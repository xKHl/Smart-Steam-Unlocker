/**
 * Electron integration for the Humanized scheduler.
 * This service intentionally wires only Steam-independent mock execution and
 * verification adapters. A future production adapter belongs at this boundary.
 */

const { BrowserWindow } = require('electron');
const settingsStore = require('./settingsStore');
const { createMockExecutionAdapter } = require('./humanized/mockExecutionAdapter');
const { createMockVerifier } = require('./humanized/mockVerifier');
const { assertScheduleReplacementAllowed } = require('./humanized/schedulePolicy');
const { SchedulerBusyError, createSchedule, createScheduler } = require('./humanized/schedulerEngine');

const STORAGE_KEY = 'humanizedSchedulerState';
let engine = null;
let tickTimer = null;
let serviceFault = null;

function enrichStatus(status) {
  const runtime = {
    ...(status.runtime ?? {}),
    error: serviceFault ?? status.runtime?.error ?? null,
  };
  return { ...status, runtime, adapter: 'mock', verifier: 'mock' };
}

function emitUpdate(_schedule, _summary, _runtime) {
  const status = enrichStatus(ensureEngine().getStatus());
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('humanized:update', status);
  });
}

function persist(schedule) {
  if (schedule) return settingsStore.set(STORAGE_KEY, schedule);
  return settingsStore.delete(STORAGE_KEY);
}

function ensureEngine() {
  if (engine) return engine;
  engine = createScheduler({
    executor: createMockExecutionAdapter(),
    verifier: createMockVerifier(),
    persist,
    onUpdate: emitUpdate,
  });
  return engine;
}

function stopTickLoop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

async function tick() {
  const scheduler = ensureEngine();
  await scheduler.processDue();
  const status = scheduler.getStatus();
  if (!status.schedule || status.schedule.state !== 'running') stopTickLoop();
  return enrichStatus(status);
}

function ensureTickLoop() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tick().catch(() => stopTickLoop());
  }, 1000);
}

async function init() {
  try {
    const savedSchedule = settingsStore.get(STORAGE_KEY);
    if (savedSchedule) await ensureEngine().load(savedSchedule);
  } catch (error) {
    serviceFault = {
      code: error?.code || 'PERSISTENCE_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return getStatus();
}

function getStatus() {
  return enrichStatus(ensureEngine().getStatus());
}

async function create(payload, { replace = false } = {}) {
  const scheduler = ensureEngine();
  const current = scheduler.getSchedule();
  const requestedAppId = payload?.appId;

  assertScheduleReplacementAllowed(current, requestedAppId, { replace });
  if (scheduler.isProcessing()) throw new SchedulerBusyError('Cannot create or replace a schedule while execution is in flight.');

  stopTickLoop();
  const nextSchedule = createSchedule(payload);
  await scheduler.setSchedule(nextSchedule);
  serviceFault = null;
  return getStatus();
}

async function start() {
  await ensureEngine().start();
  serviceFault = null;
  ensureTickLoop();
  try {
    await tick();
  } catch (error) {
    stopTickLoop();
    throw error;
  }
  return getStatus();
}

async function pause() {
  stopTickLoop();
  await ensureEngine().pause();
  serviceFault = null;
  return getStatus();
}

async function clear() {
  stopTickLoop();
  await ensureEngine().clear();
  serviceFault = null;
  return getStatus();
}

async function replace(payload) {
  return create(payload, { replace: true });
}

module.exports = {
  clear,
  create,
  getStatus,
  init,
  pause,
  replace,
  start,
};
