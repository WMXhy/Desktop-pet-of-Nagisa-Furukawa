import type { Rectangle } from 'electron';

export const quickMenuActions = ['feed', 'bakery', 'study', 'game'] as const;
export type QuickMenuAction = typeof quickMenuActions[number];
export type QuickMenuPresentation = { id: number; reducedMotion: boolean };

const width = 82;
const rowHeight = 44;
const rowGap = 4;
const petGap = 2;

export function quickMenuLayout(pet: Rectangle, area: Rectangle) {
  const right = pet.x + pet.width + petGap;
  const left = pet.x - petGap;
  const roomRight = area.x + area.width - right;
  const roomLeft = left - area.x;
  const rightSide = roomRight >= width || (roomLeft < width && roomRight >= roomLeft);
  const menuWidth = Math.min(width, rightSide ? roomRight : roomLeft);
  const gaps = (quickMenuActions.length - 1) * rowGap;
  const row = Math.min(rowHeight, Math.floor((area.height - gaps) / quickMenuActions.length));
  if (menuWidth < 40 || row < 20) return undefined;

  const height = quickMenuActions.length * row + gaps;
  const centered = Math.round(pet.y + (pet.height - height) / 2);
  const bounds = {
    x: rightSide ? right : left - menuWidth,
    y: Math.max(area.y, Math.min(centered, area.y + area.height - height)),
    width: menuWidth,
    height,
  };
  const rows = quickMenuActions.map((_, index) => ({
    x: 0, y: index * (row + rowGap), width: menuWidth, height: row,
  }));
  return { bounds, rows };
}
