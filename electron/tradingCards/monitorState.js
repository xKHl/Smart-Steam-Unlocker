const { DROP_STATUS } = require('./cardClassification');

const STATE_VERSION = 1;

const MONITOR_STATE = Object.freeze({
  INACTIVE: 'inactive',
  MONITORING: 'monitoring',
  PAUSED: 'paused',
  COMPLETED: 'completed',
});

function inactiveMonitor() {
  return {
    version: STATE_VERSION,
    state: MONITOR_STATE.INACTIVE,
    appId: null,
    gameName: null,
    launchRequestedAt: null,
    monitoringStartedAt: null,
    pausedAt: null,
    pausedDurationMs: 0,
    lastObservedAt: null,
    remainingDrops: null,
    dropStatus: DROP_STATUS.UNAVAILABLE,
    recovered: false,
    confirmedRunning: false,
  };
}

function validTimestamp(value) {
  return Number.isFinite(value) && value >= 0;
}

function validatePersistedMonitor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== STATE_VERSION || !Object.values(MONITOR_STATE).includes(value.state)) return null;
  if (value.state === MONITOR_STATE.INACTIVE) return inactiveMonitor();
  if (!Number.isInteger(value.appId) || value.appId <= 0 || typeof value.gameName !== 'string' || !value.gameName.trim()) return null;
  if (!validTimestamp(value.launchRequestedAt) || !validTimestamp(value.monitoringStartedAt)) return null;
  if (!Number.isFinite(value.pausedDurationMs) || value.pausedDurationMs < 0) return null;
  if (value.pausedAt !== null && value.pausedAt !== undefined && !validTimestamp(value.pausedAt)) return null;
  if (value.remainingDrops !== null && value.remainingDrops !== undefined && (!Number.isInteger(value.remainingDrops) || value.remainingDrops < 0)) return null;
  if (!Object.values(DROP_STATUS).includes(value.dropStatus)) return null;

  return {
    ...inactiveMonitor(),
    ...JSON.parse(JSON.stringify(value)),
    // No persisted field may be treated as proof that an external Steam game
    // continues to run after process restart.
    confirmedRunning: false,
  };
}

function monitorDurationMs(monitor, now = Date.now()) {
  if (!monitor?.monitoringStartedAt) return 0;
  const endAt = monitor.state === MONITOR_STATE.PAUSED && monitor.pausedAt ? monitor.pausedAt : now;
  return Math.max(0, endAt - monitor.monitoringStartedAt - (monitor.pausedDurationMs || 0));
}

function startMonitor({ appId, gameName, remainingDrops, now = Date.now() }) {
  if (!Number.isInteger(appId) || appId <= 0 || typeof gameName !== 'string' || !gameName.trim()) throw new Error('A valid game monitor context is required.');
  if (!Number.isInteger(remainingDrops) || remainingDrops <= 0) throw new Error('Explicit remaining card drops are required to start monitoring.');
  return {
    version: STATE_VERSION,
    state: MONITOR_STATE.MONITORING,
    appId,
    gameName: gameName.trim(),
    launchRequestedAt: now,
    monitoringStartedAt: now,
    pausedAt: null,
    pausedDurationMs: 0,
    lastObservedAt: now,
    remainingDrops,
    dropStatus: DROP_STATUS.REMAINING,
    recovered: false,
    confirmedRunning: false,
  };
}

function pauseMonitor(monitor, now = Date.now()) {
  if (monitor?.state !== MONITOR_STATE.MONITORING) return { ...monitor };
  return { ...monitor, state: MONITOR_STATE.PAUSED, pausedAt: now };
}

function resumeMonitor(monitor, now = Date.now()) {
  if (monitor?.state !== MONITOR_STATE.PAUSED) return { ...monitor };
  return {
    ...monitor,
    state: MONITOR_STATE.MONITORING,
    pausedAt: null,
    pausedDurationMs: (monitor.pausedDurationMs || 0) + Math.max(0, now - monitor.pausedAt),
  };
}

function observeDropStatus(monitor, { dropStatus, remainingDrops, observedAt = Date.now() } = {}) {
  if (!monitor || !Object.values(DROP_STATUS).includes(dropStatus)) return { ...monitor };
  const next = {
    ...monitor,
    lastObservedAt: observedAt,
    remainingDrops: Number.isInteger(remainingDrops) && remainingDrops > 0 ? remainingDrops : null,
    dropStatus,
  };
  if (dropStatus === DROP_STATUS.EXHAUSTED) next.state = MONITOR_STATE.COMPLETED;
  return next;
}

module.exports = {
  STATE_VERSION,
  MONITOR_STATE,
  inactiveMonitor,
  validatePersistedMonitor,
  monitorDurationMs,
  startMonitor,
  pauseMonitor,
  resumeMonitor,
  observeDropStatus,
};
