import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';
import { quickMenuActions, quickMenuLayout, type QuickMenuAction, type QuickMenuPresentation } from './quick-menu-layout';

export function createQuickMenu(pet: BrowserWindow, url: string,
  webPreferences: BrowserWindowConstructorOptions['webPreferences'], select: (action: QuickMenuAction) => void) {
  const menuUrl = new URL(url).href;
  let menu: BrowserWindow | undefined;
  let active: QuickMenuPresentation | undefined;
  let nextId = 0;
  let ready = false;
  let focusCheck: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(focusCheck);
    active = undefined;
    if (menu && !menu.isDestroyed() && menu.isVisible()) menu.hide();
  }

  function onBlur() {
    const current = active;
    clearTimeout(focusCheck);
    // Windows can deliver the blur before the pet receives focus and its pointer IPC.
    focusCheck = setTimeout(() => {
      if (current && active === current && !menu?.isFocused() && !pet.isFocused()) hide();
    }, 120);
  }

  pet.on('blur', onBlur);
  pet.on('hide', hide);
  pet.webContents.on('before-input-event', (event, input) => {
    if (active && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      hide();
    }
  });
  pet.on('closed', () => {
    hide();
    menu?.destroy();
  });

  function createWindow() {
    const window = new BrowserWindow({
      title: '团子快捷菜单', show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, skipTaskbar: true, resizable: false,
      movable: false, minimizable: false, maximizable: false, fullscreenable: false, webPreferences,
    });
    menu = window;
    const page = window.webContents;
    const currentPage = (frame: typeof page.mainFrame | null) => frame === page.mainFrame && frame?.url === menuUrl;

    page.ipc.on('quick-menu:ready', (event) => {
      if (!currentPage(event.senderFrame)) return;
      ready = true;
      if (active) page.send('quick-menu:present', active);
    });
    page.ipc.on('quick-menu:painted', (event, id: unknown) => {
      if (!currentPage(event.senderFrame) || !active || active.id !== id || window.isVisible() || !pet.isVisible()) return;
      const petBounds = pet.getBounds();
      const layout = quickMenuLayout(petBounds, screen.getDisplayMatching(petBounds).workArea);
      if (!layout) { hide(); return; }
      window.setAlwaysOnTop(pet.isAlwaysOnTop());
      window.setBounds(layout.bounds);
      if (process.platform === 'win32' || process.platform === 'linux') window.setShape(layout.rows);
      window.show();
      page.send('quick-menu:shown', id);
    });
    page.ipc.on('quick-menu:select', (event, id: unknown, action: unknown) => {
      if (!currentPage(event.senderFrame) || !active || active.id !== id || !window.isVisible() ||
          !quickMenuActions.some((candidate) => candidate === action)) return;
      hide();
      select(action as QuickMenuAction);
    });
    page.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        hide();
      }
    });
    window.on('blur', onBlur);
    window.on('closed', () => {
      menu = undefined;
      ready = false;
      active = undefined;
    });
    page.on('render-process-gone', () => { if (!window.isDestroyed()) window.destroy(); });
    void window.loadURL(menuUrl).catch((error) => {
      if (window.isDestroyed()) return;
      console.error('团子快捷菜单无法打开', error);
      window.destroy();
    });
  }

  return {
    hide,
    continuePetGesture: () => clearTimeout(focusCheck),
    toggle(reducedMotion: boolean) {
      if (active) { hide(); return false; }
      active = { id: ++nextId, reducedMotion };
      if (!menu) createWindow();
      else if (ready) menu.webContents.send('quick-menu:present', active);
      return true;
    },
  };
}
