import { createElement as h, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { canClaimBread, foodIds, foods, foodUnavailable, previewFood, purchaseUnavailable,
  type Care, type CareResponse, type FoodId } from './care';
import { foodArt } from './food-art';

type Submit = (request: () => Promise<CareResponse>, message: string, onSuccess?: () => void) => Promise<void>;
type Props = { state: Care; busy: boolean; submit: Submit };

function effects(id: FoodId): string {
  const { fullness, mood, affection } = foods[id];
  return [`饱食 +${fullness}`, mood ? `心情 +${mood}` : '', `好感 +${affection}`].filter(Boolean).join(' · ');
}

function feedPreview(state: Care, id: FoodId): string {
  const next = previewFood(state, id);
  return [`饱食 ${state.fullness} → ${next.fullness}`,
    foods[id].mood ? `心情 ${state.mood} → ${next.mood}` : '',
    `好感 +${next.affection - state.affection}`].filter(Boolean).join(' · ');
}

function feed(state: Care, id: FoodId, submit: Submit, onSuccess?: () => void) {
  return submit(() => window.pet.feedFood(id, state.revision), `已喂一个${foods[id].name}。`, onSuccess);
}

export function Backpack({ state, busy, submit }: Props) {
  const stocked = foodIds.filter((id) => id === 'bread' || state.inventory[id] > 0);
  return h('section', { className: 'backpack', 'aria-labelledby': 'backpack-heading' },
    h('h2', { id: 'backpack-heading' }, '背包'),
    stocked.map((id) => {
      const unavailable = foodUnavailable(state, id);
      const detailId = id === 'bread' ? 'bread-effect' : `effect-${id}`;
      return h('div', { className: 'bread-row', key: id },
        h('img', { src: foodArt[id].icon, alt: '', width: 48, height: 48 }),
        h('div', { className: 'bread-description' },
          h('strong', null, `${foods[id].name} × ${state.inventory[id]}`),
          h('p', { id: detailId }, unavailable ?? feedPreview(state, id)),
        ),
        h('button', { type: 'button', disabled: busy || Boolean(unavailable), 'aria-describedby': detailId,
          'aria-label': id === 'bread' ? '喂给渚' : `喂给渚：${foods[id].name}`,
          onClick: () => { void feed(state, id, submit); } }, '喂给渚'),
      );
    }),
    canClaimBread(state) && h('button', { type: 'button', disabled: busy, className: 'emergency-bread',
      onClick: () => { void submit(() => window.pet.claimBread(state.revision), '已领取一个应急小面包。'); } }, '领取应急小面包'),
  );
}

export function SnackShop({ state, busy, submit }: Props) {
  const [quantities, setQuantities] = useState<Record<FoodId, string>>({ bread: '1', redBeanBread: '1', dangoSnack: '1' });
  const [purchase, setPurchase] = useState<{ id: FoodId; quantity: number }>();
  const receipt = useRef<HTMLDivElement>(null);
  const feedReason = purchase && foodUnavailable(state, purchase.id);
  useEffect(() => {
    if (purchase) receipt.current?.scrollIntoView({ block: 'nearest' });
  }, [purchase]);

  return h('section', { className: 'snack-shop', 'aria-label': '零食店' },
    purchase && h('div', { className: 'shop-receipt', ref: receipt },
      h('p', { role: 'status' }, `${foods[purchase.id].name} ×${purchase.quantity} 已放入背包。`),
      h('button', { type: 'button', disabled: busy || Boolean(feedReason),
        'aria-describedby': feedReason ? 'quick-feed-reason' : undefined,
        onClick: () => { void feed(state, purchase.id, submit, () => setPurchase(undefined)); } }, '现在喂给她'),
      feedReason && h('p', { id: 'quick-feed-reason' }, feedReason),
    ),
    foodIds.map((id) => {
      const { name, price } = foods[id];
      const quantity = Number(quantities[id]);
      const total = price * quantity;
      const unavailable = purchaseUnavailable(state, id, quantity);
      const quote = `quote-${id}`;
      return h('article', { className: 'shop-product', key: id, 'aria-labelledby': `product-${id}` },
        h('div', { className: 'shop-product-summary' },
          h('img', { src: foodArt[id].icon, alt: '', width: 48, height: 48 }),
          h('div', null,
            h('h2', { id: `product-${id}` }, name),
            h('p', null, `${price} 币 / 个 · 背包 ${state.inventory[id]} 个`),
            h('p', null, effects(id)),
          ),
        ),
        h('div', { className: 'shop-purchase' },
          h('label', null, '数量', h('input', { type: 'number', min: 1, step: 1, value: quantities[id], disabled: busy,
            'aria-label': `${name}数量`, 'aria-describedby': quote,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              const value = event.currentTarget.value;
              setQuantities((current) => ({ ...current, [id]: value }));
            },
          })),
          h('button', { type: 'button', disabled: busy || Boolean(unavailable), 'aria-describedby': quote,
            onClick: () => {
              setPurchase(undefined);
              void submit(() => window.pet.buyFood(id, quantity, state.revision), '', () => setPurchase({ id, quantity }));
            },
          }, Number.isSafeInteger(total) && total > 0 ? `花 ${total} 币购买` : '购买'),
        ),
        h('p', { className: 'shop-quote', id: quote }, unavailable ?? `购买后剩 ${state.coins - total} 币`),
      );
    }),
  );
}
