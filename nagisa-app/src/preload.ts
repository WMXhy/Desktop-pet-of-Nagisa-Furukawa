import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pet', {
  start: (x, y) => ipcRenderer.send('pet:start', x, y),
  move: (x, y) => ipcRenderer.send('pet:move', x, y),
  finish: (x, y) => ipcRenderer.invoke('pet:finish', x, y),
  cancel: () => ipcRenderer.send('pet:cancel'),
  readCare: () => ipcRenderer.invoke('care:read'),
  feedBread: (revision) => ipcRenderer.invoke('care:feed', revision),
  feedFood: (id, revision) => ipcRenderer.invoke('care:feed-food', id, revision),
  buyFood: (id, quantity, revision) => ipcRenderer.invoke('care:buy', id, quantity, revision),
  buyToy: (id, revision) => ipcRenderer.invoke('care:buy-toy', id, revision),
  hugDango: () => ipcRenderer.invoke('pet:hug'),
  claimBread: (revision) => ipcRenderer.invoke('care:claim-bread', revision),
  startActivity: (kind, revision) => ipcRenderer.invoke('care:start', kind, revision),
  cancelActivity: (id, revision) => ipcRenderer.invoke('care:cancel', id, revision),
  openDangoGame: (mode) => ipcRenderer.invoke('dango:open', mode),
  readDangoMode: () => ipcRenderer.invoke('dango:mode'),
  startDango: (revision, mode) => ipcRenderer.invoke('dango:start', revision, mode),
  pickDango: (id, slot) => ipcRenderer.invoke('dango:pick', id, slot),
  leaveDango: (id) => ipcRenderer.invoke('dango:leave', id),
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
  onDangoMode: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, mode: import('./dango').DangoMode) => callback(mode);
    ipcRenderer.on('dango:mode', listener);
    return () => { ipcRenderer.removeListener('dango:mode', listener); };
  },
} satisfies Window['pet']);
