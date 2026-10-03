const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CARD_ELIGIBILITY,
  DROP_STATUS,
  classifyTradingCardGame,
  classifyTradingCardLibrary,
  summarizeTradingCardLibrary,
} = require('../electron/tradingCards/cardClassification');
const {
  eligibilityFromAppDetails,
  normalizeAppIds,
  createStoreMetadataClient,
} = require('../electron/tradingCards/storeMetadataClient');
const {
  MONITOR_STATE,
  inactiveMonitor,
  validatePersistedMonitor,
  monitorDurationMs,
  startMonitor,
  pauseMonitor,
  resumeMonitor,
  observeDropStatus,
} = require('../electron/tradingCards/monitorState');
const { STEAM_READ_ERROR, createSteamApiClient } = require('../electron/steamApiClient');

const root = path.resolve(__dirname, '..');

async function projectionModule() {
  return import('../src/lib/tradingCardProjection.mjs');
}

test('Trading Card classification distinguishes explicit cards, no cards, exhausted, and unavailable data without guessing', () => {
  const remaining = classifyTradingCardGame({ appId: 1 }, { storeEligibility: true, badgeRemainingDrops: 3 });
  const exhausted = classifyTradingCardGame({ appId: 2 }, { storeEligibility: true, badgeRemainingDrops: 0 });
  const noCards = classifyTradingCardGame({ appId: 3 }, { storeEligibility: false });
  const unavailable = classifyTradingCardGame({ appId: 4 });
  const badgeOnly = classifyTradingCardGame({ appId: 5 }, { badgeRemainingDrops: 0 });

  assert.deepEqual(remaining, { appId: 1, eligibility: CARD_ELIGIBILITY.WITH_CARDS, dropStatus: DROP_STATUS.REMAINING, remainingDrops: 3, isEligibleForLaunch: true });
  assert.deepEqual(exhausted, { appId: 2, eligibility: CARD_ELIGIBILITY.WITH_CARDS, dropStatus: DROP_STATUS.EXHAUSTED, remainingDrops: null, isEligibleForLaunch: false });
  assert.deepEqual(noCards, { appId: 3, eligibility: CARD_ELIGIBILITY.NO_CARDS, dropStatus: DROP_STATUS.NOT_APPLICABLE, remainingDrops: null, isEligibleForLaunch: false });
  assert.deepEqual(unavailable, { appId: 4, eligibility: CARD_ELIGIBILITY.UNAVAILABLE, dropStatus: DROP_STATUS.UNAVAILABLE, remainingDrops: null, isEligibleForLaunch: false });
  assert.equal(badgeOnly.dropStatus, DROP_STATUS.EXHAUSTED);
});

test('Trading Card library summary counts only classified Steam evidence and de-duplicates app IDs', () => {
  const games = classifyTradingCardLibrary([
    { appId: 1, name: 'Available' },
    { appId: 2, name: 'Exhausted' },
    { appId: 3, name: 'No Cards' },
    { appId: 4, name: 'Unknown' },
    { appId: 1, name: 'Duplicate' },
  ], {
    eligibilityByAppId: new Map([[1, true], [2, true], [3, false]]),
    badgeRecords: [{ appId: 1, remainingDrops: 2 }, { appId: 2, remainingDrops: 0 }],
  });

  assert.equal(games.length, 4);
  assert.deepEqual(summarizeTradingCardLibrary(games), {
    totalGames: 4, withCards: 2, withoutCards: 1, dropsRemaining: 1, dropsExhausted: 1, unavailable: 1,
  });
});

test('Store metadata treats only explicit category 29 as Trading Card eligibility and preserves malformed responses as unavailable', async () => {
  assert.deepEqual(normalizeAppIds([1, '1', 2, 0, 'nope', 2]), [1, 2]);
  assert.equal(eligibilityFromAppDetails({ 1: { success: true, data: { categories: [{ id: 29 }] } } }, 1), true);
  assert.equal(eligibilityFromAppDetails({ 1: { success: true, data: { categories: [{ id: 22 }] } } }, 1), false);
  assert.equal(eligibilityFromAppDetails({ 1: { success: false } }, 1), null);

  const client = createStoreMetadataClient({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        1: { success: true, data: { categories: [{ id: 29 }] } },
        2: { success: true, data: { categories: [{ id: 22 }] } },
        3: { success: false },
      }),
    }),
  });
  const result = await client.getTradingCardEligibility([1, 2, 3]);
  assert.equal(result.eligibilityByAppId.get(1), true);
  assert.equal(result.eligibilityByAppId.get(2), false);
  assert.ok(result.unavailableAppIds.has(3));
});

