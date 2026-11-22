import { BrowserWindow, screen, type BrowserWindowConstructorOptions, type Rectangle } from 'electron';
import { isFoodId, type CareResponse, type CareSnapshot, type FoodId } from './care';
import { isRecord } from './settings';
import { watchQuickLayers, type QuickLayer } from './quick-layer-dismissal';
import { quickFoodLayer, quickMenuActions, quickMenuLayer, quickMenuLayout, quickOverlayLayer,
  type FoodOverlay, type QuickMenuAction, type QuickMenuPresentation, type QuickMenuView } from './quick-menu-layout';

type FoodActions = {
  read(): CareSnapshot;
  feed(id: FoodId, revision: number): CareResponse;
  buy(id: FoodId, quantity: number, revision: number): CareResponse;
};

function counter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function foodTarget(value: unknown): value is Rectangle {
  return isRecord(value) && counter(value.x) && counter(value.y) &&
    counter(value.width) && value.width > 0 && counter(value.height) && value.height > 0;
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
  let hasFeedback = false;
  let ready = false;
  let focusCheck: ReturnType<typeof setTimeout> | undefined;
  let visibleLayout: ReturnType<typeof quickMenuLayout>;
  let interacting: string[] = [];
  const dismissal = watchQuickLayers(() => ({
    layers: visibleLayers(), point: screen.getCursorScreenPoint(), interacting,
  }));

  function hide() {
    clearTimeout(focusCheck);
    dismissal.clear();
    if (active && ready && menu && !menu.isDestroyed()) menu.webContents.send('quick-menu:closed', active.id);
    active = undefined;
    foodSession = undefined;
    overlay = undefined;
    hasFeedback = false;
    visibleLayout = undefined;
    interacting = [];
    if (menu && !menu.isDestroyed() && menu.isVisible()) menu.hide();
  }

  function closeFood(window: BrowserWindow) {
    foodSession = undefined;
    overlay = undefined;
    hasFeedback = false;
    layoutMenu(window);
  }

  function closeOverlay(window: BrowserWindow) {
    overlay = undefined;
    layoutMenu(window);
  }

  function visibleLayers(): QuickLayer[] {
    if (!active || !menu?.isVisible() || !visibleLayout) return [];
    const window = menu;
    const origin = window.getBounds();
    const global = (rect: Rectangle) => ({ ...rect, x: origin.x + rect.x, y: origin.y + rect.y });
    const parent = quickMenuLayer(active.id);
    const layers: QuickLayer[] = [{ id: parent, areas: visibleLayout.rows.map(global), dismiss: hide }];
    const { strip, panel } = visibleLayout;
    if (!strip || foodSession === undefined) return layers;
    const foodId = quickFoodLayer(foodSession);
    layers.push({ id: foodId, parent, areas: [global(strip)], dismiss: () => closeFood(window) });
    if (!overlay || !panel) return layers;
    const areas = [global(panel)];
    if (overlay.kind === 'tip') {
      const target = overlay.target;
      const width = Math.min(target.width, strip.width - target.x);
      const height = Math.min(target.height, strip.height - target.y);
      if (width > 0 && height > 0) areas.push(global({ x: strip.x + target.x, y: strip.y + target.y, width, height }));
    }
    layers.push({ id: quickOverlayLayer(foodSession, overlay.token), parent: foodId, areas, dismiss: () => closeOverlay(window) });
    return layers;
  }

  function layoutMenu(window: BrowserWindow) {
    if (!active || !pet.isVisible()) return false;
    const bounds = pet.getBounds();
    const layout = quickMenuLayout(bounds, screen.getDisplayMatching(bounds).workArea, foodSession !== undefined, overlay, hasFeedback);
    if (!layout) { hide(); return false; }
    window.setBounds(layout.bounds);
    if (process.platform === 'win32' || process.platform === 'linux') window.setShape(layout.shape);
    visibleLayout = layout;
    window.webContents.send('quick-menu:view', {
      id: active.id, foodSession, overlay, side: layout.side, strip: layout.strip, panel: layout.panel,
    } satisfies QuickMenuView);
    dismissal.update();
    return true;
  }

  function back() {
    if (!menu || !active) return;
    if (overlay?.kind === 'card') closeOverlay(menu);
    else if (foodSession !== undefined) closeFood(menu);
    else hide();
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
      dismissal.update();
    });
    page.ipc.on('quick-menu:select', (event, id: unknown, action: unknown) => {
      if (!currentPage(event.senderFrame) || !active || active.id !== id || !window.isVisible() ||
          !quickMenuActions.some((candidate) => candidate === action)) return;
      if (action === 'feed') {
        if (foodSession === undefined) {
          foodSession = ++nextFoodSession;
          layoutMenu(window);
        } else closeFood(window);
        return;
      }
      hide();
      select(action as QuickMenuAction);
    });
    function canUseFood(frame: typeof page.mainFrame | null, id: unknown, session: unknown) {
      return currentPage(frame) && active?.id === id && active !== undefined && window.isVisible() &&
        foodSession !== undefined && foodSession === session;
    }
    page.ipc.on('quick-menu:activity', (event, id: unknown, layers: unknown) => {
      if (!currentPage(event.senderFrame) || !active || active.id !== id || !window.isVisible() ||
          !Array.isArray(layers) || layers.length > 6 || !layers.every((value) => typeof value === 'string')) return;
      interacting = layers;
      dismissal.update();
    });
    page.ipc.on('quick-menu:feedback', (event, id: unknown, session: unknown, feedback: unknown) => {
      if (!canUseFood(event.senderFrame, id, session) || typeof feedback !== 'boolean' || hasFeedback === feedback) return;
      hasFeedback = feedback;
      layoutMenu(window);
    });
    page.ipc.on('quick-menu:overlay', (event, id: unknown, session: unknown, change: unknown) => {
      if (!canUseFood(event.senderFrame, id, session) || !isRecord(change) || !counter(change.token)) return;
      if (change.kind === 'close') {
        if (overlay?.token !== change.token) return;
        overlay = undefined;
      } else {
        if (!isFoodId(change.food)) return;
        if (change.kind === 'card' && typeof change.keyboard === 'boolean') {
          overlay = { kind: 'card', token: change.token, food: change.food, keyboard: change.keyboard };
        } else if (change.kind === 'tip' && overlay?.kind !== 'card' && foodTarget(change.target)) {
          overlay = { kind: 'tip', token: change.token, food: change.food, target: change.target };
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
      dismissal.clear();
      menu = undefined;
      ready = false;
      active = undefined;
      foodSession = undefined;
      overlay = undefined;
      hasFeedback = false;
      visibleLayout = undefined;
      interacting = [];
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
