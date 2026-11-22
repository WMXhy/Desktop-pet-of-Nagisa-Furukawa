import type { Rectangle } from 'electron';
import type { FoodId } from './care';

export const quickMenuActions = ['feed', 'bakery', 'study', 'game'] as const;
export type QuickMenuAction = typeof quickMenuActions[number];
export type QuickMenuPresentation = { id: number; reducedMotion: boolean };
export type FoodOverlay = { token: number; food: FoodId } & (
  { kind: 'card'; keyboard: boolean } | { kind: 'tip'; anchor: number });
export type QuickMenuView = {
  id: number;
  foodSession?: number;
  overlay?: FoodOverlay;
  side: Rectangle;
  strip?: Rectangle;
  panel?: Rectangle;
};

const width = 82;
const rowHeight = 44;
const rowGap = 4;
const petGap = 2;
const foodGap = 6;
const stripHeight = 96;
const cardHeight = 160;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rightEdge = (rect: Rectangle) => rect.x + rect.width;
const bottomEdge = (rect: Rectangle) => rect.y + rect.height;

function overlaps(a: Rectangle, b: Rectangle) {
  return a.x < rightEdge(b) && b.x < rightEdge(a) && a.y < bottomEdge(b) && b.y < bottomEdge(a);
}

function foodPositions(pet: Rectangle, area: Rectangle, side: Rectangle) {
  const width = Math.min(304, area.width - 2 * foodGap);
  const x = clamp(Math.round(pet.x + (pet.width - width) / 2), area.x, rightEdge(area) - width);
  const fits = (rect: Rectangle) => rect.x >= area.x && rect.y >= area.y &&
    rightEdge(rect) <= rightEdge(area) && bottomEdge(rect) <= bottomEdge(area) && !overlaps(rect, side);

  for (const above of [true, false]) {
    const strip = { x, y: above ? pet.y - stripHeight - foodGap : bottomEdge(pet) + foodGap, width, height: stripHeight };
    if (!fits(strip)) continue;
    const card = { ...strip, height: cardHeight,
      y: above ? strip.y - cardHeight - foodGap : bottomEdge(strip) + foodGap };
    if (fits(card)) return { strip, card };
    const sideY = clamp(strip.y, area.y, bottomEdge(area) - cardHeight);
    for (const cardX of [strip.x - width - foodGap, rightEdge(strip) + foodGap]) {
      const beside = { ...card, x: cardX, y: sideY };
      if (fits(beside) && !overlaps(beside, pet)) return { strip, card: beside };
    }
  }

  // Try a narrower stack beside the pet before using any of its footprint.
  const left = side.x > pet.x;
  const edge = left ? side.x - foodGap : rightEdge(side) + foodGap;
  const leftLimit = Math.min(pet.x - foodGap, left ? rightEdge(area) : side.x - foodGap);
  const rightStart = Math.max(rightEdge(pet) + foodGap, left ? rightEdge(side) + foodGap : area.x);
  const leftRoom = leftLimit - area.x;
  const rightRoom = rightEdge(area) - rightStart;
  let minX = left ? area.x : edge;
  let maxX = left ? edge : rightEdge(area);
  if (leftRoom >= 106 && leftRoom >= rightRoom) {
    minX = area.x;
    maxX = leftLimit;
  } else if (rightRoom >= 106) {
    minX = rightStart;
    maxX = rightEdge(area);
  }
  const compactWidth = Math.min(width, maxX - minX);
  const stackX = clamp(x, minX, maxX - compactWidth);
  const available = Math.max(1, area.height - stripHeight - foodGap);
  const height = Math.min(cardHeight, available);
  const y = clamp(pet.y - height - stripHeight - 2 * foodGap, area.y, bottomEdge(area) - height - stripHeight - foodGap);
  const card = { x: stackX, y, width: compactWidth, height };
  const strip = { ...card, y: bottomEdge(card) + foodGap, height: stripHeight };
  return { strip, card };
}

export function quickMenuLayout(pet: Rectangle, area: Rectangle, food = false, overlay?: FoodOverlay) {
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
  const side = {
    x: rightSide ? right : left - menuWidth,
    y: Math.max(area.y, Math.min(centered, area.y + area.height - height)),
    width: menuWidth,
    height,
  };
  const positions = food ? foodPositions(pet, area, side) : undefined;
  const strip = positions?.strip;
  let panel = overlay && positions?.card;
  if (panel && strip && overlay?.kind === 'tip') {
    const width = Math.min(panel.width, 202);
    const height = Math.min(panel.height, 69);
    panel = {
      x: clamp(Math.round(strip.x + overlay.anchor - width / 2), panel.x, rightEdge(panel) - width),
      y: clamp(strip.y - height - foodGap, panel.y, bottomEdge(panel) - height),
      width, height,
    };
  }
  const visible = [side, ...(strip ? [strip] : []), ...(panel ? [panel] : [])];
  const x = Math.min(...visible.map((rect) => rect.x));
  const y = Math.min(...visible.map((rect) => rect.y));
  const bounds = { x, y, width: Math.max(...visible.map(rightEdge)) - x, height: Math.max(...visible.map(bottomEdge)) - y };
  const local = (rect: Rectangle) => ({ ...rect, x: rect.x - x, y: rect.y - y });
  const rows = quickMenuActions.map((_, index) => ({
    x: side.x - x, y: side.y - y + index * (row + rowGap), width: menuWidth, height: row,
  }));
  return { bounds, side: local(side), strip: strip && local(strip), panel: panel && local(panel),
    shape: [...rows, ...visible.slice(1).map(local)] };
}