test('Trading Card monitor lifecycle tracks only app-monitor duration, supports pause/resume/stop, and never confirms running', () => {
  const started = startMonitor({ appId: 620, gameName: 'Portal 2', remainingDrops: 3, now: 1_000 });
  assert.equal(started.state, MONITOR_STATE.MONITORING);
  assert.equal(started.confirmedRunning, false);
  assert.equal(monitorDurationMs(started, 5_000), 4_000);

  const paused = pauseMonitor(started, 5_000);
  assert.equal(paused.state, MONITOR_STATE.PAUSED);
  assert.equal(monitorDurationMs(paused, 9_000), 4_000);

  const resumed = resumeMonitor(paused, 9_000);
  assert.equal(resumed.state, MONITOR_STATE.MONITORING);
  assert.equal(monitorDurationMs(resumed, 12_000), 7_000);

  const unavailable = observeDropStatus(resumed, { dropStatus: DROP_STATUS.UNAVAILABLE, observedAt: 12_500 });
  assert.equal(unavailable.state, MONITOR_STATE.MONITORING);
  assert.equal(unavailable.remainingDrops, null);

  const exhausted = observeDropStatus(unavailable, { dropStatus: DROP_STATUS.EXHAUSTED, observedAt: 13_000 });
  assert.equal(exhausted.state, MONITOR_STATE.COMPLETED);
  assert.equal(exhausted.confirmedRunning, false);
  assert.equal(inactiveMonitor().state, MONITOR_STATE.INACTIVE);
});

test('Persisted Trading Card monitor validation rejects fabricated contexts and restores only a non-running monitor state', () => {
  const valid = startMonitor({ appId: 620, gameName: 'Portal 2', remainingDrops: 1, now: 1_000 });
  valid.confirmedRunning = true;
  const restored = validatePersistedMonitor(valid);
  assert.equal(restored.confirmedRunning, false);
  assert.equal(restored.appId, 620);
  assert.equal(validatePersistedMonitor({ ...valid, appId: 0 }), null);
  assert.equal(validatePersistedMonitor({ ...valid, remainingDrops: -1 }), null);
  assert.equal(validatePersistedMonitor({ ...valid, version: 99 }), null);
});

test('Trading Card projection filters, searches, and sorts deterministically without mutating source data', async () => {
  const { buildRecentAppIds, projectTradingCardLibrary, TRADING_CARD_SORTS } = await projectionModule();
  const games = [
    { appId: 1, name: 'Zeta', eligibility: 'with-cards', dropStatus: 'remaining', remainingDrops: 1 },
    { appId: 2, name: 'Alpha', eligibility: 'with-cards', dropStatus: 'remaining', remainingDrops: 4 },
    { appId: 3, name: 'No Cards', eligibility: 'no-cards', dropStatus: 'not-applicable', remainingDrops: null },
    { appId: 4, name: 'Spent', eligibility: 'with-cards', dropStatus: 'exhausted', remainingDrops: null },
  ];
  const before = structuredClone(games);
  assert.deepEqual(projectTradingCardLibrary({ games, filter: 'Drops Remaining', sort: TRADING_CARD_SORTS.DROPS }).map((game) => game.appId), [2, 1]);
  assert.deepEqual(projectTradingCardLibrary({ games, filter: 'Without Cards', sort: TRADING_CARD_SORTS.ALPHABETICAL }).map((game) => game.appId), [3]);
  assert.deepEqual(projectTradingCardLibrary({ games, search: 'a', sort: TRADING_CARD_SORTS.ALPHABETICAL }).map((game) => game.appId), [2, 3, 1]);
  assert.deepEqual(projectTradingCardLibrary({ games, filter: 'Currently Monitoring', monitoredAppId: 4 }).map((game) => game.appId), [4]);
  assert.deepEqual(buildRecentAppIds(2, [1, 2, 3]), [2, 1, 3]);
  assert.deepEqual(games, before);
});

test('Typed badge client returns only explicit app/drop pairs and retains the shared API error contract', async () => {
  const client = createSteamApiClient({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ response: { badges: [
        { appid: 1, cards_remaining: 2 },
        { appid: 2, cards_remaining: 0 },
        { appid: 3 },
        { appid: 0, cards_remaining: 4 },
      ] } }),
    }),
  });
  assert.deepEqual(await client.getPlayerBadges({ apiKey: 'abc', steamId: '76561198000000000' }), {
    success: true, endpoint: 'player-badges', badges: [{ appId: 1, remainingDrops: 2 }, { appId: 2, remainingDrops: 0 }], cardBadgeAppIds: [1, 2, 3],
  });
  assert.equal((await client.getPlayerBadges({ apiKey: '', steamId: 'x' })).errorCode, STEAM_READ_ERROR.MISSING_API_KEY);
});

