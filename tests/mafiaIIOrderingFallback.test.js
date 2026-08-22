'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeOrderingPayload } = require('../electron/ipc/validation');
const {
  BENDY_AND_THE_DARK_REVIVAL_APP_ID,
  ORDER_MODES,
  orderAchievements,
  orderingMetadata,
} = require('../electron/humanized/ordering');

const ROOT = path.join(__dirname, '..');
const MAFIA_II_APP_ID = 50130;

// Uses only public-schema style API names and percentages. The exclamation
// mark is a valid Steam achievement API-name character, not a game-specific
// exception in application logic.
const mafiaII = [
  { id: 'MDL_CHOP_CHOP!', name: 'Chop Chop!', description: 'Complete Chapter 13.', originalIndex: 0, globalPercent: '52.9', hidden: false, unlocked: false },
  { id: 'MDL_VIVA_LA_RESISTANCE', name: 'Viva la Resistenza!', description: 'Complete Chapter 1.', originalIndex: 1, globalPercent: '89.4', hidden: false, unlocked: false },
  { id: 'MDL_EXPLORER', name: 'Explorer', description: 'Drive 1,000 miles.', originalIndex: 2, globalPercent: '2.5', hidden: false, unlocked: false },
  { id: 'MDL_UNKNOWN_PERCENT', name: 'Unavailable Percent', description: '', originalIndex: 3, globalPercent: null, hidden: true, unlocked: false },
];

const bendy = [
  { id: 'FINALE', name: "The Master's Pen", originalIndex: 0, globalPercent: 12, hidden: false, unlocked: false },
  { id: 'PROLOGUE', name: 'The Ritual', originalIndex: 1, globalPercent: 65, hidden: false, unlocked: false },
  { id: 'CHAPTER', name: 'Armed and Ready', originalIndex: 2, globalPercent: 40, hidden: false, unlocked: false },
];

function ids(achievements, mode, appId) {
  return orderAchievements(achievements, mode, { appId }).map((achievement) => achievement.id);
}

