const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openclaw', {
  // Environment detection
  detectEnvironment: () => ipcRenderer.invoke('detect-environment'),

  // Health check
  healthCheck: () => ipcRenderer.invoke('health-check'),
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Service management
  start: () => ipcRenderer.invoke('gateway-start'),
  stop: () => ipcRenderer.invoke('gateway-stop'),
  restart: () => ipcRenderer.invoke('gateway-restart'),

  // Logs
  getLogs: (limit) => ipcRenderer.invoke('get-logs', limit),
  startLogStream: () => ipcRenderer.invoke('start-log-stream'),
  stopLogStream: () => ipcRenderer.invoke('stop-log-stream'),
  onLogData: (callback) => ipcRenderer.on('log-data', (_, data) => callback(data)),
  onLogError: (callback) => ipcRenderer.on('log-error', (_, data) => callback(data)),

  // File operations
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),

  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // App control
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),

  // Status updates from main process
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_, data) => callback(data))
});
