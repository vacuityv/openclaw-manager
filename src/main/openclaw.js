const { exec, spawn } = require('child_process');
const path = require('path');
const http = require('http');

class OpenClawManager {
  constructor() {
    this.cliBin = 'openclaw';
    this.gatewayPort = 18789;
    this.gatewayProcess = null;  // 仅前台模式使用
    this.gatewayLogs = [];
    this.maxLogLines = 5000;
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

  // Get gateway status via CLI
  async getStatus() {
    try {
      const result = await this.execCommand('gateway status', 10000);
      return { raw: result.stdout };
    } catch (e) {
      return { error: true, message: e.error || e.stderr || 'Failed to get status' };
    }
  }

  // Combined health check
  async healthCheck() {
    const [status, probe] = await Promise.all([
      this.getStatus(),
      this.probePort()
    ]);
    const processAlive = this.gatewayProcess !== null && this.gatewayProcess.exitCode === null;
    return {
      status,
      running: processAlive || probe.reachable,
      probe
    };
  }

  // Start gateway - try `gateway start` first, fallback to `gateway run`
  async start(onLog) {
    // 先检查是否已在运行
    const probe = await this.probePort();
    if (probe.reachable) {
      return { error: false, message: '网关已在运行中' };
    }

    // 尝试后台模式 `openclaw gateway start`
    try {
      const result = await this.execCommand('gateway start', 30000);
      if (onLog) onLog(result.stdout + '\n');
      return { error: false, message: result.stdout || '网关已启动' };
    } catch {
      // fallback: 前台模式 `openclaw gateway run`
      return this.startForeground(onLog);
    }
  }

  // Start gateway in foreground mode via spawn
  startForeground(onLog) {
    if (this.gatewayProcess && this.gatewayProcess.exitCode === null) {
      return { error: false, message: '网关已在运行中' };
    }

    const args = process.platform === 'win32'
      ? ['/c', 'chcp', '65001', '>nul', '&&', this.cliBin, 'gateway', 'run', '--port', String(this.gatewayPort)]
      : ['gateway', 'run', '--port', String(this.gatewayPort)];
    const bin = process.platform === 'win32' ? 'cmd' : this.cliBin;

    this.gatewayProcess = spawn(bin, args, { shell: false });
    this.gatewayLogs = [];

    const handleOutput = (data) => {
      const text = data.toString();
      const lines = text.split('\n').filter(l => l.trim());
      this.gatewayLogs.push(...lines);
      if (this.gatewayLogs.length > this.maxLogLines) {
        this.gatewayLogs = this.gatewayLogs.slice(-this.maxLogLines);
      }
      if (onLog) onLog(text);
    };

    this.gatewayProcess.stdout.on('data', handleOutput);
    this.gatewayProcess.stderr.on('data', handleOutput);

    this.gatewayProcess.on('close', (code) => {
      const msg = `[manager] 网关进程已退出，退出码: ${code}`;
      this.gatewayLogs.push(msg);
      this.gatewayProcess = null;
      if (onLog) onLog(msg + '\n');
    });

    return { error: false, message: '网关正在启动（前台模式）...' };
  }

  // Stop gateway
  async stop() {
    // 先尝试 CLI stop
    try {
      const result = await this.execCommand('gateway stop', 15000);
      return { error: false, message: result.stdout || '网关已停止' };
    } catch {
      // fallback: kill foreground process
      if (this.gatewayProcess && this.gatewayProcess.exitCode === null) {
        if (process.platform === 'win32') {
          exec(`taskkill /pid ${this.gatewayProcess.pid} /T /F`, { encoding: 'utf8' });
        } else {
          this.gatewayProcess.kill('SIGTERM');
        }
        return { error: false, message: '正在停止网关...' };
      }
      return { error: false, message: '网关未运行' };
    }
  }

  // Restart gateway
  async restart(onLog) {
    // 先尝试 CLI restart
    try {
      const result = await this.execCommand('gateway restart', 30000);
      if (onLog) onLog(result.stdout + '\n');
      return { error: false, message: result.stdout || '网关已重启' };
    } catch {
      // fallback: stop then start
      await this.stop();
      return new Promise((resolve) => {
        setTimeout(async () => {
          resolve(await this.start(onLog));
        }, 2000);
      });
    }
  }

  // Check if gateway process is alive (foreground mode)
  isRunning() {
    return this.gatewayProcess !== null && this.gatewayProcess.exitCode === null;
  }

  // Get logs - from process buffer or CLI
  async getLogs(limit = 200) {
    // 如果有前台进程日志，直接返回
    if (this.gatewayLogs.length > 0) {
      const lines = this.gatewayLogs.slice(-limit);
      return { logs: lines.join('\n') };
    }
    // 否则尝试 CLI 获取
    try {
      const result = await this.execCommand(`logs --limit ${limit} --local-time`, 10000);
      return { logs: result.stdout };
    } catch (e) {
      return { error: true, message: e.error || e.stderr || 'Failed to get logs' };
    }
  }

  // Stream logs via CLI
  streamLogs(onData, onError) {
    // 如果有前台进程，日志已经自动推送，无需额外 stream
    if (this.gatewayProcess) return null;

    const args = process.platform === 'win32'
      ? ['/c', 'chcp', '65001', '>nul', '&&', this.cliBin, 'logs', '--follow', '--local-time']
      : ['logs', '--follow', '--local-time'];
    const bin = process.platform === 'win32' ? 'cmd' : this.cliBin;

    const logProc = spawn(bin, args, { shell: false });
    logProc.stdout.on('data', (data) => onData(data.toString()));
    logProc.stderr.on('data', (data) => onError(data.toString()));
    return logProc;
  }

  // Get openclaw home directory
  getHomeDir() {
    return process.env.OPENCLAW_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.openclaw');
  }

  // Cleanup on app quit
  cleanup() {
    if (this.gatewayProcess && this.gatewayProcess.exitCode === null) {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${this.gatewayProcess.pid} /T /F`, { encoding: 'utf8' });
      } else {
        this.gatewayProcess.kill('SIGTERM');
      }
    }
  }
}

module.exports = OpenClawManager;
