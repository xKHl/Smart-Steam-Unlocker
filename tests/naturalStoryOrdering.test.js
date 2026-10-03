const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BENDY_AND_THE_DARK_REVIVAL_APP_ID,
  ORDER_MODES,
  orderAchievements,
} = require('../electron/humanized/ordering');
const { createSchedule } = require('../electron/humanized/schedulerEngine');

const root = path.resolve(__dirname, '..');

const bendyAchievements = [
  { id: 'FINAL', name: "The Master's Pen", description: 'Complete the main story.', originalIndex: 0, globalPercent: 95, unlocked: false },
  { id: 'SIDE', name: 'Heavy Hitter', description: 'Defeat enemies with Shock Pipe.', originalIndex: 1, globalPercent: 3, unlocked: false },
  { id: 'CH5_END', name: 'To The Darkest Reaches', description: 'Complete Chapter Five.', originalIndex: 2, globalPercent: 40, unlocked: false },
  { id: 'CH1_START', name: 'Welcome To The Studio', description: 'Meet up with an old friend.', originalIndex: 3, globalPercent: 85, unlocked: false },
  { id: 'CH2_END', name: 'Rubberhose Nightmare', description: 'Complete Chapter Two.', originalIndex: 4, globalPercent: 60, unlocked: false },
  { id: 'CH3_END', name: 'Thrills and Spills', description: 'Complete Chapter Three.', originalIndex: 5, globalPercent: 50, unlocked: false },
  { id: 'CH4_END', name: 'Timeless Remains', description: 'Complete Chapter Four.', originalIndex: 6, globalPercent: 45, unlocked: false },
  { id: 'CH1_SIDE', name: 'Plaything', description: "Locate the Toyman's secret.", originalIndex: 7, globalPercent: 10, unlocked: false },
  { id: 'CH5_SIDE', name: 'Socialite', description: 'Be a first time party pooper.', originalIndex: 8, globalPercent: 30, unlocked: false },
  { id: 'CH3_BOSS', name: 'Next In Line', description: 'Defeat the ruler of the lower realm.', originalIndex: 9, globalPercent: 55, unlocked: false },
  { id: 'PROLOGUE', name: 'The Ritual', description: 'Clean up the exhibit.', originalIndex: 10, globalPercent: 90, unlocked: false },
  { id: 'CH1_POWER', name: 'Banish The Darkness', description: 'Obtain the banish power.', originalIndex: 11, globalPercent: 80, unlocked: false },
];

const naturalIds = () => orderAchievements(
  bendyAchievements,
  ORDER_MODES.NATURAL_STORY,
  { appId: BENDY_AND_THE_DARK_REVIVAL_APP_ID },
).map((achievement) => achievement.id);

async function displayModule() {
  return import('../src/lib/achievementDisplayProjection.mjs');
}

async function bulkSelectionModule() {
  return import('../src/lib/achievementBulkSelection.mjs');
}

test('Natural / Story Progression is deterministic, evidence-backed, and distinct from both rarity modes for Bendy', () => {
  const first = naturalIds();
  const second = naturalIds();
  const common = orderAchievements(bendyAchievements, ORDER_MODES.MOST_COMMON_TO_RAREST, { appId: BENDY_AND_THE_DARK_REVIVAL_APP_ID }).map((achievement) => achievement.id);
  const rare = orderAchievements(bendyAchievements, ORDER_MODES.RAREST_TO_MOST_COMMON, { appId: BENDY_AND_THE_DARK_REVIVAL_APP_ID }).map((achievement) => achievement.id);

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, common);
  assert.notDeepEqual(first, rare);
  assert.deepEqual(first, [
    'PROLOGUE', 'CH1_START', 'CH1_POWER', 'CH1_SIDE', 'CH2_END', 'CH3_BOSS',
    'CH3_END', 'CH4_END', 'CH5_SIDE', 'CH5_END', 'FINAL', 'SIDE',
  ]);
});

test('Bendy Natural ordering respects documented prologue, chapter, and finale progression constraints', () => {
  const positions = new Map(naturalIds().map((id, index) => [id, index]));
  assert.ok(positions.get('PROLOGUE') < positions.get('CH1_START'));
  assert.ok(positions.get('CH1_START') < positions.get('CH2_END'));
  assert.ok(positions.get('CH2_END') < positions.get('CH3_END'));
  assert.ok(positions.get('CH3_END') < positions.get('CH4_END'));
  assert.ok(positions.get('CH4_END') < positions.get('CH5_END'));
  assert.ok(positions.get('CH5_END') < positions.get('FINAL'));
  assert.ok(positions.get('FINAL') < positions.get('SIDE'));
});

test('Natural ordering falls back conservatively to original schema order when app evidence is unavailable', () => {
  const unsupportedApp = orderAchievements(bendyAchievements, ORDER_MODES.NATURAL_STORY, { appId: 480 }).map((achievement) => achievement.id);
  const original = orderAchievements(bendyAchievements, ORDER_MODES.ORIGINAL).map((achievement) => achievement.id);
  assert.deepEqual(unsupportedApp, original);
});

