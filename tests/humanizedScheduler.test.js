const test = require('node:test');
const assert = require('node:assert/strict');

const { ORDER_MODES, normalizeAchievements, orderAchievements } = require('../electron/humanized/ordering');
const { createScheduleTimeline } = require('../electron/humanized/timeline');
const {
  ITEM_STATUS,
  PersistenceError,
  SCHEDULE_STATE,
  SchedulerBusyError,
  VERIFICATION,
  createSchedule,
  createScheduler,
  recoverSchedule,
} = require('../electron/humanized/schedulerEngine');
const { createMockExecutionAdapter } = require('../electron/humanized/mockExecutionAdapter');
const { createMockVerifier } = require('../electron/humanized/mockVerifier');
const { assertScheduleReplacementAllowed } = require('../electron/humanized/schedulePolicy');
const { OperationLeaseConflictError, createOperationCoordinator } = require('../electron/operationCoordinator');

const achievements = [
  { id: 'ENDING', name: 'Ending', originalIndex: 2, globalPercent: 4 },
  { id: 'INTRO', name: 'Intro', originalIndex: 0, globalPercent: 98 },
  { id: 'BOSS', name: 'Boss', originalIndex: 1, globalPercent: 40, hidden: true },
  { id: 'UNKNOWN', name: 'Unknown', originalIndex: 3, globalPercent: undefined },
];

function makeSchedule(now, achievementList = [{ id: 'A', originalIndex: 0, globalPercent: 100 }], options = {}) {
  return createSchedule({
    appId: options.appId ?? 480,
    achievements: achievementList,
    seed: options.seed ?? 'test-schedule',
    startAt: now,
    timelineOptions: options.timelineOptions ?? {},
  });
}

function createTestScheduler({ executor, verifier, persist, now, verificationPolicy }) {
  return createScheduler({
    executor: executor ?? createMockExecutionAdapter(),
    verifier: verifier ?? createMockVerifier(),
    persist: persist ?? (() => true),
    now: now ?? (() => 0),
    verificationPolicy,
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for the expected in-flight state.');
}

test('normalization clamps percentages and removes malformed duplicate entries', () => {
  const normalized = normalizeAchievements([
    { id: 'A', globalPercent: 120, originalIndex: 2 },
    { id: 'A', globalPercent: 10, originalIndex: 3 },
    { id: 'B', globalPercent: -3 },
    { name: 'C', percent: '42.5' },
    { id: '' },
  ]);

  assert.deepEqual(normalized.map(({ id, globalPercent }) => ({ id, globalPercent })), [
    { id: 'A', globalPercent: 100 },
    { id: 'B', globalPercent: 0 },
    { id: 'C', globalPercent: 42.5 },
  ]);
});

test('ordering is deterministic with stable original-order fallback for missing percentages', () => {
  const mostCommon = orderAchievements(achievements, ORDER_MODES.MOST_COMMON_TO_RAREST);
  const rarest = orderAchievements(achievements, ORDER_MODES.RAREST_TO_MOST_COMMON);
  const original = orderAchievements([...achievements].reverse(), ORDER_MODES.ORIGINAL);

  assert.deepEqual(mostCommon.map((item) => item.id), ['INTRO', 'BOSS', 'ENDING', 'UNKNOWN']);
  assert.deepEqual(rarest.map((item) => item.id), ['ENDING', 'BOSS', 'INTRO', 'UNKNOWN']);
  assert.deepEqual(original.map((item) => item.id), ['INTRO', 'BOSS', 'ENDING', 'UNKNOWN']);
  assert.deepEqual(orderAchievements(achievements, ORDER_MODES.MOST_COMMON_TO_RAREST), mostCommon);
});

test('timeline generation is reproducible and always chronologically bounded', () => {
  const ordered = orderAchievements(achievements, ORDER_MODES.MOST_COMMON_TO_RAREST);
  const options = { seed: 'fixed-seed', startAt: 1_700_000_000_000, minIntervalMs: 1_000, maxIntervalMs: 10_000 };
  const first = createScheduleTimeline(ordered, options);
  const second = createScheduleTimeline(ordered, options);

  assert.deepEqual(first, second);
  assert.equal(first[0].scheduledAt, options.startAt);
  for (let index = 1; index < first.length; index += 1) {
    assert.ok(first[index].scheduledAt > first[index - 1].scheduledAt);
    assert.ok(first[index].delayMs >= options.minIntervalMs);
    assert.ok(first[index].delayMs <= options.maxIntervalMs);
  }
});

test('later due items cannot bypass the earliest item while it is waiting for retry', async () => {
  let now = 1_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['retry', 'success'], B: ['success'] } });
  const scheduler = createTestScheduler({ executor, now: () => now });
  const schedule = makeSchedule(now, [
    { id: 'A', originalIndex: 0, globalPercent: 100 },
    { id: 'B', originalIndex: 1, globalPercent: 100 },
  ]);
  schedule.items[1].scheduledAt = now;
  await scheduler.setSchedule(schedule);
  await scheduler.start();

  await scheduler.processDue();
  const retryAt = scheduler.getSchedule().items[0].nextAttemptAt;
  assert.equal(scheduler.getSchedule().items[0].status, ITEM_STATUS.RETRY);
  await scheduler.processDue();
  assert.deepEqual(executor.getCalls().map((call) => call.achievementId), ['A']);

  now = retryAt;
  await scheduler.processDue();
  assert.equal(scheduler.getSchedule().items[0].status, ITEM_STATUS.COMPLETED);
  await scheduler.processDue();
  assert.deepEqual(executor.getCalls().map((call) => call.achievementId), ['A', 'A', 'B']);
});

