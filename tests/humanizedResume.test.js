'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ITEM_STATUS,
  SCHEDULE_STATE,
  VERIFICATION,
  createSchedule,
  createScheduler,
  rebaseScheduledTimeline,
  recoverSchedule,
} = require('../electron/humanized/schedulerEngine');
const { createMockExecutionAdapter } = require('../electron/humanized/mockExecutionAdapter');
const { createMockVerifier } = require('../electron/humanized/mockVerifier');

// ── Helpers ──────────────────────────────────────────────────────────────

const achievements10 = Array.from({ length: 10 }, (_, i) => ({
  id: `ACH_${i + 1}`,
  name: `Achievement ${i + 1}`,
  originalIndex: i,
  globalPercent: 100 - i * 10,
}));

function makeSchedule(now, list = achievements10, opts = {}) {
  return createSchedule({
    appId: opts.appId ?? 480,
    achievements: list,
    seed: opts.seed ?? 'resume-test',
    startAt: now,
    timelineOptions: opts.timelineOptions ?? { baseIntervalMs: 60_000, varianceMs: 0, minIntervalMs: 60_000, maxIntervalMs: 60_000 },
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

// ── rebaseScheduledTimeline unit tests ───────────────────────────────────

test('rebaseScheduledTimeline shifts elapsed scheduled items forward from baseTime', () => {
  const items = [
    { id: 'A', sequencePosition: 1, scheduledAt: 1000, delayMs: 0, status: ITEM_STATUS.COMPLETED },
    { id: 'B', sequencePosition: 2, scheduledAt: 2000, delayMs: 1000, status: ITEM_STATUS.COMPLETED },
    { id: 'C', sequencePosition: 3, scheduledAt: 3000, delayMs: 1000, status: ITEM_STATUS.SCHEDULED },
    { id: 'D', sequencePosition: 4, scheduledAt: 4000, delayMs: 1000, status: ITEM_STATUS.SCHEDULED },
    { id: 'E', sequencePosition: 5, scheduledAt: 5000, delayMs: 1000, status: ITEM_STATUS.SCHEDULED },
  ];

  const rebased = rebaseScheduledTimeline(items, 10_000);

  // Completed items remain unchanged
  assert.equal(rebased[0].scheduledAt, 1000);
  assert.equal(rebased[1].scheduledAt, 2000);

  // First scheduled item rebased to baseTime
  assert.equal(rebased[2].scheduledAt, 10_000);
  // Subsequent items preserve their delayMs spacing
  assert.equal(rebased[3].scheduledAt, 11_000);
  assert.equal(rebased[4].scheduledAt, 12_000);
});

test('rebaseScheduledTimeline does not rebase items whose timestamps are still in the future', () => {
  const items = [
    { id: 'A', sequencePosition: 1, scheduledAt: 50_000, delayMs: 0, status: ITEM_STATUS.SCHEDULED },
    { id: 'B', sequencePosition: 2, scheduledAt: 60_000, delayMs: 10_000, status: ITEM_STATUS.SCHEDULED },
  ];

  const rebased = rebaseScheduledTimeline(items, 10_000);

  assert.equal(rebased[0].scheduledAt, 50_000);
  assert.equal(rebased[1].scheduledAt, 60_000);
});

test('rebaseScheduledTimeline preserves ordering by sequencePosition', () => {
  const items = [
    { id: 'Z', sequencePosition: 3, scheduledAt: 3000, delayMs: 1000, status: ITEM_STATUS.SCHEDULED },
    { id: 'A', sequencePosition: 1, scheduledAt: 1000, delayMs: 0, status: ITEM_STATUS.SCHEDULED },
    { id: 'M', sequencePosition: 2, scheduledAt: 2000, delayMs: 1000, status: ITEM_STATUS.SCHEDULED },
  ];

  const rebased = rebaseScheduledTimeline(items, 5000);

  // Items should be rebased in sequencePosition order
  const rebasedA = rebased.find((i) => i.id === 'A');
  const rebasedM = rebased.find((i) => i.id === 'M');
  const rebasedZ = rebased.find((i) => i.id === 'Z');
  assert.equal(rebasedA.scheduledAt, 5000); // first in sequence
  assert.equal(rebasedM.scheduledAt, 6000); // +1000 delayMs
  assert.equal(rebasedZ.scheduledAt, 7000); // +1000 delayMs
});

// ── recoverSchedule rebasing tests ───────────────────────────────────────

test('10-item schedule: first 5 completed, restart → resume at 6, no backlog burst', () => {
  const originalStart = 1_000_000;
  const schedule = makeSchedule(originalStart);

  // Mark items 1–5 as completed
  for (let i = 0; i < 5; i++) {
    schedule.items[i].status = ITEM_STATUS.COMPLETED;
    schedule.items[i].verification = VERIFICATION.VERIFIED;
    schedule.items[i].completedAt = originalStart + (i + 1) * 60_000;
  }

  // The app was closed; items 6–10 have elapsed timestamps
  schedule.state = SCHEDULE_STATE.RUNNING;

  // Restart happens at a time AFTER all original scheduled timestamps
  const restartTime = originalStart + 20 * 60_000;

  const recovered = recoverSchedule(schedule, restartTime);

  // 1–5 remain COMPLETED
  for (let i = 0; i < 5; i++) {
    assert.equal(recovered.items[i].status, ITEM_STATUS.COMPLETED, `Item ${i + 1} should stay completed`);
  }

  // Items 6–10 should have scheduledAt >= restartTime (rebased)
  for (let i = 5; i < 10; i++) {
    assert.ok(
      recovered.items[i].scheduledAt >= restartTime,
      `Item ${i + 1} scheduledAt (${recovered.items[i].scheduledAt}) should be >= restartTime (${restartTime})`
    );
    assert.equal(recovered.items[i].status, ITEM_STATUS.SCHEDULED, `Item ${i + 1} should stay scheduled`);
  }

  // Item 6 starts at restartTime, items 7–10 are spaced with their delayMs
  assert.equal(recovered.items[5].scheduledAt, restartTime);
  for (let i = 6; i < 10; i++) {
    assert.ok(recovered.items[i].scheduledAt > recovered.items[i - 1].scheduledAt,
      `Item ${i + 1} should be after item ${i}`);
  }
});

test('completed items are never re-executed after restart', async () => {
  const originalStart = 1_000_000;
  let now = originalStart + 20 * 60_000;
  const executionCalls = [];
  const executor = {
    async executeUnlock(ctx) {
      executionCalls.push(ctx.achievementId);
      return { outcome: 'success' };
    },
  };
  const verifier = createMockVerifier({ defaultVerification: 'verified' });
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });

  const schedule = makeSchedule(originalStart);
  // Mark items 1–5 as completed
  for (let i = 0; i < 5; i++) {
    schedule.items[i].status = ITEM_STATUS.COMPLETED;
    schedule.items[i].verification = VERIFICATION.VERIFIED;
    schedule.items[i].completedAt = originalStart + (i + 1) * 60_000;
  }
  schedule.state = SCHEDULE_STATE.PAUSED;

  await scheduler.setSchedule(schedule);
  await scheduler.start();

  // Process all due items — only item 6 should be due now
  await scheduler.processDue();

  // Only ACH_6 should have been executed (it's the next in sequence, at restartTime)
  assert.equal(executionCalls.length, 1);
  assert.equal(executionCalls[0], 'ACH_6');
});

test('remaining timeline spacing is preserved from original delayMs after restart', () => {
  const originalStart = 1_000_000;
  const schedule = makeSchedule(originalStart);

  // Mark items 1–5 as completed
  for (let i = 0; i < 5; i++) {
    schedule.items[i].status = ITEM_STATUS.COMPLETED;
    schedule.items[i].verification = VERIFICATION.VERIFIED;
  }
  schedule.state = SCHEDULE_STATE.RUNNING;

  const restartTime = originalStart + 20 * 60_000;
  const recovered = recoverSchedule(schedule, restartTime);

  // Items 6–10 should preserve inter-item spacing from delayMs
  for (let i = 6; i < 10; i++) {
    const gap = recovered.items[i].scheduledAt - recovered.items[i - 1].scheduledAt;
    const expectedDelay = recovered.items[i].delayMs;
    assert.equal(gap, expectedDelay, `Gap between items ${i} and ${i + 1} should match delayMs`);
  }
});

test('ordering is preserved after rebase — sequencePosition unchanged', () => {
  const originalStart = 1_000_000;
  const schedule = makeSchedule(originalStart);

  for (let i = 0; i < 5; i++) {
    schedule.items[i].status = ITEM_STATUS.COMPLETED;
    schedule.items[i].verification = VERIFICATION.VERIFIED;
  }
  schedule.state = SCHEDULE_STATE.RUNNING;

  const restartTime = originalStart + 20 * 60_000;
  const recovered = recoverSchedule(schedule, restartTime);

  // sequencePosition should be unchanged
  for (let i = 0; i < 10; i++) {
    assert.equal(recovered.items[i].sequencePosition, i + 1);
    assert.equal(recovered.items[i].id, `ACH_${i + 1}`);
  }
});

test('resume from paused with elapsed timestamps does not execute in a burst', async () => {
  const originalStart = 1_000_000;
  let now = originalStart + 30 * 60_000; // 30 mins after start, all timestamps elapsed
  const executionCalls = [];
  const executor = {
    async executeUnlock(ctx) {
      executionCalls.push(ctx.achievementId);
      return { outcome: 'success' };
    },
  };
  const verifier = createMockVerifier({ defaultVerification: 'verified' });
  const scheduler = createTestScheduler({ executor, verifier, now: () => now });

  const schedule = makeSchedule(originalStart);
  schedule.state = SCHEDULE_STATE.PAUSED;

  await scheduler.setSchedule(schedule);
  await scheduler.start();

  // First processDue should only execute item 1 (the first in sequence)
  await scheduler.processDue();
  assert.equal(executionCalls.length, 1);
  assert.equal(executionCalls[0], 'ACH_1');

  // Item 2 should NOT be due yet because start() rebased the timeline
  const status = scheduler.getSchedule();
  const item2 = status.items.find((i) => i.id === 'ACH_2');
  assert.ok(item2.scheduledAt > now, `Item 2 scheduledAt (${item2.scheduledAt}) should be > now (${now})`);
});

test('start() rebases elapsed scheduled items without regenerating completed items', async () => {
  let now = 50_000;
  const scheduler = createTestScheduler({ now: () => now });

  const schedule = makeSchedule(1_000);
  schedule.items[0].status = ITEM_STATUS.COMPLETED;
  schedule.items[0].verification = VERIFICATION.VERIFIED;
  schedule.items[0].completedAt = 2_000;
  schedule.state = SCHEDULE_STATE.PAUSED;

  await scheduler.setSchedule(schedule);
  await scheduler.start();

  const started = scheduler.getSchedule();
  assert.equal(started.state, SCHEDULE_STATE.RUNNING);
  assert.equal(started.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(started.items[0].completedAt, 2_000); // Not changed

  // Item 2 should be rebased to >= now
  assert.ok(started.items[1].scheduledAt >= now);
});
