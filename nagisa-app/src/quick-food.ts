import { createElement as h, useEffect, useLayoutEffect, useRef, useState,
  type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import type { Rectangle } from 'electron';
import { foodIds, foods, foodUnavailable, previewFood, purchaseUnavailable, type Care, type FoodId } from './care';
import { useCareSnapshot } from './care-snapshot';
import { foodArt } from './food-art';
import { quickFoodLayer, quickOverlayLayer, type FoodOverlay } from './quick-menu-layout';
import './quick-food.css';

const descriptions: Record<FoodId, string> = {
  bread: '刚出炉的小面包，软软的。',
  redBeanBread: '松软的面包里裹着一层红豆馅。',
  dangoSnack: '软糯的小团子，带一点甜味。',
};

export function panelStyle({ x, y, width, height }: Rectangle) {
  return { left: x, top: y, width, height };
}

type CardOverlay = Extract<FoodOverlay, { kind: 'card' }>;
type Props = { id: number; session: number; strip: Rectangle; panel?: Rectangle; overlay?: FoodOverlay;
  onSubmitting(layer: string, busy: boolean): void };

export function QuickFood({ id, session, strip, panel, overlay, onSubmitting }: Props) {
  const api = window.quickMenu;
  const { care, loadCare } = useCareSnapshot({ readCare: () => api.readCare(id, session), onCareChanged: api.onCareChanged });
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const stripElement = useRef<HTMLElement>(null);
  const items = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, max: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef<{ food: FoodId; token: number; published: boolean } | undefined>(undefined);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextToken = useRef(0);
  const previousCard = useRef<CardOverlay | undefined>(undefined);
  const previousTip = useRef<number | undefined>(undefined);
  const card = overlay?.kind === 'card' ? overlay : undefined;
  const tip = overlay?.kind === 'tip' ? overlay : undefined;

  function closeOverlay(token: number) { api.overlay(id, session, { kind: 'close', token }); }

  function clearTip() {
    clearTimeout(hoverTimer.current);
    if (hovered.current?.published) closeOverlay(hovered.current.token);
    hovered.current = undefined;
  }

  function leaveFood() {
    if (!hovered.current?.published) clearTip();
  }

  function startTip(food: FoodId, button: HTMLElement) {
    if (card || hovered.current?.food === food) return;
    clearTip();
    const token = ++nextToken.current;
    hovered.current = { food, token, published: false };
    hoverTimer.current = setTimeout(() => {
      const hover = hovered.current;
      if (hover?.token !== token || !button.isConnected || !stripElement.current || !items.current) return;
      const tile = button.getBoundingClientRect();
      const track = items.current.getBoundingClientRect();
      const origin = stripElement.current.getBoundingClientRect();
      const left = Math.max(tile.left, track.left);
      const right = Math.min(tile.right, track.right);
      if (right <= left) { hovered.current = undefined; return; }
      hover.published = true;
      api.overlay(id, session, { kind: 'tip', food, token, target: {
        x: Math.round(left - origin.left), y: Math.round(tile.top - origin.top),
        width: Math.max(1, Math.round(right - left)), height: Math.max(1, Math.round(tile.height)),
      } });
    }, 1000);
  }

  function report(message: string, success = false) {
    clearTimeout(feedbackTimer.current);
    setFeedback(message);
    if (success) feedbackTimer.current = setTimeout(() => setFeedback(''), 3000);
  }

  function syncScroll() {
    const element = items.current;
    if (!element) return;
    const left = Math.round(element.scrollLeft);
    const max = element.scrollWidth - element.clientWidth;
    setScroll((current) => current.left === left && current.max === max ? current : { left, max });
  }

  useLayoutEffect(() => {
    const surface = stripElement.current;
    const element = items.current;
    if (!surface || !element) return;
    mounted.current = true;
    function wheel(event: WheelEvent) {
      clearTip();
      if (!element || element.scrollWidth <= element.clientWidth) return;
      const units = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? element.clientWidth : 1;
      const amount = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * units;
      if (!amount) return;
      event.preventDefault();
      element.scrollLeft += amount;
    }
    const observer = new ResizeObserver(syncScroll);
    observer.observe(element);
    surface.addEventListener('wheel', wheel, { passive: false });
    syncScroll();
    return () => {
      observer.disconnect();
      surface.removeEventListener('wheel', wheel);
      clearTimeout(hoverTimer.current);
      clearTimeout(feedbackTimer.current);
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const previous = previousCard.current;
    previousCard.current = card;
    if (!card && previous?.keyboard) {
      items.current?.querySelector<HTMLElement>(`[data-food="${previous.food}"]`)?.focus({ preventScroll: true });
    }
  }, [card?.token]);

  useLayoutEffect(() => {
    const old = previousTip.current;
    previousTip.current = tip?.token;
    if (old !== undefined && old !== tip?.token && hovered.current?.token === old) hovered.current = undefined;
  }, [tip?.token]);

  const status = card ? '' : feedback || (care?.ok === false ? care.message : !care ? '正在读取…' : '');
  const showStatus = Boolean(status);
  useLayoutEffect(() => { api.feedback(id, session, showStatus); }, [showStatus]);

  function openCard(food: FoodId, keyboard: boolean) {
    clearTip();
    report('');
    api.overlay(id, session, { kind: 'card', food, keyboard, token: ++nextToken.current });
  }

  async function submit(food: FoodId, purchase?: { token: number; quantity: number }) {
    if (!care?.ok || submitting.current) return;
    const layer = purchase ? quickOverlayLayer(session, purchase.token) : quickFoodLayer(session);
    submitting.current = true;
    onSubmitting(layer, true);
    setPending(true);
    report('');
    try {
      const result = await api.changeFood(id, session, food, care.state.revision, care.epoch, purchase);
      if (!mounted.current) return;
      if (result.ok === false) {
        report(result.message);
        void loadCare();
      } else if (purchase) {
        closeOverlay(purchase.token);
        report(`已补货 ×${purchase.quantity}`, true);
      } else {
        report(`已喂一个${foods[food].name}。`, true);
      }
    } catch {
      if (mounted.current) {
        report('操作暂时未完成，请重新查看。');
        void loadCare();
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
      onSubmitting(layer, false);
    }
  }

  function useFood(food: FoodId, keyboard: boolean) {
    clearTip();
    if (!care?.ok || submitting.current) return;
    if (care.state.inventory[food] === 0) { openCard(food, keyboard); return; }
    const unavailable = foodUnavailable(care.state, food, care.gameBusy);
    if (unavailable) report(unavailable);
    else {
      if (card) closeOverlay(card.token);
      void submit(food);
    }
  }

  const state = care?.ok ? care.state : undefined;
  return h('div', { className: 'quick-food-layer' },
    h('section', { ref: stripElement, className: 'quick-food-strip', style: panelStyle(strip), 'aria-label': '头顶食物栏',
      'data-quick-layer': quickFoodLayer(session) },
      h('div', { ref: items, className: 'quick-food-items', onScroll: () => { clearTip(); syncScroll(); } },
        foodIds.map((food) => {
          const count = state?.inventory[food];
          return h('button', {
            key: food, type: 'button', 'data-food': food, className: count === 0 ? 'quick-food-item out-of-stock' : 'quick-food-item',
            'aria-label': `${foods[food].name}，${count === undefined ? '库存读取中' : `库存 ${count}`}`,
            'aria-describedby': tip?.food === food ? 'quick-food-tooltip' : undefined,
            'data-quick-layer': tip?.food === food ? quickOverlayLayer(session, tip.token) : undefined,
            onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
              if (event.pointerType !== 'touch') startTip(food, event.currentTarget);
            },
            onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
              if (event.pointerType !== 'touch' && !event.buttons) startTip(food, event.currentTarget);
            },
            onPointerLeave: leaveFood,
            onFocus: (event: FocusEvent<HTMLButtonElement>) => {
              if (event.currentTarget.matches(':focus-visible')) startTip(food, event.currentTarget);
            },
            onBlur: leaveFood,
            onClick: (event: MouseEvent<HTMLButtonElement>) => useFood(food, event.detail === 0),
            onContextMenu: (event: MouseEvent<HTMLButtonElement>) => { event.preventDefault(); if (state) openCard(food, false); },
            onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
              event.preventDefault();
              if (state) openCard(food, true);
            },
          }, h('img', { src: foodArt[food].icon, alt: '', draggable: false }),
          h('span', { className: 'quick-food-count' }, count === undefined ? '×–' : `×${count}`));
        }),
      ),
      h('input', {
        className: 'quick-food-scroll' + (scroll.max ? '' : ' quick-food-scroll--full'),
        type: 'range', min: 0, max: Math.max(1, scroll.max), step: 1,
        value: scroll.max ? scroll.left : 1, disabled: !scroll.max, 'aria-label': '横向浏览食物',
        onPointerDown: clearTip,
        onChange: (event: FormEvent<HTMLInputElement>) => {
          clearTip();
          if (items.current) items.current.scrollLeft = event.currentTarget.valueAsNumber;
        },
      }),
      h('div', { className: 'quick-food-feedback quick-food-strip-feedback' + (showStatus ? '' : ' quick-food-feedback-empty'),
        role: 'status', title: status || undefined }, status),
    ),
    tip && panel && state && h(FoodTip, { bounds: panel, food: tip.food, state }),
    card && panel && state && h(PurchaseCard, { key: card.token, card, bounds: panel, state, pending, feedback,
      layer: quickOverlayLayer(session, card.token), buy: (quantity) => void submit(card.food, { token: card.token, quantity }) }),
  );
}

