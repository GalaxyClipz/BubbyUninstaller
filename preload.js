const { contextBridge, ipcRenderer } = require('electron');
const call = (n) => (...a) => ipcRenderer.invoke(n, ...a);
contextBridge.exposeInMainWorld('bubby', {
  info: call('info'), scan: call('scan'), icon: call('icon'),
  uninstall: call('uninstall'), deleteLeftovers: call('deleteLeftovers'), deleteFiles: call('deleteFiles'),
  cleanJunk: call('cleanJunk'), removeBloat: call('removeBloat'), tweak: call('tweak'), setStartup: call('setStartup'),
  restorePoint: call('restorePoint'), restartExplorer: call('restartExplorer'),
  reveal: call('reveal'), open: call('open'), elevate: call('elevate'), github: call('github'),
  onLog: (fn) => ipcRenderer.on('log', (_e, m) => fn(m)),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, n) => fn(n)),
});
