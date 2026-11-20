import { app, globalShortcut, screen } from 'electron';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { createSettingsStore } from './settings-store';
import { isQuietNow, liveSettings, shortcutIds, validateSettings,
  type Failure, type Presentation, type Settings, type SettingsResult, type SettingsView, type ShortcutAction } from './settings';

export type SettingsChange = 'preview' | 'cancel' | 'apply' | 'refresh';

export function createSettingsController(directory: string, change: (kind: SettingsChange) => void,
  onShortcut: (id: ShortcutAction) => void) {
  const store = createSettingsStore(directory);
  const loginItem = { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()],
    name: app.isPackaged ? 'NagisaDesktopPet' : 'NagisaDesktopPet.Dev' };
  const mappings = new Map<string, ShortcutAction>();
  let settings = store.initial;
  let draft: Settings | undefined;
  let warning = store.warning;
  let fullscreen = false;

  function readLogin() {
    if (process.platform !== 'win32') return false;
    const current = app.getLoginItemSettings(loginItem);
    return current.launchItems?.find((item) => item.name === loginItem.name && item.scope === 'user')?.enabled
      ?? (current.openAtLogin && current.executableWillLaunchAtLogin);
  }

  function presentation(): Presentation {
    return { fullscreen, quiet: isQuietNow(settings, fullscreen, new Date()) };
  }

  function view(checkLogin = false): SettingsView {
    if (checkLogin) settings = { ...settings, launchAtLogin: readLogin() };
    let savedAt: number | null = null;
    try { savedAt = statSync(join(directory, 'save.json')).mtimeMs; } catch { /* no save yet */ }
    const primary = screen.getPrimaryDisplay().id;
    const displays = screen.getAllDisplays().map((display, index) => ({ id: display.id,
      label: `${display.label || `显示器 ${index + 1}`} · ${display.workArea.width} × ${display.workArea.height}${display.id === primary ? ' · 主屏' : ''}` }));
    return { settings,
      effective: draft ? liveSettings(settings, draft) : settings, displays, presentation: presentation(), warning, savedAt };
  }

  function register(next: Settings) {
    const added: string[] = [];
    const proposed = new Map<string, ShortcutAction>();
    for (const id of shortcutIds) {
      const key = next.shortcuts[id];
      if (!key) continue;
      proposed.set(key, id);
      if (mappings.has(key)) continue;
      let available = false;
      try {
        available = globalShortcut.register(key, () => {
          const action = mappings.get(key);
          if (action) onShortcut(action);
        });
      } catch { /* invalid or unavailable in the current Windows session */ }
      if (!available) {
        for (const key of added) globalShortcut.unregister(key);
        return { ok: false, field: `shortcuts.${id}`, message: '该组合键已被系统或其他程序占用。' } as const;
      }
      added.push(key);
    }
    return { ok: true as const, commit() {
      for (const key of mappings.keys()) if (!proposed.has(key)) globalShortcut.unregister(key);
      mappings.clear();
      for (const [key, value] of proposed) mappings.set(key, value);
    }, rollback() { for (const key of added) globalShortcut.unregister(key); } };
  }

  const initialShortcuts = register(settings);
  if (initialShortcuts.ok === true) initialShortcuts.commit();
  else warning = initialShortcuts;
  settings = { ...settings, launchAtLogin: readLogin() };

  function cancel() {
    if (draft) {
      draft = undefined;
      change('cancel');
    }
  }

  return {
    view,
    presentation,
    settings: () => settings,
    canWrite: store.canWrite,
    setFullscreen(active: boolean) { fullscreen = active; },
    preview(value: unknown): SettingsResult {
      const result = validateSettings(value);
      if (result.ok === false) return result;
      draft = result.settings;
      change('preview');
      return { ok: true, view: view() };
    },
    cancel,
    apply(value: unknown): SettingsResult {
      const result = validateSettings(value);
      if (result.ok === false) return result;
      const next = result.settings;
      if (!store.canWrite) { cancel(); return warning ?? { ok: false, message: '无法保存设置。' }; }
      const keys = register(next);
      if (keys.ok === false) { cancel(); return keys; }
      const oldLogin = readLogin();
      const loginChanged = oldLogin !== next.launchAtLogin;
      let error: Failure | undefined;
      let loginWritten = false;
      if (loginChanged) {
        try {
          if (process.platform !== 'win32') throw new Error('login unavailable');
          app.setLoginItemSettings({ ...loginItem, openAtLogin: next.launchAtLogin });
          loginWritten = true;
          if (readLogin() !== next.launchAtLogin) throw new Error('login not updated');
        } catch { error = { ok: false, field: 'launchAtLogin', message: 'Windows 登录启动设置无法更改。' }; }
      }
      if (!error) {
        try { store.save(next); }
        catch { error = { ok: false, message: '设置文件写入失败，已恢复原有设置。' }; }
      }
      if (error) {
        keys.rollback();
        if (loginWritten) {
          try { app.setLoginItemSettings({ ...loginItem, openAtLogin: oldLogin }); }
          catch { error = { ...error, message: '设置应用失败，Windows 登录启动项需要重新核对。' }; }
        }
        cancel();
        return error;
      }
      keys.commit();
      settings = next;
      draft = undefined;
      warning = undefined;
      change('apply');
      return { ok: true, view: view() };
    },
    quick<K extends 'passThrough' | 'onboardingSeen'>(key: K, value: Settings[K], recover = false): SettingsResult {
      const next = { ...settings, [key]: value };
      let error: Failure | undefined;
      try { store.save(next); } catch { error = { ok: false, field: key, message: '设置未保存，请重试。' }; }
      if (error && !recover) return error;
      settings = next;
      warning = error;
      change('refresh');
      return error ?? { ok: true, view: view() };
    },
    replace(next: Settings) {
      settings = next;
      draft = undefined;
      warning = undefined;
      change('apply');
    },
  };
}
