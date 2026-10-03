const { BrowserWindow } = require('electron');
const settingsStore = require('./settingsStore');
const credentialStore = require('./credentialStore');
const steamManager = require('./steamManager');
const { createStoreMetadataClient } = require('./tradingCards/storeMetadataClient');
const { createCommunityBadgesClient } = require('./tradingCards/communityBadges');
const {
  CARD_ELIGIBILITY,
  DROP_STATUS,
  classifyTradingCardLibrary,
  summarizeTradingCardLibrary,
} = require('./tradingCards/cardClassification');
const {
  MONITOR_STATE,
  inactiveMonitor,
  validatePersistedMonitor,
  monitorDurationMs: durationForMonitor,
  startMonitor,
  pauseMonitor,
  resumeMonitor,
  observeDropStatus,
} = require('./tradingCards/monitorState');

const STORAGE_KEY = 'tradingCardMonitorState';
const STORE_CACHE_KEY = 'tradingCardStoreEligibility';
const STORE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LIBRARY_CACHE_TTL_MS = 5 * 60 * 1000;
const MONITOR_REFRESH_MS = 2 * 60 * 1000;

const storeMetadataClient = createStoreMetadataClient();
let monitor = inactiveMonitor();
let libraryCache = null;
let libraryCacheAt = 0;
let storeEligibilityCache = null;
let refreshTimer = null;
let inFlightRefresh = null;

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function status() {
  return {
    ...clone(monitor),
    monitorDurationMs: durationForMonitor(monitor),
    runningEvidence: 'unavailable',
    limitation: 'Steam launch was requested, but this app cannot confirm an arbitrary Steam game process or predict card drops.',
  };
}

function emitUpdate() {
  const payload = status();
  BrowserWindow.getAllWindows().forEach((win) => win.webContents.send('trading-cards:update', payload));
}

function persist() {
  if (monitor.state === MONITOR_STATE.INACTIVE) return settingsStore.delete(STORAGE_KEY);
  return settingsStore.set(STORAGE_KEY, clone(monitor));
}

function stopRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function ensureRefreshLoop() {
  if (refreshTimer || monitor.state !== MONITOR_STATE.MONITORING) return;
  refreshTimer = setInterval(() => {
    refreshActiveMonitor().catch(() => {
      // The latest unavailable state is represented by the library read; a
      // background retry must never throw through Electron's event loop.
    });
  }, MONITOR_REFRESH_MS);
  refreshTimer.unref?.();
}

async function resolveSteamIdentity() {
  let steamStatus = steamManager.getStatus();
  if (!steamStatus.steamId) {
    await steamManager.initSteam();
    steamStatus = steamManager.getStatus();
  }
  return steamStatus?.steamId ? steamStatus : null;
}

// Store eligibility rarely changes, and large libraries need one request per
// app, so explicit answers are persisted for a week across restarts.
function loadStoreCache() {
  if (storeEligibilityCache) return storeEligibilityCache;
  storeEligibilityCache = new Map();
  const persisted = settingsStore.get(STORE_CACHE_KEY);
  if (persisted && typeof persisted === 'object' && Date.now() - Number(persisted.savedAt) < STORE_CACHE_TTL_MS) {
    Object.entries(persisted.entries || {}).forEach(([appId, eligible]) => {
      if (Number(appId) > 0 && typeof eligible === 'boolean') storeEligibilityCache.set(Number(appId), eligible);
    });
  }
  return storeEligibilityCache;
}

function saveStoreCache() {
  const entries = Object.fromEntries([...storeEligibilityCache.entries()].map(([appId, eligible]) => [String(appId), eligible]));
  try {
    settingsStore.set(STORE_CACHE_KEY, { savedAt: Date.now(), entries });
  } catch {
    // The in-memory cache still serves this session.
  }
}

// The Electron-bound session module is loaded lazily so pure modules and
// tests never need a running Electron app.
function communitySession() {
  return require('./tradingCards/communitySession');
}

