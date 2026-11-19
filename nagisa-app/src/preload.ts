import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pet', {
  start: (x, y) => ipcRenderer.send('pet:start', x, y),
  move: (x, y) => ipcRenderer.send('pet:move', x, y),
  finish: (x, y) => ipcRenderer.invoke('pet:finish', x, y),
  cancel: () => ipcRenderer.send('pet:cancel'),
} satisfies Window['pet']);
