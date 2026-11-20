export const settingsVersion = 1;

export const shortcutActions = { togglePet: '显示 / 隐藏角色', recoverPet: '取消穿透并找回角色', openJournal: '打开手账' } as const;
export type ShortcutAction = keyof typeof shortcutActions;
export const shortcutIds = ['togglePet', 'recoverPet', 'openJournal'] as const;

export const defaultSettings = {
  launchAtLogin: false, showOnStartup: true, stayInTray: true,
  scale: 100, opacity: 100, onTop: true, lockPosition: false, displayId: null as number | null,
  passThrough: false, allowDrag: true, bubbleSeconds: 4, autoGreeting: false, greetingMinutes: 30,
  volume: 50, soundEffects: false, reducedMotion: false, fps: 24 as 12 | 24 | 30,
  completionBubble: true, systemNotifications: false, quietHours: true, quietStart: '22:00', quietEnd: '08:00',
  fullscreenQuiet: true, fullscreenHide: false, manualQuiet: false,
  shortcuts: { togglePet: '', recoverPet: '', openJournal: '' } as Record<ShortcutAction, string>,
  onboardingSeen: false,
};
export type Settings = typeof defaultSettings;
export type SettingsField = keyof Settings | `shortcuts.${ShortcutAction}`;
export type Failure = { ok: false; message: string; field?: SettingsField };
export type SettingsResult = { ok: true; view: SettingsView } | Failure;
export type Presentation = { quiet: boolean; fullscreen: boolean };
export type SettingsView = {
  settings: Settings;
  effective: Settings;
  presentation: Presentation;
  displays: { id: number; label: string }[];
  savedAt: number | null;
  warning?: Failure;
};

export const settingsPages = {
  general: { name: '常规', fields: ['launchAtLogin', 'showOnStartup', 'stayInTray'] },
  desktop: { name: '外观与桌面', fields: ['scale', 'opacity', 'onTop', 'lockPosition', 'displayId'] },
  interaction: { name: '互动', fields: ['passThrough', 'allowDrag', 'bubbleSeconds', 'autoGreeting', 'greetingMinutes'] },
  sound: { name: '声音与动画', fields: ['volume', 'soundEffects', 'reducedMotion', 'fps'] },
  focus: { name: '提醒与专注', fields: ['completionBubble', 'systemNotifications', 'quietHours', 'quietStart', 'quietEnd',
    'fullscreenQuiet', 'fullscreenHide', 'manualQuiet'] },
  shortcuts: { name: '快捷键', fields: ['shortcuts'] },
  data: { name: '存档与隐私', fields: [] },
} as const satisfies Record<string, { name: string; fields: readonly (keyof Settings)[] }>;
export type SettingsPage = keyof typeof settingsPages;
export type JournalSection = 'feed' | 'bakery' | 'study';

const keys = Object.keys(defaultSettings) as (keyof Settings)[];
const localFields: readonly (keyof Settings)[] = ['launchAtLogin', 'displayId', 'shortcuts', 'onboardingSeen'];
export type PortableSettings = Omit<Settings, 'launchAtLogin' | 'displayId' | 'shortcuts' | 'onboardingSeen'>;
const liveFields = ['scale', 'opacity', 'onTop', 'lockPosition', 'displayId', 'allowDrag', 'bubbleSeconds', 'volume',
  'soundEffects', 'reducedMotion', 'fps'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

const modifierKeys = ['Control', 'Alt', 'Shift', 'Super'] as const;
const shortcutKey = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/;

function acceleratorValid(value: string): boolean {
  const parts = value.split('+');
  const key = parts.pop();
  return parts.length > 0 && shortcutKey.test(key ?? '') &&
    modifierKeys.filter((modifier) => parts.includes(modifier)).join('+') === parts.join('+');
}

export function captureShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | undefined {
  const aliases: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const key = aliases[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const parts = modifierKeys.filter((_, index) => [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey][index]);
  if (parts.length && shortcutKey.test(key)) return [...parts, key].join('+');
}

function fieldValueValid(key: keyof Settings, value: unknown): boolean {
  switch (key) {
    case 'scale': return inRange(value, 50, 200);
    case 'opacity': return inRange(value, 30, 100);
    case 'volume': return inRange(value, 0, 100);
    case 'bubbleSeconds': return inRange(value, 2, 10);
    case 'greetingMinutes': return inRange(value, 1, 1440);
    case 'fps': return value === 12 || value === 24 || value === 30;
    case 'displayId': return value === null || (typeof value === 'number' && Number.isSafeInteger(value));
    case 'quietStart': case 'quietEnd': return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    default: return typeof value === 'boolean';
  }
}

export function validateSettings(value: unknown): { ok: true; settings: Settings } | Failure {
  if (!isRecord(value)) return { ok: false, message: '设置格式无法识别。' };
  const extra = Object.keys(value).find((key) => !Object.prototype.hasOwnProperty.call(defaultSettings, key));
  if (extra) return { ok: false, message: '包含无法识别的设置项。' };
  for (const key of keys) {
    if (key !== 'shortcuts' && !fieldValueValid(key, value[key])) return { ok: false, field: key, message: '请检查这一项的取值。' };
  }
  const shortcuts = value.shortcuts;
  if (!isRecord(shortcuts) || Object.keys(shortcuts).length !== shortcutIds.length) {
    return { ok: false, field: 'shortcuts', message: '快捷键格式无法识别。' };
  }
  const used = new Set<string>();
  for (const id of shortcutIds) {
    const value = shortcuts[id];
    if (typeof value !== 'string' || (value !== '' && !acceleratorValid(value))) {
      return { ok: false, field: `shortcuts.${id}`, message: '请录入修饰键与普通键的组合。' };
    }
    if (value && used.has(value)) return { ok: false, field: `shortcuts.${id}`, message: '这个组合键已分配给另一项。' };
    if (value) used.add(value);
  }
  return { ok: true, settings: { ...value, shortcuts: { ...shortcuts } } as Settings };
}

export function liveSettings(saved: Settings, draft: Settings): Settings {
  return { ...saved, ...Object.fromEntries(liveFields.map((key) => [key, draft[key]])) };
}

export function exportPreferences(settings: Settings): PortableSettings {
  return Object.fromEntries(keys.filter((key) => !localFields.includes(key)).map((key) => [key, settings[key]])) as PortableSettings;
}

export function importPreferences(value: unknown, saved: Settings): ReturnType<typeof validateSettings> {
  const fields = Object.keys(exportPreferences(saved));
  if (!isRecord(value) || Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !fields.includes(key))) {
    return { ok: false, message: '导出的便携设置格式不完整。' };
  }
  return validateSettings({ ...saved, ...value });
}

export function isQuietNow(settings: Settings, fullscreen: boolean, now: Date): boolean {
  if (settings.manualQuiet || (settings.fullscreenQuiet && fullscreen)) return true;
  if (!settings.quietHours || settings.quietStart === settings.quietEnd) return false;
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const { quietStart: start, quietEnd: end } = settings;
  return start < end ? time >= start && time < end : time >= start || time < end;
}