async function readCommunityDrops(steamId) {
  const sessionModule = communitySession();
  const status = await sessionModule.getStatus();
  if (!status.signedIn) return { connected: false, signedIn: false, success: false, errorCode: null, badges: [] };
  if (status.steamId && String(status.steamId) !== String(steamId)) {
    return { connected: false, signedIn: true, success: false, errorCode: 'COMMUNITY_ACCOUNT_MISMATCH', badges: [] };
  }
  const client = createCommunityBadgesClient({ fetchImpl: sessionModule.fetchWithSession });
  const result = await client.getRemainingDrops(steamId);
  return { connected: result.success, signedIn: true, ...result };
}

async function getLibrary({ forceRefresh = false } = {}) {
  if (!forceRefresh && libraryCache && Date.now() - libraryCacheAt < LIBRARY_CACHE_TTL_MS) return clone(libraryCache);

  let apiKey;
  try {
    apiKey = credentialStore.getApiKey();
  } catch (error) {
    return { success: false, errorCode: error?.code || 'NO_API_KEY', games: [], summary: summarizeTradingCardLibrary([]) };
  }
  if (!apiKey) return { success: false, errorCode: 'NO_API_KEY', games: [], summary: summarizeTradingCardLibrary([]) };

  const steamStatus = await resolveSteamIdentity();
  if (!steamStatus) return { success: false, errorCode: 'STEAM_NOT_CONNECTED', games: [], summary: summarizeTradingCardLibrary([]) };

  try {
    const [ownedGames, badgeResult, communityResult] = await Promise.all([
      steamManager.getOwnedGames(apiKey, steamStatus.steamId),
      steamManager.getTradingCardBadges(apiKey, steamStatus.steamId),
      readCommunityDrops(steamStatus.steamId).catch(() => ({ connected: false, signedIn: false, success: false, errorCode: 'COMMUNITY_FETCH_FAILED', badges: [] })),
    ]);
    // Signed-in badge-page counts are the only real source of remaining drops.
    const dropRecords = [
      ...(badgeResult.success ? badgeResult.badges : []),
      ...(communityResult.success ? communityResult.badges : []),
    ];
    loadStoreCache();
    const unknownStoreEligibility = ownedGames
      .map((game) => Number(game.appId))
      .filter((appId) => Number.isInteger(appId) && appId > 0 && !storeEligibilityCache.has(appId));
    if (unknownStoreEligibility.length) {
      const storeResult = await storeMetadataClient.getTradingCardEligibility(unknownStoreEligibility);
      storeResult.eligibilityByAppId.forEach((eligible, appId) => storeEligibilityCache.set(appId, eligible));
      if (storeResult.eligibilityByAppId.size) saveStoreCache();
    }
    const games = classifyTradingCardLibrary(ownedGames, {
      eligibilityByAppId: storeEligibilityCache,
      badgeRecords: dropRecords,
      cardBadgeAppIds: badgeResult.success ? badgeResult.cardBadgeAppIds : [],
    });
    // Drop counts exist only when Steam explicitly returned them; the Web API
    // badge endpoint normally does not, so the UI must not show zeros as facts.
    const result = {
      success: true,
      errorCode: badgeResult.success ? null : badgeResult.errorCode,
      cardDataAvailable: dropRecords.length > 0 || communityResult.success,
      community: { connected: communityResult.success, signedIn: communityResult.signedIn, errorCode: communityResult.errorCode || null },
      games,
      summary: summarizeTradingCardLibrary(games),
      refreshedAt: Date.now(),
    };
    libraryCache = result;
    libraryCacheAt = Date.now();
    return clone(result);
  } catch (error) {
    return {
      success: false,
      errorCode: error?.message === 'INVALID_API_KEY' ? 'INVALID_API_KEY' : 'FETCH_ERROR',
      games: [],
      summary: summarizeTradingCardLibrary([]),
    };
  }
}

async function refreshActiveMonitor() {
  if (monitor.state !== MONITOR_STATE.MONITORING || !monitor.appId) return status();
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const result = await getLibrary({ forceRefresh: true });
    const activeGame = result.games?.find((game) => Number(game.appId) === Number(monitor.appId));
    if (!activeGame) return status();

    monitor = observeDropStatus(monitor, {
      dropStatus: activeGame.dropStatus,
      remainingDrops: activeGame.remainingDrops,
      observedAt: result.refreshedAt ?? Date.now(),
    });
    if (monitor.state === MONITOR_STATE.COMPLETED) {
      // Steam explicitly reported zero remaining drops. Monitoring may end, but
      // no attempt is made to close or control the separately launched game.
      stopRefreshLoop();
    }
    persist();
    emitUpdate();
    return status();
  })().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

