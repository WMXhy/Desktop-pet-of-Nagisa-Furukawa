import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';
import { isFoodId, type CareResponse, type CareSnapshot, type FoodId } from './care';
import { isRecord } from './settings';
import { quickMenuActions, quickMenuLayout,
  type FoodOverlay, type QuickMenuAction, type QuickMenuPresentation, type QuickMenuView } from './quick-menu-layout';

type FoodActions = {
  read(): CareSnapshot;
  feed(id: FoodId, revision: number): CareResponse;
  buy(id: FoodId, quantity: number, revision: number): CareResponse;
};

function counter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function createQuickMenu(pet: BrowserWindow, url: string,
  webPreferences: BrowserWindowConstructorOptions['webPreferences'], select: (action: QuickMenuAction) => void,
  food: FoodActions) {
  const menuUrl = new URL(url).href;
  let menu: BrowserWindow | undefined;
  let active: QuickMenuPresentation | undefined;
  let nextId = 0;
  let nextFoodSession = 0;
  let foodSession: number | undefined;
  let overlay: FoodOverlay | undefined;
  let ready = false;
  let focusCheck: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(focusCheck);
    if (active && ready && menu && !menu.isDestroyed()) menu.webContents.send('quick-menu:closed', active.id);
    active = undefined;
    foodSession = undefined;
    overlay = undefined;
    if (menu && !menu.isDestroyed() && menu.isVisible()) menu.hide();
  }

  function layoutMenu(window: BrowserWindow) {
    if (!active || !pet.isVisible()) return false;
    const bounds = pet.getBounds();
    const layout = quickMenuLayout(bounds, screen.getDisplayMatching(bounds).workArea, foodSession !== undefined, overlay);
    if (!layout) { hide(); return false; }
    window.setBounds(layout.bounds);
    if (process.platform === 'win32' || process.platform === 'linux') window.setShape(layout.shape);
    window.webContents.send('quick-menu:view', {
      id: active.id, foodSession, overlay, side: layout.side, strip: layout.strip, panel: layout.panel,
    } satisfies QuickMenuView);
    return true;
  }

  function back() {
    if (!menu || !active) return;
    if (overlay?.kind === 'card') overlay = undefined;
    else if (foodSession !== undefined) { foodSession = undefined; overlay = undefined; }
    else { hide(); return; }
    layoutMenu(menu);
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
      if (!input.isAutoRepeat) back();
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
      window.setAlwaysOnTop(pet.isAlwaysOnTop());
      if (!layoutMenu(window)) return;
      window.show();
      page.send('quick-menu:shown', id);
    });
    page.ipc.on('quick-menu:select', (event, id: unknown, action: unknown) => {
      if (!currentPage(event.senderFrame) || !active || active.id !== id || !window.isVisible() ||
          !quickMenuActions.some((candidate) => candidate === action)) return;
      if (action === 'feed') {
        foodSession = foodSession === undefined ? ++nextFoodSession : undefined;
        overlay = undefined;
        layoutMenu(window);
        return;
      }
      hide();
      select(action as QuickMenuAction);
    });
    function canUseFood(frame: typeof page.mainFrame | null, id: unknown, session: unknown) {
      return currentPage(frame) && active?.id === id && active !== undefined && window.isVisible() &&
        foodSession !== undefined && foodSession === session;
    }
    page.ipc.on('quick-menu:overlay', (event, id: unknown, session: unknown, change: unknown) => {
      if (!canUseFood(event.senderFrame, id, session) || !isRecord(change) || !counter(change.token)) return;
      if (change.kind === 'close') {
        if (overlay?.token !== change.token) return;
        overlay = undefined;
      } else {
        if (!isFoodId(change.food)) return;
        if (change.kind === 'card' && typeof change.keyboard === 'boolean') {
          overlay = { kind: 'card', token: change.token, food: change.food, keyboard: change.keyboard };
        } else if (change.kind === 'tip' && overlay?.kind !== 'card' && counter(change.anchor)) {
          overlay = { kind: 'tip', token: change.token, food: change.food, anchor: change.anchor };
        } else return;
      }
      layoutMenu(window);
    });
    page.ipc.handle('quick-menu:care', (event, id: unknown, session: unknown) => {
      if (!canUseFood(event.senderFrame, id, session)) throw new Error('食物栏已经收起。');
      return food.read();
    });
    page.ipc.handle('quick-menu:food', (event, id: unknown, session: unknown, item: unknown, revision: unknown,
      epoch: unknown, purchase: unknown): CareResponse => {
      if (!canUseFood(event.senderFrame, id, session) || !isFoodId(item) || !counter(revision)) {
        return { ok: false, message: '食物栏已更新，请重新操作。' };
      }
      if (epoch !== food.read().epoch) return { ok: false, message: '养成档已更新，请重新确认。' };
      if (purchase === undefined) return food.feed(item, revision);
      if (!isRecord(purchase) || !counter(purchase.quantity) || purchase.quantity === 0 ||
          overlay?.kind !== 'card' || overlay.food !== item || overlay.token !== purchase.token) {
        return { ok: false, message: '购买卡已更新，请重新确认。' };
      }
      return food.buy(item, purchase.quantity, revision);
    });
    page.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        if (!input.isAutoRepeat) back();
      }
    });
    window.on('blur', onBlur);
    window.on('closed', () => {
      menu = undefined;
      ready = false;
      active = undefined;
      foodSession = undefined;
      overlay = undefined;
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
    updateFood(snapshot: CareSnapshot) {
      if (foodSession !== undefined && menu?.isVisible()) menu.webContents.send('quick-menu:care-changed', snapshot);
    },
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
