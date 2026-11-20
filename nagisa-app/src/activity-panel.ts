import { createElement as h, useEffect, useState } from 'react';
import { activityKinds, activityRules, activityUnavailable, dramaClubStudyPoints, remainingSeconds,
  specialLineStudyPoints, specialStudyLine, type Activity, type ActivityDurations, type ActivityKind,
  type Care, type CareResponse, type Reward } from './care';

type Submit = (request: () => Promise<CareResponse>, message: string) => Promise<void>;

function rewards(reward: Reward, estimated = false): string {
  const values: [string, number][] = [
    ['团子币', reward.coins], ['精力', reward.energy], ['心情', reward.mood],
    [estimated ? '好感最多' : '好感', reward.affection], ['学习点', reward.studyPoints],
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

function cancellationMessage({ kind, reward }: Activity): string {
  const { label, cost } = activityRules[kind];
  const spent = cost > 0 ? `已消耗 ${cost} 精力，` : '';
  const forfeited = reward.studyPoints > 0 ? '本次不获得学习点。'
    : reward.coins > 0 ? '本次没有工资。'
    : reward.energy > 0 ? '本次不会恢复精力。' : '本次没有收益。';
  return `现在结束${label}吗？${spent}${forfeited}`;
}

export function ActivityPanel({ state, durations, gameBusy, busy, submit }: {
  state: Care; durations: ActivityDurations; gameBusy: boolean; busy: boolean; submit: Submit;
}) {
  const [confirmation, setConfirmation] = useState<{ activity: Activity; revision: number }>();
  const [, tick] = useState(0);
  const activity = state.activeActivity;

  useEffect(() => {
    if (!activity) return;
    const timer = window.setInterval(() => tick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activity?.id]);

  function activityOption(kind: ActivityKind) {
    const unavailable = activityUnavailable(state, kind, gameBusy);
    const { label, cost, reward } = activityRules[kind];
    const description = kind === 'rest' ? `预计恢复 ${Math.min(reward.energy, 100 - state.energy)} 点精力`
      : `消耗 ${cost} 精力，完成后${rewards(reward, true)}`;
    return h('div', { className: 'activity-row', key: kind },
      h('div', null, h('strong', null, label), h('p', null, unavailable ?? description)),
      h('button', { type: 'button', disabled: busy || Boolean(unavailable),
        onClick: () => { void submit(() => window.pet.startActivity(kind, state.revision), `已开始${label}。`); } },
      `${label} ${durationLabel(durations[kind])}`),
    );
  }

  const remaining = activity ? remainingSeconds(activity, Date.now()) : 0;
  const studyProgress = state.studyPoints >= specialLineStudyPoints ? `专属待机语句 “${specialStudyLine}”`
    : state.studyPoints >= dramaClubStudyPoints ? `再得 ${specialLineStudyPoints - state.studyPoints} 学习点，解锁专属待机语句。`
    : `再得 ${dramaClubStudyPoints - state.studyPoints} 学习点，开放戏剧部活动。`;
  return h('section', { className: 'care-activities', 'aria-labelledby': 'activities-heading' },
    h('h2', { id: 'activities-heading' }, '活动'),
    h('p', { className: 'study-progress' }, studyProgress),
    activity && h('div', { className: 'activity-row' },
      h('div', null,
        h('strong', null, `${activityRules[activity.kind].label} · ${remaining ? countdown(remaining) : '正在结算'}`),
        h('p', null, `预计：${activity.kind === 'rest'
          ? `精力 +${Math.min(100 - state.energy, activity.reward.energy)}` : rewards(activity.reward, true)}`),
      ),
      !confirmation && h('button', { type: 'button', disabled: busy || remaining === 0,
        onClick: () => setConfirmation({ activity, revision: state.revision }) }, '取消活动'),
    ),
    confirmation && h('div', { className: 'activity-confirm', role: 'group', 'aria-label': '确认取消活动' },
      h('p', null, cancellationMessage(confirmation.activity)),
      h('button', { type: 'button', disabled: busy, onClick: () => setConfirmation(undefined) }, '返回手账'),
      h('button', { type: 'button', disabled: busy, onClick: async () => {
        await submit(() => window.pet.cancelActivity(confirmation.activity.id, confirmation.revision), '已取消活动。');
        setConfirmation(undefined);
      } }, '确认取消'),
    ),
    !activity && !confirmation && activityKinds.map(activityOption),
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
