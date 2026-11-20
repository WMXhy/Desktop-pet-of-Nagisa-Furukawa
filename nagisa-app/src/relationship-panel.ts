import { createElement as h, useEffect, useRef, useState } from 'react';
import { affectionGainedToday, localDay, practiceLineUnavailable, type Care, type CareResponse } from './care';
import { affectionLimit, dailyAffectionLimit, milestones, relationshipRank, trustThreshold } from './relationship';

const relationshipDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

export function RelationshipPanel({ state, gameBusy, busy, submit }: {
  state: Care;
  gameBusy: boolean;
  busy: boolean;
  submit: (request: () => Promise<CareResponse>, message: string) => Promise<void>;
}) {
  const [today, setToday] = useState(() => localDay());
  const anniversary = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const refresh = () => setToday(localDay());
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  function replayAnniversary() {
    const entry = anniversary.current;
    if (!entry) return;
    entry.open = true;
    entry.scrollIntoView({ block: 'nearest' });
    entry.querySelector('summary')?.focus({ preventScroll: true });
  }

  const rank = relationshipRank(state.affection);
  const practiceReason = practiceLineUnavailable(state, gameBusy);

  return h('section', { className: 'relationship', 'aria-labelledby': 'relationship-rank' },
    h('div', { className: 'relationship-overview' },
      h('h2', { id: 'relationship-rank' }, `${rank.title} · ${state.affection} / ${affectionLimit}`),
      h('p', null, rank.next ? `距离${rank.next.title}还差 ${rank.next.min - state.affection} 点` : '全部关系称号已解锁'),
      h('p', { className: 'relationship-today' }, `今日好感 ${affectionGainedToday(state, today)} / ${dailyAffectionLimit}`),
    ),
    state.affection >= trustThreshold && h('div', { className: 'relationship-actions' },
      h('button', { type: 'button', disabled: busy || Boolean(practiceReason),
        'aria-describedby': practiceReason ? 'practice-reason' : undefined,
        onClick: () => { void submit(window.pet.listenToLine, '渚准备念一句台词。'); },
      }, '听她练一句台词'),
      rank.id === 'companion' && h('button', { type: 'button', onClick: replayAnniversary }, '重看纪念对话'),
      practiceReason && h('p', { id: 'practice-reason' }, practiceReason),
    ),
    h('h3', null, '关系记录'),
    h('ol', { className: 'relationship-log' }, milestones.map((milestone) => {
      const entry = state.relationshipLog.find(({ id }) => id === milestone.id);
      if (!entry) return h('li', { key: milestone.id },
        h('strong', null, milestone.title),
        h('p', null, `好感 ${milestone.min} 解锁 · 还差 ${milestone.min - state.affection} 点`),
      );
      const date = entry.unlockedAt === null ? '从旧存档继承' : h('time', {
        dateTime: new Date(entry.unlockedAt).toISOString(),
      }, relationshipDate.format(entry.unlockedAt));
      return h('li', { key: milestone.id, 'data-milestone': milestone.id },
        h('details', { ref: milestone.id === 'companion' ? anniversary : undefined },
          h('summary', null, h('strong', null, `${milestone.title} · ${milestone.event}`)),
          h('dl', { className: 'relationship-dialogue' }, milestone.dialogue.map(({ speaker, line }) =>
            h('div', { key: line }, h('dt', null, speaker), h('dd', null, line)),
          )),
        ),
        h('p', null, date),
      );
    })),
  );
}
