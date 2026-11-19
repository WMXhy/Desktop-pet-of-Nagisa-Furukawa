import { app, BrowserWindow, Menu, nativeImage, screen, Tray, type Point } from 'electron';
import appIcon from './assets/app-icon.png';
import { homePosition, restorePosition, savePosition } from './pet-position';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const title = '古河渚桌宠';
const size = 256;
const maxCoordinate = 0x7fffffff;

let tray: Tray;

async function startPet(): Promise<void> {
  const icon = nativeImage.createFromDataURL(appIcon);
  const { x, y } = restorePosition(size);
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
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
      height: 320,
      show: false,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
    });
    journal = window;
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
  });

  await petWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  showPet();
  refreshMenu();
}

app.whenReady().then(startPet).catch((error) => {
  console.error('桌宠启动失败', error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => tray?.destroy());
