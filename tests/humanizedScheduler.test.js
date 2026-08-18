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

function createTestScheduler({ executor, verifier, persist, now }) {
  return createScheduler({
    executor: executor ?? createMockExecutionAdapter(),
    verifier: verifier ?? createMockVerifier(),
    persist: persist ?? (() => true),
    now: now ?? (() => 0),
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
  const easiest = orderAchievements(achievements, ORDER_MODES.EASIEST_TO_HARDEST);
  const rarest = orderAchievements(achievements, ORDER_MODES.RAREST_TO_MOST_COMMON);
  const original = orderAchievements([...achievements].reverse(), ORDER_MODES.ORIGINAL);

  assert.deepEqual(easiest.map((item) => item.id), ['INTRO', 'BOSS', 'ENDING', 'UNKNOWN']);
  assert.deepEqual(rarest.map((item) => item.id), ['ENDING', 'BOSS', 'INTRO', 'UNKNOWN']);
  assert.deepEqual(original.map((item) => item.id), ['INTRO', 'BOSS', 'ENDING', 'UNKNOWN']);
  assert.deepEqual(orderAchievements(achievements, ORDER_MODES.EASIEST_TO_HARDEST), easiest);
});

test('timeline generation is reproducible and always chronologically bounded', () => {
  const ordered = orderAchievements(achievements, ORDER_MODES.EASIEST_TO_HARDEST);
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

test('unverified verification pauses the schedule in verification-required state without re-executing', async () => {
  let now = 3_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['unverified'] } });
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });
  await scheduler.setSchedule(makeSchedule(now));
  await scheduler.start();
  await scheduler.processDue();

  const paused = scheduler.getSchedule();
  assert.equal(paused.state, SCHEDULE_STATE.PAUSED);
  assert.equal(paused.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(paused.items[0].verification, VERIFICATION.UNVERIFIED);
  await scheduler.processDue();
  assert.equal(executor.getCalls().length, 1);
});

test('uncertain verification pauses safely and verification failure follows retry policy', async () => {
  let now = 4_000;
  const uncertainScheduler = createTestScheduler({
    executor: createMockExecutionAdapter({ outcomes: { A: ['success'] } }),
    verifier: createMockVerifier({ outcomes: { A: ['uncertain'] } }),
    now: () => now,
  });
  await uncertainScheduler.setSchedule(makeSchedule(now));
  await uncertainScheduler.start();
  await uncertainScheduler.processDue();
  assert.equal(uncertainScheduler.getSchedule().state, SCHEDULE_STATE.PAUSED);
  assert.equal(uncertainScheduler.getSchedule().items[0].verification, VERIFICATION.UNCERTAIN);

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
  let current = failureScheduler.getSchedule();
  assert.equal(current.items[0].status, ITEM_STATUS.RETRY);
  now = current.items[0].nextAttemptAt;
  await failureScheduler.processDue();
  current = failureScheduler.getSchedule();
  assert.equal(current.items[0].status, ITEM_STATUS.FAILED);
  assert.equal(current.state, SCHEDULE_STATE.FAILED);
});

test('interrupted execution recovers without consuming an extra retry attempt', () => {
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

  const recovered = recoverSchedule(persisted, 500);
  assert.equal(recovered.state, SCHEDULE_STATE.PAUSED);
  assert.equal(recovered.items[0].status, ITEM_STATUS.RETRY);
  assert.equal(recovered.items[0].verification, VERIFICATION.UNCERTAIN);
  assert.equal(recovered.items[0].attempts, 1);
  assert.equal(recovered.items[0].nextAttemptAt, 500);
  assert.equal(recovered.items[0].executionToken, null);
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
