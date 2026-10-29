const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  // Scans the folder in the main process (Node fs) and pushes with the signed-in user's token.
  scan: opts => ipcRenderer.invoke('scan:run', opts),
  openPath: rel => ipcRenderer.invoke('file:open', rel),
})
