import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { windowsHelperPath } from './desktop-state';

const packagedLoginName = 'NagisaDesktopPet';
const appExe = basename(process.execPath);
const versionDirectory = dirname(process.execPath);
const root = dirname(versionDirectory);
const installed = process.platform === 'win32' && app.isPackaged &&
  basename(versionDirectory).toLowerCase() === `app-${app.getVersion().toLowerCase()}` &&
  existsSync(join(root, 'Update.exe'));

export function petLoginItem() {
  return {
    path: installed ? join(root, appExe) : process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
    name: app.isPackaged ? packagedLoginName : `${packagedLoginName}.Dev`,
  };
}

export function readPetLoginItem(path: string, name: string) {
  if (process.platform !== 'win32') return undefined;
  return app.getLoginItemSettings({ path }).launchItems
    ?.find((item) => item.scope === 'user' && item.name.toLowerCase() === name.toLowerCase());
}

export function migrateInstalledLogin() {
  if (!installed) return;
  const item = petLoginItem();
  try {
    if (!existsSync(item.path) || readPetLoginItem(item.path, item.name)) return;
    // Older packaged versions registered the full executable path without arguments.
    const command = execFileSync(windowsHelperPath(), ['--read-login-item', item.name],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim();
    const previous = command.startsWith('"') && command.endsWith('"') ? command.slice(1, -1) : command;
    if (!isAbsolute(previous) || basename(previous).toLowerCase() !== appExe.toLowerCase()) return;
    const registration = readPetLoginItem(previous, item.name);
    if (registration?.args.length === 0) {
      app.setLoginItemSettings({ ...item, openAtLogin: true, enabled: registration.enabled });
    }
  } catch (error) {
    console.warn('无法迁移桌宠的 Windows 登录启动项', error);
  }
}

export function handleSquirrelStartup(): boolean {
  if (!installed) {
    if (process.platform === 'win32' && app.isPackaged && existsSync(join(versionDirectory, '.nagisa-install'))) {
      app.setAppUserModelId('WMXhy.NagisaDesktopPet');
    }
    return false;
  }
  app.setAppUserModelId(`com.squirrel.${basename(root).replace(/ /g, '')}.${basename(appExe, '.exe').replace(/ /g, '')}`);
  switch (process.argv[1]) {
    case '--squirrel-install':
    case '--squirrel-updated':
      migrateInstalledLogin();
      break;
    case '--squirrel-uninstall':
      try { app.setLoginItemSettings({ ...petLoginItem(), openAtLogin: false }); }
      catch (error) { console.warn('无法清理桌宠的 Windows 登录启动项', error); }
      break;
  }
  // The module runs the shortcut command and quits once Squirrel has finished it.
  return require('electron-squirrel-startup') as boolean;
}