test('verified execution success completes only after the verifier confirms it', async () => {
  let now = 2_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['verified'] } });
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });
  await scheduler.setSchedule(makeSchedule(now));
  await scheduler.start();
  await scheduler.processDue();

  const schedule = scheduler.getSchedule();
  assert.equal(schedule.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(schedule.items[0].verification, VERIFICATION.VERIFIED);
  assert.equal(schedule.state, SCHEDULE_STATE.COMPLETED);
  assert.equal(verifier.getCalls().length, 1);
});

test('confirmed non-completion continues persisted verification without re-executing', async () => {
  let now = 3_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['unverified'] } });
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });
  await scheduler.setSchedule(makeSchedule(now));
  await scheduler.start();
  await scheduler.processDue();

  const paused = scheduler.getSchedule();
  assert.equal(paused.state, SCHEDULE_STATE.RUNNING);
  assert.equal(paused.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(paused.items[0].verification, VERIFICATION.PENDING);
  assert.ok(paused.items[0].verificationMeta.nextVerificationAt > now);
  await scheduler.processDue();
  assert.equal(executor.getCalls().length, 1);
});

test('uncertain reads continue verification and terminal verifier failures require user attention', async () => {
  let now = 4_000;
  const uncertainScheduler = createTestScheduler({
    executor: createMockExecutionAdapter({ outcomes: { A: ['success'] } }),
    verifier: createMockVerifier({ outcomes: { A: ['uncertain'] } }),
    now: () => now,
  });
  await uncertainScheduler.setSchedule(makeSchedule(now));
  await uncertainScheduler.start();
  await uncertainScheduler.processDue();
  assert.equal(uncertainScheduler.getSchedule().state, SCHEDULE_STATE.RUNNING);
  assert.equal(uncertainScheduler.getSchedule().items[0].verification, VERIFICATION.UNCERTAIN);
  assert.equal(uncertainScheduler.getSchedule().items[0].verificationMeta.exhausted, false);

  const failureScheduler = createTestScheduler({
    executor: createMockExecutionAdapter({ outcomes: { A: ['success', 'success'] } }),
    verifier: createMockVerifier({ outcomes: { A: ['failed', 'failed'] } }),
    now: () => now,
  });
  const schedule = makeSchedule(now);
  schedule.items[0].maxRetries = 1;
  await failureScheduler.setSchedule(schedule);
  await failureScheduler.start();
  await failureScheduler.processDue();
  const current = failureScheduler.getSchedule();
  assert.equal(current.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(current.state, SCHEDULE_STATE.PAUSED);
  assert.equal(current.items[0].verificationMeta.exhausted, true);
  assert.equal(current.items[0].attempts, 1);
});

test('interrupted execution recovers into verifier-first uncertainty without consuming a retry', async () => {
  let now = 500;
  const persisted = {
    version: 2,
    id: 'interrupted',
    appId: 480,
    state: SCHEDULE_STATE.RUNNING,
    items: [{
      id: 'A', status: ITEM_STATUS.EXECUTING, attempts: 1, maxRetries: 2,
      executionToken: 'previous-token', verification: VERIFICATION.UNVERIFIED, scheduledAt: 10,
    }],
  };
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['verified'] } });
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });

  await scheduler.load(persisted);
  let recovered = scheduler.getSchedule();
  assert.equal(recovered.state, SCHEDULE_STATE.RUNNING);
  assert.equal(recovered.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(recovered.items[0].verification, VERIFICATION.UNCERTAIN);
  assert.equal(recovered.items[0].attempts, 1);
  assert.equal(recovered.items[0].interruptedExecutionToken, 'previous-token');
  assert.equal(recovered.items[0].executionToken, null);

  await scheduler.start();
  await scheduler.processDue();
  recovered = scheduler.getSchedule();
  assert.equal(recovered.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(executor.getCalls().length, 0);
  assert.equal(verifier.getCalls().length, 1);
});

