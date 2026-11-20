export const careVersion = 3;
export const hungerInterval = 600_000;
export const idleInterval = 300_000;
export const activityLogLimit = 20;

export const foods = {
  bread: { name: '小面包', price: 6, fullness: 18, mood: 0, affection: 1 },
  redBeanBread: { name: '红豆面包', price: 12, fullness: 24, mood: 3, affection: 2 },
  dangoSnack: { name: '团子点心', price: 10, fullness: 12, mood: 6, affection: 2 },
} as const;
export type FoodId = keyof typeof foods;
export const foodIds: readonly FoodId[] = ['bread', 'redBeanBread', 'dangoSnack'];

export function isFoodId(value: unknown): value is FoodId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(foods, value);
}

export type ActivityKind = 'rest' | 'bakery';
export type Reward = { coins: number; energy: number; mood: number; affection: number };
export type Activity = { id: string; kind: ActivityKind; startedAt: number; endsAt: number; reward: Reward };
export type ActivityRecord = {
  id: string;
  kind: ActivityKind;
  outcome: 'completed' | 'cancelled';
  endedAt: number;
  actual: Reward;
};
export type OnlineTime = { hungerMs: number; idleMs: number };
export type ActivityDurations = Record<ActivityKind, number>;

export const activityRules = {
  rest: { label: '休息', durationMs: 300_000, cost: 0, minFullness: 0,
    reward: { coins: 0, energy: 15, mood: 0, affection: 0 } },
  bakery: { label: '面包店帮工', durationMs: 180_000, cost: 10, minFullness: 15,
    reward: { coins: 18, energy: 0, mood: -3, affection: 1 } },
};

export function isActivityKind(value: unknown): value is ActivityKind {
  return value === 'rest' || value === 'bakery';
}

