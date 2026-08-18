const test = require('node:test');
const assert = require('node:assert/strict');

const { ORDER_MODES, normalizeAchievements, orderAchievements } = require('../electron/humanized/ordering');
const { createScheduleTimeline } = require('../electron/humanized/timeline');
const {
  ITEM_STATUS,
  SCHEDULE_STATE,
  createSchedule,
  createScheduler,
  recoverSchedule,
} = require('../electron/humanized/schedulerEngine');
const { createMockExecutionAdapter } = require('../electron/humanized/mockExecutionAdapter');

const achievements = [
  { id: 'ENDING', name: 'Ending', originalIndex: 2, globalPercent: 4 },
  { id: 'INTRO', name: 'Intro', originalIndex: 0, globalPercent: 98 },
  { id: 'BOSS', name: 'Boss', originalIndex: 1, globalPercent: 40, hidden: true },
  { id: 'UNKNOWN', name: 'Unknown', originalIndex: 3, globalPercent: undefined },
];

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

test('mock executor retries once, persists each state transition, and then verifies completion', async () => {
  let now = 1_700_000_000_000;
  const persisted = [];
  const executor = createMockExecutionAdapter({ outcomes: { INTRO: ['retry', 'success'] } });
  const scheduler = createScheduler({
    executor,
    now: () => now,
    persist: (schedule) => persisted.push(schedule),
  });
  const schedule = createSchedule({
    appId: 480,
    achievements: [{ id: 'INTRO', originalIndex: 0, globalPercent: 100 }],
    seed: 'retry-test',
    startAt: now,
  });

  scheduler.setSchedule(schedule);
  scheduler.start();
  await scheduler.processDue();

  let current = scheduler.getSchedule();
  assert.equal(current.items[0].status, ITEM_STATUS.RETRY);
  assert.equal(current.items[0].attempts, 1);
  assert.equal(current.items[0].verification, 'unverified');
  assert.ok(current.items[0].nextAttemptAt > now);

  now = current.items[0].nextAttemptAt;
  await scheduler.processDue();
  current = scheduler.getSchedule();

  assert.equal(current.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(current.items[0].verification, 'verified');
  assert.equal(current.state, SCHEDULE_STATE.COMPLETED);
  assert.equal(executor.getCalls().length, 2);
  assert.ok(persisted.length >= 5);
});

test('recovery pauses a previously running schedule and makes an interrupted item safe to retry', () => {
  const persisted = {
    version: 1,
    id: 'interrupted',
    appId: 480,
    state: SCHEDULE_STATE.RUNNING,
    items: [{
      id: 'A', status: ITEM_STATUS.EXECUTING, attempts: 0, maxRetries: 2,
      executionToken: 'previous-token', verification: 'unverified', scheduledAt: 10,
    }],
  };

  const recovered = recoverSchedule(persisted, 500);
  assert.equal(recovered.state, SCHEDULE_STATE.PAUSED);
  assert.equal(recovered.items[0].status, ITEM_STATUS.RETRY);
  assert.equal(recovered.items[0].verification, 'uncertain');
  assert.equal(recovered.items[0].attempts, 1);
  assert.equal(recovered.items[0].nextAttemptAt, 500);
  assert.equal(recovered.items[0].executionToken, null);
});

test('duplicate process calls do not execute the same item concurrently', async () => {
  let now = 5_000;
  let resolveExecution;
  let calls = 0;
  const executor = {
    executeUnlock: async () => {
      calls += 1;
      await new Promise((resolve) => { resolveExecution = resolve; });
      return { outcome: 'success', verification: 'verified' };
    },
  };
  const scheduler = createScheduler({ executor, now: () => now });
  scheduler.setSchedule(createSchedule({
    appId: 480,
    achievements: [{ id: 'A', originalIndex: 0, globalPercent: 100 }],
    seed: 'concurrency',
    startAt: now,
  }));
  scheduler.start();

  const first = scheduler.processDue();
  const second = scheduler.processDue();
  assert.equal(calls, 1);
  resolveExecution();
  await Promise.all([first, second]);
  assert.equal(scheduler.getSchedule().items[0].status, ITEM_STATUS.COMPLETED);
});

test('non-retryable mock failure completes the schedule in a failed state', async () => {
  let now = 100;
  const scheduler = createScheduler({
    executor: createMockExecutionAdapter({ outcomes: { A: ['failed'] } }),
    now: () => now,
  });
  scheduler.setSchedule(createSchedule({
    appId: 480,
    achievements: [{ id: 'A', originalIndex: 0, globalPercent: 50 }],
    startAt: now,
  }));
  scheduler.start();
  await scheduler.processDue();

  const schedule = scheduler.getSchedule();
  assert.equal(schedule.items[0].status, ITEM_STATUS.FAILED);
  assert.equal(schedule.state, SCHEDULE_STATE.FAILED);
});