test('persistence failure blocks execution before the adapter is invoked', async () => {
  let now = 5_000;
  let persistenceCalls = 0;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const scheduler = createTestScheduler({
    executor,
    now: () => now,
    persist: () => {
      persistenceCalls += 1;
      if (persistenceCalls === 3) throw new Error('disk full');
      return true;
    },
  });
  await scheduler.setSchedule(makeSchedule(now));
  await scheduler.start();
  await assert.rejects(() => scheduler.processDue(), PersistenceError);

  const status = scheduler.getStatus();
  assert.equal(executor.getCalls().length, 0);
  assert.equal(status.schedule.state, SCHEDULE_STATE.PAUSED);
  assert.equal(status.schedule.items[0].status, ITEM_STATUS.SCHEDULED);
  assert.equal(status.runtime.executionBlocked, true);
  assert.equal(status.runtime.error.code, 'PERSISTENCE_FAILED');
});

test('clear during execution safely discards a late adapter result', async () => {
  let now = 6_000;
  let resolveExecution;
  let calls = 0;
  const executor = {
    executeUnlock: async () => {
      calls += 1;
      await new Promise((resolve) => { resolveExecution = resolve; });
      return { outcome: 'success' };
    },
  };
  const scheduler = createTestScheduler({ executor, now: () => now });
  await scheduler.setSchedule(makeSchedule(now));
  await scheduler.start();
  const execution = scheduler.processDue();
  await waitFor(() => calls === 1);
  assert.equal(calls, 1);
  await scheduler.clear();
  resolveExecution();
  await execution;

  assert.equal(scheduler.getSchedule(), null);
});

test('pause during execution invalidates the late result and requires verification before resume', async () => {
  let now = 7_000;
  let resolveExecution;
  const executor = {
    executeUnlock: async () => {
      await new Promise((resolve) => { resolveExecution = resolve; });
      return { outcome: 'success' };
    },
  };
  const scheduler = createTestScheduler({ executor, now: () => now });
  await scheduler.setSchedule(makeSchedule(now));
  await scheduler.start();
  const execution = scheduler.processDue();
  await waitFor(() => typeof resolveExecution === 'function');
  await scheduler.pause();
  resolveExecution();
  await execution;

  const schedule = scheduler.getSchedule();
  assert.equal(schedule.state, SCHEDULE_STATE.PAUSED);
  assert.equal(schedule.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(schedule.items[0].verification, VERIFICATION.UNCERTAIN);
});

test('replacement attempts during execution are rejected and cannot mutate the active schedule', async () => {
  let now = 8_000;
  let resolveExecution;
  const executor = {
    executeUnlock: async () => {
      await new Promise((resolve) => { resolveExecution = resolve; });
      return { outcome: 'success' };
    },
  };
  const scheduler = createTestScheduler({ executor, now: () => now });
  const original = makeSchedule(now, [{ id: 'A', originalIndex: 0, globalPercent: 100 }]);
  await scheduler.setSchedule(original);
  await scheduler.start();
  const execution = scheduler.processDue();
  await waitFor(() => typeof resolveExecution === 'function');
  await assert.rejects(
    () => scheduler.setSchedule(makeSchedule(now, [{ id: 'B', originalIndex: 0, globalPercent: 100 }], { appId: 481 })),
    SchedulerBusyError,
  );
  resolveExecution();
  await execution;
  assert.equal(scheduler.getSchedule().appId, 480);
});

test('cross-game service policy rejects replacement by default while same-game and explicit replacement remain allowed', () => {
  const current = { appId: 480, id: 'game-a' };
  assert.throws(
    () => assertScheduleReplacementAllowed(current, 481),
    (error) => error.code === 'CROSS_GAME_SCHEDULE_EXISTS',
  );
  assert.equal(assertScheduleReplacementAllowed(current, 480), true);
  assert.equal(assertScheduleReplacementAllowed(current, 481, { replace: true }), true);
  assert.equal(assertScheduleReplacementAllowed(null, 481), true);
});


test('recovery confirmation delay continues verification before any controlled retry', async () => {
  let now = 900;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['unverified', 'verified'] } });
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });
  await scheduler.load({
    version: 2,
    id: 'interrupted-retry',
    appId: 480,
    state: SCHEDULE_STATE.RUNNING,
    items: [{ id: 'A', status: ITEM_STATUS.EXECUTING, attempts: 1, maxRetries: 2, executionToken: 'old-token', scheduledAt: now }],
  });

  await scheduler.start();
  await scheduler.processDue();
  let current = scheduler.getSchedule();
  assert.equal(current.state, SCHEDULE_STATE.RUNNING);
  assert.equal(current.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(current.items[0].verificationMeta.confirmedNotUnlockedCount, 1);
  assert.equal(executor.getCalls().length, 0);

  now = current.items[0].verificationMeta.nextVerificationAt;
  await scheduler.processDue();
  current = scheduler.getSchedule();
  assert.equal(current.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(current.items[0].attempts, 1);
  assert.equal(executor.getCalls().length, 0);
});

