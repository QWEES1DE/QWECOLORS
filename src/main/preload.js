'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qwe', {
  isDesktop: true,
  getState: () => ipcRenderer.invoke('state:get'),
  update: (patch) => ipcRenderer.invoke('state:update', patch),
  savePreset: (name) => ipcRenderer.invoke('preset:save', { name }),
  deletePreset: (id) => ipcRenderer.invoke('preset:delete', { id }),
  captureScreen: () => ipcRenderer.invoke('screen:capture'),
  pickForeground: () => ipcRenderer.invoke('fg:pick'),
  unlockGamma: () => ipcRenderer.invoke('system:unlockGamma'),
  resetAll: () => ipcRenderer.invoke('system:resetAll'),
  peek: (on) => ipcRenderer.invoke('engine:peek', !!on),
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  close: () => ipcRenderer.send('window:close'),
  quit: () => ipcRenderer.send('app:quit'),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
});
