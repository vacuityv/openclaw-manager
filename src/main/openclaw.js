const { exec, spawn } = require('child_process');
const path = require('path');
const http = require('http');

class OpenClawManager {
  constructor() {
    this.cliBin = 'openclaw';
    this.gatewayPort = 18789;
    this.logProcess = null;
  }

  // Execute a CLI command and return parsed result
  execCommand(command, timeout = 15000) {
    const cmd = process.platform === 'win32'
      ? `chcp 65001 >nul && ${this.cliBin} ${command}`
      : `${this.cliBin} ${command}`;
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          reject({ error: error.message, stderr, code: error.code });
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  // Execute a CLI command expecting JSON output
  async execJson(command, timeout = 15000) {
    const result = await this.execCommand(`${command} --json`, timeout);
    try {
      return JSON.parse(result.stdout);
    } catch {
      return { raw: result.stdout };
    }
  }

  // Check if openclaw CLI is available
  async detectCli() {
    try {
      const result = await this.execCommand('--version', 5000);
      return { available: true, version: result.stdout };
    } catch {
      return { available: false, version: null };
    }
  }

  // Check Node.js version
  async detectNode() {
    return new Promise((resolve) => {
      exec('node --version', { timeout: 5000, encoding: 'utf8' }, (error, stdout) => {
        if (error) {
          resolve({ available: false, version: null });
          return;
        }
        const version = stdout.trim().replace('v', '');
        const [major, minor] = version.split('.').map(Number);
        const compatible = major > 22 || (major === 22 && minor >= 14);
        resolve({ available: true, version, compatible });
      });
    });
  }

  // Check if Docker is running with openclaw container
  async detectDocker() {
    return new Promise((resolve) => {
      exec('docker ps --format "{{.Names}} {{.Image}}" 2>&1', { timeout: 5000, encoding: 'utf8' }, (error, stdout) => {
        if (error) {
          resolve({ available: false, containers: [] });
          return;
        }
        const lines = stdout.trim().split('\n').filter(l => l.toLowerCase().includes('openclaw'));
        resolve({ available: lines.length > 0, containers: lines });
      });
    });
  }

  // Full environment detection
  async detectEnvironment() {
    const [cli, node, docker] = await Promise.all([
      this.detectCli(),
      this.detectNode(),
      this.detectDocker()
    ]);
    return { cli, node, docker };
  }

  // Get gateway status
  async getStatus() {
    try {
      return await this.execJson('gateway status', 10000);
    } catch (e) {
      return { error: true, message: e.error || e.stderr || 'Failed to get status' };
    }
  }

  // Get gateway health
  async getHealth() {
    try {
      return await this.execJson('gateway health', 10000);
    } catch (e) {
      return { error: true, message: e.error || e.stderr || 'Failed to get health' };
    }
  }

  // HTTP probe to check if gateway port is reachable
  probePort() {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.gatewayPort}`, { timeout: 3000 }, (res) => {
        resolve({ reachable: true, statusCode: res.statusCode });
      });
      req.on('error', () => resolve({ reachable: false }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ reachable: false });
      });
    });
  }

  // Combined health check
  async healthCheck() {
    const [status, health, probe] = await Promise.all([
      this.getStatus(),
      this.getHealth(),
      this.probePort()
    ]);
    return { status, health, probe };
  }

  // Start gateway
  async start() {
    try {
      return await this.execJson('gateway start', 30000);
    } catch (e) {
      return { error: true, message: e.error || e.stderr || 'Failed to start' };
    }
  }

  // Stop gateway
  async stop() {
    try {
      return await this.execJson('gateway stop', 15000);
    } catch (e) {
      return { error: true, message: e.error || e.stderr || 'Failed to stop' };
    }
  }

  // Restart gateway
  async restart() {
    try {
      return await this.execJson('gateway restart', 30000);
    } catch (e) {
      return { error: true, message: e.error || e.stderr || 'Failed to restart' };
    }
  }

  // Get recent logs
  async getLogs(limit = 200) {
    try {
      const result = await this.execCommand(`logs --limit ${limit} --local-time`, 10000);
      return { logs: result.stdout };
    } catch (e) {
      return { error: true, message: e.error || e.stderr || 'Failed to get logs' };
    }
  }

  // Start streaming logs (returns the child process)
  streamLogs(onData, onError) {
    if (this.logProcess) {
      this.logProcess.kill();
    }
    const args = process.platform === 'win32'
      ? ['/c', 'chcp', '65001', '>nul', '&&', this.cliBin, 'logs', '--follow', '--local-time']
      : ['logs', '--follow', '--local-time'];
    const bin = process.platform === 'win32' ? 'cmd' : this.cliBin;
    this.logProcess = spawn(bin, args, { shell: false });
    this.logProcess.stdout.on('data', (data) => onData(data.toString()));
    this.logProcess.stderr.on('data', (data) => onError(data.toString()));
    this.logProcess.on('close', () => { this.logProcess = null; });
    return this.logProcess;
  }

  // Stop streaming logs
  stopStreamLogs() {
    if (this.logProcess) {
      this.logProcess.kill();
      this.logProcess = null;
    }
  }

  // Get openclaw home directory
  getHomeDir() {
    return process.env.OPENCLAW_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw');
  }

  // Open dashboard in browser
  async openDashboard() {
    try {
      return await this.execCommand('dashboard', 5000);
    } catch (e) {
      return { error: true, message: e.error || e.stderr };
    }
  }
}

module.exports = OpenClawManager;
