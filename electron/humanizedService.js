/**
 * Electron integration for the Humanized scheduler.
 * This service intentionally wires only Steam-independent mock execution and
 * verification adapters. A future production adapter belongs at this boundary.
 */

const { BrowserWindow } = require('electron');
const settingsStore = require('./settingsStore');
const { operationCoordinator } = require('./operationCoordinator');
const steamManager = require('./steamManager');
const { createRealSteamExecutionAdapter, createRealSteamVerificationAdapter } = require('./humanized/realSteamAdapters');
const { assertScheduleReplacementAllowed } = require('./humanized/schedulePolicy');
const { SchedulerBusyError, createSchedule, createScheduler } = require('./humanized/schedulerEngine');

const STORAGE_KEY = 'humanizedSchedulerState';
let engine = null;
let tickTimer = null;
let serviceFault = null;
let leasedOwnerId = null;
const executionAdapter = createRealSteamExecutionAdapter({ steamManager });
const verificationAdapter = createRealSteamVerificationAdapter({ steamManager });

function isTerminalItem(item) {
  return item.status === 'completed' || item.status === 'failed';
}

function ownerFor(schedule) {
  return schedule ? `humanized:${schedule.id}` : null;
}

function leasesForSchedule(schedule) {
  if (!schedule) return [];
  const ownerId = ownerFor(schedule);
  return schedule.items
    .filter((item) => !isTerminalItem(item))
    .map((item) => ({
      appId: schedule.appId,
      achievementId: item.id,
      mode: 'humanized',
      ownerId,
      state: item.status,
    }));
}

function synchronizeLeases(schedule) {
  const nextOwnerId = ownerFor(schedule);
  operationCoordinator.replaceOwner(leasedOwnerId, leasesForSchedule(schedule));
  leasedOwnerId = nextOwnerId;
}

function enrichStatus(status) {
  const runtime = {
    ...(status.runtime ?? {}),
    error: serviceFault ?? status.runtime?.error ?? null,
  };
  return { ...status, runtime, adapter: executionAdapter.kind, verifier: verificationAdapter.kind };
}

function emitUpdate(schedule) {
  try {
    synchronizeLeases(schedule);
  } catch (error) {
    serviceFault = {
      code: error?.code || 'OPERATION_COORDINATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
  }

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
    executor: executionAdapter,
    verifier: verificationAdapter,
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
    if (savedSchedule) {
      synchronizeLeases(savedSchedule);
      const loaded = await ensureEngine().load(savedSchedule);
      if (loaded?.state === 'running') ensureTickLoop();
    }
  } catch (error) {
    if (leasedOwnerId) operationCoordinator.releaseOwner(leasedOwnerId);
    leasedOwnerId = null;
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

async function applyScheduleChange(nextSchedule, action) {
  const scheduler = ensureEngine();
  const previousSchedule = scheduler.getSchedule();
  const previousOwnerId = leasedOwnerId;

  synchronizeLeases(nextSchedule);
  try {
    const result = await action();
    serviceFault = null;
    return result;
  } catch (error) {
    try {
      operationCoordinator.replaceOwner(leasedOwnerId, leasesForSchedule(previousSchedule));
      leasedOwnerId = previousOwnerId;
    } catch {
      // Preserve the original scheduler error; runtime status still reports it.
    }
    throw error;
  }
}

async function create(payload, { replace = false } = {}) {
  const scheduler = ensureEngine();
  const current = scheduler.getSchedule();
  const requestedAppId = payload?.appId;

  assertScheduleReplacementAllowed(current, requestedAppId, { replace });
  if (scheduler.isProcessing()) throw new SchedulerBusyError('Cannot create or replace a schedule while execution is in flight.');

  stopTickLoop();
  const nextSchedule = createSchedule(payload);
  await applyScheduleChange(nextSchedule, () => scheduler.setSchedule(nextSchedule));
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

async function recheckNow() {
  await ensureEngine().recheckNow();
  serviceFault = null;
  ensureTickLoop();
  return getStatus();
}

async function clear() {
  stopTickLoop();
  await applyScheduleChange(null, () => ensureEngine().clear());
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
  recheckNow,
  replace,
  start,
};