test('recovery uncertainty continues verification and never calls the executor', async () => {
  let now = 1_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const scheduler = createTestScheduler({
    executor,
    verifier: createMockVerifier({ outcomes: { A: ['uncertain'] } }),
    now: () => now,
  });
  await scheduler.load({
    version: 2,
    id: 'interrupted-uncertain',
    appId: 480,
    state: SCHEDULE_STATE.RUNNING,
    items: [{ id: 'A', status: ITEM_STATUS.EXECUTING, attempts: 1, maxRetries: 2, executionToken: 'old-token', scheduledAt: now }],
  });

  await scheduler.start();
  await scheduler.processDue();
  const current = scheduler.getSchedule();
  assert.equal(current.state, SCHEDULE_STATE.RUNNING);
  assert.equal(current.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(current.items[0].verification, VERIFICATION.UNCERTAIN);
  assert.equal(current.items[0].verificationMeta.exhausted, false);
  assert.equal(executor.getCalls().length, 0);
});

test('executor receives an immutable App-ID-aware execution context', async () => {
  let now = 1_500;
  let receivedContext;
  const executor = {
    async executeUnlock(context) {
      receivedContext = context;
      assert.equal(Object.isFrozen(context), true);
      assert.equal(Object.getOwnPropertyDescriptor(context, 'appId').writable, false);
      return { outcome: 'success' };
    },
  };
  const scheduler = createTestScheduler({ executor, now: () => now });
  await scheduler.setSchedule(makeSchedule(now, [{ id: 'A', originalIndex: 0, globalPercent: 100 }], { appId: 480 }));
  await scheduler.start();
  await scheduler.processDue();

  assert.deepEqual(receivedContext, {
    appId: 480,
    achievementId: 'A',
    scheduleId: receivedContext.scheduleId,
    itemId: 'A',
    sequencePosition: 1,
    executionToken: receivedContext.executionToken,
  });
  assert.match(receivedContext.executionToken, /^humanized-480-/);
});

test('executor context mismatch is rejected before execution', async () => {
  let now = 1_700;
  let executeCalls = 0;
  const executor = {
    async validateContext(context) {
      return { valid: context.appId === 999, error: 'Active App ID does not match the persisted schedule.' };
    },
    async executeUnlock() {
      executeCalls += 1;
      return { outcome: 'success' };
    },
  };
  const scheduler = createTestScheduler({ executor, now: () => now });
  await scheduler.setSchedule(makeSchedule(now, [{ id: 'A', originalIndex: 0, globalPercent: 100 }], { appId: 480 }));
  await scheduler.start();
  await scheduler.processDue();

  const current = scheduler.getSchedule();
  assert.equal(executeCalls, 0);
  assert.equal(current.items[0].status, ITEM_STATUS.FAILED);
  assert.match(current.items[0].lastError, /Active App ID/);
});

test('operation coordinator prevents cross-mode duplicates and releases terminal leases', () => {
  const coordinator = createOperationCoordinator();
  const humanized = { appId: 480, achievementId: 'A', mode: 'humanized', ownerId: 'humanized:one', state: 'scheduled' };
  const instant = { appId: 480, achievementId: 'A', mode: 'instant', ownerId: 'instant:one', state: 'running' };

  coordinator.claim(humanized);
  assert.throws(() => coordinator.claim(instant), OperationLeaseConflictError);
  coordinator.releaseOwner(humanized.ownerId);
  coordinator.claim(instant);
  assert.throws(() => coordinator.claim(humanized), OperationLeaseConflictError);
  assert.equal(coordinator.getLease(480, 'A').mode, 'instant');

  coordinator.release(480, 'A', instant.ownerId);
  assert.equal(coordinator.getLease(480, 'A'), null);
  coordinator.claim(humanized);
  coordinator.resetForRestart();
  assert.deepEqual(coordinator.snapshot(), []);
});

test('operation coordinator atomically rejects a queue containing a Humanized-owned achievement', () => {
  const coordinator = createOperationCoordinator();
  coordinator.claim({ appId: 480, achievementId: 'A', mode: 'humanized', ownerId: 'humanized:one', state: 'paused' });
  assert.throws(() => coordinator.claimMany([
    { appId: 480, achievementId: 'B', mode: 'instant', ownerId: 'instant:one', state: 'running' },
    { appId: 480, achievementId: 'A', mode: 'instant', ownerId: 'instant:one', state: 'running' },
  ]), OperationLeaseConflictError);
  assert.equal(coordinator.getLease(480, 'B'), null);
  assert.equal(coordinator.getLease(480, 'A').mode, 'humanized');
});


test('recovery verifier failure remains paused and never authorizes a duplicate execution', async () => {
  let now = 1_200;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const scheduler = createTestScheduler({
    executor,
    verifier: createMockVerifier({ outcomes: { A: ['failed'] } }),
    now: () => now,
  });
  await scheduler.load({
    version: 2,
    id: 'interrupted-verifier-failure',
    appId: 480,
    state: SCHEDULE_STATE.RUNNING,
    items: [{ id: 'A', status: ITEM_STATUS.EXECUTING, attempts: 1, maxRetries: 2, executionToken: 'old-token', scheduledAt: now }],
  });

  await scheduler.start();
  await scheduler.processDue();
  const current = scheduler.getSchedule();
  assert.equal(current.state, SCHEDULE_STATE.PAUSED);
  assert.equal(current.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(current.items[0].verification, VERIFICATION.UNCERTAIN);
  assert.equal(current.items[0].recoveryPending, true);
  assert.equal(executor.getCalls().length, 0);
});


test('post-activation visibility delay automatically rechecks and completes without a duplicate executor call', async () => {
  let now = 10_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['unverified', 'verified'] } });
  const scheduler = createTestScheduler({
    executor,
    verifier,
    now: () => now,
    verificationPolicy: { backoffMs: [0, 50], horizonMs: 500 },
  });
  await scheduler.setSchedule(makeSchedule(now));
  await scheduler.start();
  await scheduler.processDue();

  let current = scheduler.getSchedule();
  assert.equal(current.state, SCHEDULE_STATE.RUNNING);
  assert.equal(current.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(current.items[0].verificationMeta.confirmedNotUnlockedCount, 1);
  assert.equal(executor.getCalls().length, 1);

  now = current.items[0].verificationMeta.nextVerificationAt;
  await scheduler.processDue();
  current = scheduler.getSchedule();
  assert.equal(current.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(executor.getCalls().length, 1);
  assert.equal(verifier.getCalls().length, 2);
});

test('persisted verification job resumes automatically after restart at its persisted due time', async () => {
  let now = 20_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['verified'] } });
  const scheduler = createTestScheduler({
    executor,
    verifier,
    now: () => now,
    verificationPolicy: { backoffMs: [0, 50], horizonMs: 500 },
  });
  await scheduler.load({
    version: 2,
    id: 'persisted-verification',
    appId: 480,
    state: SCHEDULE_STATE.RUNNING,
    items: [{
      id: 'A', sequencePosition: 1, status: ITEM_STATUS.VERIFICATION_REQUIRED,
      attempts: 1, maxRetries: 2, scheduledAt: 0, executionToken: null,
      verification: VERIFICATION.UNCERTAIN,
      verificationMeta: {
        attemptCount: 2, confirmedNotUnlockedCount: 0, firstVerificationAt: 19_000,
        lastVerificationAt: 19_500, nextVerificationAt: 20_000, horizonAt: 25_000,
        reasonCode: 'TIMEOUT', exhausted: false, autoContinue: true,
      },
      executionContext: { appId: 480, achievementId: 'A', scheduleId: 'persisted-verification', itemId: 'A', sequencePosition: 1, executionToken: 'prior' },
    }],
  });

  assert.equal(scheduler.getSchedule().state, SCHEDULE_STATE.RUNNING);
  await scheduler.processDue();
  assert.equal(scheduler.getSchedule().items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(executor.getCalls().length, 0);
  assert.equal(verifier.getCalls().length, 1);
});

