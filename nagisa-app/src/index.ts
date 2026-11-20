import { app, BrowserWindow, Menu, nativeImage, screen, Tray, type IpcMainInvokeEvent, type Point } from 'electron';
import { mkdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import appIcon from './assets/app-icon.png';
import { hugUnavailable, isActivityKind, isFoodId, isToyId, type FoodId } from './care';
import { createCareRuntime } from './care-runtime';
import { dangoHugMs, isDangoMode, isDangoSlot, type DangoMode } from './dango';
import { homePosition, restorePosition, savePosition } from './pet-position';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const title = '古河渚桌宠';
const size = 256;
const maxCoordinate = 0x7fffffff;

function requestedDangoMode(mode: unknown): DangoMode | undefined {
  if (mode === undefined) return;
  if (!isDangoMode(mode)) throw new Error('无效的小游戏玩法');
  return mode;
}

let tray: Tray;

async function startPet(): Promise<void> {
  const icon = nativeImage.createFromDataURL(appIcon);
  const { x, y } = restorePosition(size);
  const webPreferences = { preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, contextIsolation: true, nodeIntegration: false, sandbox: true };
  const petWindow = new BrowserWindow({
    title,
    icon,
    width: size,
    height: size,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences,
  });

  let pendingSave: ReturnType<typeof setTimeout> | undefined;
  function saveNow() {
    clearTimeout(pendingSave);
    savePosition(petWindow.getBounds());
  }
  petWindow.on('move', () => {
    clearTimeout(pendingSave);
    pendingSave = setTimeout(saveNow, 250);
  });
  petWindow.on('close', saveNow);
  petWindow.on('closed', () => clearTimeout(pendingSave));

  let passThrough = false;
  let gesture: { pointer: Point; origin: Point; dragged: boolean } | undefined;

  function updateDrag(screenX: number, screenY: number) {
    if (!gesture) return;
    const dx = screenX - gesture.pointer.x;
    const dy = screenY - gesture.pointer.y;
    if (Math.hypot(dx, dy) > 5) gesture.dragged = true;
    if (gesture.dragged) {
      const x = Math.round(gesture.origin.x + dx);
      const y = Math.round(gesture.origin.y + dy);
      if (Math.abs(x) <= maxCoordinate && Math.abs(y) <= maxCoordinate) petWindow.setPosition(x, y);
    }
  }

  const contents = petWindow.webContents;
  const { ipc } = contents;
  ipc.on('pet:start', (event, screenX: number, screenY: number) => {
    if (event.senderFrame !== contents.mainFrame || passThrough || !petWindow.isVisible()) return;
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    const [x, y] = petWindow.getPosition();
    // 使用指针事件发生时的屏幕坐标，避免快速拖动时多条消息读到同一个鼠标位置。
    gesture = { pointer: { x: screenX, y: screenY }, origin: { x, y }, dragged: false };
  });
  ipc.on('pet:move', (event, screenX: number, screenY: number) => {
    if (event.senderFrame !== contents.mainFrame || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    updateDrag(screenX, screenY);
  });
  ipc.handle('pet:finish', (event, screenX: number, screenY: number) => {
    if (event.senderFrame !== contents.mainFrame || !gesture) return false;
    const valid = Number.isFinite(screenX) && Number.isFinite(screenY);
    if (valid) updateDrag(screenX, screenY);
    const clicked = valid && !gesture.dragged;
    gesture = undefined;
    return clicked;
  });
  ipc.on('pet:cancel', (event) => {
    if (event.senderFrame === contents.mainFrame) gesture = undefined;
  });

  function showPet() {
    petWindow.showInactive();
    if (petWindow.isAlwaysOnTop()) return;
    petWindow.setAlwaysOnTop(true);
    if (process.platform === 'win32' && !petWindow.isAlwaysOnTop()) {
      // Windows 有时不会为不抢焦点的窗口应用默认置顶层级。
      petWindow.setAlwaysOnTop(true, 'pop-up-menu');
    }
  }

  let journal: BrowserWindow | undefined;
  let game: BrowserWindow | undefined;
  let gameMode: DangoMode = 'classic';
  let hugUntil = 0;
  const care = createCareRuntime(app.getPath('userData'), !app.isPackaged && process.env.NAGISA_FAST_ACTIVITY === '1', (change) => {
    for (const window of [petWindow, journal, game]) {
      if (!window || window.isDestroyed()) continue;
      const page = window.webContents;
      if (!page.isCrashed() && page.getURL()) page.send('care:changed', change);
    }
  });
  app.once('before-quit', () => care.close());
  ipc.handle('care:read', (event) => {
    if (event.senderFrame !== contents.mainFrame) throw new Error('无效的角色请求');
    return care.read();
  });

  function openDangoGame(mode?: DangoMode) {
    if (game && !game.isDestroyed()) {
      if (mode && !care.read().gameBusy) {
        gameMode = mode;
        if (!game.webContents.isLoadingMainFrame()) game.webContents.send('dango:mode', mode);
      }
      if (game.isMinimized()) game.restore();
      if (game.isVisible()) game.focus();
      return;
    }

    const pet = petWindow.getBounds();
    const area = screen.getDisplayMatching(pet).workArea;
    const width = Math.min(352, area.width);
    const height = Math.min(364, area.height);
    const right = pet.x + pet.width + 8;
    const maxX = area.x + area.width - width;
    const side = right <= maxX ? right : pet.x - width - 8;
    const window = new BrowserWindow({
      title: mode === 'lines' ? '台词接龙' : '猜团子', icon, width, height, show: false, autoHideMenuBar: true, webPreferences,
      x: Math.max(area.x, Math.min(side, maxX)),
      y: Math.max(area.y, Math.min(pet.y, area.y + area.height - height)),
    });
    game = window;
    gameMode = mode ?? 'classic';
    const page = window.webContents;
    let owner = Symbol();
    let ownedRoundId: string | undefined;

    function release() {
      if (ownedRoundId) care.leaveDango(owner, ownedRoundId);
      ownedRoundId = undefined;
      owner = Symbol();
    }

    function checkSender(event: IpcMainInvokeEvent) {
      if (event.sender !== page || !event.senderFrame || event.senderFrame !== page.mainFrame ||
          !event.senderFrame.url.endsWith('#dango-game')) throw new Error('无效的猜团子请求');
    }

    page.ipc.handle('care:read', (event) => {
      checkSender(event);
      return care.read();
    });
    page.ipc.handle('dango:mode', (event) => {
      checkSender(event);
      return gameMode;
    });
    page.ipc.handle('dango:start', (event, revision: unknown, mode: unknown) => {
      checkSender(event);
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的开局请求');
      if (page.isLoadingMainFrame()) return { ok: false, message: '面板正在加载，请稍后重试。' };
      const result = care.startDango(owner, revision, requestedDangoMode(mode));
      if (result.ok) ownedRoundId = result.round.id;
      return result;
    });
    page.ipc.handle('dango:pick', (event, id: unknown, slot: unknown) => {
      checkSender(event);
      if (typeof id !== 'string' || !id.trim() || !isDangoSlot(slot)) throw new Error('无效的作答请求');
      return care.pickDango(owner, id, slot);
    });
    page.ipc.handle('dango:leave', (event, id: unknown) => {
      checkSender(event);
      if (typeof id !== 'string' || !id.trim()) throw new Error('无效的退出请求');
      if (ownedRoundId !== id) return;
      care.leaveDango(owner, id);
      ownedRoundId = undefined;
    });
    page.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) release();
    });
    page.on('render-process-gone', () => { if (!window.isDestroyed()) window.destroy(); });
    window.on('closed', () => {
      if (game === window) game = undefined;
      release();
    });
    window.once('ready-to-show', () => window.show());
    void window.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#dango-game`).catch((error) => {
      if (window.isDestroyed()) return;
      console.error('猜团子面板无法打开', error);
      window.close();
    });
  }

  function openJournal() {
    if (journal && !journal.isDestroyed()) {
      if (journal.isMinimized()) journal.restore();
      journal.focus();
      return;
    }

    const window = new BrowserWindow({
      title: '渚的手账',
      icon,
      width: 420,
      height: 480,
      show: false,
      autoHideMenuBar: true,
      webPreferences,
    });
    journal = window;
    const journalContents = window.webContents;
    journalContents.ipc.handle('care:read', (event) => {
      if (event.senderFrame !== journalContents.mainFrame) throw new Error('无效的手账请求');
      return care.read();
    });
    journalContents.ipc.handle('dango:open', (event, mode: unknown) => {
      if (event.sender !== journalContents || !event.senderFrame || event.senderFrame !== journalContents.mainFrame) {
        throw new Error('无效的手账请求');
      }
      openDangoGame(requestedDangoMode(mode));
    });
    function feed(id: FoodId, revision: number) {
      const result = care.feed(id, revision);
      if (result.ok && !petWindow.isDestroyed() && petWindow.isVisible()) {
        contents.send('care:fed', id);
      }
      return result;
    }
    journalContents.ipc.handle('care:feed', (event, revision: number) => {
      if (event.senderFrame !== journalContents.mainFrame || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error('无效的喂食请求');
      }
      return feed('bread', revision);
    });
    journalContents.ipc.handle('care:feed-food', (event, id: unknown, revision: number) => {
      if (event.senderFrame !== journalContents.mainFrame || !isFoodId(id) ||
          !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的喂食请求');
      return feed(id, revision);
    });
    journalContents.ipc.handle('care:buy', (event, id: unknown, quantity: number, revision: number) => {
      if (event.senderFrame !== journalContents.mainFrame || !isFoodId(id) ||
          !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error('无效的购买请求');
      }
      return care.buy(id, quantity, revision);
    });
    journalContents.ipc.handle('care:buy-toy', (event, id: unknown, revision: number) => {
      if (event.sender !== journalContents || !event.senderFrame || event.senderFrame !== journalContents.mainFrame ||
          !isToyId(id) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的玩具购买请求');
      return care.buyToy(id, revision);
    });
    journalContents.ipc.handle('pet:hug', (event) => {
      if (event.sender !== journalContents || !event.senderFrame || event.senderFrame !== journalContents.mainFrame) {
        throw new Error('无效的抱玩偶请求');
      }
      const snapshot = care.read();
      if (snapshot.ok === false) return snapshot;
      const { state, gameBusy } = snapshot;
      const unavailable = hugUnavailable(state, gameBusy);
      if (unavailable) return { ok: false, state, message: unavailable };
      if (petWindow.isDestroyed() || !petWindow.isVisible() || contents.isCrashed()) {
        return { ok: false, state, message: '请先从托盘找回角色。' };
      }
      if (performance.now() < hugUntil) return { ok: false, state, message: '渚正在抱玩偶，等一下就能再抱。' };
      hugUntil = performance.now() + dangoHugMs;
      contents.send('pet:hug');
      return { ok: true, state };
    });
    journalContents.ipc.handle('care:claim-bread', (event, revision: number) => {
      if (event.senderFrame !== journalContents.mainFrame || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error('无效的补给请求');
      }
      return care.claimBread(revision);
    });
    journalContents.ipc.handle('care:start', (event, kind: unknown, revision: number) => {
      if (event.senderFrame !== journalContents.mainFrame || !isActivityKind(kind) ||
          !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的活动请求');
      return care.start(kind, revision);
    });
    journalContents.ipc.handle('care:cancel', (event, id: unknown, revision: number) => {
      if (event.senderFrame !== journalContents.mainFrame || typeof id !== 'string' || !id.trim() ||
          !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的取消请求');
      return care.cancel(id, revision);
    });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      if (journal === window) journal = undefined;
    });
    void window.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#journal`).catch((error) => {
      if (window.isDestroyed()) return;
      console.error('手账无法打开', error);
      window.close();
    });
  }

  tray = new Tray(icon.resize({ width: 32, height: 32, quality: 'best' }));
  tray.setToolTip(title);

  function recoverPet() {
    gesture = undefined;
    passThrough = false;
    petWindow.setIgnoreMouseEvents(false);
    const { x, y } = homePosition(size);
    petWindow.setPosition(x, y);
    showPet();
    saveNow();
    refreshMenu();
  }

  function refreshMenu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开手账', click: openJournal },
      { type: 'separator' },
      { label: '隐藏角色', enabled: petWindow.isVisible(), click: () => {
        gesture = undefined;
        petWindow.hide();
        refreshMenu();
      } },
      { label: '鼠标穿透', type: 'checkbox', checked: passThrough, click: (item) => {
        gesture = undefined;
        passThrough = item.checked;
        petWindow.setIgnoreMouseEvents(passThrough);
      } },
      { label: '找回角色', click: recoverPet },
      { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ]));
  }

  function recoverAfterDisplayRemoval() {
    const { x, y, width, height } = petWindow.getBounds();
    const fits = screen.getAllDisplays().some(({ workArea: area }) => (
      x >= area.x && y >= area.y && x + width <= area.x + area.width && y + height <= area.y + area.height
    ));
    if (!fits) recoverPet();
  }

  screen.on('display-removed', recoverAfterDisplayRemoval);
  petWindow.on('closed', () => {
    screen.off('display-removed', recoverAfterDisplayRemoval);
    if (journal && !journal.isDestroyed()) journal.close();
    if (game && !game.isDestroyed()) game.close();
  });

  await petWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  showPet();
  refreshMenu();
}

const testData = process.env.NAGISA_TEST_DATA;
if (!app.isPackaged && testData && isAbsolute(testData)) {
  mkdirSync(testData, { recursive: true });
  app.setPath('userData', testData);
}

if (app.requestSingleInstanceLock()) {
  app.whenReady().then(startPet).catch((error) => {
    console.error('桌宠启动失败', error);
    app.quit();
  });
} else {
  app.quit();
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => tray?.destroy());
