import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, screen, Tray,
  type IpcMainInvokeEvent, type Point, type Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import appIcon from './assets/app-icon.png';
import { activityRules, hugUnavailable, isActivityKind, isFoodId, isToyId, newCare, practiceLineUnavailable,
  type Care, type CareChange, type CareResponse, type FoodId } from './care';
import { writeAtomic } from './atomic-file';
import { readSave } from './care-store';
import { createCareRuntime } from './care-runtime';
import { dangoHugMs, isDangoMode, isDangoSlot, type DangoMode } from './dango';
import { petBounds, restorePosition, savePosition } from './pet-position';
import type { QuickMenuAction } from './quick-menu-layout';
import { createQuickMenu } from './quick-menu-window';
import { practiceLineMs } from './relationship';
import { watchDesktop } from './desktop-state';
import { handleSquirrelStartup, migrateInstalledLogin } from './windows-install';
import { defaultSettings, type JournalSection, type Settings, type SettingsResult, type ShortcutAction } from './settings';
import { createSettingsController, type SettingsChange } from './settings-controller';
import { exportJson, readTransfer, recoverDataTransaction, replaceSavedData, RollbackError, transferPreview,
  type TransferPreview, type TransferResponse } from './save-transfer';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const title = '古河渚桌宠';
const baseSize = 256;

function requestedDangoMode(mode: unknown): DangoMode | undefined {
  if (mode === undefined) return;
  if (!isDangoMode(mode)) throw new Error('无效的小游戏玩法');
  return mode;
}

let tray: Tray;

