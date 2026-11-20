import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { careVersion, feedBread, newCare, type Care, type CareReadResult, type FeedResponse } from './care';

type SaveFile = { kind: 'valid'; state: Care } | { kind: 'missing' | 'invalid' | 'newer' };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function validDay(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validCare(data: Record<string, unknown>): data is Care {
  return data.version === careVersion && integer(data.revision) && integer(data.coins) &&
    integer(data.fullness, 100) && integer(data.energy, 100) && integer(data.mood, 100) &&
    integer(data.affection, 300) && record(data.daily) && validDay(data.daily.day) &&
    integer(data.daily.gained, 12) && record(data.inventory) && integer(data.inventory.bread);
}

function readSave(file: string): SaveFile {
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (record(data)) {
      if (integer(data.version) && data.version > careVersion) return { kind: 'newer' };
      if (validCare(data)) return { kind: 'valid', state: data };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    console.warn('养成存档无法读取', file, error);
  }
  return { kind: 'invalid' };
}

function writeSave(file: string, state: Care): void {
  const temporaryFile = `${file}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(state), { encoding: 'utf8', flush: true });
  renameSync(temporaryFile, file);
}

export function createCareStore(directory: string) {
  const mainFile = join(directory, 'save.json');
  const backupFile = join(directory, 'save.backup.json');

  function load(): CareReadResult {
    const main = readSave(mainFile);
    if (main.kind === 'valid') return { ok: true, state: main.state };
    if (main.kind === 'newer') return { ok: false, message: '养成存档来自较新版本，请升级桌宠。' };

    const backup = readSave(backupFile);
    if (backup.kind === 'newer') return { ok: false, message: '养成备份来自较新版本，请升级桌宠。' };
    const isNew = main.kind === 'missing' && backup.kind === 'missing';
    if (backup.kind !== 'valid' && !isNew) {
      return { ok: false, message: '养成主档和备份均无法读取，原文件已保留。' };
    }

    const state = backup.kind === 'valid' ? backup.state : newCare();
    try {
      mkdirSync(directory, { recursive: true });
      writeSave(mainFile, state);
      return backup.kind === 'valid'
        ? { ok: true, state, notice: '已从养成备份恢复。' }
        : { ok: true, state };
    } catch (error) {
      console.warn('养成存档无法创建或恢复', error);
      return { ok: false, message: isNew ? '无法创建养成存档，请重试。' : '无法从备份恢复养成存档，请重试。' };
    }
  }

  let current = load();
  return {
    read(): CareReadResult {
      if (!current.ok) current = load();
      return current;
    },
    feed(revision: number): FeedResponse {
      if (!current.ok) return current;
      const result = feedBread(current.state, revision);
      if (!result.ok) return result;
      try {
        writeSave(backupFile, current.state);
        writeSave(mainFile, result.state);
      } catch (error) {
        console.warn('养成存档无法提交', error);
        return { ok: false, state: current.state, message: '存档写入失败，面包已保留。' };
      }
      current = { ...current, state: result.state };
      return result;
    },
  };
}
