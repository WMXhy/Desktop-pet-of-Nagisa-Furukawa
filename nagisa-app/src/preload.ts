import { contextBridge, ipcRenderer } from 'electron';
import type { CareChange, CareSnapshot } from './care';
import type { JournalSection, SettingsView } from './settings';
import type { QuickMenuPresentation, QuickMenuView } from './quick-menu-layout';

let careEpoch = 0;
ipcRenderer.on('care:changed', (_event, change: CareChange) => { careEpoch = Math.max(careEpoch, change.snapshot.epoch); });

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

if (location.hash === '#quick-menu') {
  contextBridge.exposeInMainWorld('quickMenu', {
    ready: () => ipcRenderer.send('quick-menu:ready'),
    painted: (id) => ipcRenderer.send('quick-menu:painted', id),
    select: (id, action) => ipcRenderer.send('quick-menu:select', id, action),
    activity: (id, layers) => ipcRenderer.send('quick-menu:activity', id, layers),
    feedback: (id, session, visible) => ipcRenderer.send('quick-menu:feedback', id, session, visible),
    overlay: (id, session, change) => ipcRenderer.send('quick-menu:overlay', id, session, change),
    readCare: (id, session) => ipcRenderer.invoke('quick-menu:care', id, session),
    changeFood: (id, session, food, revision, epoch, purchase) =>
      ipcRenderer.invoke('quick-menu:food', id, session, food, revision, epoch, purchase),
    onCareChanged: (callback) => subscribe<CareSnapshot>('quick-menu:care-changed', (snapshot) => callback({ snapshot })),
    onPresent: (callback) => subscribe<QuickMenuPresentation>('quick-menu:present', callback),
    onView: (callback) => subscribe<QuickMenuView>('quick-menu:view', callback),
    onShown: (callback) => subscribe<number>('quick-menu:shown', callback),
    onClosed: (callback) => subscribe<number>('quick-menu:closed', callback),
  } satisfies Window['quickMenu']);
} else contextBridge.exposeInMainWorld('pet', {
  start: (id, x, y) => ipcRenderer.send('pet:start', id, x, y),
  move: (id, x, y) => ipcRenderer.send('pet:move', id, x, y),
  finish: (id, x, y) => ipcRenderer.invoke('pet:finish', id, x, y),
  cancel: (id) => ipcRenderer.send('pet:cancel', id),
  onPickupChanged: (callback) => subscribe<PickupChange>('pet:pickup', callback),
  readCare: async () => {
    const snapshot = await ipcRenderer.invoke('care:read') as CareSnapshot;
    careEpoch = Math.max(careEpoch, snapshot.epoch);
    return snapshot;
  },
  greetToday: () => ipcRenderer.invoke('care:greet-today'),
  feedBread: (revision, epoch = careEpoch) => ipcRenderer.invoke('care:feed', revision, epoch),
  feedFood: (id, revision, epoch = careEpoch) => ipcRenderer.invoke('care:feed-food', id, revision, epoch),
  buyFood: (id, quantity, revision, epoch = careEpoch) => ipcRenderer.invoke('care:buy', id, quantity, revision, epoch),
  buyToy: (id, revision, epoch = careEpoch) => ipcRenderer.invoke('care:buy-toy', id, revision, epoch),
  hugDango: () => ipcRenderer.invoke('pet:hug'),
  listenToLine: () => ipcRenderer.invoke('pet:listen-line'),
  claimBread: (revision, epoch = careEpoch) => ipcRenderer.invoke('care:claim-bread', revision, epoch),
  startActivity: (kind, revision, epoch = careEpoch) => ipcRenderer.invoke('care:start', kind, revision, epoch),
  cancelActivity: (id, revision, epoch = careEpoch) => ipcRenderer.invoke('care:cancel', id, revision, epoch),
  openDangoGame: (mode) => ipcRenderer.invoke('dango:open', mode),
  readDangoMode: () => ipcRenderer.invoke('dango:mode'),
  startDango: (revision, mode, epoch = careEpoch) => ipcRenderer.invoke('dango:start', revision, mode, epoch),
  pickDango: (id, slot) => ipcRenderer.invoke('dango:pick', id, slot),
  leaveDango: (id) => ipcRenderer.invoke('dango:leave', id),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  readSettings: () => ipcRenderer.invoke('settings:read'),
  previewSettings: (draft) => ipcRenderer.invoke('settings:preview', draft),
  applySettings: (draft) => ipcRenderer.invoke('settings:apply', draft),
  cancelSettings: () => ipcRenderer.invoke('settings:cancel'),
  resetPositionPreview: () => ipcRenderer.invoke('settings:reset-position'),
  previewAnimation: () => ipcRenderer.invoke('settings:preview-animation'),
  dismissOnboarding: () => ipcRenderer.invoke('settings:dismiss-onboarding'),
  exportData: () => ipcRenderer.invoke('data:export'),
  previewData: (action) => ipcRenderer.invoke('data:preview', action),
  applyData: (token, confirm) => ipcRenderer.invoke('data:apply', token, confirm),
  cancelData: () => ipcRenderer.invoke('data:cancel'),
  onSettingsChanged: (callback) => subscribe<SettingsView>('settings:changed', callback),
  onPreviewAnimation: (callback) => subscribe<void>('settings:preview-animation', callback),
  journalReady: () => ipcRenderer.send('journal:ready'),
  onJournalSection: (callback) => subscribe<JournalSection>('journal:section', callback),
  onCareChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, change: import('./care').CareChange) => callback(change);
    ipcRenderer.on('care:changed', listener);
    return () => { ipcRenderer.removeListener('care:changed', listener); };
  },
  onFed: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, id: import('./care').FoodId) => callback(id);
    ipcRenderer.on('care:fed', listener);
    return () => { ipcRenderer.removeListener('care:fed', listener); };
  },
  onHug: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:hug', listener);
    return () => { ipcRenderer.removeListener('pet:hug', listener); };
  },
  onListenToLine: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:listen-line', listener);
    return () => { ipcRenderer.removeListener('pet:listen-line', listener); };
  },
  onDangoMode: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, mode: import('./dango').DangoMode) => callback(mode);
    ipcRenderer.on('dango:mode', listener);
    return () => { ipcRenderer.removeListener('dango:mode', listener); };
  },
} satisfies Window['pet']);
