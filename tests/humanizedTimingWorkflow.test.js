const assert = require('node:assert/strict');
const test = require('node:test');

const { ITEM_STATUS, SCHEDULE_STATE, createSchedule, createScheduler } = require('../electron/humanized/schedulerEngine');
const { createMockExecutionAdapter } = require('../electron/humanized/mockExecutionAdapter');
const { createMockVerifier } = require('../electron/humanized/mockVerifier');

const achievements = [
  { id: 'A', name: 'Alpha', originalIndex: 0, globalPercent: 80 },
  { id: 'B', name: 'Beta', originalIndex: 1, globalPercent: 20 },
  { id: 'C', name: 'Gamma', originalIndex: 2, globalPercent: 55 },
];

function configuredSchedule(startAt = 1_000) {
  return createSchedule({
    appId: 480,
    achievements,
    seed: 'timing-regression',
    startAt,
    timingPreset: 'natural',
    timelineOptions: {
      initialDelayMs: 120_000,
      baseIntervalMs: 600_000,
      varianceMs: 120_000,
      minIntervalMs: 480_000,
      maxIntervalMs: 720_000,
    },
  });
}

test('configured initial delay and timing metadata are generated once and persisted with the queue', () => {
  const schedule = configuredSchedule();
  assert.deepEqual(schedule.timing, {
    initialDelayMs: 120_000,
    baseIntervalMs: 600_000,
    varianceMs: 120_000,
    minIntervalMs: 480_000,
    maxIntervalMs: 720_000,
    maxRetries: 2,
    preset: 'natural',
  });
  assert.equal(schedule.items[0].delayMs, 120_000);
  assert.equal(schedule.items[0].scheduledAt, 121_000);
  assert.equal(schedule.items[1].scheduledAt, schedule.items[0].scheduledAt + schedule.items[1].delayMs);
  assert.equal(schedule.items[2].scheduledAt, schedule.items[1].scheduledAt + schedule.items[2].delayMs);
});

test('seeded configured intervals are deterministic, bounded, and naturally varied', () => {
  const first = configuredSchedule();
  const second = configuredSchedule();
  assert.deepEqual(first.id, second.id);
  assert.deepEqual(first.items, second.items);

  const intervals = first.items.slice(1).map((item) => item.delayMs);
  intervals.forEach((interval) => assert.ok(interval >= 480_000 && interval <= 720_000));
  assert.notEqual(intervals[0], intervals[1]);
});

test('a pending verification does not block the next due scheduled achievement or duplicate the submitted unlock', async () => {
  let now = 10_000;
  const executor = createMockExecutionAdapter({ outcomes: { A: ['success'], B: ['success'] } });
  const verifier = createMockVerifier({ outcomes: { A: ['unverified'], B: ['verified'] } });
  const scheduler = createScheduler({ executor, verifier, now: () => now });
  const schedule = createSchedule({
    appId: 480,
    achievements: achievements.slice(0, 2),
    seed: 'background-verification',
    startAt: now,
    timelineOptions: { initialDelayMs: 0, baseIntervalMs: 60_000, varianceMs: 0, minIntervalMs: 60_000, maxIntervalMs: 60_000 },
  });
  schedule.items[1].scheduledAt = now;
  await scheduler.setSchedule(schedule);
  await scheduler.start();

  await scheduler.processDue();
  assert.equal(scheduler.getSchedule().items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(scheduler.getSchedule().items[0].verificationMeta.autoContinue, true);
  assert.deepEqual(executor.getCalls().map((call) => call.achievementId), ['A']);

  await scheduler.processDue();
  const afterSecondExecution = scheduler.getSchedule();
  assert.deepEqual(executor.getCalls().map((call) => call.achievementId), ['A', 'B']);
  assert.equal(afterSecondExecution.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(afterSecondExecution.items[1].status, ITEM_STATUS.COMPLETED);
  assert.equal(afterSecondExecution.state, SCHEDULE_STATE.RUNNING);
  assert.equal(executor.getCalls().filter((call) => call.achievementId === 'A').length, 1);
});
