import { createElement as h, useEffect, useState } from 'react';
import { activityRules, activityUnavailable, remainingSeconds,
  type ActivityDurations, type ActivityKind, type Care, type CareResponse, type Reward } from './care';

type Submit = (request: () => Promise<CareResponse>, message: string) => Promise<void>;

function rewards(reward: Reward): string {
  const values: [string, number][] = [
    ['团子币', reward.coins], ['精力', reward.energy], ['心情', reward.mood], ['好感', reward.affection],
  ];
  return values.filter(([, value]) => value !== 0).map(([label, value]) =>
    `${label} ${value > 0 ? '+' : '−'}${Math.abs(value)}`).join('，');
}

function durationLabel(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} 分钟` : `${Math.ceil(ms / 1000)} 秒`;
}

function countdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function ActivityPanel({ state, durations, busy, submit }: {
  state: Care; durations: ActivityDurations; busy: boolean; submit: Submit;
}) {
  const [confirmation, setConfirmation] = useState<{ id: string; revision: number; kind: ActivityKind }>();
  const [, tick] = useState(0);
  const activity = state.activeActivity;

  useEffect(() => {
    if (!activity) return;
    const timer = window.setInterval(() => tick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activity?.id]);

  function activityOption(kind: ActivityKind, description: string) {
    const unavailable = activityUnavailable(state, kind);
    const label = activityRules[kind].label;
    return h('div', { className: 'activity-row' },
      h('div', null, h('strong', null, label), h('p', null, unavailable ?? description)),
      h('button', { type: 'button', disabled: busy || Boolean(unavailable),
        onClick: () => { void submit(() => window.pet.startActivity(kind, state.revision), `已开始${label}。`); } },
      `${label} ${durationLabel(durations[kind])}`),
    );
  }

  const remaining = activity ? remainingSeconds(activity, Date.now()) : 0;
  return h('section', { className: 'care-activities', 'aria-labelledby': 'activities-heading' },
    h('h2', { id: 'activities-heading' }, '活动'),
    activity && h('div', { className: 'activity-row' },
      h('div', null,
        h('strong', null, `${activityRules[activity.kind].label} · ${remaining ? countdown(remaining) : '正在结算'}`),
        h('p', null, `预计：${activity.kind === 'rest'
          ? `精力 +${Math.min(100 - state.energy, activity.reward.energy)}` : rewards(activity.reward)}`),
      ),
      !confirmation && h('button', { type: 'button', disabled: busy || remaining === 0,
        onClick: () => setConfirmation({ id: activity.id, kind: activity.kind, revision: state.revision }) }, '取消活动'),
    ),
    confirmation && h('div', { className: 'activity-confirm', role: 'group', 'aria-label': '确认取消活动' },
      h('p', null, confirmation.kind === 'bakery'
        ? '现在回家吗？已花的 10 点精力会保留，本次没有工资。' : '现在结束休息吗？本次不会恢复精力。'),
      h('button', { type: 'button', disabled: busy, onClick: () => setConfirmation(undefined) }, '返回手账'),
      h('button', { type: 'button', disabled: busy, onClick: async () => {
        await submit(() => window.pet.cancelActivity(confirmation.id, confirmation.revision), '已取消活动。');
        setConfirmation(undefined);
      } }, '确认取消'),
    ),
    !activity && !confirmation && activityOption('rest', `预计恢复 ${Math.min(15, 100 - state.energy)} 点精力`),
    !activity && !confirmation && activityOption('bakery', '消耗 10 精力，完成后团子币 +18、心情 −3、好感最多 +1'),
    state.activityLog.length > 0 && h('div', { className: 'activity-history' },
      h('h3', null, '最近记录'),
      h('ul', null, state.activityLog.map((entry) => h('li', { key: entry.id },
        h('time', { dateTime: new Date(entry.endedAt).toISOString() }, new Date(entry.endedAt).toLocaleString('zh-CN', { hour12: false })),
        h('span', null, entry.outcome === 'completed'
          ? `${activityRules[entry.kind].label}完成${rewards(entry.actual) ? `，${rewards(entry.actual)}` : '，数值已达上限'}`
          : `${activityRules[entry.kind].label}已取消，无收益`),
      ))),
    ),
  );
}
