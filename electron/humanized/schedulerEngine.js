/**
 * Stateful, persistence-aware scheduler engine.
 * The engine has no Electron or Steam dependencies. Execution and verification are
 * supplied by injectable contracts so the core remains platform independent.
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
  VERIFICATION_REQUIRED: 'verification-required',
  COMPLETED: 'completed',
  RETRY: 'retry',
  FAILED: 'failed',
});

const VERIFICATION = Object.freeze({
  UNVERIFIED: 'unverified',
  VERIFIED: 'verified',
  UNCERTAIN: 'uncertain',
  PENDING: 'pending',
});

const DEFAULT_VERIFICATION_POLICY = Object.freeze({
  // The first remote read happens immediately. Subsequent checks are bounded,
  // deterministic, persisted, and intentionally non-aggressive.
  backoffMs: Object.freeze([0, 5_000, 15_000, 30_000, 60_000, 120_000, 240_000, 300_000]),
  horizonMs: 15 * 60 * 1000,
});

class SchedulerBusyError extends Error {
  constructor(message = 'The scheduler has an execution in progress.') {
    super(message);
    this.name = 'SchedulerBusyError';
    this.code = 'SCHEDULER_BUSY';
  }
}

class PersistenceError extends Error {
  constructor(cause) {
    super(`Scheduler persistence failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'PersistenceError';
    this.code = 'PERSISTENCE_FAILED';
    this.cause = cause;
  }
}

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

  const timelineStartAt = Number.isFinite(startAt) ? Math.floor(startAt) : Date.now();
  const items = createScheduleTimeline(ordered, { seed, startAt: timelineStartAt, ...timelineOptions });
  return {
    version: 2,
    id: scheduleIdFor(appId, seed, ordered),
    appId,
    seed: String(seed),
    orderMode,
    state: SCHEDULE_STATE.PAUSED,
    createdAt: timelineStartAt,
    updatedAt: timelineStartAt,
    resumedAt: null,
    lastError: null,
    items,
  };
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function retryDelayMs(attempts) {
  return Math.min(5 * 60 * 1000, 30 * 1000 * Math.pow(2, Math.max(0, attempts - 1)));
}

function normalizeVerificationPolicy(policy = {}) {
  const requestedBackoff = Array.isArray(policy.backoffMs) ? policy.backoffMs : DEFAULT_VERIFICATION_POLICY.backoffMs;
  const backoffMs = requestedBackoff
    .filter((delay) => Number.isFinite(delay) && delay >= 0)
    .map((delay) => Math.floor(delay));
  if (!backoffMs.length) throw new Error('Verification policy requires at least one non-negative backoff delay.');
  const horizonMs = Number.isFinite(policy.horizonMs) && policy.horizonMs > 0
    ? Math.floor(policy.horizonMs)
    : DEFAULT_VERIFICATION_POLICY.horizonMs;
  return Object.freeze({ backoffMs: Object.freeze(backoffMs), horizonMs });
}

function verificationDelayMs(attemptCount, policy) {
  const index = Math.min(Math.max(0, attemptCount), policy.backoffMs.length - 1);
  return policy.backoffMs[index];
}

function createVerificationMetadata(now, policy, previous = null) {
  const firstVerificationAt = Number.isFinite(previous?.firstVerificationAt) ? previous.firstVerificationAt : now;
  return {
    attemptCount: Number.isInteger(previous?.attemptCount) && previous.attemptCount >= 0 ? previous.attemptCount : 0,
    confirmedNotUnlockedCount: Number.isInteger(previous?.confirmedNotUnlockedCount) && previous.confirmedNotUnlockedCount >= 0 ? previous.confirmedNotUnlockedCount : 0,
    firstVerificationAt,
    lastVerificationAt: Number.isFinite(previous?.lastVerificationAt) ? previous.lastVerificationAt : null,
    nextVerificationAt: Number.isFinite(previous?.nextVerificationAt) ? previous.nextVerificationAt : now,
    horizonAt: Number.isFinite(previous?.horizonAt) ? previous.horizonAt : firstVerificationAt + policy.horizonMs,
    reasonCode: previous?.reasonCode ?? null,
    exhausted: Boolean(previous?.exhausted),
    autoContinue: previous?.autoContinue !== false,
  };
}

function isTerminalItem(item) {
  return [ITEM_STATUS.COMPLETED, ITEM_STATUS.FAILED].includes(item.status);
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
    verificationRequired: counts[ITEM_STATUS.VERIFICATION_REQUIRED] ?? 0,
    failed: counts[ITEM_STATUS.FAILED] ?? 0,
    executing: counts[ITEM_STATUS.EXECUTING] ?? 0,
  };
}

function recoverSchedule(persistedSchedule, now = Date.now(), verificationPolicy = DEFAULT_VERIFICATION_POLICY) {
  if (!persistedSchedule || !Array.isArray(persistedSchedule.items)) return null;
  const recovered = clone(persistedSchedule);
  let changed = false;
  const normalizedPolicy = normalizeVerificationPolicy(verificationPolicy);

  recovered.items = recovered.items.map((item) => {
    if (item.status === ITEM_STATUS.EXECUTING) {
      changed = true;
      const interruptedToken = item.executionToken ?? item.interruptedExecutionToken ?? null;
      const history = Array.isArray(item.executionHistory) ? [...item.executionHistory] : [];
      if (interruptedToken && !history.some((attempt) => attempt.token === interruptedToken)) {
        history.push({ token: interruptedToken, recoveredAt: now, state: 'interrupted' });
      }
      return {
        ...item,
        // An external operation may have completed before the process stopped.
        // Recovery must verify this immutable attempt before a new execution is allowed.
        status: ITEM_STATUS.VERIFICATION_REQUIRED,
        verification: VERIFICATION.UNCERTAIN,
        verificationMeta: createVerificationMetadata(now, normalizedPolicy, { autoContinue: true, reasonCode: 'INTERRUPTED_EXECUTION' }),
        recoveryPending: true,
        interruptedExecutionToken: interruptedToken,
        executionToken: null,
        executionHistory: history,
        nextAttemptAt: null,
        lastError: 'Recovered an interrupted execution; verification will continue before any retry.',
      };
    }

    if (item.status === ITEM_STATUS.VERIFICATION_REQUIRED) {
      const metadata = createVerificationMetadata(now, normalizedPolicy, item.verificationMeta ?? { autoContinue: true });
      if (!item.verificationMeta || JSON.stringify(metadata) !== JSON.stringify(item.verificationMeta)) changed = true;
      return { ...item, verificationMeta: metadata };
    }
    return item;
  });

  const pendingVerification = recovered.items.find((item) => item.status === ITEM_STATUS.VERIFICATION_REQUIRED && item.verificationMeta?.autoContinue && !item.verificationMeta?.exhausted);
  if (pendingVerification) {
    recovered.state = SCHEDULE_STATE.RUNNING;
    recovered.resumedAt = now;
    changed = true;
  } else if (recovered.state === SCHEDULE_STATE.RUNNING) {
    recovered.state = SCHEDULE_STATE.PAUSED;
    recovered.resumedAt = null;
    changed = true;
  }

  if (changed) recovered.updatedAt = now;
  return recovered;
}

function hasTerminalScheduleState(schedule) {
  return schedule.items.every(isTerminalItem);
}

function getHeadNonTerminalItem(schedule) {
  return schedule.items
    .filter((item) => !isTerminalItem(item))
    .sort((left, right) => (left.sequencePosition ?? Number.MAX_SAFE_INTEGER) - (right.sequencePosition ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
}

function getHeadAction(schedule, now) {
  const item = getHeadNonTerminalItem(schedule);
  if (!item) return null;

  if (item.status === ITEM_STATUS.VERIFICATION_REQUIRED) {
    const metadata = item.verificationMeta;
    if (metadata?.exhausted) return null;
    if (!Number.isFinite(metadata?.nextVerificationAt) || metadata.nextVerificationAt <= now) return { type: 'verify', item };
    return null;
  }
  if (item.status === ITEM_STATUS.EXECUTING || item.status === ITEM_STATUS.PENDING) return null;
  if (item.status === ITEM_STATUS.SCHEDULED && item.scheduledAt <= now) return { type: 'execute', item };
  if (item.status === ITEM_STATUS.RETRY && (item.nextAttemptAt ?? item.scheduledAt) <= now) return { type: 'execute', item };
  return null;
}

function createExecutionContext(schedule, item, executionToken) {
  return Object.freeze({
    appId: schedule.appId,
    achievementId: item.id,
    scheduleId: schedule.id,
    itemId: item.id,
    sequencePosition: item.sequencePosition,
    executionToken,
  });
}

function normalizeExecutionResult(result) {
  const outcome = result?.outcome ?? (result?.success ? 'success' : 'failed');
  return {
    outcome,
    error: result?.error ?? null,
    raw: result ?? null,
  };
}

function normalizeVerificationResult(result) {
  const verification = result?.verification ?? VERIFICATION.UNCERTAIN;
  return {
    verification,
    retryable: Boolean(result?.retryable),
    errorCode: result?.errorCode ?? null,
    error: result?.error ?? null,
  };
}

function createScheduler({ executor, verifier, persist = () => true, now = () => Date.now(), onUpdate = () => {}, verificationPolicy = {} } = {}) {
  if (!executor || typeof executor.executeUnlock !== 'function') {
    throw new Error('An executor with executeUnlock(executionContext) is required.');
  }
  if (!verifier || typeof verifier.verify !== 'function') {
    throw new Error('A verifier with verify({ schedule, item, executionResult }) is required.');
  }

  const normalizedVerificationPolicy = normalizeVerificationPolicy(verificationPolicy);
  let schedule = null;
  let processing = false;
  let generation = 0;
  let persistTail = Promise.resolve();
  let runtimeFault = null;
  let executionBlocked = false;

  function runtimeStatus() {
    return {
      processing,
      executionBlocked,
      error: runtimeFault ? { ...runtimeFault } : null,
    };
  }

  function emitCurrent() {
    const snapshot = clone(schedule);
    onUpdate(snapshot, summarize(snapshot), runtimeStatus());
    return snapshot;
  }

  function queuePersistence(snapshot) {
    const work = persistTail.then(async () => {
      const acknowledged = await persist(clone(snapshot));
      if (acknowledged === false) throw new Error('Persistence adapter did not acknowledge the write.');
    });
    persistTail = work.catch(() => {});
    return work;
  }

  async function commit(nextSchedule, previousSchedule, expectedGeneration, { blockOnFailure = false } = {}) {
    schedule = nextSchedule;
    try {
      await queuePersistence(schedule);
      if (generation !== expectedGeneration || schedule !== nextSchedule) return { applied: false, snapshot: clone(schedule) };
      runtimeFault = null;
      if (!processing) executionBlocked = false;
      return { applied: true, snapshot: emitCurrent() };
    } catch (cause) {
      const error = new PersistenceError(cause);
      if (generation === expectedGeneration && schedule === nextSchedule) {
        const halted = clone(previousSchedule);
        if (blockOnFailure && halted && halted.state === SCHEDULE_STATE.RUNNING) {
          halted.state = SCHEDULE_STATE.PAUSED;
          halted.updatedAt = now();
          halted.lastError = error.message;
        }
        schedule = halted;
        if (blockOnFailure) executionBlocked = true;
      }
      runtimeFault = { code: error.code, message: error.message };
      emitCurrent();
      throw error;
    }
  }

  function finalizeSchedule(nextSchedule) {
    if (hasTerminalScheduleState(nextSchedule)) {
      nextSchedule.state = nextSchedule.items.some((item) => item.status === ITEM_STATUS.FAILED)
        ? SCHEDULE_STATE.FAILED
        : SCHEDULE_STATE.COMPLETED;
    }
    return nextSchedule;
  }

  async function load(persistedSchedule) {
    const recovered = recoverSchedule(persistedSchedule, now(), normalizedVerificationPolicy);
    if (!recovered) {
      schedule = null;
      return null;
    }
    const previous = schedule;
    const expectedGeneration = generation;
    const result = await commit(recovered, previous, expectedGeneration);
    return result.snapshot;
  }

  async function setSchedule(nextSchedule) {
    if (processing) throw new SchedulerBusyError('Cannot replace a schedule while execution is in flight.');
    const previous = schedule;
    const expectedGeneration = generation + 1;
    generation = expectedGeneration;
    const result = await commit(clone(nextSchedule), previous, expectedGeneration, { blockOnFailure: true });
    return result.snapshot;
  }

  async function start() {
    if (!schedule) throw new Error('No schedule has been created.');
    if (processing) throw new SchedulerBusyError('Cannot resume while an execution result is still in flight.');
    const previous = schedule;
    const next = clone(schedule);
    if (hasTerminalScheduleState(next)) {
      finalizeSchedule(next);
    } else {
      next.state = SCHEDULE_STATE.RUNNING;
      next.resumedAt = now();
    }
    next.updatedAt = now();
    const result = await commit(next, previous, generation, { blockOnFailure: true });
    return result.snapshot;
  }

  async function pause() {
    if (!schedule) return null;
    const previous = schedule;
    const next = clone(schedule);
    const expectedGeneration = processing ? generation + 1 : generation;
    if (processing) generation = expectedGeneration;

    const executingItem = next.items.find((item) => item.status === ITEM_STATUS.EXECUTING);
    if (executingItem) {
      executingItem.status = ITEM_STATUS.VERIFICATION_REQUIRED;
      executingItem.verification = VERIFICATION.UNCERTAIN;
      executingItem.verificationMeta = createVerificationMetadata(now(), normalizedVerificationPolicy, { autoContinue: false, reasonCode: 'PAUSED_DURING_EXECUTION' });
      executingItem.executionToken = null;
      executingItem.lastError = 'Paused while execution was in flight; verification is required before resuming.';
    }
    const verificationItem = next.items.find((item) => item.status === ITEM_STATUS.VERIFICATION_REQUIRED);
    if (verificationItem?.verificationMeta) verificationItem.verificationMeta.autoContinue = false;
    next.state = SCHEDULE_STATE.PAUSED;
    next.updatedAt = now();
    const result = await commit(next, previous, expectedGeneration, { blockOnFailure: true });
    return result.snapshot;
  }

  async function clear() {
    const previous = schedule;
    const expectedGeneration = generation + 1;
    generation = expectedGeneration;
    const result = await commit(null, previous, expectedGeneration, { blockOnFailure: true });
    return result.snapshot;
  }

  async function transitionToRetry(scheduleId, expectedGeneration, itemId, error, verification = VERIFICATION.UNCERTAIN) {
    if (!schedule || schedule.id !== scheduleId || generation !== expectedGeneration) return null;
    const previous = schedule;
    const next = clone(schedule);
    const item = next.items.find((candidate) => candidate.id === itemId);
    if (!item) return null;

    item.executionToken = null;
    item.verification = verification;
    item.lastError = error || 'Execution requires a retry.';
    if (item.attempts <= item.maxRetries) {
      item.status = ITEM_STATUS.RETRY;
      item.nextAttemptAt = now() + retryDelayMs(item.attempts);
    } else {
      item.status = ITEM_STATUS.FAILED;
      item.nextAttemptAt = null;
    }
    next.updatedAt = now();
    finalizeSchedule(next);
    return commit(next, previous, expectedGeneration, { blockOnFailure: true });
  }

  async function transitionToVerificationRequired(scheduleId, expectedGeneration, itemId, executionResult) {
    if (!schedule || schedule.id !== scheduleId || generation !== expectedGeneration) return null;
    const previous = schedule;
    const next = clone(schedule);
    const item = next.items.find((candidate) => candidate.id === itemId);
    if (!item) return null;

    item.status = ITEM_STATUS.VERIFICATION_REQUIRED;
    item.executionToken = null;
    item.recoveryPending = false;
    item.verification = VERIFICATION.PENDING;
    item.verificationMeta = createVerificationMetadata(now(), normalizedVerificationPolicy, {
      autoContinue: true,
      reasonCode: executionResult?.outcome === 'uncertain' ? 'POST_ACTIVATION_UNCERTAIN' : 'POST_ACTIVATION_CONFIRMATION',
    });
    item.executionResult = executionResult;
    item.executionContext = executionResult?.context ?? item.executionContext ?? null;
    item.lastError = null;
    next.updatedAt = now();
    return commit(next, previous, expectedGeneration, { blockOnFailure: true });
  }

  async function verifyHead(scheduleId, expectedGeneration, itemId) {
    if (!schedule || schedule.id !== scheduleId || generation !== expectedGeneration) return clone(schedule);
    const head = getHeadNonTerminalItem(schedule);
    if (!head || head.id !== itemId || head.status !== ITEM_STATUS.VERIFICATION_REQUIRED) return clone(schedule);

    let verificationResult;
    try {
      verificationResult = normalizeVerificationResult(await verifier.verify({
        schedule: clone(schedule),
        item: clone(head),
        executionResult: clone(head.executionResult ?? {
          outcome: 'uncertain',
          recoveryPending: Boolean(head.recoveryPending),
          context: head.executionContext ?? {
            appId: schedule.appId,
            achievementId: head.id,
            scheduleId: schedule.id,
            itemId: head.id,
            sequencePosition: head.sequencePosition,
            executionToken: head.interruptedExecutionToken ?? null,
          },
        }),
      }));
    } catch (error) {
      verificationResult = { verification: VERIFICATION.UNCERTAIN, error: error instanceof Error ? error.message : String(error) };
    }

    if (!schedule || schedule.id !== scheduleId || generation !== expectedGeneration) return clone(schedule);
    const previous = schedule;
    const next = clone(schedule);
    const item = next.items.find((candidate) => candidate.id === itemId);
    if (!item || item.status !== ITEM_STATUS.VERIFICATION_REQUIRED) return clone(schedule);

    const verifiedAt = now();
    const metadata = createVerificationMetadata(verifiedAt, normalizedVerificationPolicy, item.verificationMeta);
    metadata.attemptCount += 1;
    metadata.lastVerificationAt = verifiedAt;
    metadata.reasonCode = verificationResult.errorCode || verificationResult.verification;
    item.verification = verificationResult.verification;
    item.lastError = verificationResult.error;

    if (verificationResult.verification === VERIFICATION.VERIFIED) {
      item.status = ITEM_STATUS.COMPLETED;
      item.completedAt = verifiedAt;
      item.recoveryPending = false;
      item.interruptedExecutionToken = null;
      item.verificationMeta = { ...metadata, nextVerificationAt: null, exhausted: false, autoContinue: false, reasonCode: 'CONFIRMED_UNLOCKED' };
      item.lastError = null;
    } else if (verificationResult.verification === VERIFICATION.UNVERIFIED && verificationResult.retryable) {
      // A single remote false result after activation is not permission to call
      // Steam again. Require repeated confirmed non-completion through the
      // visibility horizon before exposing a controlled retry.
      metadata.confirmedNotUnlockedCount += 1;
      if (verifiedAt >= metadata.horizonAt && metadata.confirmedNotUnlockedCount >= 2) {
        item.status = ITEM_STATUS.RETRY;
        item.executionToken = null;
        item.recoveryPending = false;
        item.interruptedExecutionToken = null;
        item.nextAttemptAt = verifiedAt;
        item.verification = VERIFICATION.UNVERIFIED;
        item.verificationMeta = { ...metadata, nextVerificationAt: null, exhausted: true, autoContinue: false, reasonCode: 'CONFIRMED_NOT_UNLOCKED_HORIZON' };
        next.state = SCHEDULE_STATE.PAUSED;
        item.lastError = 'Steam repeatedly reported this achievement as locked after the verification window. A controlled retry is ready when resumed.';
      } else {
        item.status = ITEM_STATUS.VERIFICATION_REQUIRED;
        item.verification = VERIFICATION.PENDING;
        item.verificationMeta = {
          ...metadata,
          nextVerificationAt: verifiedAt + verificationDelayMs(metadata.attemptCount, normalizedVerificationPolicy),
          exhausted: false,
          autoContinue: true,
          reasonCode: 'CONFIRMED_NOT_UNLOCKED_WAITING',
        };
        next.state = SCHEDULE_STATE.RUNNING;
        item.lastError = 'Steam has not yet reported the unlock. Verification will continue before any retry.';
      }
    } else if (verificationResult.verification === VERIFICATION.UNCERTAIN) {
      if (verifiedAt >= metadata.horizonAt) {
        item.status = ITEM_STATUS.VERIFICATION_REQUIRED;
        item.verification = VERIFICATION.UNCERTAIN;
        item.verificationMeta = { ...metadata, nextVerificationAt: null, exhausted: true, autoContinue: false, reasonCode: verificationResult.errorCode || 'VERIFICATION_HORIZON_EXHAUSTED' };
        next.state = SCHEDULE_STATE.PAUSED;
        item.lastError = verificationResult.error || 'Steam verification remained unavailable for the bounded verification window. Recheck when Steam access is restored.';
      } else {
        item.status = ITEM_STATUS.VERIFICATION_REQUIRED;
        item.verification = VERIFICATION.UNCERTAIN;
        item.verificationMeta = {
          ...metadata,
          nextVerificationAt: verifiedAt + verificationDelayMs(metadata.attemptCount, normalizedVerificationPolicy),
          exhausted: false,
          autoContinue: true,
          reasonCode: verificationResult.errorCode || 'VERIFICATION_UNCERTAIN',
        };
        next.state = SCHEDULE_STATE.RUNNING;
        item.lastError = verificationResult.error || 'Steam verification is temporarily unavailable. The app will recheck safely.';
      }
    } else {
      // Context/authentication/schema failures are not authorization to retry an
      // external operation. Preserve the barrier and require an explicit recheck
      // after the user repairs the underlying configuration.
      item.status = ITEM_STATUS.VERIFICATION_REQUIRED;
      item.verification = VERIFICATION.UNCERTAIN;
      item.verificationMeta = { ...metadata, nextVerificationAt: null, exhausted: true, autoContinue: false, reasonCode: verificationResult.errorCode || 'VERIFICATION_FAILED' };
      next.state = SCHEDULE_STATE.PAUSED;
      item.lastError = verificationResult.error || 'Steam verification needs user attention before this schedule can continue.';
    }

    next.updatedAt = now();
    finalizeSchedule(next);
    const result = await commit(next, previous, expectedGeneration, { blockOnFailure: true });
    return result.snapshot;
  }

  async function recheckNow() {
    if (!schedule) throw new Error('No schedule has been created.');
    if (processing) throw new SchedulerBusyError('Cannot recheck while a scheduler operation is in flight.');
    const head = getHeadNonTerminalItem(schedule);
    if (!head || head.status !== ITEM_STATUS.VERIFICATION_REQUIRED) {
      throw new Error('No achievement is awaiting verification.');
    }

    const previous = schedule;
    const next = clone(schedule);
    const item = next.items.find((candidate) => candidate.id === head.id);
    const metadata = createVerificationMetadata(now(), normalizedVerificationPolicy, item.verificationMeta);
    item.verification = VERIFICATION.PENDING;
    item.verificationMeta = {
      ...metadata,
      nextVerificationAt: now(),
      exhausted: false,
      autoContinue: true,
      reasonCode: 'MANUAL_RECHECK',
    };
    item.lastError = null;
    next.state = SCHEDULE_STATE.RUNNING;
    next.resumedAt = now();
    next.updatedAt = now();
    const committed = await commit(next, previous, generation, { blockOnFailure: true });
    if (!committed.applied) return committed.snapshot;
    return processDue();
  }

  async function processDue() {
    if (!schedule || schedule.state !== SCHEDULE_STATE.RUNNING || processing || executionBlocked) return clone(schedule);
    const action = getHeadAction(schedule, now());
    if (!action) return clone(schedule);

    const scheduleId = schedule.id;
    const expectedGeneration = generation;
    const itemId = action.item.id;
    processing = true;

    try {
      if (action.type === 'verify') return await verifyHead(scheduleId, expectedGeneration, itemId);

      const previous = schedule;
      const next = clone(schedule);
      const item = next.items.find((candidate) => candidate.id === itemId);
      if (!item) return clone(schedule);
      const attemptStartedAt = now();
      const token = `${scheduleId}:${item.id}:${(item.attempts ?? 0) + 1}:${attemptStartedAt}`;
      const executionContext = createExecutionContext(next, item, token);
      item.status = ITEM_STATUS.EXECUTING;
      item.executionToken = token;
      item.executionContext = clone(executionContext);
      item.interruptedExecutionToken = null;
      item.recoveryPending = false;
      item.executionHistory = [
        ...(Array.isArray(item.executionHistory) ? item.executionHistory : []),
        { token, context: clone(executionContext), startedAt: attemptStartedAt, state: 'executing' },
      ];
      item.attempts = (item.attempts ?? 0) + 1;
      item.lastError = null;
      next.updatedAt = now();

      const prepared = await commit(next, previous, expectedGeneration, { blockOnFailure: true });
      if (!prepared.applied || !schedule || schedule.id !== scheduleId || generation !== expectedGeneration || executionBlocked) return clone(schedule);

      let executionResult;
      try {
        if (typeof executor.validateContext === 'function') {
          const validation = await executor.validateContext(executionContext);
          if (validation === false || validation?.valid === false) {
            executionResult = {
              outcome: validation?.outcome || 'failed',
              error: validation?.error || 'Execution context was rejected before execution.',
              raw: validation ?? null,
              context: clone(executionContext),
            };
          }
        }
        if (!executionResult) {
          executionResult = normalizeExecutionResult(await executor.executeUnlock(executionContext));
          executionResult.context = clone(executionContext);
        }
      } catch (error) {
        executionResult = {
          outcome: 'uncertain',
          error: error instanceof Error ? error.message : String(error),
          raw: null,
          context: clone(executionContext),
        };
      }

      if (!schedule || schedule.id !== scheduleId || generation !== expectedGeneration) return clone(schedule);
      const currentItem = schedule.items.find((candidate) => candidate.id === itemId);
      if (!currentItem || currentItem.executionToken !== token) return clone(schedule);

      // A successful activation and an uncertain post-activation result both
      // require an independent state read before another executor call. In
      // particular, a failed local follow-up may occur after Steam accepted the
      // activation, so treating it as a normal retry could duplicate a real unlock.
      if (executionResult.outcome === 'success' || executionResult.outcome === 'uncertain') {
        await transitionToVerificationRequired(scheduleId, expectedGeneration, itemId, executionResult);
        if (schedule?.state === SCHEDULE_STATE.RUNNING) return await verifyHead(scheduleId, expectedGeneration, itemId);
        return clone(schedule);
      }

      if (executionResult.outcome === 'retry') {
        const result = await transitionToRetry(scheduleId, expectedGeneration, itemId, executionResult.error, VERIFICATION.UNVERIFIED);
        return result?.snapshot ?? clone(schedule);
      }

      const failurePrevious = schedule;
      const failureNext = clone(schedule);
      const failureItem = failureNext.items.find((candidate) => candidate.id === itemId);
      if (!failureItem) return clone(schedule);
      failureItem.status = ITEM_STATUS.FAILED;
      failureItem.executionToken = null;
      failureItem.verification = VERIFICATION.UNVERIFIED;
      failureItem.lastError = executionResult.error || 'Execution failed.';
      failureNext.updatedAt = now();
      finalizeSchedule(failureNext);
      const result = await commit(failureNext, failurePrevious, expectedGeneration, { blockOnFailure: true });
      return result.snapshot;
    } finally {
      processing = false;
    }
  }

  function getSchedule() {
    return clone(schedule);
  }

  function getStatus() {
    return {
      schedule: getSchedule(),
      summary: summarize(schedule),
      runtime: runtimeStatus(),
    };
  }

  return {
    clear,
    getSchedule,
    getStatus,
    isProcessing: () => processing,
    load,
    pause,
    processDue,
    recheckNow,
    setSchedule,
    start,
  };
}

module.exports = {
  ITEM_STATUS,
  PersistenceError,
  SCHEDULE_STATE,
  SchedulerBusyError,
  VERIFICATION,
  createExecutionContext,
  createSchedule,
  createScheduler,
  recoverSchedule,
  retryDelayMs,
  summarize,
  DEFAULT_VERIFICATION_POLICY,
  normalizeVerificationPolicy,
};
