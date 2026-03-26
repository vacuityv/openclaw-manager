const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const OpenClawManager = require('./openclaw');
const TrayManager = require('./tray');

let mainWindow = null;
let trayManager = null;
const manager = new OpenClawManager();
let healthInterval = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 800,
    minHeight: 550,
    title: 'OpenClaw Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function setupIPC() {
  // Environment detection
  ipcMain.handle('detect-environment', async () => {
    return await manager.detectEnvironment();
  });

  // Health check
  ipcMain.handle('health-check', async () => {
    return await manager.healthCheck();
  });

  ipcMain.handle('get-status', async () => {
    return await manager.getStatus();
  });

  // Service management
  ipcMain.handle('gateway-start', async () => {
    const result = await manager.start();
    setTimeout(() => pollHealth(), 2000);
    return result;
  });

  ipcMain.handle('gateway-stop', async () => {
    const result = await manager.stop();
    setTimeout(() => pollHealth(), 1000);
    return result;
  });

  ipcMain.handle('gateway-restart', async () => {
    const result = await manager.restart();
    setTimeout(() => pollHealth(), 3000);
    return result;
  });

  // Logs
  ipcMain.handle('get-logs', async (_, limit) => {
    return await manager.getLogs(limit || 200);
  });

  ipcMain.handle('start-log-stream', async () => {
    manager.streamLogs(
      (data) => mainWindow?.webContents?.send('log-data', data),
      (data) => mainWindow?.webContents?.send('log-error', data)
    );
    return { ok: true };
  });

  ipcMain.handle('stop-log-stream', async () => {
    manager.stopStreamLogs();
    return { ok: true };
  });

  // File operations
  ipcMain.handle('open-log-folder', async () => {
    const homeDir = manager.getHomeDir();
    shell.openPath(homeDir);
    return { ok: true };
  });

  ipcMain.handle('open-dashboard', async () => {
    shell.openExternal(`http://127.0.0.1:${manager.gatewayPort}`);
    return { ok: true };
  });

  // External links
  ipcMain.handle('open-external', (_, url) => {
    shell.openExternal(url);
    return { ok: true };
  });

  // App control
  ipcMain.handle('minimize-to-tray', () => {
    mainWindow.hide();
    return { ok: true };
  });
}

async function pollHealth() {
  try {
    const probe = await manager.probePort();
    const status = probe.reachable ? 'running' : 'stopped';
    trayManager?.updateStatus(status);
    mainWindow?.webContents?.send('status-update', { status, probe });
  } catch {
    trayManager?.updateStatus('error');
    mainWindow?.webContents?.send('status-update', { status: 'error' });
  }
}

function startHealthPolling() {
  pollHealth();
  healthInterval = setInterval(pollHealth, 10000);
}

app.whenReady().then(() => {
  createWindow();
  setupIPC();

  trayManager = new TrayManager(mainWindow, manager);
  trayManager.create();

  startHealthPolling();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  manager.stopStreamLogs();
  if (healthInterval) clearInterval(healthInterval);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
