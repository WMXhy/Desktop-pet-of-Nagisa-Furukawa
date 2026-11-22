import { createElement as h, useLayoutEffect, useState } from 'react';
import dangoBase from './assets/quick_menu/dango_base.png';
import { QuickFood, panelStyle } from './quick-food';
import { quickMenuActions, type QuickMenuPresentation, type QuickMenuView } from './quick-menu-layout';

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
  const motion = presentation.reducedMotion ? '' : shown === presentation.id ? ' quick-menu--fade' : ' quick-menu--waiting';
  return h('div', { key: presentation.id },
    h('div', { className: 'quick-menu' + motion, style: panelStyle(view.side), role: 'group', 'aria-label': '团子快捷菜单' },
      quickMenuActions.map((action) => h('button', {
        key: action, type: 'button', className: `quick-menu-button quick-menu-button--${action}`,
        'aria-pressed': action === 'feed' ? view.foodSession !== undefined : undefined,
        onClick: () => window.quickMenu.select(presentation.id, action),
      }, h('img', { src: dangoBase, alt: '', draggable: false }), h('span', null, labels[action])))),
    view.foodSession !== undefined && view.strip && h(QuickFood, {
      key: view.foodSession, id: view.id, session: view.foodSession, strip: view.strip, panel: view.panel, overlay: view.overlay,
    }),
  );
}
