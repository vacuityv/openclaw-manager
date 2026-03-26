const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

class TrayManager {
  constructor(mainWindow, openclawManager) {
    this.tray = null;
    this.mainWindow = mainWindow;
    this.manager = openclawManager;
    this.status = 'unknown'; // unknown, running, stopped, error
  }

  create() {
    // Create a simple 16x16 icon using nativeImage
    const icon = this.createIcon('#808080');
    this.tray = new Tray(icon);
    this.tray.setToolTip('OpenClaw Manager');
    this.updateMenu();

    this.tray.on('click', () => {
      if (this.mainWindow.isVisible()) {
        this.mainWindow.focus();
      } else {
        this.mainWindow.show();
      }
    });
  }

  createIcon(color) {
    // Create a simple colored circle icon
    const size = 16;
    const canvas = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="7" fill="${color}" stroke="#333" stroke-width="1"/>
    </svg>`;
    return nativeImage.createFromBuffer(
      Buffer.from(canvas),
      { width: size, height: size }
    );
  }

  updateStatus(status) {
    this.status = status;
    const colors = {
      running: '#4CAF50',
      stopped: '#F44336',
      error: '#FF9800',
      unknown: '#808080'
    };
    const labels = {
      running: 'OpenClaw - Running',
      stopped: 'OpenClaw - Stopped',
      error: 'OpenClaw - Error',
      unknown: 'OpenClaw Manager'
    };

    if (this.tray) {
      this.tray.setImage(this.createIcon(colors[status] || colors.unknown));
      this.tray.setToolTip(labels[status] || labels.unknown);
      this.updateMenu();
    }
  }

  updateMenu() {
    const isRunning = this.status === 'running';
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Manager',
        click: () => { this.mainWindow.show(); this.mainWindow.focus(); }
      },
      { type: 'separator' },
      {
        label: 'Start Gateway',
        enabled: !isRunning,
        click: () => { this.manager.start(); }
      },
      {
        label: 'Stop Gateway',
        enabled: isRunning,
        click: () => { this.manager.stop(); }
      },
      {
        label: 'Restart Gateway',
        enabled: isRunning,
        click: () => { this.manager.restart(); }
      },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: () => { this.manager.openDashboard(); }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.mainWindow.destroy();
          require('electron').app.quit();
        }
      }
    ]);
    this.tray.setContextMenu(contextMenu);
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;