function source(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('Mafia II public-style API identifiers, including punctuation, pass the generic strict ordering contract', () => {
  const payload = sanitizeOrderingPayload({
    achievements: mafiaII,
    orderMode: ORDER_MODES.ORIGINAL,
    appId: MAFIA_II_APP_ID,
  });

  assert.equal(payload.achievements.length, 4);
  assert.equal(payload.achievements[0].id, 'MDL_CHOP_CHOP!');
  assert.throws(() => sanitizeOrderingPayload({
    achievements: [{ ...mafiaII[0], id: 'MDL_BAD\nID' }],
    orderMode: ORDER_MODES.ORIGINAL,
    appId: MAFIA_II_APP_ID,
  }));
});

test('Mafia II Original, rarity, and Natural fallback modes each complete without one mode breaking the pipeline', () => {
  assert.deepEqual(ids(mafiaII, ORDER_MODES.ORIGINAL, MAFIA_II_APP_ID), [
    'MDL_CHOP_CHOP!', 'MDL_VIVA_LA_RESISTANCE', 'MDL_EXPLORER', 'MDL_UNKNOWN_PERCENT',
  ]);
  assert.deepEqual(ids(mafiaII, ORDER_MODES.MOST_COMMON_TO_RAREST, MAFIA_II_APP_ID), [
    'MDL_VIVA_LA_RESISTANCE', 'MDL_CHOP_CHOP!', 'MDL_EXPLORER', 'MDL_UNKNOWN_PERCENT',
  ]);
  assert.deepEqual(ids(mafiaII, ORDER_MODES.RAREST_TO_MOST_COMMON, MAFIA_II_APP_ID), [
    'MDL_EXPLORER', 'MDL_CHOP_CHOP!', 'MDL_VIVA_LA_RESISTANCE', 'MDL_UNKNOWN_PERCENT',
  ]);
  assert.deepEqual(ids(mafiaII, ORDER_MODES.NATURAL_STORY, MAFIA_II_APP_ID), [
    'MDL_CHOP_CHOP!', 'MDL_VIVA_LA_RESISTANCE', 'MDL_EXPLORER', 'MDL_UNKNOWN_PERCENT',
  ]);
});

test('Mafia II valid percentages are available for rarity modes while Natural truthfully reports documented progression fallback', () => {
  const common = orderingMetadata(mafiaII, ORDER_MODES.MOST_COMMON_TO_RAREST, { appId: MAFIA_II_APP_ID });
  const rare = orderingMetadata(mafiaII, ORDER_MODES.RAREST_TO_MOST_COMMON, { appId: MAFIA_II_APP_ID });
  const natural = orderingMetadata(mafiaII, ORDER_MODES.NATURAL_STORY, { appId: MAFIA_II_APP_ID });

  assert.equal(common.capability, 'available');
  assert.equal(rare.capability, 'available');
  assert.equal(common.knownPercentCount, 3);
  assert.equal(natural.capability, 'fallback');
  assert.equal(natural.reasonCode, 'PROGRESSION_METADATA_UNAVAILABLE');
  assert.match(natural.message, /conservatively preserves Steam schema order/i);
});

test('Missing and null percentage data only trigger truthful rarity fallback, never an ordering exception', () => {
  const unavailable = mafiaII.map((achievement, index) => ({ ...achievement, originalIndex: index, globalPercent: index === 0 ? undefined : null }));
  const common = orderingMetadata(unavailable, ORDER_MODES.MOST_COMMON_TO_RAREST, { appId: MAFIA_II_APP_ID });
  const rare = orderingMetadata(unavailable, ORDER_MODES.RAREST_TO_MOST_COMMON, { appId: MAFIA_II_APP_ID });

  assert.equal(common.capability, 'fallback');
  assert.equal(common.reasonCode, 'GLOBAL_PERCENTAGES_UNAVAILABLE');
  assert.equal(rare.capability, 'fallback');
  assert.deepEqual(ids(unavailable, ORDER_MODES.MOST_COMMON_TO_RAREST, MAFIA_II_APP_ID), ids(unavailable, ORDER_MODES.ORIGINAL, MAFIA_II_APP_ID));
  assert.deepEqual(ids(unavailable, ORDER_MODES.RAREST_TO_MOST_COMMON, MAFIA_II_APP_ID), ids(unavailable, ORDER_MODES.ORIGINAL, MAFIA_II_APP_ID));
});

test('A working game retains progression-aware Natural order independently of Mafia II fallback metadata', () => {
  const natural = orderingMetadata(bendy, ORDER_MODES.NATURAL_STORY, { appId: BENDY_AND_THE_DARK_REVIVAL_APP_ID });
  assert.equal(natural.capability, 'available');
  assert.deepEqual(ids(bendy, ORDER_MODES.NATURAL_STORY, BENDY_AND_THE_DARK_REVIVAL_APP_ID), ['PROLOGUE', 'CHAPTER', 'FINALE']);
  assert.deepEqual(ids(bendy, ORDER_MODES.MOST_COMMON_TO_RAREST, BENDY_AND_THE_DARK_REVIVAL_APP_ID), ['PROLOGUE', 'CHAPTER', 'FINALE']);
  assert.deepEqual(ids(bendy, ORDER_MODES.RAREST_TO_MOST_COMMON, BENDY_AND_THE_DARK_REVIVAL_APP_ID), ['FINALE', 'CHAPTER', 'PROLOGUE']);
});

test('The sole ordering IPC handler returns canonical IDs, mode capability, and redacted diagnostics through one pipeline', () => {
  const handlers = source('electron/ipc/handlers.js');
  const page = source('src/pages/Achievements.jsx');

  assert.match(handlers, /const \{ orderAchievements, orderingMetadata \}/);
  assert.match(handlers, /runtimeDiagnostics\.trace\('humanized-ordering', 'result'/);
  assert.match(handlers, /runtimeDiagnostics\.trace\('humanized-ordering', 'failure'/);
  assert.match(handlers, /return \{ ordered, metadata \}/);
  assert.match(page, /selectedOrderingMetadata\?\.message/);
  assert.match(page, /metadataByMode/);
});
