import { randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { powerMonitor } from 'electron';
import { createCareStore } from './care-store';
import { activityDurations, advanceOnline, buyFood, buyToy, cancelActivity, claimBread, dangoUnavailable, feedFood, finishDango, finishDue,
  greetToday as recordGreeting, hungerInterval, idleInterval, localDay, startActivity,
  type ActivityKind, type ActivityRecord, type Care, type CareChange, type CareResponse, type CareResult, type FoodId,
  type CareSnapshot, type GreetingResponse, type OnlineTime, type ToyId } from './care';
import { dangoCoverMs, dangoEnergyCost, dangoPreviewMs, dangoSlots,
  type DangoMode, type DangoPreview, type DangoResponse, type DangoResult, type DangoSlot } from './dango';
import { drawDangoLines } from './dango-lines';
import { newMilestones } from './relationship';

type DangoSession = { preview: DangoPreview; target: DangoSlot; owner: symbol; chooseAt: number; picked?: DangoSlot };
type CommitOptions = { completed?: ActivityRecord; writeFailure?: string; announceRelationship?: boolean;
  afterSave?: () => Pick<CareChange, 'dangoStarted' | 'dangoCompleted'> | void };

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
  let dango: DangoSession | undefined;
  let lastDango: { owner: symbol; result: DangoResult } | undefined;

  function snapshot(): CareSnapshot {
    return { ...store.snapshot(), durations, gameBusy: Boolean(dango), warning };
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
    if (dango) return;
    // 跨过截止点的采样段，只有截止点之后才算空闲。
    pending.idleMs += state.activeActivity
      ? Math.min(elapsed, Math.max(0, now - state.activeActivity.endsAt))
      : elapsed;
  }

  function commit(state: Care, { completed, writeFailure, afterSave, announceRelationship = true }: CommitOptions = {}): CareResponse {
    const before = store.snapshot();
    if (before.ok === false) return before;
    const unlocked = newMilestones(before.state.affection, state.affection, state.relationshipLog.map(({ id }) => id));
    const unlockedAt = Date.now();
    const result = store.commit(unlocked.length > 0 ? { ...state,
      relationshipLog: [...state.relationshipLog, ...unlocked.map(({ id }) => ({ id, unlockedAt }))] } : state, writeFailure);
    if (result.ok) {
      pending.hungerMs = 0;
      pending.idleMs = 0;
      retryUntil = 0;
      warning = undefined;
      const gameChange = afterSave?.();
      const relationshipUnlocked = announceRelationship && unlocked.length > 0 ? unlocked.map(({ id }) => id) : undefined;
      publish({ snapshot: snapshot(), completed, ...gameChange, relationshipUnlocked });
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
    const result = commit(advanceOnline(completion?.state ?? state, pending), {
      completed: announce ? completion?.entry : undefined, announceRelationship: announce,
    });
    if (result.ok === false) {
      warning = due ? '活动暂时无法结算，稍后会自动重试。' : result.message;
      retryUntil = performance.now() + 5000;
      publish({ snapshot: snapshot() });
      schedule();
      return { ...result, message: warning };
    }
    return result;
  }

  function apply(operation: (state: Care, now: number) => CareResult, options?: CommitOptions): CareResponse {
    const now = Date.now();
    const advancement = advance(now, { retry: true });
    if (advancement?.ok === false) return advancement;
    const saved = store.snapshot();
    if (saved.ok === false) return saved;
    const change = operation(saved.state, now);
    if (change.ok === false || change.state === saved.state) return change;
    return commit(advanceOnline(change.state, pending), options);
  }

  function greetToday(): GreetingResponse {
    const current = store.snapshot();
    if (current.ok && current.state.lastGreetingDay === localDay()) return { ok: true, state: current.state, gained: null };
    let gained: number | null = null;
    const result = apply((state, now) => {
      const next = recordGreeting(state, localDay(new Date(now)));
      if (next !== state) gained = next.affection - state.affection;
      return { ok: true, state: next };
    }, { writeFailure: '问候未保存，请再点一次。' });
    return result.ok === false ? result : { ...result, gained };
  }

  function startDango(owner: symbol, revision: number, mode: DangoMode = 'classic'): DangoResponse<DangoPreview> {
    const id = randomUUID();
    const target = dangoSlots[randomInt(dangoSlots.length)];
    const board = mode === 'lines' ? drawDangoLines(id) : { preview: { id, mode, target }, target };
    const saved = apply((state) => {
      if (state.revision !== revision) return { ok: false, state, message: '状态已更新，请再试一次。' };
      const unavailable = dangoUnavailable(state, Boolean(dango), mode);
      if (unavailable) return { ok: false, state, message: unavailable };
      return { ok: true, state: { ...state, energy: state.energy - dangoEnergyCost } };
    }, {
      writeFailure: '开局存档失败，精力已保留。请重试。',
      afterSave: () => {
        const delay = mode === 'lines' ? 0 : dangoPreviewMs + dangoCoverMs;
        dango = { ...board, owner, chooseAt: performance.now() + delay };
        return { dangoStarted: mode };
      },
    });
    return saved.ok === false ? { ok: false, message: saved.message } : { ok: true, round: board.preview };
  }

  function pickDango(owner: symbol, id: string, picked: DangoSlot): DangoResponse<DangoResult> {
    if (lastDango?.owner === owner && lastDango.result.id === id) return { ok: true, round: lastDango.result };
    const round = dango;
    if (!round || round.preview.id !== id || round.owner !== owner) return { ok: false, message: '这局小游戏已结束。' };
    if (performance.now() < round.chooseAt) return { ok: false, message: '等小碗盖好后再选。' };
    if (round.picked !== undefined && round.picked !== picked) return { ok: false, message: '请重试刚才的选择。' };
    round.picked = picked;
    const correct = picked === round.target;
    let result: DangoResult;
    const saved = apply((state, now) => {
      const { state: next, actual } = finishDango(state, correct, localDay(new Date(now)));
      result = { ...round.preview, target: round.target, picked, correct, actual };
      return { ok: true, state: next };
    }, {
      writeFailure: '作答无法保存，请重试刚才的选择。',
      afterSave: () => {
        dango = undefined;
        lastDango = { owner, result };
        return { dangoCompleted: result };
      },
    });
    return saved.ok === false ? { ok: false, message: saved.message } : { ok: true, round: result };
  }

  function leaveDango(owner: symbol, id: string) {
    if (dango?.owner !== owner || dango.preview.id !== id || stopped) return;
    advance(Date.now());
    dango = undefined;
    publish({ snapshot: snapshot() });
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
    feed: (id: FoodId, revision: number) => apply(
      (state, now) => feedFood(state, id, revision, localDay(new Date(now)), Boolean(dango)),
      { writeFailure: '存档写入失败，食物已保留。' }),
    buy: (id: FoodId, quantity: number, revision: number) => apply((state) => buyFood(state, id, quantity, revision),
      { writeFailure: '存档写入失败，本次购买未完成。' }),
    buyToy: (id: ToyId, revision: number) => apply((state) => buyToy(state, id, revision),
      { writeFailure: '存档写入失败，本次购买未完成。' }),
    claimBread: (revision: number) => apply((state) => claimBread(state, revision),
      { writeFailure: '存档写入失败，本次补给未领取。' }),
    greetToday,
    start: (kind: ActivityKind, revision: number) => apply(
      (state, now) => startActivity(state, kind, revision, randomUUID(), now, durations[kind], Boolean(dango))),
    cancel: (id: string, revision: number) => apply((state, now) => cancelActivity(state, id, revision, now)),
    startDango,
    pickDango,
    leaveDango,
    close() {
      stopped = true;
      clearInterval(tick);
      clearTimeout(deadline);
      powerMonitor.off('suspend', suspend);
      powerMonitor.off('resume', resume);
      advance(Date.now(), { force: true, announce: false, retry: true });
      dango = undefined;
    },
  };
}