async function startPet(): Promise<void> {
  const directory = app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  recoverDataTransaction(directory);
  migrateInstalledLogin();
  const settings = createSettingsController(directory, applyDesktop, useShortcut);
  const icon = nativeImage.createFromDataURL(appIcon);
  const size = petSize(settings.settings());
  const savedPoint = restorePosition(size);
  const firstBounds = petBounds(size, settings.settings().displayId, { ...savedPoint, width: size, height: size });
  const webPreferences = { preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, contextIsolation: true, nodeIntegration: false, sandbox: true };
  const petWindow = new BrowserWindow({
    title,
    icon,
    ...firstBounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences,
  });
  const quickMenu = createQuickMenu(petWindow, `${MAIN_WINDOW_WEBPACK_ENTRY}#quick-menu`, webPreferences, openQuickAction);

  let pendingSave: ReturnType<typeof setTimeout> | undefined;
  let previewOrigin: Rectangle | undefined;
  function saveNow() {
    clearTimeout(pendingSave);
    savePosition(previewOrigin ?? petWindow.getBounds());
  }
  petWindow.on('move', () => {
    if (previewOrigin) return;
    clearTimeout(pendingSave);
    pendingSave = setTimeout(saveNow, 250);
  });
  petWindow.on('close', saveNow);
  petWindow.on('closed', () => clearTimeout(pendingSave));

  let passThrough = settings.settings().passThrough;
  let desktopSettings = settings.settings();
  let userHidden = !desktopSettings.showOnStartup;
  let windowsReady = false;
  let quitting = false;
  let desktopState = { fullscreen: false, notificationsAllowed: process.platform !== 'win32' };
  let lastQuiet: boolean | undefined;
  let gesture: { id: number; pointer: Point; origin: Point; dragged: boolean; pose: PickupPose | null; turnX: number } | undefined;
  let greetingClickUntil = 0;

  function endGesture() {
    const ended = gesture;
    gesture = undefined;
    greetingClickUntil = 0;
    if (ended && !contents.isDestroyed()) contents.send('pet:pickup', { id: ended.id, pose: null });
  }

  function updateDrag(screenX: number, screenY: number, finishing = false) {
    if (!gesture) return;
    const dx = screenX - gesture.pointer.x;
    const dy = screenY - gesture.pointer.y;
    if (!gesture.dragged && Math.hypot(dx, dy) > 5) {
      gesture.dragged = true;
      quickMenu.hide();
    }
    if (gesture.dragged && desktopSettings.allowDrag && !desktopSettings.lockPosition &&
        !passThrough && petWindow.isVisible()) {
      const x = Math.round(gesture.origin.x + dx);
      const y = Math.round(gesture.origin.y + dy);
      if (Number.isSafeInteger(x) && Number.isSafeInteger(y) && Math.abs(x) <= 0x7fffffff && Math.abs(y) <= 0x7fffffff) {
        petWindow.setBounds(petBounds(petSize(desktopSettings), desktopSettings.displayId, { ...petWindow.getBounds(), x, y }));
        if (finishing) return;
        const fromTurn = screenX - gesture.turnX;
        const pose = fromTurn >= 6 ? 'right' : fromTurn <= -6 ? 'left' : gesture.pose ?? 'hold';
        if (pose !== gesture.pose && pose !== 'hold') gesture.turnX = screenX;
        if (pose === 'right') gesture.turnX = Math.max(gesture.turnX, screenX);
        if (pose === 'left') gesture.turnX = Math.min(gesture.turnX, screenX);
        if (pose !== gesture.pose) {
          gesture.pose = pose;
          contents.send('pet:pickup', { id: gesture.id, pose });
        }
      }
    }
  }

  const contents = petWindow.webContents;
  const { ipc } = contents;
  ipc.on('pet:start', (event, id: number, screenX: number, screenY: number) => {
    if (event.senderFrame !== contents.mainFrame || !Number.isSafeInteger(id) || id <= 0) return;
    if (passThrough || !petWindow.isVisible() || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
      contents.send('pet:pickup', { id, pose: null });
      return;
    }
    const [x, y] = petWindow.getPosition();
    quickMenu.continuePetGesture();
    endGesture();
    // 使用指针事件发生时的屏幕坐标，避免快速拖动时多条消息读到同一个鼠标位置。
    gesture = { id, pointer: { x: screenX, y: screenY }, origin: { x, y }, dragged: false, pose: null, turnX: screenX };
  });
  ipc.on('pet:move', (event, id: number, screenX: number, screenY: number) => {
    if (event.senderFrame !== contents.mainFrame || gesture?.id !== id ||
        !Number.isFinite(screenX) || !Number.isFinite(screenY)) return;
    updateDrag(screenX, screenY);
  });
  ipc.handle('pet:finish', (event, id: number, screenX: number, screenY: number) => {
    if (event.senderFrame !== contents.mainFrame || !gesture || gesture.id !== id) return { greet: false };
    const valid = Number.isFinite(screenX) && Number.isFinite(screenY);
    if (valid) updateDrag(screenX, screenY, true);
    const clicked = valid && !gesture.dragged && !passThrough && petWindow.isVisible();
    endGesture();
    const greet = clicked && quickMenu.toggle(desktopSettings.reducedMotion);
    if (greet) greetingClickUntil = performance.now() + 2000;
    return { greet };
  });
  ipc.on('pet:cancel', (event, id: number) => {
    if (event.senderFrame === contents.mainFrame && gesture?.id === id) endGesture();
  });

  function showPet() {
    if (!petWindow.isVisible()) petWindow.showInactive();
    if (petWindow.isAlwaysOnTop() === desktopSettings.onTop) return;
    petWindow.setAlwaysOnTop(desktopSettings.onTop);
    if (desktopSettings.onTop && process.platform === 'win32' && !petWindow.isAlwaysOnTop()) {
      // Windows 有时不会为不抢焦点的窗口应用默认置顶层级。
      petWindow.setAlwaysOnTop(true, 'pop-up-menu');
    }
  }

  function petSize(value: Settings) { return Math.round(baseSize * value.scale / 100); }

  function updateVisibility() {
    if (quitting || !windowsReady || petWindow.isDestroyed()) return;
    const temporarilyHidden = desktopState.fullscreen && desktopSettings.fullscreenQuiet && desktopSettings.fullscreenHide;
    if (userHidden || temporarilyHidden) {
      quickMenu.hide();
      endGesture();
      if (petWindow.isVisible()) petWindow.hide();
    } else showPet();
    refreshMenu();
  }

  function applyDesktop(kind: SettingsChange) {
    const { effective } = settings.view();
    if (!petWindow.isDestroyed() && !quitting) {
      if (kind === 'preview' || effective.scale !== desktopSettings.scale ||
          effective.displayId !== desktopSettings.displayId || effective.passThrough !== passThrough) quickMenu.hide();
      const bounds = petWindow.getBounds();
      if (kind === 'preview' && !previewOrigin) { previewOrigin = bounds; clearTimeout(pendingSave); }
      if (kind === 'cancel' || kind === 'apply' || effective.scale !== desktopSettings.scale || effective.displayId !== desktopSettings.displayId) {
        const anchor = kind === 'apply' && effective.scale === desktopSettings.scale && effective.displayId === desktopSettings.displayId
          ? bounds : previewOrigin ?? bounds;
        petWindow.setBounds(petBounds(petSize(effective), effective.displayId, anchor));
      }
      if (kind === 'apply' || kind === 'cancel') {
        previewOrigin = undefined;
        if (kind === 'apply') saveNow();
      }
      if (passThrough !== effective.passThrough || (!desktopSettings.lockPosition && effective.lockPosition) ||
          (desktopSettings.allowDrag && !effective.allowDrag)) endGesture();
      passThrough = effective.passThrough;
      petWindow.setIgnoreMouseEvents(passThrough);
      petWindow.setOpacity(effective.opacity / 100);
    }
    desktopSettings = effective;
    updateVisibility();
    broadcastSettings();
  }

  let journal: BrowserWindow | undefined;
  let navigateJournal: ((section: JournalSection) => void) | undefined;
  let game: BrowserWindow | undefined;
  let settingsWindow: BrowserWindow | undefined;
  let gameMode: DangoMode = 'classic';
  let interactionUntil = 0;
  const fast = !app.isPackaged && process.env.NAGISA_FAST_ACTIVITY === '1';
  let careEpoch = 0;
  function publishCare(change: CareChange) {
    for (const window of [petWindow, journal, game]) {
      if (!window || window.isDestroyed()) continue;
      const page = window.webContents;
      if (!page.isCrashed() && page.getURL()) page.send('care:changed', change);
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) sendSettings(settingsWindow);
    if (change.completed && desktopSettings.systemNotifications && !settings.presentation().quiet && desktopState.notificationsAllowed) {
      const activity = change.completed;
      tray?.displayBalloon({ title, content: `${activityRules[activity.kind].label}已完成，收益可在手账查看。`,
        noSound: true, respectQuietTime: true });
    }
  }
  let care = createCareRuntime(directory, fast, publishCare, careEpoch);
  app.once('before-quit', () => {
    quitting = true;
    quickMenu.hide();
    care.close();
  });

  function ensureEpoch(epoch: unknown) {
    if (epoch !== careEpoch) throw new Error('养成档已更新，请重新操作。');
  }

  function sendSettings(window: BrowserWindow) {
    const page = window.webContents;
    if (page.getURL() && !page.isCrashed()) page.send('settings:changed', settings.view());
  }

  function broadcastSettings() {
    lastQuiet = settings.presentation().quiet;
    for (const window of [petWindow, journal, game, settingsWindow]) if (window && !window.isDestroyed()) sendSettings(window);
  }

  function readSettings(event: IpcMainInvokeEvent) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('无效的设置读取请求');
    return settings.view(event.sender === settingsWindow?.webContents);
  }
  ipc.handle('settings:read', readSettings);
  ipc.handle('care:read', (event) => {
    if (event.senderFrame !== contents.mainFrame) throw new Error('无效的角色请求');
    return care.read();
  });

  ipc.handle('care:greet-today', (event) => {
    if (event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame) {
      throw new Error('无效的问候请求');
    }
    if (performance.now() >= greetingClickUntil || passThrough || !petWindow.isVisible()) {
      return { ok: false, message: '轻点渚就可以打招呼。' };
    }
    greetingClickUntil = 0;
    return care.greetToday();
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
    page.ipc.handle('settings:read', readSettings);
    page.ipc.handle('dango:mode', (event) => {
      checkSender(event);
      return gameMode;
    });
    page.ipc.handle('dango:start', (event, revision: unknown, mode: unknown, epoch: unknown) => {
      checkSender(event);
      ensureEpoch(epoch);
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

  function openJournal(section?: JournalSection) {
    if (journal && !journal.isDestroyed()) {
      if (journal.isMinimized()) journal.restore();
      if (journal.isVisible()) journal.focus();
      if (section) navigateJournal?.(section);
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
    let requested = section;
    let ready = false;
    navigateJournal = (next) => {
      if (ready) journalContents.send('journal:section', next);
      else requested = next;
    };
    journalContents.ipc.on('journal:ready', (event) => {
      if (event.senderFrame !== journalContents.mainFrame || !event.senderFrame?.url.endsWith('#journal')) return;
      ready = true;
      if (requested) journalContents.send('journal:section', requested);
      requested = undefined;
    });
    journalContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) ready = false;
    });
    journalContents.ipc.handle('settings:open', (event) => {
      if (event.senderFrame !== journalContents.mainFrame) throw new Error('无效的设置请求');
      openSettings();
    });
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
    journalContents.ipc.handle('care:feed', (event, revision: number, epoch: unknown) => {
      ensureEpoch(epoch);
      if (event.senderFrame !== journalContents.mainFrame || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error('无效的喂食请求');
      }
      return feed('bread', revision);
    });
    journalContents.ipc.handle('care:feed-food', (event, id: unknown, revision: number, epoch: unknown) => {
      ensureEpoch(epoch);
      if (event.senderFrame !== journalContents.mainFrame || !isFoodId(id) ||
          !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的喂食请求');
      return feed(id, revision);
    });
    journalContents.ipc.handle('care:buy', (event, id: unknown, quantity: number, revision: number, epoch: unknown) => {
      ensureEpoch(epoch);
      if (event.senderFrame !== journalContents.mainFrame || !isFoodId(id) ||
          !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error('无效的购买请求');
      }
      return care.buy(id, quantity, revision);
    });
    journalContents.ipc.handle('care:buy-toy', (event, id: unknown, revision: number, epoch: unknown) => {
      ensureEpoch(epoch);
      if (event.sender !== journalContents || !event.senderFrame || event.senderFrame !== journalContents.mainFrame ||
          !isToyId(id) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的玩具购买请求');
      return care.buyToy(id, revision);
    });
    function requestInteraction(event: IpcMainInvokeEvent, channel: 'pet:hug' | 'pet:listen-line'): CareResponse {
      if (event.sender !== journalContents || !event.senderFrame || event.senderFrame !== journalContents.mainFrame) {
        throw new Error('无效的角色互动请求');
      }
      const snapshot = care.read();
      if (snapshot.ok === false) return snapshot;
      const { state, gameBusy } = snapshot;
      const hugging = channel === 'pet:hug';
      const unavailable = hugging ? hugUnavailable(state, gameBusy) : practiceLineUnavailable(state, gameBusy);
      if (unavailable) return { ok: false, state, message: unavailable };
      if (petWindow.isDestroyed() || !petWindow.isVisible() || contents.isCrashed()) {
        return { ok: false, state, message: '请先从托盘找回角色。' };
      }
      if (performance.now() < interactionUntil) return { ok: false, state, message: '渚正在互动，请稍后再试。' };
      interactionUntil = performance.now() + (hugging ? dangoHugMs : practiceLineMs);
      contents.send(channel);
      return { ok: true, state };
    }
    journalContents.ipc.handle('pet:hug', (event) => requestInteraction(event, 'pet:hug'));
    journalContents.ipc.handle('pet:listen-line', (event) => requestInteraction(event, 'pet:listen-line'));
    journalContents.ipc.handle('care:claim-bread', (event, revision: number, epoch: unknown) => {
      ensureEpoch(epoch);
      if (event.senderFrame !== journalContents.mainFrame || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error('无效的补给请求');
      }
      return care.claimBread(revision);
    });
    journalContents.ipc.handle('care:start', (event, kind: unknown, revision: number, epoch: unknown) => {
      ensureEpoch(epoch);
      if (event.senderFrame !== journalContents.mainFrame || !isActivityKind(kind) ||
          !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的活动请求');
      return care.start(kind, revision);
    });
    journalContents.ipc.handle('care:cancel', (event, id: unknown, revision: number, epoch: unknown) => {
      ensureEpoch(epoch);
      if (event.senderFrame !== journalContents.mainFrame || typeof id !== 'string' || !id.trim() ||
          !Number.isSafeInteger(revision) || revision < 0) throw new Error('无效的取消请求');
      return care.cancel(id, revision);
    });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      if (journal === window) { journal = undefined; navigateJournal = undefined; }
      if (!quitting && !desktopSettings.stayInTray) app.quit();
    });
    void window.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#journal`).catch((error) => {
      if (window.isDestroyed()) return;
      console.error('手账无法打开', error);
      window.close();
    });
  }

  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (settingsWindow.isMinimized()) settingsWindow.restore();
      if (settingsWindow.isVisible()) settingsWindow.focus();
      return;
    }
    const window = new BrowserWindow({ title: '桌宠设置', icon, width: 700, height: 550,
      minWidth: 540, minHeight: 370, show: false, autoHideMenuBar: true, webPreferences });
    settingsWindow = window;
    const page = window.webContents;
    let transfer: { preview: TransferPreview; state: Care; preferences?: Settings } | undefined;
    function check(event: IpcMainInvokeEvent) {
      if (event.sender !== page || !event.senderFrame || event.senderFrame !== page.mainFrame ||
          !event.senderFrame.url.endsWith('#settings')) throw new Error('无效的设置请求');
    }

    page.ipc.handle('settings:read', readSettings);
    page.ipc.handle('settings:preview', (event, draft: unknown) => { check(event); return settings.preview(draft); });
    page.ipc.handle('settings:apply', (event, draft: unknown) => {
      check(event);
      const result = settings.apply(draft);
      if (result.ok === false && previewOrigin) cancelPreview();
      return result;
    });
    page.ipc.handle('settings:cancel', (event) => { check(event); cancelPreview(); return settings.view(true); });
    page.ipc.handle('settings:reset-position', (event) => {
      check(event);
      if (!previewOrigin) { previewOrigin = petWindow.getBounds(); clearTimeout(pendingSave); }
      petWindow.setBounds(petBounds(petSize(desktopSettings), desktopSettings.displayId));
    });
    page.ipc.handle('settings:preview-animation', (event): SettingsResult => {
      check(event);
      const current = care.read();
      if (current.ok === false) return current;
      if (!petWindow.isVisible() || contents.isCrashed()) return { ok: false, message: '请先从托盘找回角色。' };
      if (current.gameBusy || current.state.activeActivity) return { ok: false, message: '活动或小游戏结束后可以预览动作。' };
      contents.send('settings:preview-animation');
      return { ok: true, view: settings.view() };
    });
    page.ipc.handle('settings:dismiss-onboarding', (event): SettingsResult => {
      check(event);
      return settings.quick('onboardingSeen', true);
    });

    const jsonPicker = { filters: [{ name: '桌宠存档 JSON', extensions: ['json'] }] };
    page.ipc.handle('data:export', async (event): Promise<TransferResponse> => {
      check(event);
      const selected = await dialog.showSaveDialog(window, { ...jsonPicker, title: '导出桌宠存档', defaultPath: '古河渚桌宠存档.json' });
      if (selected.canceled || !selected.filePath || window.isDestroyed()) return { ok: true, cancelled: true };
      const snapshot = care.read();
      if (snapshot.ok === false) return snapshot;
      if (snapshot.warning) return { ok: false, message: snapshot.warning };
      try { writeAtomic(selected.filePath, exportJson(snapshot.state, settings.settings()), `.${randomUUID()}.tmp`); }
      catch { return { ok: false, message: '无法写入导出文件，请选择可写入的位置。' }; }
      return { ok: true };
    });
    page.ipc.handle('data:preview', async (event, action: unknown): Promise<TransferResponse> => {
      check(event);
      transfer = undefined;
      let state: Care;
      let preferences: Settings | undefined;
      if (action === 'import') {
        const selected = await dialog.showOpenDialog(window, { ...jsonPicker, title: '选择桌宠导出档', properties: ['openFile'] });
        if (selected.canceled || !selected.filePaths[0] || window.isDestroyed()) return { ok: true, cancelled: true };
        const decoded = readTransfer(selected.filePaths[0], settings.settings());
        if (decoded.ok === false) return decoded;
        ({ state, settings: preferences } = decoded);
      } else if (action === 'backup') {
        const backup = readSave(join(directory, 'save.backup.json'));
        if (backup.kind !== 'valid') return { ok: false, message: backup.kind === 'newer' ? '备份来自较新版本。' : '没有可恢复的养成备份。' };
        state = backup.state;
      } else if (action === 'reset') state = newCare();
      else throw new Error('无效的数据操作');
      const preview = transferPreview(state, action);
      transfer = { preview, state, preferences };
      return { ok: true, preview };
    });

    page.ipc.handle('data:apply', (event, token: unknown, confirm: unknown): TransferResponse => {
      check(event);
      const selected = transfer;
      if (!selected || selected.preview.token !== token) return { ok: false, message: '确认已失效，请重新预览。' };
      if (selected.preview.action === 'reset' && confirm !== '清空养成') return { ok: false, message: '请输入「清空养成」确认。' };
      if (!settings.canWrite) return { ok: false, message: '本机设置来自较新版本，请升级桌宠。' };
      const before = care.read();
      if (before.ok === false && before.message.includes('较新版本')) return before;
      if (before.warning) return { ok: false, message: before.warning };
      const saved = settings.settings();
      const next = selected.preferences ? { ...selected.preferences, launchAtLogin: saved.launchAtLogin,
        displayId: saved.displayId, shortcuts: saved.shortcuts, onboardingSeen: saved.onboardingSeen } : saved;
      try { replaceSavedData(directory, selected.state, next, before.ok ? before.state : undefined, saved); }
      catch (error) {
        console.error('数据替换失败', error);
        if (error instanceof RollbackError) {
          care.close(false);
          quitting = true;
          dialog.showErrorBox('数据待恢复', error.message);
          app.exit(1);
        }
        return { ok: false, message: '替换失败，原有数据已保留。可以重试。' };
      }
      transfer = undefined;
      endGesture();
      interactionUntil = 0;
      care.close(false);
      careEpoch += 1;
      care = createCareRuntime(directory, fast, publishCare, careEpoch);
      settings.replace(next);
      publishCare({ snapshot: care.read() });
      return { ok: true };
    });
    page.ipc.handle('data:cancel', (event) => { check(event); transfer = undefined; });

    function cancelPreview() {
      settings.cancel();
      if (previewOrigin) applyDesktop('cancel');
      transfer = undefined;
    }
    window.on('closed', () => {
      settingsWindow = undefined;
      cancelPreview();
      if (!quitting && !settings.settings().onboardingSeen) settings.quick('onboardingSeen', true);
    });
    page.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) cancelPreview();
    });
    page.on('render-process-gone', () => { if (!window.isDestroyed()) window.destroy(); });
    window.once('ready-to-show', () => window.show());
    void window.loadURL(`${MAIN_WINDOW_WEBPACK_ENTRY}#settings`).catch((error) => {
      console.error('桌宠设置无法打开', error);
      if (!window.isDestroyed()) window.close();
    });
  }

  tray = new Tray(icon.resize({ width: 32, height: 32, quality: 'best' }));
  tray.setToolTip(title);

  function recoverPet() {
    quickMenu.hide();
    endGesture();
    userHidden = false;
    if (passThrough) settings.quick('passThrough', false, true);
    const target = desktopSettings.displayId ?? screen.getPrimaryDisplay().id;
    petWindow.setBounds(petBounds(petSize(desktopSettings), target));
    if (previewOrigin) previewOrigin = petBounds(petSize(settings.settings()), settings.settings().displayId ?? screen.getPrimaryDisplay().id);
    saveNow();
    updateVisibility();
  }

  function togglePet() {
    userHidden = !userHidden;
    updateVisibility();
  }

  function useShortcut(action: ShortcutAction) {
    if (action === 'togglePet') togglePet();
    else if (action === 'recoverPet') recoverPet();
    else openJournal();
  }

  function refreshMenu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开手账', click: () => openJournal() },
      { label: '设置', click: openSettings },
      { type: 'separator' },
      { label: userHidden ? '显示角色' : '隐藏角色', click: togglePet },
      { label: '鼠标穿透', type: 'checkbox', checked: passThrough, click: (item) => {
        const result = settings.quick('passThrough', item.checked);
        if (result.ok === false) { item.checked = passThrough; dialog.showErrorBox('设置未保存', result.message); }
      } },
      { label: '找回角色', click: recoverPet },
      { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ]));
  }

  function openQuickAction(action: QuickMenuAction) {
    if (action === 'game') openDangoGame();
    else openJournal(action);
  }

  contents.on('context-menu', () => {
    quickMenu.hide();
    if (passThrough) return;
    Menu.buildFromTemplate([
      { label: '打开手账', click: () => openJournal() },
      { label: '喂食', click: () => openQuickAction('feed') },
      { label: '面包店帮工', click: () => openQuickAction('bakery') },
      { label: '温习功课', click: () => openQuickAction('study') },
      { label: '玩小游戏', click: () => openQuickAction('game') },
      { type: 'separator' },
      { label: '设置', click: openSettings },
      { label: '隐藏角色', click: togglePet },
    ]).popup({ window: petWindow });
  });

  function recoverAfterDisplayRemoval() {
    quickMenu.hide();
    const { x, y, width, height } = petWindow.getBounds();
    const fits = screen.getAllDisplays().some(({ workArea: area }) => (
      x >= area.x && y >= area.y && x + width <= area.x + area.width && y + height <= area.y + area.height
    ));
    if (!fits) {
      petWindow.setBounds(petBounds(petSize(desktopSettings), screen.getPrimaryDisplay().id));
      if (previewOrigin) previewOrigin = petBounds(petSize(settings.settings()), screen.getPrimaryDisplay().id);
      saveNow();
    }
    broadcastSettings();
  }

  function onDisplayAdded() {
    quickMenu.hide();
    broadcastSettings();
  }

  screen.on('display-removed', recoverAfterDisplayRemoval);
  screen.on('display-metrics-changed', recoverAfterDisplayRemoval);
  screen.on('display-added', onDisplayAdded);
  const stopWatch = watchDesktop((state) => {
    desktopState = state;
    settings.setFullscreen(state.fullscreen);
    updateVisibility();
    broadcastSettings();
  });
  const quietTimer = setInterval(() => {
    if (lastQuiet !== settings.presentation().quiet) broadcastSettings();
  }, 1000);
  app.on('second-instance', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) openSettings();
    else openJournal();
  });
  petWindow.on('closed', () => {
    stopWatch();
    clearInterval(quietTimer);
    screen.off('display-removed', recoverAfterDisplayRemoval);
    screen.off('display-metrics-changed', recoverAfterDisplayRemoval);
    screen.off('display-added', onDisplayAdded);
    if (journal && !journal.isDestroyed()) journal.close();
    if (game && !game.isDestroyed()) game.close();
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  });

  await petWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  windowsReady = true;
  applyDesktop('refresh');
  if (!settings.settings().onboardingSeen) openSettings();
}

if (!handleSquirrelStartup()) {
  const testData = process.env.NAGISA_TEST_DATA;
  if (!app.isPackaged && testData && isAbsolute(testData)) {
    mkdirSync(testData, { recursive: true });
    app.setPath('userData', testData);
  }
  if (app.requestSingleInstanceLock()) {
    app.whenReady().then(startPet).catch((error) => {
      console.error('桌宠启动失败', error);
      dialog.showErrorBox('桌宠启动失败', '无法加载桌宠数据，请确认应用数据目录可读写后重试。');
      app.quit();
    });
    app.on('window-all-closed', () => app.quit());
    app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });
  } else app.quit();
}
