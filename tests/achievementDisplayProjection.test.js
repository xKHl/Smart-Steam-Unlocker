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

async function bulkSelectionModule() {
  return import('../src/lib/achievementBulkSelection.mjs');
}

async function visibleLockedIdsFor(mode, options = {}) {
  const { projectAchievementDisplay } = await projectionModule();
  const { visibleLockedAchievementIds } = await bulkSelectionModule();
  const displayed = projectAchievementDisplay({
    achievements,
    orderedIds: idsFor(mode),
    useCanonicalOrder: true,
    ...options,
  });
  return visibleLockedAchievementIds(displayed);
}

test('Select All Locked follows the visible canonical locked order in every Humanized mode', async () => {
  assert.deepEqual(await visibleLockedIdsFor(ORDER_MODES.ORIGINAL), ['MID_A', 'RARE', 'MID_B']);
  assert.deepEqual(await visibleLockedIdsFor(ORDER_MODES.EASIEST_TO_HARDEST), ['MID_A', 'MID_B', 'RARE']);
  assert.deepEqual(await visibleLockedIdsFor(ORDER_MODES.MOST_COMMON_TO_RAREST), ['MID_A', 'MID_B', 'RARE']);
  assert.deepEqual(await visibleLockedIdsFor(ORDER_MODES.RAREST_TO_MOST_COMMON), ['RARE', 'MID_A', 'MID_B']);
});

test('bulk selection assigns sequence in visible order without letting unlocked items consume positions', async () => {
  const { addVisibleLockedSelection } = await bulkSelectionModule();
  const visibleLockedIds = await visibleLockedIdsFor(ORDER_MODES.RAREST_TO_MOST_COMMON);
  const selection = addVisibleLockedSelection(new Set(), visibleLockedIds);

  assert.deepEqual([...selection], ['RARE', 'MID_A', 'MID_B']);
  assert.equal(selection.has('COMMON'), false);
  assert.equal(selection.has('UNKNOWN'), false);
});

test('search-filtered Select All Locked adds only visible matching locked achievements in display order', async () => {
  const { addVisibleLockedSelection } = await bulkSelectionModule();
  const visibleLockedIds = await visibleLockedIdsFor(ORDER_MODES.RAREST_TO_MOST_COMMON, { search: 'mid', filter: 'Locked' });
  const hiddenUnlockedIds = await visibleLockedIdsFor(ORDER_MODES.RAREST_TO_MOST_COMMON, { filter: 'Unlocked' });
  const selection = addVisibleLockedSelection(new Set(['RARE']), visibleLockedIds);

  assert.deepEqual(visibleLockedIds, ['MID_A', 'MID_B']);
  assert.deepEqual(hiddenUnlockedIds, []);
  assert.deepEqual([...selection], ['RARE', 'MID_A', 'MID_B']);
});

test('bulk selection preserves manual selections and deselects only the current visible locked subset', async () => {
  const {
    addVisibleLockedSelection,
    areAllVisibleLockedSelected,
    removeVisibleLockedSelection,
  } = await bulkSelectionModule();
  const visibleLockedIds = await visibleLockedIdsFor(ORDER_MODES.MOST_COMMON_TO_RAREST, { search: 'mid' });
  const manuallySelected = new Set(['RARE', 'MID_A']);
  const afterBulkAdd = addVisibleLockedSelection(manuallySelected, visibleLockedIds);

  assert.deepEqual([...afterBulkAdd], ['RARE', 'MID_A', 'MID_B']);
  assert.equal(areAllVisibleLockedSelected(afterBulkAdd, visibleLockedIds), true);
  assert.deepEqual([...removeVisibleLockedSelection(afterBulkAdd, visibleLockedIds)], ['RARE']);
});

test('Humanized schedule generation resolves the selected visible IDs into the same canonical execution order', async () => {
  const visibleLockedIds = await visibleLockedIdsFor(ORDER_MODES.RAREST_TO_MOST_COMMON);
  const selectedItemsInSteamSourceOrder = achievements.filter((achievement) => visibleLockedIds.includes(achievement.id));
  const schedule = createSchedule({
    appId: 480,
    achievements: selectedItemsInSteamSourceOrder,
    orderMode: ORDER_MODES.RAREST_TO_MOST_COMMON,
    seed: 'visible-bulk-order',
    startAt: 10_000,
  });

  assert.deepEqual(schedule.items.map((item) => item.id), visibleLockedIds);
});

test('Instant mode retains Steam source order even when Humanized bulk ordering is available', async () => {
  const { projectAchievementDisplay } = await projectionModule();
  const { visibleLockedAchievementIds } = await bulkSelectionModule();
  const displayed = projectAchievementDisplay({
    achievements,
    orderedIds: idsFor(ORDER_MODES.RAREST_TO_MOST_COMMON),
    useCanonicalOrder: false,
  });

  assert.deepEqual(visibleLockedAchievementIds(displayed), ['MID_A', 'RARE', 'MID_B']);
});
