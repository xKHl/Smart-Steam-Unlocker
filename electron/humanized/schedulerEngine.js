/**
 * Stateful, persistence-friendly scheduler engine.
 * This module is deliberately execution-provider agnostic and never imports Electron or Steam code.
 */

const { orderAchievements, ORDER_MODES } = require('./ordering');
const { createScheduleTimeline } = require('./timeline');

const SCHEDULE_STATE = Object.freeze({
  PAUSED: 'paused',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const ITEM_STATUS = Object.freeze({
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  RETRY: 'retry',
  FAILED: 'failed',
});

const VERIFICATION = Object.freeze({
  UNVERIFIED: 'unverified',
  VERIFIED: 'verified',
  UNCERTAIN: 'uncertain',
});

function scheduleIdFor(appId, seed, ordered) {
  const ids = ordered.map(({ id }) => id).join('|');
  let hash = 0;
  const text = `${appId}:${seed}:${ids}`;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  return `humanized-${appId}-${(hash >>> 0).toString(36)}`;
}

function createSchedule({ appId, achievements, orderMode = ORDER_MODES.ORIGINAL, seed = 'humanized-schedule', startAt = Date.now(), timelineOptions = {} }) {
  if (!appId && appId !== 0) throw new Error('A valid appId is required to create a schedule.');
  const ordered = orderAchievements(achievements, orderMode);
  if (!ordered.length) throw new Error('At least one valid achievement is required to create a schedule.');

  const items = createScheduleTimeline(ordered, { seed, startAt, ...timelineOptions });
  return {
    version: 1,
    id: scheduleIdFor(appId, seed, ordered),
    appId,
    seed: String(seed),
    orderMode,
    state: SCHEDULE_STATE.PAUSED,
    createdAt: startAt,
    updatedAt: startAt,
    resumedAt: null,
    lastError: null,
    items,
  };
}

function clone(schedule) {
  return JSON.parse(JSON.stringify(schedule));
}

function retryDelayMs(attempts) {
  return Math.min(5 * 60 * 1000, 30 * 1000 * Math.pow(2, Math.max(0, attempts - 1)));
}

function summarize(schedule) {
  const items = schedule?.items ?? [];
  const counts = items.reduce((accumulator, item) => {
    accumulator[item.status] = (accumulator[item.status] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    id: schedule?.id ?? null,
    appId: schedule?.appId ?? null,
    state: schedule?.state ?? null,
    total: items.length,
    completed: counts[ITEM_STATUS.COMPLETED] ?? 0,
    scheduled: counts[ITEM_STATUS.SCHEDULED] ?? 0,
    retry: counts[ITEM_STATUS.RETRY] ?? 0,
    failed: counts[ITEM_STATUS.FAILED] ?? 0,
    executing: counts[ITEM_STATUS.EXECUTING] ?? 0,
  };
}

function recoverSchedule(persistedSchedule, now = Date.now()) {
  if (!persistedSchedule || !Array.isArray(persistedSchedule.items)) return null;
  const recovered = clone(persistedSchedule);
  let changed = false;

  recovered.items = recovered.items.map((item) => {
    if (item.status !== ITEM_STATUS.EXECUTING) return item;
    changed = true;
    const attempts = (item.attempts ?? 0) + 1;
    const canRetry = attempts <= (item.maxRetries ?? 2);
    return {
      ...item,
      attempts,
      status: canRetry ? ITEM_STATUS.RETRY : ITEM_STATUS.FAILED,
      verification: VERIFICATION.UNCERTAIN,
      nextAttemptAt: canRetry ? now : null,
      lastError: 'Recovered an interrupted execution; prior outcome could not be verified.',
      executionToken: null,
    };
  });

  if (recovered.state === SCHEDULE_STATE.RUNNING) {
    recovered.state = SCHEDULE_STATE.PAUSED;
    recovered.resumedAt = null;
    changed = true;
  }

  if (changed) recovered.updatedAt = now;
  return recovered;
}

function hasTerminalScheduleState(schedule) {
  return schedule.items.every((item) => [ITEM_STATUS.COMPLETED, ITEM_STATUS.FAILED].includes(item.status));
}

function nextDueItem(schedule, now) {
  return schedule.items.find((item) => {
    if (item.status === ITEM_STATUS.SCHEDULED) return item.scheduledAt <= now;
    if (item.status === ITEM_STATUS.RETRY) return (item.nextAttemptAt ?? item.scheduledAt) <= now;
    return false;
  });
}

function createScheduler({ executor, persist = () => {}, now = () => Date.now(), onUpdate = () => {} } = {}) {
  if (!executor || typeof executor.executeUnlock !== 'function') {
    throw new Error('A mockable executor with executeUnlock(achievementId) is required.');
  }

  let schedule = null;
  let processing = false;

  function publish() {
    const snapshot = schedule ? clone(schedule) : null;
    persist(snapshot);
    onUpdate(snapshot, summarize(snapshot));
    return snapshot;
  }

  function load(persistedSchedule) {
    schedule = recoverSchedule(persistedSchedule, now());
    if (schedule) publish();
    return schedule ? clone(schedule) : null;
  }

  function setSchedule(nextSchedule) {
    schedule = clone(nextSchedule);
    publish();
    return clone(schedule);
  }

  function start() {
    if (!schedule) throw new Error('No schedule has been created.');
    if (hasTerminalScheduleState(schedule)) {
      schedule.state = schedule.items.some((item) => item.status === ITEM_STATUS.FAILED) ? SCHEDULE_STATE.FAILED : SCHEDULE_STATE.COMPLETED;
    } else {
      schedule.state = SCHEDULE_STATE.RUNNING;
      schedule.resumedAt = now();
    }
    schedule.updatedAt = now();
    publish();
    return clone(schedule);
  }

  function pause() {
    if (!schedule) return null;
    schedule.state = SCHEDULE_STATE.PAUSED;
    schedule.updatedAt = now();
    return publish();
  }

  function clear() {
    schedule = null;
    publish();
    return null;
  }

  async function processDue() {
    if (!schedule || schedule.state !== SCHEDULE_STATE.RUNNING || processing) return schedule ? clone(schedule) : null;
    const dueItem = nextDueItem(schedule, now());
    if (!dueItem) return clone(schedule);

    processing = true;
    const token = `${schedule.id}:${dueItem.id}:${dueItem.attempts + 1}:${now()}`;
    dueItem.status = ITEM_STATUS.EXECUTING;
    dueItem.executionToken = token;
    dueItem.attempts = (dueItem.attempts ?? 0) + 1;
    dueItem.lastError = null;
    schedule.updatedAt = now();
    publish();

    try {
      const result = await executor.executeUnlock(dueItem.id);
      const currentItem = schedule.items.find((item) => item.id === dueItem.id);
      if (!currentItem || currentItem.executionToken !== token) return clone(schedule);

      currentItem.executionToken = null;
      currentItem.verification = result?.verification ?? VERIFICATION.UNVERIFIED;
      const outcome = result?.outcome ?? 'failed';

      if (outcome === 'success' && currentItem.verification === VERIFICATION.VERIFIED) {
        currentItem.status = ITEM_STATUS.COMPLETED;
        currentItem.completedAt = now();
        currentItem.lastError = null;
      } else if ((outcome === 'retry' || outcome === 'uncertain' || currentItem.verification === VERIFICATION.UNCERTAIN) && currentItem.attempts <= currentItem.maxRetries) {
        currentItem.status = ITEM_STATUS.RETRY;
        currentItem.nextAttemptAt = now() + retryDelayMs(currentItem.attempts);
        currentItem.lastError = result?.error ?? 'Execution requires verification before it can be completed.';
      } else {
        currentItem.status = ITEM_STATUS.FAILED;
        currentItem.lastError = result?.error ?? 'Execution did not complete verification.';
      }
    } catch (error) {
      const currentItem = schedule.items.find((item) => item.id === dueItem.id);
      if (currentItem && currentItem.executionToken === token) {
        currentItem.executionToken = null;
        currentItem.verification = VERIFICATION.UNCERTAIN;
        if (currentItem.attempts <= currentItem.maxRetries) {
          currentItem.status = ITEM_STATUS.RETRY;
          currentItem.nextAttemptAt = now() + retryDelayMs(currentItem.attempts);
        } else {
          currentItem.status = ITEM_STATUS.FAILED;
        }
        currentItem.lastError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      processing = false;
    }

    if (hasTerminalScheduleState(schedule)) {
      schedule.state = schedule.items.some((item) => item.status === ITEM_STATUS.FAILED) ? SCHEDULE_STATE.FAILED : SCHEDULE_STATE.COMPLETED;
    }
    schedule.updatedAt = now();
    return publish();
  }

  function getSchedule() {
    return schedule ? clone(schedule) : null;
  }

  return {
    clear,
    getSchedule,
    load,
    pause,
    processDue,
    setSchedule,
    start,
  };
}

module.exports = {
  ITEM_STATUS,
  SCHEDULE_STATE,
  VERIFICATION,
  createSchedule,
  createScheduler,
  recoverSchedule,
  retryDelayMs,
  summarize,
};
