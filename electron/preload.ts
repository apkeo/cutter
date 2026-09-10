import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CutterAPI, Events } from '../shared/types';
const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);
const api: CutterAPI = {
  platform: process.platform,
  settings: invoke('settings:get'),
  saveSettings: invoke('settings:save'),
  chooseFolder: invoke('folder:choose'),
  open: invoke('media:open'),
  importFile: invoke('media:import'),
  saveCursor: invoke('cursor:save'),
  filePath: (file) => webUtils.getPathForFile(file),
  picker: invoke('picker:open'),
  movePicker: invoke('picker:move'),
  pickerInit: invoke('picker:init'),
  capture: invoke('capture:start'),
  stop: invoke('capture:stop'),
  cancelPicker: invoke('picker:cancel'),
  captureSession: invoke('capture:session'),
  captureChunk: invoke('capture:chunk'),
  captureReady: invoke('capture:ready'),
  captureFinish: invoke('capture:finish'),
  export: invoke('export:start'),
  cancelExport: invoke('export:cancel'),
  fileAction: invoke('file:action'),
  window: invoke('window:action'),
  on: <K extends keyof Events>(channel: K, callback: (data: Events[K]) => void) => {
    const allowed = [
      'media',
      'status',
      'export-progress',
      'recording',
      'error',
      'capture-stop',
      'picker-region',
    ];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_event: Electron.IpcRendererEvent, data: Events[K]) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};
contextBridge.exposeInMainWorld('cutter', api);
