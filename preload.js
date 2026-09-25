'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getFolderTree: (folder) => ipcRenderer.invoke('get-folder-tree', folder),
  scanProject: (folder) => ipcRenderer.invoke('scan-project', folder),
  runTests: (folder, commands) => ipcRenderer.invoke('run-tests', folder, commands),
  generateFiles: (folder, options) => ipcRenderer.invoke('generate-files', folder, options),
  startOAuth: () => ipcRenderer.invoke('start-oauth'),
  pushToRemote: (folder, remoteUrl, branch) => ipcRenderer.invoke('push-to-remote', folder, remoteUrl, branch)
});
