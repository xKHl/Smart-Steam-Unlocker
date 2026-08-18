const test = require('node:test');
const assert = require('node:assert/strict');

const { ORDER_MODES, orderAchievements } = require('../electron/humanized/ordering');
const { createSchedule } = require('../electron/humanized/schedulerEngine');

const achievements = [
  { id: 'MID_A', name: 'Mid A', originalIndex: 0, globalPercent: 50, unlocked: false },
  { id: 'COMMON', name: 'Common', originalIndex: 1, globalPercent: 100, unlocked: true },
  { id: 'RARE', name: 'Rare', originalIndex: 2, globalPercent: 0, unlocked: false },
  { id: 'MID_B', name: 'Mid B', originalIndex: 3, globalPercent: 50, unlocked: false },
  { id: 'UNKNOWN', name: 'Unknown', originalIndex: 4, unlocked: true },
];

async function projectionModule() {
  return import('../src/lib/achievementDisplayProjection.mjs');
}

function idsFor(mode) {
  return orderAchievements(achievements, mode).map((achievement) => achievement.id);
}

test('the grid projection follows canonical IDs immediately across all Humanized modes', async () => {
  const { projectAchievementDisplay } = await projectionModule();
  const original = projectAchievementDisplay({ achievements, orderedIds: idsFor(ORDER_MODES.ORIGINAL), useCanonicalOrder: true });
  const common = projectAchievementDisplay({ achievements, orderedIds: idsFor(ORDER_MODES.MOST_COMMON_TO_RAREST), useCanonicalOrder: true });
  const rare = projectAchievementDisplay({ achievements, orderedIds: idsFor(ORDER_MODES.RAREST_TO_MOST_COMMON), useCanonicalOrder: true });
  const easiest = projectAchievementDisplay({ achievements, orderedIds: idsFor(ORDER_MODES.EASIEST_TO_HARDEST), useCanonicalOrder: true });

  assert.deepEqual(original.map((achievement) => achievement.id), ['MID_A', 'COMMON', 'RARE', 'MID_B', 'UNKNOWN']);
  assert.deepEqual(common.map((achievement) => achievement.id), ['COMMON', 'MID_A', 'MID_B', 'RARE', 'UNKNOWN']);
  assert.deepEqual(rare.map((achievement) => achievement.id), ['RARE', 'MID_A', 'MID_B', 'COMMON', 'UNKNOWN']);
  assert.deepEqual(easiest.map((achievement) => achievement.id), common.map((achievement) => achievement.id));
  assert.notDeepEqual(common.map((achievement) => achievement.id), rare.map((achievement) => achievement.id));
});

test('search and locked/unlocked filters preserve the selected canonical display order', async () => {
  const { projectAchievementDisplay } = await projectionModule();
  const rareIds = idsFor(ORDER_MODES.RAREST_TO_MOST_COMMON);

  const locked = projectAchievementDisplay({ achievements, orderedIds: rareIds, useCanonicalOrder: true, filter: 'Locked' });
  const unlocked = projectAchievementDisplay({ achievements, orderedIds: rareIds, useCanonicalOrder: true, filter: 'Unlocked' });
  const searched = projectAchievementDisplay({ achievements, orderedIds: rareIds, useCanonicalOrder: true, search: 'mid' });

  assert.deepEqual(locked.map((achievement) => achievement.id), ['RARE', 'MID_A', 'MID_B']);
  assert.deepEqual(unlocked.map((achievement) => achievement.id), ['COMMON', 'UNKNOWN']);
  assert.deepEqual(searched.map((achievement) => achievement.id), ['MID_A', 'MID_B']);
});

test('selection identity and existing schedules remain unchanged when the display projection changes', async () => {
  const { projectAchievementDisplay } = await projectionModule();
  const selectedIds = new Set(['MID_A', 'RARE']);
  const schedule = createSchedule({ appId: 480, achievements, orderMode: ORDER_MODES.ORIGINAL, seed: 'grid-projection', startAt: 10_000 });
  const scheduleBefore = structuredClone(schedule);

  const reordered = projectAchievementDisplay({
    achievements,
    orderedIds: idsFor(ORDER_MODES.RAREST_TO_MOST_COMMON),
    useCanonicalOrder: true,
  });

  assert.deepEqual(reordered.filter((achievement) => selectedIds.has(achievement.id)).map((achievement) => achievement.id), ['RARE', 'MID_A']);
  assert.deepEqual([...selectedIds], ['MID_A', 'RARE']);
  assert.deepEqual(schedule, scheduleBefore);
});

test('Instant mode ignores Humanized ordered IDs and preserves the Steam source order', async () => {
  const { projectAchievementDisplay } = await projectionModule();
  const instant = projectAchievementDisplay({
    achievements,
    orderedIds: idsFor(ORDER_MODES.RAREST_TO_MOST_COMMON),
    useCanonicalOrder: false,
  });

  assert.deepEqual(instant.map((achievement) => achievement.id), ['MID_A', 'COMMON', 'RARE', 'MID_B', 'UNKNOWN']);
});
