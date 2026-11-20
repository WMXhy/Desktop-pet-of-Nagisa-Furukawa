export const dangoEnergyCost = 3;
export const dangoPreviewMs = 3000;
export const dangoCoverMs = 300;

export const dangoSlots = [0, 1, 2] as const;
export type DangoSlot = typeof dangoSlots[number];

export function isDangoSlot(value: unknown): value is DangoSlot {
  return value === 0 || value === 1 || value === 2;
}

export type DangoPreview = { id: string; target: DangoSlot };
export type DangoResult = DangoPreview & {
  picked: DangoSlot;
  correct: boolean;
  actual: { mood: number; affection: number };
};
export type DangoResponse<T> = { ok: true; round: T } | { ok: false; message: string };
