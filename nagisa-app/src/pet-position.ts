import { app, screen, type Point, type Rectangle } from 'electron';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const margin = 24;
const positionFile = () => join(app.getPath('userData'), 'pet-position.json');

export function homePosition(size: number): Point {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + Math.max(0, area.width - size - margin),
    y: area.y + Math.max(0, area.height - size - margin),
  };
}

export function restorePosition(size: number): Point {
  try {
    const saved: unknown = JSON.parse(readFileSync(positionFile(), 'utf8'));
    if (!saved || typeof saved !== 'object' || !('version' in saved) || saved.version !== 1 ||
        !('displayId' in saved) || !('dx' in saved) || !('dy' in saved) ||
        typeof saved.dx !== 'number' || !Number.isSafeInteger(saved.dx) ||
        typeof saved.dy !== 'number' || !Number.isSafeInteger(saved.dy)) {
      return homePosition(size);
    }

    const display = screen.getAllDisplays().find(({ id }) => id === saved.displayId);
    if (!display) return homePosition(size);
    const area = display.workArea;
    return {
      x: area.x + Math.max(0, Math.min(saved.dx, area.width - size)),
      y: area.y + Math.max(0, Math.min(saved.dy, area.height - size)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('位置记录无法读取，回到主屏', error);
    }
    return homePosition(size);
  }
}

export function savePosition(bounds: Rectangle): void {
  const { id, workArea } = screen.getDisplayMatching(bounds);
  const data = {
    version: 1,
    displayId: id,
    dx: bounds.x - workArea.x,
    dy: bounds.y - workArea.y,
  };

  try {
    const file = positionFile();
    const temporaryFile = `${file}.${process.pid}.tmp`;
    writeFileSync(temporaryFile, JSON.stringify(data), 'utf8');
    renameSync(temporaryFile, file);
  } catch (error) {
    console.warn('本次位置未保存', error);
  }
}
