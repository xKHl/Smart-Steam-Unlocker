const assert = require('node:assert/strict');
const test = require('node:test');
const { ITEM_STATUS, SCHEDULE_STATE, createSchedule, createScheduler } = require('../electron/humanized/schedulerEngine');
const { validateSchedule, ScheduleValidationError } = require('../electron/humanized/scheduleValidation');
const { createScheduleTimeline } = require('../electron/humanized/timeline');
const { createMockExecutionAdapter } = require('../electron/humanized/mockExecutionAdapter');
const { createMockVerifier } = require('../electron/humanized/mockVerifier');

function validSchedule() {
  return createSchedule({
    appId: 480,
    achievements: [{ id: 'A', name: 'A', originalIndex: 0, globalPercent: 50 }],
    seed: 'integrity',
    startAt: 1_000,
  });
}

test('timeline rejects invalid start time, interval bounds, retry policy, and achievement input', () => {
  const achievements = [{ id: 'A', globalPercent: 50 }];
  assert.throws(() => createScheduleTimeline(achievements, { startAt: -1 }), /start time/);
  assert.throws(() => createScheduleTimeline(achievements, { startAt: 1, minIntervalMs: 2_000, maxIntervalMs: 1_000 }), /cannot exceed/);
  assert.throws(() => createScheduleTimeline(achievements, { startAt: 1, minIntervalMs: 0 }), /minimum interval/);
  assert.throws(() => createScheduleTimeline(achievements, { startAt: 1, maxRetries: 11 }), /retry policy/);
  assert.throws(() => createScheduleTimeline(null, { startAt: 1 }), /must be an array/);
});

test('schedule validation accepts current schema and rejects unsupported, malformed, duplicate, and invalid-state persistence', () => {
  const schedule = validSchedule();
  assert.equal(validateSchedule(schedule), schedule);

  assert.throws(() => validateSchedule({ ...schedule, version: 1 }), (error) => error instanceof ScheduleValidationError && error.code === 'UNSUPPORTED_SCHEDULE_VERSION');
  assert.throws(() => validateSchedule({ ...schedule, appId: 0 }), /App ID/);
  assert.throws(() => validateSchedule({ ...schedule, state: 'unknown' }), /state/);
  assert.throws(() => validateSchedule({ ...schedule, items: [{ ...schedule.items[0], status: 'unknown' }] }), /invalid state/);
  assert.throws(() => validateSchedule({ ...schedule, items: [schedule.items[0], { ...schedule.items[0], sequencePosition: 2 }] }), /duplicate/);
  assert.throws(() => validateSchedule({ ...schedule, items: [{ ...schedule.items[0], verificationMeta: { attemptCount: -1 } }] }), /non-negative/);
});

test('scheduler persists a bounded redacted diagnostic trail without plaintext credential fields', async () => {
  let now = 5_000;
  const scheduler = createScheduler({
    executor: createMockExecutionAdapter({ outcomes: { A: ['success'] } }),
    verifier: createMockVerifier({ outcomes: { A: ['verified'] } }),
    now: () => now,
    persist: () => true,
  });
  await scheduler.setSchedule(validSchedule());
  await scheduler.start();
  await scheduler.processDue();

  const schedule = scheduler.getSchedule();
  assert.equal(schedule.state, SCHEDULE_STATE.COMPLETED);
  assert.ok(Array.isArray(schedule.diagnostics));
  assert.equal(schedule.diagnostics.length, 3);
  assert.deepEqual(schedule.diagnostics.map((record) => [record.phase, record.result]), [
    ['execution', 'started'],
    ['execution', 'success'],
    ['verification', 'verified'],
  ]);
  schedule.diagnostics.forEach((record) => {
    assert.equal(record.appId, 480);
    assert.equal(record.achievementId, 'A');
    assert.equal('apiKey' in record, false);
    assert.equal('credential' in record, false);
  });
  assert.equal(schedule.items[0].status, ITEM_STATUS.COMPLETED);
});
