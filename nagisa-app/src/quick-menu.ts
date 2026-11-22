import { createElement as h, useLayoutEffect, useRef, useState } from 'react';
import dangoBase from './assets/quick_menu/dango_base.png';
import { QuickFood, panelStyle } from './quick-food';
import { quickMenuActions, quickMenuLayer, type QuickMenuPresentation, type QuickMenuView } from './quick-menu-layout';

const labels = { feed: '喂食', bakery: '打工', study: '学习', game: '游戏' };

export function QuickMenu() {
  const [presentation, setPresentation] = useState<QuickMenuPresentation>();
  const [shown, setShown] = useState<number>();
  const [view, setView] = useState<QuickMenuView>();

  useLayoutEffect(() => {
    const unsubscribePresent = window.quickMenu.onPresent(setPresentation);
    const unsubscribeShown = window.quickMenu.onShown(setShown);
    const unsubscribeView = window.quickMenu.onView(setView);
    const unsubscribeClosed = window.quickMenu.onClosed((id) => {
      setPresentation((current) => current?.id === id ? undefined : current);
      setView((current) => current?.id === id ? undefined : current);
    });
    window.quickMenu.ready();
    return () => { unsubscribePresent(); unsubscribeShown(); unsubscribeView(); unsubscribeClosed(); };
  }, []);

  useLayoutEffect(() => {
    if (presentation) window.quickMenu.painted(presentation.id);
  }, [presentation]);

  if (!presentation || view?.id !== presentation.id) return null;
  return h(QuickMenuContents, { key: presentation.id, presentation, view, shown: shown === presentation.id });
}

function QuickMenuContents({ presentation, view, shown }: {
  presentation: QuickMenuPresentation; view: QuickMenuView; shown: boolean;
}) {
  const id = presentation.id;
  const keyboard = useRef(false);
  const drag = useRef<{ id: number; input: HTMLInputElement } | undefined>(undefined);
  const submissions = useRef(new Set<string>());

  function layerFor(element: Element | null) {
    return element?.closest<HTMLElement>('[data-quick-layer]')?.dataset.quickLayer;
  }

  function syncActivity() {
    const layers = new Set(submissions.current);
    const focus = keyboard.current ? layerFor(document.activeElement) : undefined;
    if (focus) layers.add(focus);
    const input = drag.current?.input;
    const captured = input?.isConnected ? layerFor(input) : undefined;
    if (captured) layers.add(captured);
    else drag.current = undefined;
    window.quickMenu.activity(id, [...layers]);
  }

  useLayoutEffect(() => {
    let frame = 0;
    function refresh() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; syncActivity(); });
    }
    function keyDown() { keyboard.current = true; refresh(); }
    function blur() { keyboard.current = false; syncActivity(); }
    function pointerDown(event: PointerEvent) {
      keyboard.current = false;
      const input = event.target;
      if (event.button === 0 && input instanceof HTMLInputElement &&
          input.type === 'range' && !input.disabled && layerFor(input)) {
        input.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, input };
      }
      syncActivity();
    }
    function release(event: PointerEvent) {
      if (drag.current?.id === event.pointerId) drag.current = undefined;
      syncActivity();
    }
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('lostpointercapture', release, true);
    document.addEventListener('pointermove', refresh);
    document.addEventListener('pointerover', refresh);
    document.addEventListener('pointerout', refresh);
    document.addEventListener('focusin', refresh);
    document.addEventListener('focusout', refresh);
    document.addEventListener('keydown', keyDown, true);
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('lostpointercapture', release, true);
      document.removeEventListener('pointermove', refresh);
      document.removeEventListener('pointerover', refresh);
      document.removeEventListener('pointerout', refresh);
      document.removeEventListener('focusin', refresh);
      document.removeEventListener('focusout', refresh);
      document.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('blur', blur);
    };
  }, []);

  useLayoutEffect(syncActivity, [view, shown]);
  const motion = presentation.reducedMotion ? '' : shown ? ' quick-menu--fade' : ' quick-menu--waiting';
  return h('div', null,
    h('div', { className: 'quick-menu' + motion, style: panelStyle(view.side), role: 'group', 'aria-label': '团子快捷菜单',
      'data-quick-layer': quickMenuLayer(id) },
      quickMenuActions.map((action) => h('button', {
        key: action, type: 'button', className: `quick-menu-button quick-menu-button--${action}`,
        'aria-pressed': action === 'feed' ? view.foodSession !== undefined : undefined,
        onClick: () => window.quickMenu.select(presentation.id, action),
      }, h('img', { src: dangoBase, alt: '', draggable: false }), h('span', null, labels[action])))),
    view.foodSession !== undefined && view.strip && h(QuickFood, {
      key: view.foodSession, id: view.id, session: view.foodSession, strip: view.strip, panel: view.panel, overlay: view.overlay,
      onSubmitting: (layer, busy) => {
        if (busy) submissions.current.add(layer);
        else submissions.current.delete(layer);
        syncActivity();
      },
    }),
  );
}