test('Original and completion-percentage ordering remain unchanged', () => {
  assert.deepEqual(
    orderAchievements(bendyAchievements, ORDER_MODES.ORIGINAL).map((achievement) => achievement.id),
    bendyAchievements.map((achievement) => achievement.id),
  );
  assert.deepEqual(
    orderAchievements(bendyAchievements, ORDER_MODES.MOST_COMMON_TO_RAREST).map((achievement) => achievement.id),
    ['FINAL', 'PROLOGUE', 'CH1_START', 'CH1_POWER', 'CH2_END', 'CH3_BOSS', 'CH3_END', 'CH4_END', 'CH5_END', 'CH5_SIDE', 'CH1_SIDE', 'SIDE'],
  );
  assert.deepEqual(
    orderAchievements(bendyAchievements, ORDER_MODES.RAREST_TO_MOST_COMMON).map((achievement) => achievement.id),
    ['SIDE', 'CH1_SIDE', 'CH5_SIDE', 'CH5_END', 'CH4_END', 'CH3_END', 'CH3_BOSS', 'CH2_END', 'CH1_POWER', 'CH1_START', 'PROLOGUE', 'FINAL'],
  );
});

test('Natural display projection, filtered visible bulk selection, and selected IDs use one canonical ID sequence', async () => {
  const { projectAchievementDisplay } = await displayModule();
  const { addVisibleLockedSelection, visibleLockedAchievementIds } = await bulkSelectionModule();
  const orderedIds = naturalIds();
  const visible = projectAchievementDisplay({
    achievements: bendyAchievements,
    orderedIds,
    useCanonicalOrder: true,
    search: 'the',
    filter: 'Locked',
  });
  const visibleLocked = visibleLockedAchievementIds(visible);
  const selected = addVisibleLockedSelection(new Set(), visibleLocked);

  assert.deepEqual(visible.map((achievement) => achievement.id), ['PROLOGUE', 'CH1_START', 'CH1_POWER', 'CH5_END', 'FINAL']);
  assert.deepEqual(visibleLocked, ['PROLOGUE', 'CH1_START', 'CH1_POWER', 'CH5_END', 'FINAL']);
  assert.deepEqual([...selected], ['PROLOGUE', 'CH1_START', 'CH1_POWER', 'CH5_END', 'FINAL']);

  const fullVisible = projectAchievementDisplay({ achievements: bendyAchievements, orderedIds, useCanonicalOrder: true, filter: 'Locked' });
  const fullVisibleLocked = visibleLockedAchievementIds(fullVisible);
  assert.deepEqual(fullVisibleLocked, orderedIds);
  assert.deepEqual([...addVisibleLockedSelection(new Set(), fullVisibleLocked)], orderedIds);
});

test('Natural schedule construction receives the exact canonical selected IDs and existing schedules remain immutable', () => {
  const selectedIds = naturalIds().filter((id) => id !== 'SIDE');
  const selectedInSteamOrder = bendyAchievements.filter((achievement) => selectedIds.includes(achievement.id));
  const schedule = createSchedule({
    appId: BENDY_AND_THE_DARK_REVIVAL_APP_ID,
    achievements: selectedInSteamOrder,
    orderMode: ORDER_MODES.NATURAL_STORY,
    seed: 'bendy-natural',
    startAt: 10_000,
  });
  const before = structuredClone(schedule);

  orderAchievements(bendyAchievements, ORDER_MODES.RAREST_TO_MOST_COMMON, { appId: BENDY_AND_THE_DARK_REVIVAL_APP_ID });

  assert.deepEqual(schedule.items.map((item) => item.id), selectedIds);
  assert.deepEqual(schedule, before);
});

test('Natural selector exposes exactly the four requested public modes and defaults new Humanized setup to Natural', () => {
  const panel = fs.readFileSync(path.join(root, 'src/components/HumanizedSchedulePanel.jsx'), 'utf8');
  const achievementsPage = fs.readFileSync(path.join(root, 'src/pages/Achievements.jsx'), 'utf8');

  assert.match(panel, /value: 'original'/);
  assert.match(panel, /value: 'natural-story-progression'/);
  assert.match(panel, /value: 'most-common-to-rarest'/);
  assert.match(panel, /value: 'rarest-to-most-common'/);
  assert.doesNotMatch(panel, /easiest-to-hardest|Easiest → Hardest|Ease proxy/);
  assert.match(achievementsPage, /useState\('natural-story-progression'\)/);
});

test('Instant mode stays in source order even when Natural canonical IDs are available', async () => {
  const { projectAchievementDisplay } = await displayModule();
  const instant = projectAchievementDisplay({
    achievements: bendyAchievements,
    orderedIds: naturalIds(),
    useCanonicalOrder: false,
  });
  assert.deepEqual(instant.map((achievement) => achievement.id), bendyAchievements.map((achievement) => achievement.id));
});
