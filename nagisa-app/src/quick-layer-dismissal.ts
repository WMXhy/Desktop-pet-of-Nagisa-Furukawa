import type { Point, Rectangle } from 'electron';

export type QuickLayer = {
  id: string;
  parent?: string;
  areas: Rectangle[];
  dismiss(): void;
};

const leaveDelay = 10_000;
const insideSample = 80;

function contains({ x, y, width, height }: Rectangle, point: Point) {
  return point.x >= x && point.y >= y && point.x < x + width && point.y < y + height;
}

export function watchQuickLayers(read: () => { layers: QuickLayer[]; point: Point; interacting: readonly string[] }) {
  const deadlines = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear() {
    clearTimeout(timer);
    deadlines.clear();
  }

  function update() {
    clearTimeout(timer);
    const { layers, point, interacting } = read();
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    for (const id of deadlines.keys()) if (!byId.has(id)) deadlines.delete(id);

    const underPointer = layers.filter((layer) => layer.areas.some((area) => contains(area, point)));
    const retained = new Set<string>();
    for (const id of [...interacting, ...underPointer.map((layer) => layer.id)]) {
      for (let layer = byId.get(id); layer && !retained.has(layer.id); layer = byId.get(layer.parent ?? '')) {
        retained.add(layer.id);
      }
    }

    const now = performance.now();
    let next = underPointer.length ? now + insideSample : Infinity;
    // Parents precede their children so a shared deadline only closes the outermost layer.
    for (const layer of layers) {
      if (retained.has(layer.id)) {
        deadlines.delete(layer.id);
        continue;
      }
      const deadline = deadlines.get(layer.id) ?? now + leaveDelay;
      if (deadline <= now) {
        deadlines.delete(layer.id);
        layer.dismiss();
        return;
      }
      deadlines.set(layer.id, deadline);
      next = Math.min(next, deadline);
    }
    // Outside the controls, a renderer pointer event wakes this check on re-entry.
    if (Number.isFinite(next)) timer = setTimeout(update, Math.max(1, Math.ceil(next - now)));
  }

  return { clear, update };
}
