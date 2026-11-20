import { createElement as h } from 'react';
import dangoPlush from './assets/items/dango_plush.png';
import miniStage from './assets/items/mini_stage.png';
import { hugUnavailable, toyIds, toyPurchaseUnavailable, toys, type Care, type CareResponse, type ToyId } from './care';
import type { DangoMode } from './dango';

const toyDetails = {
  dangoPlush: { icon: dangoPlush, use: '可以抱一抱，也能解锁猜团子的玩偶主题。', mode: 'plush', play: '玩偶主题猜团子' },
  miniStage: { icon: miniStage, use: '解锁台词接龙，和渚一起排练。', mode: 'lines', play: '台词接龙' },
} satisfies Record<ToyId, { icon: string; use: string; mode: DangoMode; play: string }>;

type Props = {
  epoch: number;
  state: Care;
  busy: boolean;
  gameBusy: boolean;
  submit: (request: () => Promise<CareResponse>, message: string) => Promise<void>;
  openGame: (mode: DangoMode) => void;
};

export function ToyShop({ state, busy, submit, openGame, epoch }: Props) {
  return h('section', { 'aria-label': '玩具店' }, toyIds.map((id) => {
    const { name, price } = toys[id];
    const { icon, use, mode, play } = toyDetails[id];
    const owned = state.ownedToys[id];
    const unavailable = toyPurchaseUnavailable(state, id);
    const quote = unavailable ?? `买后剩 ${state.coins - price} 币`;
    return h('article', { className: 'shop-product toy-product', key: id, 'aria-labelledby': `toy-${id}` },
      h('div', { className: 'shop-product-summary' }, h('img', { src: icon, alt: '', width: 48, height: 48 }),
        h('div', null, h('h2', { id: `toy-${id}` }, name), h('p', null, use))),
      h('div', { className: 'shop-purchase' },
        h('p', { id: `toy-quote-${id}` }, owned ? '已拥有' : `${price} 币 · ${quote}`),
        owned
          ? h('button', { type: 'button', 'aria-label': `现在一起玩 · ${play}`, disabled: busy, onClick: () => openGame(mode) }, '现在一起玩')
          : h('button', { type: 'button', 'aria-label': `购买${name}`, 'aria-describedby': `toy-quote-${id}`,
            disabled: busy || Boolean(unavailable),
            onClick: () => { void submit(() => window.pet.buyToy(id, state.revision, epoch), `已买下${name}。`); },
          }, `花 ${price} 币购买`),
      ),
    );
  }));
}

export function OwnedToys({ state, busy, gameBusy, submit, openGame }: Props) {
  const owned = toyIds.filter((id) => state.ownedToys[id]);
  if (owned.length === 0) return null;
  const hugReason = hugUnavailable(state, gameBusy);
  return h('section', { className: 'owned-toys', 'aria-labelledby': 'owned-toys-heading' },
    h('h3', { id: 'owned-toys-heading' }, '玩具'),
    owned.map((id) => {
      const { icon, mode, play } = toyDetails[id];
      return h('div', { className: 'owned-toy', key: id },
        h('div', { className: 'shop-product-summary' }, h('img', { src: icon, alt: '', width: 48, height: 48 }),
          h('div', null, h('strong', null, toys[id].name),
            id === 'dangoPlush' && hugReason && h('p', { id: 'hug-reason' }, hugReason))),
        h('div', { className: 'owned-toy-actions' },
          id === 'dangoPlush' && h('button', { type: 'button', disabled: busy || Boolean(hugReason),
            'aria-describedby': hugReason ? 'hug-reason' : undefined,
            onClick: () => { void submit(window.pet.hugDango, '渚抱起了团子玩偶。'); },
          }, '抱一抱'),
          h('button', { type: 'button', disabled: busy, onClick: () => openGame(mode) }, play),
        ),
      );
    }),
  );
}
