'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeOrderingPayload, IpcValidationError } = require('../electron/ipc/validation');
const { ORDER_MODES, orderAchievements } = require('../electron/humanized/ordering');
const { createSchedule } = require('../electron/humanized/schedulerEngine');

const ROOT = path.join(__dirname, '..');
const BENDY_APP_ID = 1063660;

const achievements = [
  { id: 'FINALE', name: "The Master's Pen", originalIndex: 0, globalPercent: 12, unlocked: false, unlockTime: 1700000000 },
  { id: 'COMMON', name: 'Common Reward', originalIndex: 1, globalPercent: 95, unlocked: true, unlockTime: 1700000001 },
  { id: 'PROLOGUE', name: 'The Ritual', originalIndex: 2, globalPercent: 65, unlocked: false },
  { id: 'RARE', name: 'Rare Reward', originalIndex: 3, globalPercent: 2, unlocked: false },
  { id: 'CHAPTER', name: 'Armed and Ready', originalIndex: 4, globalPercent: 40, unlocked: false },
];

async function rendererModules() {
  const [payload, projection, bulk] = await Promise.all([
    import('../src/lib/executionAchievementPayload.mjs'),
    import('../src/lib/achievementDisplayProjection.mjs'),
    import('../src/lib/achievementBulkSelection.mjs'),
  ]);
  return { ...payload, ...projection, ...bulk };
}

function source(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

async function canonicalView(mode, options = {}) {
  const { projectExecutionAchievements, projectAchievementDisplay } = await rendererModules();
  const request = sanitizeOrderingPayload({
    achievements: projectExecutionAchievements(achievements),
    orderMode: mode,
    appId: BENDY_APP_ID,
  });
  const canonical = orderAchievements(request.achievements, request.orderMode, { appId: request.appId });
  const ids = canonical.map((achievement) => achievement.id);
  const visible = projectAchievementDisplay({
    achievements,
    orderedIds: ids,
    useCanonicalOrder: true,
    ...options,
  });
  return { ids, visible, request };
}

test('display-only unlockTime is stripped before strict ordering IPC instead of rejecting every Humanized mode', async () => {
  const { projectExecutionAchievements } = await rendererModules();
  assert.throws(() => sanitizeOrderingPayload({
    achievements,
    orderMode: ORDER_MODES.MOST_COMMON_TO_RAREST,
    appId: BENDY_APP_ID,
  }), IpcValidationError);

  const request = sanitizeOrderingPayload({
    achievements: projectExecutionAchievements(achievements),
    orderMode: ORDER_MODES.MOST_COMMON_TO_RAREST,
    appId: BENDY_APP_ID,
  });
  assert.equal(request.achievements.some((achievement) => Object.hasOwn(achievement, 'unlockTime')), false);
  assert.equal(request.achievements.length, achievements.length);
});

test('Original, Natural, Most Common, and Rarest projections are each deterministic and materially correct', async () => {
  const original = await canonicalView(ORDER_MODES.ORIGINAL);
  const natural = await canonicalView(ORDER_MODES.NATURAL_STORY);
  const common = await canonicalView(ORDER_MODES.MOST_COMMON_TO_RAREST);
  const rare = await canonicalView(ORDER_MODES.RAREST_TO_MOST_COMMON);

  assert.deepEqual(original.ids, ['FINALE', 'COMMON', 'PROLOGUE', 'RARE', 'CHAPTER']);
  assert.deepEqual(natural.ids, ['PROLOGUE', 'CHAPTER', 'FINALE', 'COMMON', 'RARE']);
  assert.deepEqual(common.ids, ['COMMON', 'PROLOGUE', 'CHAPTER', 'FINALE', 'RARE']);
  assert.deepEqual(rare.ids, ['RARE', 'FINALE', 'CHAPTER', 'PROLOGUE', 'COMMON']);
  assert.notDeepEqual(natural.ids, original.ids);
  assert.notDeepEqual(common.ids, rare.ids);
  assert.deepEqual((await canonicalView(ORDER_MODES.NATURAL_STORY)).ids, natural.ids);
});

test('search and Locked/Unlocked filtering preserve the selected canonical order instead of re-sorting source data', async () => {
  const { visibleLockedAchievementIds } = await rendererModules();
  const rareSearch = await canonicalView(ORDER_MODES.RAREST_TO_MOST_COMMON, { search: 'reward' });
  const commonLocked = await canonicalView(ORDER_MODES.MOST_COMMON_TO_RAREST, { filter: 'Locked' });
  const rareUnlocked = await canonicalView(ORDER_MODES.RAREST_TO_MOST_COMMON, { filter: 'Unlocked' });

  assert.deepEqual(rareSearch.visible.map((achievement) => achievement.id), ['RARE', 'COMMON']);
  assert.deepEqual(visibleLockedAchievementIds(commonLocked.visible), ['PROLOGUE', 'CHAPTER', 'FINALE', 'RARE']);
  assert.deepEqual(rareUnlocked.visible.map((achievement) => achievement.id), ['COMMON']);
});

test('bulk selection and selected-ID projection follow the visible canonical grid order', async () => {
  const { addVisibleLockedSelection, visibleLockedAchievementIds } = await rendererModules();
  const { visible } = await canonicalView(ORDER_MODES.RAREST_TO_MOST_COMMON, { filter: 'Locked' });
  const visibleLocked = visibleLockedAchievementIds(visible);
  const selection = addVisibleLockedSelection(new Set(), visibleLocked);

  assert.deepEqual(visibleLocked, ['RARE', 'FINALE', 'CHAPTER', 'PROLOGUE']);
  assert.deepEqual([...selection], visibleLocked);
});

test('Humanized schedule sequence positions match the canonical visible selection order in every mode', async () => {
  const { projectExecutionAchievements, visibleLockedAchievementIds } = await rendererModules();
  for (const mode of Object.values(ORDER_MODES)) {
    const { visible } = await canonicalView(mode, { filter: 'Locked' });
    const visibleLocked = visibleLockedAchievementIds(visible);
    const selectedInVisibleOrder = visible.filter((achievement) => visibleLocked.includes(achievement.id));
    const schedule = createSchedule({
      appId: BENDY_APP_ID,
      achievements: projectExecutionAchievements(selectedInVisibleOrder),
      orderMode: mode,
      seed: `mode-${mode}`,
      startAt: 10_000,
    });
    assert.deepEqual(schedule.items.map((item) => item.id), visibleLocked, mode);
  }
});

test('page-level ordering state keys the canonical projection by humanized mode and never silently labels a fallback as selected ordering', () => {
  const page = source('src/pages/Achievements.jsx');
  const panel = source('src/components/HumanizedSchedulePanel.jsx');

  assert.match(page, /const canonicalOrderingInput = projectExecutionAchievements\(achievements\)/);
  assert.match(page, /orderAchievements\(canonicalOrderingInput, mode, selectedGame\?\.appId\)/);
  assert.match(page, /humanizedOrderCache\.byMode\[humanizedOrderMode\]/);
  assert.match(page, /\[achievements, canonicalOrderedIds, unlockMode\]/);
  assert.match(page, /canonicalAchievements=\{canonicalOrderedAchievements\}/);
  assert.match(page, /t\('achievements\.gridFallback'\)/);
  assert.match(panel, /canonicalAchievements\.filter/);
});
