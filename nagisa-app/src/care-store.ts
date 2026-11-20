import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './atomic-file';
import { activityLogLimit, careVersion, hungerInterval, idleInterval, newCare, upgradeCare,
  type Care, type CareV4, type CareV5, type LegacyCare, type CareReadResult, type CareResponse } from './care';
import { affectionLimit, dailyAffectionLimit, milestones } from './relationship';

type SaveFile = { kind: 'valid'; state: Care; original?: LegacyCare } | { kind: 'missing' | 'invalid' | 'newer' };

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

function validCommonFields(data: Record<string, unknown>): boolean {
  return integer(data.revision) && integer(data.coins) &&
    integer(data.fullness, 100) && integer(data.energy, 100) && integer(data.mood, 100) &&
    integer(data.affection, affectionLimit) && record(data.daily) && validDay(data.daily.day) &&
    integer(data.daily.gained, dailyAffectionLimit) && record(data.inventory) && integer(data.inventory.bread);
}

function validLegacyReward(value: unknown): boolean {
  return record(value) && integer(value.coins, 1_000_000) && integer(value.energy, 100) &&
    typeof value.mood === 'number' && Number.isInteger(value.mood) && Math.abs(value.mood) <= 100 &&
    integer(value.affection, 300);
}

function validV4Reward(value: unknown): boolean {
  return record(value) && validLegacyReward(value) && integer(value.studyPoints);
}

function isLegacyActivityKind(value: unknown): boolean {
  return value === 'rest' || value === 'bakery';
}

function isV4ActivityKind(value: unknown): boolean {
  return isLegacyActivityKind(value) || value === 'study' || value === 'rehearse' || value === 'work_props';
}

function validActivityFields(data: Record<string, unknown>, legacy: boolean): boolean {
  const validKind = legacy ? isLegacyActivityKind : isV4ActivityKind;
  const reward = legacy ? validLegacyReward : validV4Reward;
  const active = data.activeActivity;

  function activityIdentity(value: Record<string, unknown>): boolean {
    return typeof value.id === 'string' && value.id.trim().length > 0 && validKind(value.kind);
  }

  return (active === null || (record(active) && activityIdentity(active) && integer(active.startedAt, 8.64e15) &&
    integer(active.endsAt, 8.64e15) && active.endsAt > active.startedAt && reward(active.reward))) &&
    Array.isArray(data.activityLog) && data.activityLog.length <= activityLogLimit &&
    data.activityLog.every((entry: unknown) => record(entry) && activityIdentity(entry) && integer(entry.endedAt, 8.64e15) &&
      (entry.outcome === 'completed' || entry.outcome === 'cancelled') && reward(entry.actual)) &&
    record(data.online) && integer(data.online.hungerMs, hungerInterval - 1) && integer(data.online.idleMs, idleInterval - 1);
}

function validRelationship(data: Record<string, unknown>): boolean {
  const { lastGreetingDay, relationshipLog, affection } = data;
  if (typeof affection !== 'number' || (lastGreetingDay !== null && !validDay(lastGreetingDay))) return false;
  const reached = milestones.filter(({ min }) => affection >= min);
  if (!Array.isArray(relationshipLog) || relationshipLog.length !== reached.length) return false;
  const seen = new Set<unknown>();
  return relationshipLog.every((entry: unknown) => {
    if (!record(entry) || !reached.some(({ id }) => id === entry.id) || seen.has(entry.id) ||
        (entry.unlockedAt !== null && !integer(entry.unlockedAt, 8.64e15))) return false;
    seen.add(entry.id);
    return true;
  });
}

export function decodeCare(data: unknown): Exclude<SaveFile, { kind: 'missing' }> {
  if (record(data)) {
    if (integer(data.version) && data.version > careVersion) return { kind: 'newer' };
    if (validCommonFields(data)) {
      const { version, inventory, ownedToys } = data;
      const fullInventory = record(inventory) && integer(inventory.redBeanBread) && integer(inventory.dangoSnack);
      const hasLegacyActivities = version === 2 || (version === 3 && fullInventory);
      if (version === 1 || (hasLegacyActivities && validActivityFields(data, true))) {
        const original = data as LegacyCare;
        return { kind: 'valid', state: upgradeCare(original), original };
      }
      if ((version === 4 || version === 5 || version === careVersion) && fullInventory &&
          integer(data.studyPoints) && validActivityFields(data, false)) {
        if (version === 4) {
          const original = data as CareV4;
          return { kind: 'valid', state: upgradeCare(original), original };
        }
        if (record(ownedToys) && typeof ownedToys.dangoPlush === 'boolean' && typeof ownedToys.miniStage === 'boolean') {
          if (version === 5) {
            const original = data as CareV5;
            return { kind: 'valid', state: upgradeCare(original), original };
          }
          if (validRelationship(data)) return { kind: 'valid', state: data as Care };
        }
      }
    }
  }

  return { kind: 'invalid' };
}

export function readSave(file: string): SaveFile {
  try {
    return decodeCare(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    console.warn('养成存档无法读取', file, error);
    return { kind: 'invalid' };
  }
}

function writeSave(file: string, state: Care | LegacyCare): void {
  writeAtomic(file, JSON.stringify(state));
}

export function createCareStore(directory: string) {
  const mainFile = join(directory, 'save.json');
  const backupFile = join(directory, 'save.backup.json');

  function load(): CareReadResult {
    const main = readSave(mainFile);
    if (main.kind === 'valid') {
      if (!main.original) return { ok: true, state: main.state };
      try {
        writeSave(backupFile, main.original);
        writeSave(mainFile, main.state);
        return { ok: true, state: main.state };
      } catch (error) {
        console.warn('养成存档无法升级', error);
        return { ok: false, message: '无法升级养成存档，请重试。' };
      }
    }
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
    snapshot: () => current,
    read(): CareReadResult {
      if (!current.ok) current = load();
      return current;
    },
    commit(candidate: Care, writeFailure = '存档写入失败，请重试。'): CareResponse {
      if (!current.ok) return current;
      if (current.state.revision === Number.MAX_SAFE_INTEGER) {
        return { ok: false, state: current.state, message: '存档已达到可记录的操作次数上限。' };
      }
      const state = { ...candidate, revision: current.state.revision + 1 };
      try {
        writeSave(backupFile, current.state);
        writeSave(mainFile, state);
      } catch (error) {
        console.warn('养成存档无法提交', error);
        return { ok: false, state: current.state, message: writeFailure };
      }
      current = { ...current, state };
      return { ok: true, state };
    },
  };
}
