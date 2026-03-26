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

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function onGatewayLog(data) {
  mainWindow?.webContents?.send('log-data', data);
}

function setupIPC() {
  ipcMain.handle('detect-environment', async () => {
    return await manager.detectEnvironment();
  });

  ipcMain.handle('health-check', async () => {
    return await manager.healthCheck();
  });

  ipcMain.handle('get-status', async () => {
    const probe = await manager.probePort();
    return { running: manager.isRunning() || probe.reachable };
  });

  ipcMain.handle('gateway-start', async () => {
    const result = await manager.start(onGatewayLog);
    setTimeout(() => pollHealth(), 3000);
    return result;
  });

  ipcMain.handle('gateway-stop', async () => {
    const result = await manager.stop();
    setTimeout(() => pollHealth(), 1500);
    return result;
  });

  ipcMain.handle('gateway-restart', async () => {
    const result = await manager.restart(onGatewayLog);
    setTimeout(() => pollHealth(), 3000);
    return result;
  });

  ipcMain.handle('get-logs', async (_, limit) => {
    return await manager.getLogs(limit || 200);
  });

  ipcMain.handle('start-log-stream', () => {
    const proc = manager.streamLogs(
      (data) => mainWindow?.webContents?.send('log-data', data),
      (data) => mainWindow?.webContents?.send('log-error', data)
    );
    return { ok: true, streaming: proc !== null };
  });

  ipcMain.handle('open-log-folder', () => {
    shell.openPath(manager.getHomeDir());
    return { ok: true };
  });

  ipcMain.handle('open-dashboard', () => {
    shell.openExternal(`http://127.0.0.1:${manager.gatewayPort}`);
    return { ok: true };
  });

  ipcMain.handle('open-external', (_, url) => {
    shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('minimize-to-tray', () => {
    mainWindow.hide();
    return { ok: true };
  });
}

async function pollHealth() {
  try {
    const probe = await manager.probePort();
    const processAlive = manager.isRunning();
    const status = (processAlive || probe.reachable) ? 'running' : 'stopped';
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
  manager.cleanup();
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
