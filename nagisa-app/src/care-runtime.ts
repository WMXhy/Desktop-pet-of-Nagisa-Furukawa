import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { powerMonitor } from 'electron';
import { createCareStore } from './care-store';
import { activityDurations, advanceOnline, buyFood, cancelActivity, claimBread, feedFood, finishDue, hungerInterval, idleInterval, localDay, startActivity,
  type ActivityKind, type ActivityRecord, type Care, type CareChange, type CareResponse, type CareResult, type FoodId,
  type CareSnapshot, type OnlineTime } from './care';

export function createCareRuntime(directory: string, fast: boolean, publish: (change: CareChange) => void) {
  const store = createCareStore(directory);
  const durations = activityDurations(fast);
  const pending: OnlineTime = { hungerMs: 0, idleMs: 0 };
  let lastSample = Math.floor(performance.now());
  let suspended = false;
  let stopped = false;
  let retryUntil = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let warning: string | undefined;

  function snapshot(): CareSnapshot {
    return { ...store.snapshot(), durations, warning };
  }

  function schedule() {
    clearTimeout(deadline);
    const saved = store.snapshot();
    const activity = saved.ok && saved.state.activeActivity;
    if (!activity || stopped || suspended) return;
    const delay = Math.max(0, activity.endsAt - Date.now(), retryUntil - performance.now());
    deadline = setTimeout(() => {
      const current = store.snapshot();
      if (!current.ok || current.state.activeActivity?.id !== activity.id) return;
      if (!advance(Date.now())) schedule();
    }, Math.min(0x7fffffff, Math.ceil(delay)));
  }

  function sample(now: number, state: Care | undefined) {
    const next = Math.floor(performance.now());
    const elapsed = next - lastSample;
    lastSample = next;
    if (!state || suspended) return;
    pending.hungerMs += elapsed;
    // 跨过截止点的采样段，只有截止点之后才算空闲。
    pending.idleMs += state.activeActivity
      ? Math.min(elapsed, Math.max(0, now - state.activeActivity.endsAt))
      : elapsed;
  }

  function commit(state: Care, completed?: ActivityRecord, writeFailure?: string): CareResponse {
    const result = store.commit(state, writeFailure);
    if (result.ok) {
      pending.hungerMs = 0;
      pending.idleMs = 0;
      retryUntil = 0;
      warning = undefined;
      publish({ snapshot: snapshot(), completed });
      schedule();
    }
    return result;
  }

  function advance(now: number, { force = false, announce = true, retry = false } = {}): CareResponse | undefined {
    const saved = store.snapshot();
    const state = saved.ok ? saved.state : undefined;
    sample(now, state);
    if (!state) return;

    const activity = state.activeActivity;
    const due = activity && activity.endsAt <= now;
    const elapsed = pending.hungerMs > 0 || pending.idleMs > 0;
    const crossesThreshold = state.online.hungerMs + pending.hungerMs >= hungerInterval ||
      state.online.idleMs + pending.idleMs >= idleInterval;
    if (!due && !crossesThreshold && !(force && elapsed)) return;
    if (!retry && performance.now() < retryUntil) return { ok: false, state, message: warning };

    // 先结算活动，再计入截止点后累计的空闲恢复，记录只包含活动实际奖励。
    const completion = due ? finishDue(state, activity.id, now) : undefined;
    const result = commit(advanceOnline(completion?.state ?? state, pending), announce ? completion?.entry : undefined);
    if (result.ok === false) {
      warning = due ? '活动暂时无法结算，稍后会自动重试。' : result.message;
      retryUntil = performance.now() + 5000;
      publish({ snapshot: snapshot() });
      schedule();
      return { ...result, message: warning };
    }
    return result;
  }

  function apply(operation: (state: Care, now: number) => CareResult, writeFailure?: string): CareResponse {
    const now = Date.now();
    const advancement = advance(now, { retry: true });
    if (advancement?.ok === false) return advancement;
    const saved = store.snapshot();
    if (saved.ok === false) return saved;
    const change = operation(saved.state, now);
    if (change.ok === false) return change;
    return commit(advanceOnline(change.state, pending), undefined, writeFailure);
  }

  function suspend() {
    advance(Date.now(), { force: true, retry: true });
    suspended = true;
    clearTimeout(deadline);
  }

  function resume() {
    lastSample = Math.floor(performance.now());
    suspended = false;
    advance(Date.now(), { retry: true });
    schedule();
  }

  advance(Date.now(), { announce: false });
  schedule();
  const tick = setInterval(() => { if (!suspended) advance(Date.now()); }, 1000);
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('resume', resume);

  return {
    read(): CareSnapshot {
      const recovered = store.snapshot().ok === false && store.read().ok;
      if (recovered) lastSample = Math.floor(performance.now());
      advance(Date.now(), { announce: !recovered });
      if (recovered) schedule();
      return snapshot();
    },
    feed: (id: FoodId, revision: number) => apply((state, now) => feedFood(state, id, revision, localDay(new Date(now))), '存档写入失败，食物已保留。'),
    buy: (id: FoodId, quantity: number, revision: number) => apply((state) => buyFood(state, id, quantity, revision), '存档写入失败，本次购买未完成。'),
    claimBread: (revision: number) => apply((state) => claimBread(state, revision), '存档写入失败，本次补给未领取。'),
    start: (kind: ActivityKind, revision: number) => apply((state, now) => startActivity(state, kind, revision, randomUUID(), now, durations[kind])),
    cancel: (id: string, revision: number) => apply((state, now) => cancelActivity(state, id, revision, now)),
    close() {
      stopped = true;
      clearInterval(tick);
      clearTimeout(deadline);
      powerMonitor.off('suspend', suspend);
      powerMonitor.off('resume', resume);
      advance(Date.now(), { force: true, announce: false, retry: true });
    },
  };
}
