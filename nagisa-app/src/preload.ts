import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pet', {
  start: (x, y) => ipcRenderer.send('pet:start', x, y),
  move: (x, y) => ipcRenderer.send('pet:move', x, y),
  finish: (x, y) => ipcRenderer.invoke('pet:finish', x, y),
  cancel: () => ipcRenderer.send('pet:cancel'),
  readCare: () => ipcRenderer.invoke('care:read'),
  feedBread: (revision) => ipcRenderer.invoke('care:feed', revision),
  onFed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('care:fed', listener);
    return () => { ipcRenderer.removeListener('care:fed', listener); };
  },
} satisfies Window['pet']);
