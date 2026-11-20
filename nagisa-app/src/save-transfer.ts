import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './atomic-file';
import { activityRules, type Care } from './care';
import { decodeCare } from './care-store';
import { exportPreferences, importPreferences, isRecord, type Failure, type Settings } from './settings';
import { settingsJson } from './settings-store';

export type TransferAction = 'import' | 'backup' | 'reset';
export type TransferPreview = {
  token: string;
  action: TransferAction;
  coins: number;
  inventory: Care['inventory'];
  ownedToys: Care['ownedToys'];
  studyPoints: number;
  affection: number;
  relationshipEvents: number;
  activity?: { label: string; endsAt: number };
};
export type TransferResponse = { ok: true; preview?: TransferPreview; cancelled?: boolean } | Failure;
const transferVersion = 1;
const maxTransferBytes = 4 * 1024 * 1024;
const files = ['save.json', 'settings.json', 'save.backup.json', 'save.before-replace.json'] as const;
const marker = 'data-transaction.json';
type Original = Record<typeof files[number], string | null>;

export class RollbackError extends Error {}

export function exportJson(state: Care, settings: Settings): string {
  return JSON.stringify({ exportVersion: transferVersion, care: state, preferences: exportPreferences(settings) }, null, 2);
}

export function readTransfer(file: string, saved: Settings): { ok: true; state: Care; settings: Settings } | Failure {
  try {
    if (statSync(file).size > maxTransferBytes) return { ok: false, message: '导入文件超过 4 MB。' };
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!isRecord(parsed) || parsed.exportVersion !== transferVersion) return { ok: false, message: '无法识别此导出版本。' };
    const care = decodeCare(parsed.care);
    if (care.kind !== 'valid') return { ok: false, message: care.kind === 'newer' ? '养成存档来自较新版本。' : '导入档的养成内容无效。' };
    const settings = importPreferences(parsed.preferences, saved);
    return settings.ok === false ? settings : { ok: true, state: care.state, settings: settings.settings };
  } catch { return { ok: false, message: '文件无法读取，请选择有效的 JSON 导出档。' }; }
}

export function transferPreview(state: Care, action: TransferAction): TransferPreview {
  const activity = state.activeActivity;
  return { token: randomUUID(), action, coins: state.coins, inventory: state.inventory, ownedToys: state.ownedToys,
    studyPoints: state.studyPoints, affection: state.affection, relationshipEvents: state.relationshipLog.length,
    activity: activity ? { label: activityRules[activity.kind].label, endsAt: activity.endsAt } : undefined };
}

function optionalRead(file: string): string | null {
  try { return readFileSync(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function checksum(original: Original): string {
  return createHash('sha256').update(JSON.stringify(original)).digest('hex');
}

function rollback(directory: string, original: Original) {
  for (const name of files) {
    const file = join(directory, name);
    const contents = original[name];
    if (optionalRead(file) === contents) continue;
    if (contents === null) unlinkSync(file);
    else writeAtomic(file, contents, '.rollback.tmp');
  }
  unlinkSync(join(directory, marker));
}

export function recoverDataTransaction(directory: string) {
  const contents = optionalRead(join(directory, marker));
  if (contents === null) return;
  const stored: unknown = JSON.parse(contents);
  if (!isRecord(stored) || stored.version !== 1 || !isRecord(stored.original)) throw new Error('无效的数据替换恢复记录。');
  const original = stored.original;
  if (!files.every((name) => original[name] === null || typeof original[name] === 'string') ||
      checksum(original as Original) !== stored.checksum) throw new Error('数据替换恢复记录损坏。');
  rollback(directory, original as Original);
}

export function replaceSavedData(directory: string, next: Care, preferences: Settings, previous?: Care, oldSettings?: Settings) {
  const original = Object.fromEntries(files.map((name) => [name, optionalRead(join(directory, name))])) as Original;
  const recoveryFile = join(directory, marker);
  writeAtomic(recoveryFile, JSON.stringify({ version: 1, original, checksum: checksum(original) }));
  try {
    if (previous) {
      writeAtomic(join(directory, 'save.before-replace.json'), exportJson(previous, oldSettings ?? preferences));
      writeAtomic(join(directory, 'save.backup.json'), JSON.stringify(previous));
    }
    writeAtomic(join(directory, 'save.json'), JSON.stringify(next));
    writeAtomic(join(directory, 'settings.json'), settingsJson(preferences));
    unlinkSync(recoveryFile);
  } catch (error) {
    try { rollback(directory, original); }
    catch (recoveryError) {
      console.error('数据替换回滚将在重启时继续', recoveryError);
      throw new RollbackError('下次启动时将恢复替换前的数据。');
    }
    throw error;
  }
}