test('Trading Cards stays separate from Achievements and uses transparent Steam launch monitoring controls', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/components/Sidebar.jsx'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'src/pages/TradingCards.jsx'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'electron/tradingCardsService.js'), 'utf8');
  const handlers = fs.readFileSync(path.join(root, 'electron/ipc/handlers.js'), 'utf8');

  assert.match(app, /path="\/trading-cards"/);
  assert.match(sidebar, /nav-trading-cards/);
  assert.match(page, /useI18n/);
  assert.match(page, /t\('trading\.noCardsDetail'\)/);
  assert.match(page, /t\('trading\.runningUnconfirmed'\)/);
  assert.match(page, /t\('trading\.requestLaunch'\)/);
  assert.doesNotMatch(page, /card every|drop at|estimated drop/i);
  assert.match(service, /runningEvidence: 'unavailable'/);
  assert.match(handlers, /shell\.openExternal\(`steam:\/\/run\/\$\{appId\}`\)/);
  assert.doesNotMatch(app, /tradingCards.*isSwitching|isSwitching.*tradingCards/);
});

test('Store metadata requests one app per call with the categories filter, because multi-app appdetails returns HTTP 400', async () => {
  const urls = [];
  const client = createStoreMetadataClient({
    fetchImpl: async (url) => {
      urls.push(url);
      const appId = new URL(url).searchParams.get('appids');
      if (appId.includes(',')) return { ok: false, status: 400 };
      const body = {
        8870: { success: true, data: { categories: [{ id: 2 }, { id: 29 }] } },
        7670: { success: true, data: { categories: [{ id: 2 }] } },
        5: { success: true, data: [] },
      }[appId];
      return { ok: true, status: 200, json: async () => ({ [appId]: body ?? { success: false } }) };
    },
  });
  const result = await client.getTradingCardEligibility([8870, 7670, 5, 6]);
  assert.ok(urls.every((url) => !new URL(url).searchParams.get('appids').includes(',')));
  assert.ok(urls.every((url) => new URL(url).searchParams.get('filters') === 'categories'));
  assert.equal(result.eligibilityByAppId.get(8870), true);
  assert.equal(result.eligibilityByAppId.get(7670), false);
  assert.equal(result.eligibilityByAppId.get(5), false);
  assert.ok(result.unavailableAppIds.has(6));
});

test('Store metadata stops requesting after Steam rate-limits and leaves the rest unavailable for a later refresh', async () => {
  let calls = 0;
  const client = createStoreMetadataClient({
    concurrency: 1,
    fetchImpl: async () => { calls += 1; return { ok: false, status: 429 }; },
  });
  const result = await client.getTradingCardEligibility([1, 2, 3, 4]);
  assert.equal(calls, 1);
  assert.equal(result.rateLimited, true);
  assert.equal(result.unavailableAppIds.size, 4);
});

test('A game badge proves Trading Cards even without drop counts, and such games can be launched for monitoring', () => {
  const [game] = classifyTradingCardLibrary([{ appId: 42, name: 'Badge Game' }], { eligibilityByAppId: new Map(), cardBadgeAppIds: [42] });
  assert.equal(game.eligibility, CARD_ELIGIBILITY.WITH_CARDS);
  assert.equal(game.dropStatus, DROP_STATUS.UNAVAILABLE);
  assert.equal(game.isEligibleForLaunch, true);

  const monitor = startMonitor({ appId: 42, gameName: 'Badge Game', remainingDrops: null, now: 1_000 });
  assert.equal(monitor.state, MONITOR_STATE.MONITORING);
  assert.equal(monitor.remainingDrops, null);
  assert.equal(monitor.dropStatus, DROP_STATUS.UNAVAILABLE);
  assert.ok(validatePersistedMonitor(monitor));
  assert.throws(() => startMonitor({ appId: 42, gameName: 'Badge Game', remainingDrops: 0, now: 1_000 }));
});

test('after a complete badges-page read, games with cards missing from it count as having no drops left', () => {
  const { applyCompleteCommunityDrops } = require('../electron/tradingCards/cardClassification');
  const games = classifyTradingCardLibrary(
    [{ appId: 1, name: 'Listed' }, { appId: 2, name: 'Not listed' }, { appId: 3, name: 'No cards' }],
    { eligibilityByAppId: new Map([[1, true], [2, true], [3, false]]), badgeRecords: [{ appId: 1, remainingDrops: 3 }] },
  );
  const [listed, missing, noCards] = applyCompleteCommunityDrops(games);
  assert.equal(listed.dropStatus, DROP_STATUS.REMAINING);
  assert.equal(listed.remainingDrops, 3);
  assert.equal(missing.dropStatus, DROP_STATUS.EXHAUSTED);
  assert.equal(missing.isEligibleForLaunch, false);
  assert.equal(noCards.dropStatus, DROP_STATUS.NOT_APPLICABLE);
});
