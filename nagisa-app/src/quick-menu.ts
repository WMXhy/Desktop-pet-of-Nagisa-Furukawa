import { createElement as h, useLayoutEffect, useState } from 'react';
import dangoBase from './assets/quick_menu/dango_base.png';
import { quickMenuActions, type QuickMenuPresentation } from './quick-menu-layout';

const labels = { feed: '喂食', bakery: '打工', study: '学习', game: '游戏' };

export function QuickMenu() {
  const [presentation, setPresentation] = useState<QuickMenuPresentation>();
  const [shown, setShown] = useState<number>();

  useLayoutEffect(() => {
    const unsubscribePresent = window.quickMenu.onPresent(setPresentation);
    const unsubscribeShown = window.quickMenu.onShown(setShown);
    window.quickMenu.ready();
    return () => { unsubscribePresent(); unsubscribeShown(); };
  }, []);

  useLayoutEffect(() => {
    if (presentation) window.quickMenu.painted(presentation.id);
  }, [presentation]);

  if (!presentation) return null;
  const motion = presentation.reducedMotion ? '' : shown === presentation.id ? ' quick-menu--fade' : ' quick-menu--waiting';
  return h('div', { key: presentation.id, className: 'quick-menu' + motion, role: 'group', 'aria-label': '团子快捷菜单' },
    quickMenuActions.map((action) => h('button', {
      key: action, type: 'button', className: `quick-menu-button quick-menu-button--${action}`,
      onClick: () => window.quickMenu.select(presentation.id, action),
    }, h('img', { src: dangoBase, alt: '', draggable: false }), h('span', null, labels[action]))));
}
