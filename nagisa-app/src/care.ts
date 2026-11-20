export const careVersion = 1;

export function localDay(now = new Date()): string {
  return [String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}

export function newCare(day = localDay()) {
  return {
    version: careVersion,
    revision: 0,
    coins: 30,
    fullness: 55,
    energy: 70,
    mood: 60,
    affection: 0,
    daily: { day, gained: 0 },
    inventory: { bread: 2 },
  };
}

export type Care = ReturnType<typeof newCare>;
type CareUnavailable = { ok: false; message: string };
export type CareReadResult = { ok: true; state: Care; notice?: string } | CareUnavailable;
export type FeedResult =
  | { ok: true; state: Care }
  | { ok: false; state: Care; message: string };
export type FeedResponse = FeedResult | (CareUnavailable & { state?: never });

export function fullnessAfterBread(fullness: number): number {
  return Math.min(100, fullness + 18);
}

export function breadUnavailable(state: Care): string | undefined {
  if (state.inventory.bread < 1) return '背包里的小面包吃完了。';
  if (state.fullness >= 100) return '渚已经吃饱了。';
  if (state.revision === Number.MAX_SAFE_INTEGER) return '存档已达到可记录的操作次数上限。';
}

export function feedBread(state: Care, revision: number, day = localDay()): FeedResult {
  if (revision !== state.revision) return { ok: false, state, message: '库存已更新，请再看一眼。' };
  const unavailable = breadUnavailable(state);
  if (unavailable) return { ok: false, state, message: unavailable };

  const gained = state.daily.day === day ? state.daily.gained : 0;
  const add = gained < 12 && state.affection < 300 ? 1 : 0;
  return {
    ok: true,
    state: {
      ...state,
      revision: state.revision + 1,
      fullness: fullnessAfterBread(state.fullness),
      affection: state.affection + add,
      daily: { day, gained: gained + add },
      inventory: { ...state.inventory, bread: state.inventory.bread - 1 },
    },
  };
}