test('manual recheck invokes verification only after a bounded verification horizon is exhausted', async () => {
  let now = 30_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['verified'] } });
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });
  await scheduler.setSchedule({
    version: 2,
    id: 'manual-recheck',
    appId: 480,
    state: SCHEDULE_STATE.PAUSED,
    items: [{
      id: 'A', sequencePosition: 1, status: ITEM_STATUS.VERIFICATION_REQUIRED,
      attempts: 1, maxRetries: 2, scheduledAt: 0, executionToken: null,
      verification: VERIFICATION.UNCERTAIN,
      verificationMeta: {
        attemptCount: 8, confirmedNotUnlockedCount: 0, firstVerificationAt: 1,
        lastVerificationAt: 2, nextVerificationAt: null, horizonAt: 3,
        reasonCode: 'TIMEOUT', exhausted: true, autoContinue: false,
      },
      executionContext: { appId: 480, achievementId: 'A', scheduleId: 'manual-recheck', itemId: 'A', sequencePosition: 1, executionToken: 'prior' },
    }],
  });

  await scheduler.recheckNow();
  assert.equal(scheduler.getSchedule().items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(executor.getCalls().length, 0);
  assert.equal(verifier.getCalls().length, 1);
});

test('only repeated confirmed non-completion through the verification horizon permits a controlled retry', async () => {
  let now = 40_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['unverified', 'unverified'] } });
  const scheduler = createTestScheduler({
    executor,
    verifier,
    now: () => now,
    verificationPolicy: { backoffMs: [0, 25], horizonMs: 20 },
  });
  await scheduler.setSchedule(makeSchedule(now));
  await scheduler.start();
  await scheduler.processDue();
  let current = scheduler.getSchedule();
  assert.equal(current.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(executor.getCalls().length, 1);

  now = current.items[0].verificationMeta.nextVerificationAt;
  await scheduler.processDue();
  current = scheduler.getSchedule();
  assert.equal(current.state, SCHEDULE_STATE.PAUSED);
  assert.equal(current.items[0].status, ITEM_STATUS.RETRY);
  assert.equal(current.items[0].verificationMeta.confirmedNotUnlockedCount, 2);
  assert.equal(executor.getCalls().length, 1);
});

