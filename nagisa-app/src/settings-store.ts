import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './atomic-file';
import { defaultSettings, isRecord, settingsVersion, validateSettings, type Failure, type Settings } from './settings';

export function settingsJson(settings: Settings): string {
  return JSON.stringify({ version: settingsVersion, preferences: settings });
}

export function createSettingsStore(directory: string) {
  const file = join(directory, 'settings.json');
  let settings = defaultSettings;
  let newer = false;
  let warning: Failure | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRecord(parsed) || parsed.version !== settingsVersion) {
      newer = isRecord(parsed) && typeof parsed.version === 'number' && parsed.version > settingsVersion;
      throw new Error('settings version');
    }
    const result = validateSettings(parsed.preferences);
    if (result.ok === false) throw new Error(result.message);
    settings = result.settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try { writeAtomic(file, settingsJson(settings)); }
      catch { warning = { ok: false, message: '默认设置暂时无法写入。' }; }
    } else warning = { ok: false, message: newer ? '设置来自较新版本，请升级桌宠。' : '设置无法读取，已加载默认值。' };
  }

  return {
    initial: settings,
    warning,
    canWrite: !newer,
    save(next: Settings) {
      if (newer) throw new Error('设置来自较新版本，请升级桌宠。');
      writeAtomic(file, settingsJson(next));
    },
  };
}
