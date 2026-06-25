'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('otto', {
  // pet -> main
  click: () => ipcRenderer.send('pet:click'),
  onState: (cb) =>
    ipcRenderer.on('pet:state', (_e, state) => cb(state)),

  // panel <-> main
  dismiss: () => ipcRenderer.send('panel:dismiss'),
  onShow: (cb) => ipcRenderer.on('panel:show', (_e, data) => cb(data)),
  onHide: (cb) => ipcRenderer.on('panel:hide', () => cb()),
});
