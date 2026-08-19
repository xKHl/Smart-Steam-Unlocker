const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 512 * 1024;
const ENABLE_FLAGS = new Set(['--ssu-diagnostics', '--enable-diagnostics']);
const enabled = process.env.SSU_DIAGNOSTICS === '1'
  || process.env.SSU_DIAGNOSTICS === 'true'
  || process.argv.some((argument) => ENABLE_FLAGS.has(argument));
let logPath = null;
let statusPath = null;
let lastWriteError = null;
let initialized = false;

function getPaths() {
  if (!enabled) return { logPath: null, statusPath: null };
  if (!logPath || !statusPath) {
    // Keep pure scheduler/adapter tests Electron-free. Electron is required only
    // for an explicitly enabled desktop diagnostic run.
    const { app } = require('electron');
    const userDataPath = app.getPath('userData');
    logPath = path.join(userDataPath, 'runtime-diagnostics.jsonl');
    statusPath = path.join(userDataPath, 'runtime-diagnostics-status.json');
  }
  return { logPath, statusPath };
}

function scrub(value, depth = 0) {
  if (depth > 3) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/key|token|secret|credential|authorization|cookie/i.test(key))
      .slice(0, 20)
      .map(([key, item]) => [key, scrub(item, depth + 1)]));
  }
  return String(value).slice(0, 240);
}

function statusPayload() {
  return {
    enabled,
    initialized,
    eventLog: logPath,
    statusFile: statusPath,
    lastWriteError,
    updatedAt: new Date().toISOString(),
  };
}

function reportWriteFailure(error) {
  lastWriteError = error instanceof Error ? error.message : String(error);
  // This is intentionally visible in the Electron/terminal stderr stream. It is
  // the only fallback when the user-data directory itself cannot be written.
  console.error(`[SSU diagnostics] write failed: ${lastWriteError}`);
}

function writeStatus() {
  if (!enabled) return;
  try {
    const paths = getPaths();
    fs.mkdirSync(path.dirname(paths.logPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(paths.statusPath, `${JSON.stringify(statusPayload(), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    reportWriteFailure(error);
  }
}

function initialize() {
  if (!enabled || initialized) return getStatus();
  try {
    const paths = getPaths();
    fs.mkdirSync(path.dirname(paths.logPath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(paths.logPath, '', { encoding: 'utf8', mode: 0o600 });
    initialized = true;
    writeStatus();
  } catch (error) {
    reportWriteFailure(error);
  }
  return getStatus();
}

function trace(component, event, details = {}) {
  if (!enabled) return;
  try {
    if (!initialized) initialize();
    const paths = getPaths();
    if (fs.existsSync(paths.logPath) && fs.statSync(paths.logPath).size > MAX_LOG_BYTES) {
      fs.renameSync(paths.logPath, `${paths.logPath}.${Date.now()}.previous`);
    }
    fs.appendFileSync(paths.logPath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      component,
      event,
      details: scrub(details),
    })}\n`, { encoding: 'utf8', mode: 0o600 });
    lastWriteError = null;
    writeStatus();
  } catch (error) {
    reportWriteFailure(error);
  }
}

function traceHandler(channel, handler) {
  return async (event, ...args) => {
    const startedAt = Date.now();
    trace('ipc-main', 'invoke-start', { channel });
    try {
      const result = await handler(event, ...args);
      trace('ipc-main', 'invoke-end', { channel, durationMs: Date.now() - startedAt, outcome: 'success' });
      return result;
    } catch (error) {
      trace('ipc-main', 'invoke-end', {
        channel,
        durationMs: Date.now() - startedAt,
        outcome: 'error',
        errorCode: error?.code || null,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}

function getStatus() {
  if (!enabled) return { enabled: false, initialized: false, logPath: null, statusPath: null, lastWriteError: null };
  try {
    const paths = getPaths();
    return { enabled: true, initialized, logPath: paths.logPath, statusPath: paths.statusPath, lastWriteError };
  } catch (error) {
    reportWriteFailure(error);
    return { enabled: true, initialized: false, logPath: null, statusPath: null, lastWriteError };
  }
}

module.exports = {
  getStatus,
  initialize,
  isEnabled: () => enabled,
  trace,
  traceHandler,
};
