/**
 * Electron integration for the Humanized scheduler.
 * The scheduler is intentionally connected only to a mock adapter in this release.
 */

const { BrowserWindow } = require('electron');
const settingsStore = require('./settingsStore');
const { createMockExecutionAdapter } = require('./humanized/mockExecutionAdapter');
const { createSchedule, createScheduler, summarize } = require('./humanized/schedulerEngine');

const STORAGE_KEY = 'humanizedSchedulerState';
let engine = null;
let tickTimer = null;

function emitUpdate(schedule, summary) {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('humanized:update', { schedule, summary, adapter: 'mock' });
    }
  });
}

function persist(schedule) {
  if (schedule) settingsStore.set(STORAGE_KEY, schedule);
  else settingsStore.delete(STORAGE_KEY);
}

function ensureEngine() {
  if (engine) return engine;
  engine = createScheduler({
    executor: createMockExecutionAdapter(),
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
  const schedule = scheduler.getSchedule();
  if (!schedule || schedule.state !== 'running') stopTickLoop();
}

function ensureTickLoop() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tick().catch(() => stopTickLoop());
  }, 1000);
}

function init() {
  const savedSchedule = settingsStore.get(STORAGE_KEY);
  if (savedSchedule) ensureEngine().load(savedSchedule);
}

function getStatus() {
  const schedule = ensureEngine().getSchedule();
  return { schedule, summary: summarize(schedule), adapter: 'mock' };
}

function create(payload) {
  stopTickLoop();
  const nextSchedule = createSchedule(payload);
  ensureEngine().setSchedule(nextSchedule);
  return getStatus();
}

function start() {
  ensureEngine().start();
  ensureTickLoop();
  tick().catch(() => stopTickLoop());
  return getStatus();
}

function pause() {
  stopTickLoop();
  ensureEngine().pause();
  return getStatus();
}

function clear() {
  stopTickLoop();
  ensureEngine().clear();
  return getStatus();
}

module.exports = {
  clear,
  create,
  getStatus,
  init,
  pause,
  start,
};
