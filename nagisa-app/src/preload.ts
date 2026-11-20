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
  claimBread: (revision) => ipcRenderer.invoke('care:claim-bread', revision),
  startActivity: (kind, revision) => ipcRenderer.invoke('care:start', kind, revision),
  cancelActivity: (id, revision) => ipcRenderer.invoke('care:cancel', id, revision),
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
} satisfies Window['pet']);
