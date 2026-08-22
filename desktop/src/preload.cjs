const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  selectRom: () => ipcRenderer.invoke('select-rom'),
  getRomStatus: () => ipcRenderer.invoke('get-rom-status'),
  getLauncherStatus: () => ipcRenderer.invoke('get-launcher-status'),
  launchEmulator: () => ipcRenderer.invoke('launch-emulator'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  backupLocalData: () => ipcRenderer.invoke('backup-local-data'),
  restoreLocalData: () => ipcRenderer.invoke('restore-local-data'),
  deleteLocalData: () => ipcRenderer.invoke('delete-local-data'),
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onLauncherLog: (callback) => ipcRenderer.on('launcher-log', (_event, value) => callback(value)),
  onEmulatorExited: (callback) => ipcRenderer.on('emulator-exited', (_event, code) => callback(code)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_event, progress) => callback(progress))
});
