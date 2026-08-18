const test = require('node:test');
const assert = require('node:assert/strict');

const { ORDER_MODES, orderAchievements } = require('../electron/humanized/ordering');
const { createSchedule } = require('../electron/humanized/schedulerEngine');

const sourceAchievements = [
  { id: 'MID_A', name: 'Mid A', originalIndex: 0, globalPercent: 50 },
  { id: 'COMMON', name: 'Common', originalIndex: 1, globalPercent: 100 },
  { id: 'RARE', name: 'Rare', originalIndex: 2, globalPercent: 0 },
  { id: 'MISSING', name: 'Missing', originalIndex: 3 },
  { id: 'MID_B', name: 'Mid B', originalIndex: 4, globalPercent: '50' },
  { id: 'MID_A', name: 'Duplicate', originalIndex: 5, globalPercent: 1 },
  { id: '', name: 'Empty ID', originalIndex: 6, globalPercent: 80 },
];

function ids(mode) {
  return orderAchievements(sourceAchievements, mode).map((achievement) => achievement.id);
}

test('canonical Humanized display ordering covers original, common, rare, missing, equal, duplicate, and empty-ID cases deterministically', () => {
  const originalSnapshot = structuredClone(sourceAchievements);

  assert.deepEqual(ids(ORDER_MODES.ORIGINAL), ['MID_A', 'COMMON', 'RARE', 'MISSING', 'MID_B']);
  assert.deepEqual(ids(ORDER_MODES.EASIEST_TO_HARDEST), ['COMMON', 'MID_A', 'MID_B', 'RARE', 'MISSING']);
  assert.deepEqual(ids(ORDER_MODES.MOST_COMMON_TO_RAREST), ['COMMON', 'MID_A', 'MID_B', 'RARE', 'MISSING']);
  assert.deepEqual(ids(ORDER_MODES.RAREST_TO_MOST_COMMON), ['RARE', 'MID_A', 'MID_B', 'COMMON', 'MISSING']);
  assert.deepEqual(orderAchievements([], ORDER_MODES.RAREST_TO_MOST_COMMON), []);
  assert.deepEqual(sourceAchievements, originalSnapshot);
});

test('changing display order leaves an already-created Humanized schedule unchanged', () => {
  const schedule = createSchedule({
    appId: 480,
    achievements: sourceAchievements,
    orderMode: ORDER_MODES.ORIGINAL,
    seed: 'display-regression',
    startAt: 10_000,
  });
  const before = structuredClone(schedule);

  const humanizedDisplay = orderAchievements(sourceAchievements, ORDER_MODES.RAREST_TO_MOST_COMMON);
  assert.deepEqual(humanizedDisplay.map((achievement) => achievement.id), ['RARE', 'MID_A', 'MID_B', 'COMMON', 'MISSING']);
  assert.deepEqual(schedule, before);
  assert.deepEqual(schedule.items.map((item) => item.id), ['MID_A', 'COMMON', 'RARE', 'MISSING', 'MID_B']);
});

test('canonical ordering preserves stable identity for large display lists', () => {
  const large = Array.from({ length: 1_000 }, (_, originalIndex) => ({
    id: `ACH_${originalIndex}`,
    originalIndex,
    globalPercent: originalIndex % 101,
  }));
  const ordered = orderAchievements(large, ORDER_MODES.RAREST_TO_MOST_COMMON);

  assert.equal(ordered.length, 1_000);
  assert.equal(ordered[0].globalPercent, 0);
  assert.equal(ordered.at(-1).globalPercent, 100);
  assert.equal(new Set(ordered.map((achievement) => achievement.id)).size, 1_000);
});