function FoodTip({ bounds, food, state }: { bounds: Rectangle; food: FoodId; state: Care }) {
  const next = previewFood(state, food);
  return h('div', { id: 'quick-food-tooltip', className: 'quick-food-tip', role: 'tooltip', style: panelStyle(bounds) },
    h('strong', null, foods[food].name),
    h('div', null, `心情 +${next.mood - state.mood} · 饱食度 +${next.fullness - state.fullness} · 好感 +${next.affection - state.affection}`),
    state.inventory[food] === 0 && h('div', null, '已吃完，点击补货'));
}

type PurchaseProps = {
  card: CardOverlay; bounds: Rectangle; state: Care; pending: boolean; feedback: string;
  layer: string; buy(quantity: number): void;
};

function PurchaseCard({ card, bounds, state, pending, feedback, layer, buy }: PurchaseProps) {
  const item = foods[card.food];
  const max = Math.min(Math.floor(state.coins / item.price), Number.MAX_SAFE_INTEGER - state.inventory[card.food]);
  const [quantity, setQuantity] = useState(Math.min(1, max));
  const chosen = Math.min(quantity, max);
  const reason = purchaseUnavailable(state, card.food, max === 0 ? 1 : chosen);
  const total = chosen * item.price;
  const surface = useRef<HTMLElement>(null);
  const slider = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (card.keyboard) focusControl(slider, surface);
  }, []);
  useEffect(() => { if (quantity > max) setQuantity(max); }, [max, quantity]);

  return h('section', {
    ref: surface, className: 'quick-food-card', style: panelStyle(bounds), tabIndex: -1, 'aria-label': `购买${item.name}`,
    'data-quick-layer': layer,
  },
  h('div', { className: 'quick-food-card-product' }, h('img', { src: foodArt[card.food].icon, alt: '', draggable: false }),
    h('div', null, h('strong', null, item.name), h('span', { className: 'quick-food-price' }, `${item.price} 团子币 / 个`),
      h('p', null, descriptions[card.food]))),
  h('div', { className: 'quick-food-quantity' },
    h('label', { htmlFor: 'quick-food-quantity' }, `数量 ${chosen}`),
    h('div', { className: 'quick-food-slider' }, h('span', null, '0'), h('input', {
      id: 'quick-food-quantity', ref: slider, type: 'range', min: 0, max: Math.max(1, max), step: 1, value: chosen,
      disabled: pending || max === 0, 'aria-valuetext': `${chosen} 个，最多 ${max}`,
      onChange: (event: FormEvent<HTMLInputElement>) => setQuantity(event.currentTarget.valueAsNumber),
    }), h('span', null, `最多 ${max}`)),
  ),
  h('div', { className: 'quick-food-checkout' },
    h('div', null, `余额 ${state.coins} 币`, h('span', null, ` · 买后剩 ${state.coins - total} 币`)),
    h('button', { type: 'button', disabled: pending || Boolean(reason), onClick: () => buy(chosen) },
      chosen ? `购买 · ${total} 币` : '购买')),
  h('div', { className: 'quick-food-feedback', role: 'status' },
    feedback || (max === 0 ? reason === '团子币不足。' ? '余额不足' : reason : '')),
  );
}

function focusControl(slider: RefObject<HTMLInputElement | null>, surface: RefObject<HTMLElement | null>) {
  (slider.current && !slider.current.disabled ? slider.current : surface.current)?.focus();
}