async function start({ appId, launchGame }) {
  if (!Number.isInteger(appId) || appId <= 0) throw Object.assign(new Error('A valid App ID is required.'), { code: 'INVALID_APP_ID' });
  if (typeof launchGame !== 'function') throw Object.assign(new Error('A Steam launch function is required.'), { code: 'LAUNCH_UNAVAILABLE' });
  if (![MONITOR_STATE.INACTIVE, MONITOR_STATE.COMPLETED].includes(monitor.state)) {
    throw Object.assign(new Error('Only one Trading Card monitor can be active at a time.'), { code: 'TRADING_CARD_MONITOR_ACTIVE' });
  }

  const library = await getLibrary({ forceRefresh: true });
  if (!library.success) throw Object.assign(new Error('Trading Card data is unavailable. Refresh and try again.'), { code: library.errorCode || 'CARD_DATA_UNAVAILABLE' });
  const game = library.games.find((entry) => Number(entry.appId) === Number(appId));
  if (!game || game.eligibility !== CARD_ELIGIBILITY.WITH_CARDS || game.dropStatus === DROP_STATUS.EXHAUSTED) {
    throw Object.assign(new Error('Steam has not confirmed Trading Cards with drops left for this game.'), { code: 'CARD_DROPS_NOT_AVAILABLE' });
  }

  await launchGame(appId);
  monitor = startMonitor({
    appId: Number(appId),
    gameName: game.name,
    remainingDrops: game.remainingDrops,
    now: Date.now(),
  });
  persist();
  ensureRefreshLoop();
  emitUpdate();
  return status();
}

function pause() {
  if (monitor.state !== MONITOR_STATE.MONITORING) return status();
  monitor = pauseMonitor(monitor, Date.now());
  stopRefreshLoop();
  persist();
  emitUpdate();
  return status();
}

function resume() {
  if (monitor.state !== MONITOR_STATE.PAUSED) return status();
  monitor = resumeMonitor(monitor, Date.now());
  persist();
  ensureRefreshLoop();
  emitUpdate();
  return status();
}

function stop() {
  stopRefreshLoop();
  monitor = inactiveMonitor();
  persist();
  emitUpdate();
  return status();
}

async function init() {
  const recovered = validatePersistedMonitor(settingsStore.get(STORAGE_KEY));
  if (!recovered) {
    monitor = inactiveMonitor();
    settingsStore.delete(STORAGE_KEY);
    return status();
  }
  monitor = {
    ...recovered,
    recovered: recovered.state !== MONITOR_STATE.INACTIVE,
    // A post-restart monitor observes only account data; it cannot infer that
    // the Steam game launched before restart is still running.
    confirmedRunning: false,
  };
  if (monitor.state === MONITOR_STATE.MONITORING) ensureRefreshLoop();
  return status();
}

async function communityStatus() {
  return communitySession().getStatus();
}

async function communitySignIn(parent) {
  const status = await communitySession().signIn(parent);
  libraryCache = null;
  return status;
}

async function communitySignOut() {
  const status = await communitySession().signOut();
  libraryCache = null;
  return status;
}

function resetForTests() {
  stopRefreshLoop();
  monitor = inactiveMonitor();
  libraryCache = null;
  libraryCacheAt = 0;
  storeEligibilityCache = new Map();
  inFlightRefresh = null;
}

module.exports = {
  MONITOR_STATE,
  STORAGE_KEY,
  inactiveMonitor,
  validatePersistedMonitor,
  monitorDurationMs: (now) => durationForMonitor(monitor, now),
  init,
  getStatus: status,
  getLibrary,
  refreshActiveMonitor,
  start,
  pause,
  resume,
  stop,
  communityStatus,
  communitySignIn,
  communitySignOut,
  resetForTests,
};
