const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 512 * 1024;
const enabled = process.env.SSU_DIAGNOSTICS === '1' || process.argv.includes('--ssu-diagnostics');
let logPath = null;

function getLogPath() {
  if (!enabled) return null;
  if (!logPath) {
    // Keep pure scheduler/adapter tests Electron-free. Electron is required only
    // for an explicitly enabled desktop diagnostic run.
    const { app } = require('electron');
    logPath = path.join(app.getPath('userData'), 'runtime-diagnostics.jsonl');
  }
  return logPath;
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

function trace(component, event, details = {}) {
  if (!enabled) return;
  try {
    const target = getLogPath();
    if (fs.existsSync(target) && fs.statSync(target).size > MAX_LOG_BYTES) {
      fs.renameSync(target, `${target}.${Date.now()}.previous`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.appendFileSync(target, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      component,
      event,
      details: scrub(details),
    })}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Diagnostics must never change application control flow.
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

module.exports = {
  getStatus: () => ({ enabled, logPath: enabled ? getLogPath() : null }),
  isEnabled: () => enabled,
  trace,
  traceHandler,
};