export function localDay(now = new Date()): string {
  return [String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}

function initialCareFields(day: string) {
  return {
    revision: 0,
    coins: 30,
    fullness: 55,
    energy: 70,
    mood: 60,
    affection: 0,
    daily: { day, gained: 0 },
  };
}

type CareFields = ReturnType<typeof initialCareFields>;
type ActivityFields = {
  activeActivity: Activity | null;
  activityLog: ActivityRecord[];
  online: OnlineTime;
};
type LegacyInventory = { bread: number };
export type CareV1 = CareFields & { version: 1; inventory: LegacyInventory };
export type CareV2 = CareFields & ActivityFields & { version: 2; inventory: LegacyInventory };
export type Care = CareFields & ActivityFields & { version: typeof careVersion; inventory: Record<FoodId, number> };

export function upgradeCare(state: CareV1 | CareV2): Care {
  const activities: ActivityFields = state.version === 2 ? {
    activeActivity: state.activeActivity, activityLog: state.activityLog, online: state.online,
  } : { activeActivity: null, activityLog: [], online: { hungerMs: 0, idleMs: 0 } };
  return { ...state, ...activities, version: careVersion,
    inventory: { bread: state.inventory.bread, redBeanBread: 0, dangoSnack: 0 } };
}

export function newCare(day = localDay()): Care {
  return upgradeCare({ ...initialCareFields(day), version: 1, inventory: { bread: 2 } });
}

type CareUnavailable = { ok: false; message: string };
export type CareReadResult = { ok: true; state: Care; notice?: string } | CareUnavailable;
export type CareSnapshot = CareReadResult & { durations: ActivityDurations; warning?: string };
export type CareChange = { snapshot: CareSnapshot; completed?: ActivityRecord };
export type CareResult =
  | { ok: true; state: Care }
  | { ok: false; state: Care; message: string };
export type CareResponse = CareResult | (CareUnavailable & { state?: never });

export function foodUnavailable(state: Care, id: FoodId): string | undefined {
  if (state.activeActivity) return '活动结束后可喂食。';
  if (state.inventory[id] < 1) return `背包里的${foods[id].name}吃完了。`;
  if (state.fullness >= 100) return '渚已经吃饱了。';
  if (state.revision === Number.MAX_SAFE_INTEGER) return '存档已达到可记录的操作次数上限。';
}

function gainAffection(state: Care, amount: number, day: string) {
  const gained = state.daily.day === day ? state.daily.gained : 0;
  const add = Math.min(amount, 12 - gained, 300 - state.affection);
  return { affection: state.affection + add, daily: { day, gained: gained + add } };
}

export function previewFood(state: Care, id: FoodId, day = localDay()) {
  const food = foods[id];
  return {
    ...gainAffection(state, food.affection, day),
    fullness: Math.min(100, state.fullness + food.fullness),
    mood: Math.min(100, state.mood + food.mood),
  };
}

export function feedFood(state: Care, id: FoodId, revision: number, day = localDay()): CareResult {
  if (revision !== state.revision) return { ok: false, state, message: '库存已更新，请再看一眼。' };
  const unavailable = foodUnavailable(state, id);
  if (unavailable) return { ok: false, state, message: unavailable };

  return {
    ok: true,
    state: {
      ...state,
      ...previewFood(state, id, day),
      inventory: { ...state.inventory, [id]: state.inventory[id] - 1 },
    },
  };
}

export function purchaseUnavailable(state: Care, id: FoodId, quantity: number): string | undefined {
  if (!Number.isSafeInteger(quantity) || quantity < 1) return '请输入正整数数量。';
  const total = foods[id].price * quantity;
  if (!Number.isSafeInteger(total) || total > state.coins) return '团子币不足。';
  if (!Number.isSafeInteger(state.inventory[id] + quantity)) return '库存已达到上限。';
}

export function buyFood(state: Care, id: FoodId, quantity: number, revision: number): CareResult {
  if (revision !== state.revision) return { ok: false, state, message: '余额或库存已更新，请重新确认。' };
  const unavailable = purchaseUnavailable(state, id, quantity);
  if (unavailable) return { ok: false, state, message: unavailable };
  return { ok: true, state: { ...state, coins: state.coins - foods[id].price * quantity,
    inventory: { ...state.inventory, [id]: state.inventory[id] + quantity } } };
}

export function canClaimBread(state: Care): boolean {
  return state.fullness < 15 && state.coins < foods.bread.price && foodIds.every((id) => state.inventory[id] === 0);
}

export function claimBread(state: Care, revision: number): CareResult {
  if (revision !== state.revision) return { ok: false, state, message: '养成状态已更新，请再看一眼。' };
  if (!canClaimBread(state)) return { ok: false, state, message: '当前不符合应急补给条件。' };
  return { ok: true, state: { ...state, inventory: { ...state.inventory, bread: 1 } } };
}

export function activityUnavailable(state: Care, kind: ActivityKind): string | undefined {
  const rule = activityRules[kind];
  if (state.activeActivity) return '渚正在活动中。';
  if (state.fullness < rule.minFullness) return `饱食不足，需要至少 ${rule.minFullness} 点。`;
  if (state.energy < rule.cost) return `精力不足，需要至少 ${rule.cost} 点。`;
}

export function startActivity(state: Care, kind: ActivityKind, revision: number, id: string, now: number, duration: number): CareResult {
  if (revision !== state.revision) return { ok: false, state, message: '状态已更新，请再看一眼。' };
  const unavailable = activityUnavailable(state, kind);
  if (unavailable) return { ok: false, state, message: unavailable };
  const { cost, reward } = activityRules[kind];
  return { ok: true, state: { ...state, energy: state.energy - cost,
    activeActivity: { id, kind, startedAt: now, endsAt: now + duration, reward: { ...reward } } } };
}

function recordActivity(state: Care, entry: ActivityRecord): Care {
  return { ...state, activeActivity: null, activityLog: [entry, ...state.activityLog].slice(0, activityLogLimit) };
}

export function finishDue(state: Care, id: string, now: number) {
  const activity = state.activeActivity;
  if (!activity || activity.id !== id || now < activity.endsAt) return;
  const { reward } = activity;
  const next = { ...state,
    ...gainAffection(state, reward.affection, localDay(new Date(now))),
    coins: Math.min(Number.MAX_SAFE_INTEGER, state.coins + reward.coins),
    energy: Math.min(100, state.energy + reward.energy),
    mood: Math.max(0, Math.min(100, state.mood + reward.mood)),
  };
  const entry: ActivityRecord = { id, kind: activity.kind, outcome: 'completed', endedAt: activity.endsAt,
    actual: { coins: next.coins - state.coins, energy: next.energy - state.energy,
      mood: next.mood - state.mood, affection: next.affection - state.affection } };
  return { state: recordActivity(next, entry), entry };
}

export function cancelActivity(state: Care, id: string, revision: number, now: number): CareResult {
  const activity = state.activeActivity;
  if (state.activityLog.some((entry) => entry.id === id && entry.outcome === 'completed')) {
    return { ok: false, state, message: '这项活动已到期并完成结算。' };
  }
  if (!activity || activity.id !== id || revision !== state.revision || now >= activity.endsAt) {
    return { ok: false, state, message: '活动状态已更新，请再看一眼。' };
  }
  return { ok: true, state: recordActivity(state, { id, kind: activity.kind, outcome: 'cancelled', endedAt: now,
    actual: { coins: 0, energy: 0, mood: 0, affection: 0 } }) };
}

export function advanceOnline(state: Care, elapsed: OnlineTime): Care {
  const hungerMs = state.online.hungerMs + elapsed.hungerMs;
  const idleMs = state.online.idleMs + elapsed.idleMs;
  return { ...state,
    fullness: Math.max(0, state.fullness - Math.floor(hungerMs / hungerInterval)),
    energy: Math.min(100, state.energy + 2 * Math.floor(idleMs / idleInterval)),
    online: { hungerMs: hungerMs % hungerInterval, idleMs: idleMs % idleInterval },
  };
}

export function remainingSeconds(activity: Activity, now: number): number {
  return Math.min(Math.ceil((activity.endsAt - activity.startedAt) / 1000), Math.max(0, Math.ceil((activity.endsAt - now) / 1000)));
}
