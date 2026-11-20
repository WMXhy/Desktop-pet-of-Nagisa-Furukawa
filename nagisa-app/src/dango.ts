export const dangoEnergyCost = 3;
export const dangoPreviewMs = 3000;
export const dangoCoverMs = 300;
export const dangoHugFrameMs = [250, 350, 650, 350] as const;
export const dangoHugMs = dangoHugFrameMs.reduce<number>((total, duration) => total + duration, 0);

export const dangoModes = { classic: '基础团子', plush: '团子玩偶', lines: '台词接龙' } as const;
export type DangoMode = keyof typeof dangoModes;
export const dangoModeIds: readonly DangoMode[] = ['classic', 'plush', 'lines'];

export function isDangoMode(value: unknown): value is DangoMode {
  return value === 'classic' || value === 'plush' || value === 'lines';
}

export const dangoSlots = [0, 1, 2] as const;
export type DangoSlot = typeof dangoSlots[number];

export function isDangoSlot(value: unknown): value is DangoSlot {
  return value === 0 || value === 1 || value === 2;
}

export type DangoMemoryPreview = { id: string; mode: 'classic' | 'plush'; target: DangoSlot };
export type DangoLinesPreview = { id: string; mode: 'lines'; questionId: string; prompt: string; choices: readonly [string, string, string] };
export type DangoPreview = DangoMemoryPreview | DangoLinesPreview;
export type DangoResult = DangoPreview & {
  target: DangoSlot;
  picked: DangoSlot;
  correct: boolean;
  actual: { mood: number; affection: number };
};
export type DangoResponse<T> = { ok: true; round: T } | { ok: false; message: string };