test('concurrent manual rechecks do not create concurrent verifier or executor calls', async () => {
  let now = 90_000;
  let resolveVerification;
  let verifierCalls = 0;
  const verificationGate = new Promise((resolve) => { resolveVerification = resolve; });
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = {
    async verify() {
      verifierCalls += 1;
      await verificationGate;
      return { verification: VERIFICATION.VERIFIED };
    },
  };
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });
  const schedule = makeSchedule(now);
  const item = schedule.items[0];
  item.status = ITEM_STATUS.VERIFICATION_REQUIRED;
  item.verification = VERIFICATION.PENDING;
  item.verificationMeta = {
    attemptCount: 0,
    confirmedNotUnlockedCount: 0,
    firstVerificationAt: now,
    lastVerificationAt: null,
    nextVerificationAt: now,
    horizonAt: now + 60_000,
    reasonCode: 'POST_ACTIVATION_CONFIRMATION',
    exhausted: false,
    autoContinue: true,
  };
  schedule.state = SCHEDULE_STATE.RUNNING;
  await scheduler.setSchedule(schedule);

  const firstRecheck = scheduler.recheckNow();
  await waitFor(() => scheduler.isProcessing());
  await assert.rejects(() => scheduler.recheckNow(), SchedulerBusyError);
  assert.equal(verifierCalls, 1);
  assert.equal(executor.getCalls().length, 0);

  resolveVerification();
  await firstRecheck;
  assert.equal(scheduler.getSchedule().items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(verifierCalls, 1);
  assert.equal(executor.getCalls().length, 0);
});
