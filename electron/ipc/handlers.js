/**
 * IPC Handlers — Central channel registry
 *
 * Architecture rule: this file ONLY wires ipcMain channels to their handlers.
 * All Steam logic lives in steamManager.js.
 * All persistence lives in settingsStore.js.
 */

const { ipcMain, BrowserWindow, app, shell } = require('electron');
const steamManager  = require('../steamManager');
const settingsStore = require('../settingsStore');
const credentialStore = require('../credentialStore');
const humanizedService = require('../humanizedService');
const { orderAchievements } = require('../humanized/ordering');
const {
  assertAppId,
  sanitizeHumanizedPayload,
  sanitizeOrderingPayload,
  sanitizeOwnedGamesOptions,
  sanitizeSwitchGamePayload,
  sanitizeTimerPayload,
  sanitizeUnlockPayload,
} = require('./validation');

// In-memory cache for the owned-games response (valid 5 minutes)
let _libraryCache     = null;
let _libraryCacheTime = 0;
const CACHE_TTL_MS    = 5 * 60 * 1000;
const TRUSTED_EXTERNAL_URLS = new Set([
  'https://github.com/xkhi',
  'https://alotaibi.dev',
]);

function invalidateLibraryCache() {
  _libraryCache     = null;
  _libraryCacheTime = 0;
}

// ─────────────────────────────────────────────────────────────────────────────

function registerIpcHandlers() {

  // ─── Window Controls ─────────────────────────────────────────────────────
  ipcMain.on('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window:close',    () => BrowserWindow.getFocusedWindow()?.close());

  ipcMain.handle('window:is-maximized', () =>
    BrowserWindow.getFocusedWindow()?.isMaximized() ?? false
  );

  app.on('browser-window-created', (_e, win) => {
    win.on('maximize',   () => win.webContents.send('window:maximize-changed', true));
    win.on('unmaximize', () => win.webContents.send('window:maximize-changed', false));
  });

  // ─── Steam: Status ────────────────────────────────────────────────────────
  ipcMain.handle('steam:get-status', () => steamManager.getStatus());

  // ─── Steam: Manual Reconnect ──────────────────────────────────────────────
  ipcMain.handle('steam:reconnect', async () => {
    // console.log('[IPC] steam:reconnect → User triggered manual reconnect');
    const success = await steamManager.initSteam();
    const status = steamManager.getStatus();
    // console.log('[IPC] steam:reconnect result:', status);
    return status;
  });

  // ─── Steam: Full Owned Library (Steam Web API) ────────────────────────────
  /**
   * Returns the user's full owned game library via IPlayerService/GetOwnedGames.
   *
   * Error codes surfaced to renderer:
   *   'NO_API_KEY'          — user hasn't entered a key yet
   *   'STEAM_NOT_CONNECTED' — steamworks failed to init
   *   'INVALID_API_KEY'     — 401/403 from Steam
   *   'PRIVATE_PROFILE'     — profile privacy settings block the request
   */
  ipcMain.handle('steam:get-owned-games', async (_e, options) => {
    const { forceRefresh } = sanitizeOwnedGamesOptions(options);
    // Serve from cache unless stale or forced
    if (!forceRefresh && _libraryCache && Date.now() - _libraryCacheTime < CACHE_TTL_MS) {
      return { ..._libraryCache, fromCache: true };
    }

    let apiKey;
    try {
      apiKey = credentialStore.getApiKey();
    } catch (error) {
      return { success: false, errorCode: error?.code === 'CREDENTIAL_MIGRATION_REQUIRED' ? 'CREDENTIAL_MIGRATION_REQUIRED' : 'NO_API_KEY', games: [], count: 0 };
    }
    if (!apiKey) return { success: false, errorCode: 'NO_API_KEY', games: [], count: 0 };

    let status = steamManager.getStatus();
    
    // Lazy Execution: If Steam is running but we don't have the SteamID yet, 
    // do a fast, invisible handshake to fetch it before continuing.
    if (!status.steamId) {
      // console.log('[IPC] steam:get-owned-games → Missing SteamID. Triggering lazy handshake...');
      await steamManager.initSteam();
      status = steamManager.getStatus();
    }

    if (!status.connected || !status.steamId) {
      return { success: false, errorCode: 'STEAM_NOT_CONNECTED', games: [], count: 0 };
    }

    try {
      const games  = await steamManager.getOwnedGames(apiKey, status.steamId);
      const result = { success: true, games, count: games.length, errorCode: null };
      _libraryCache     = result;
      _libraryCacheTime = Date.now();
      return result;
    } catch (err) {
      const code = ['NO_API_KEY','INVALID_API_KEY','PRIVATE_PROFILE','NO_GAMES_RETURNED','STEAM_NOT_CONNECTED']
        .includes(err.message) ? err.message : 'FETCH_ERROR';
      return { success: false, errorCode: code, detail: err.message, games: [], count: 0 };
    }
  });


  // ─── Steam: Switch Game ───────────────────────────────────────────────────
  ipcMain.handle('steam:switch-game', async (_event, payload) => {
    const { appId, name, headerImage } = sanitizeSwitchGamePayload(payload);
    // console.log(`[IPC] steam:switch-game → AppID: ${appId} (${name})`);
    settingsStore.set('selectedGame', { appId, name, headerImage });

    const success = await steamManager.switchGame(appId);
    return { relaunching: false, success };
  });

  // ─── Steam: Achievements ──────────────────────────────────────────────────
  ipcMain.handle('steam:get-achievements', async (_e, rawAppId) => {
    const appId = assertAppId(rawAppId);
    let apiKey;
    try {
      apiKey = credentialStore.getApiKey();
    } catch (error) {
      return { success: false, achievements: [], errorCode: error?.code || 'NO_API_KEY', error: 'Steam Web API credential is unavailable.' };
    }
    let status = steamManager.getStatus();
    
    if (!status.steamId) {
      await steamManager.initSteam();
      status = steamManager.getStatus();
    }
    
    return await steamManager.getAchievements(appId, apiKey, status.steamId);
  });
  ipcMain.handle('steam:get-global-achievement-percentages', (_e, rawAppId) => steamManager.getGlobalAchievementPercentages(assertAppId(rawAppId)));
  ipcMain.handle('steam:unlock-achievement', (_e, payload) => {
    const { appId, achievementId } = sanitizeUnlockPayload(payload);
    return steamManager.unlockAchievement(achievementId, appId);
  });

  // ─── Legacy Timer (existing instant behavior) ─────────────────────────────
  const timerService = require('../timerService');
  ipcMain.handle('timer:start-queue', (_e, payload) => {
    const { achievements, base, variance, fixedMins } = sanitizeTimerPayload(payload);
    return timerService.startQueue(achievements, base, variance, fixedMins);
  });
  ipcMain.handle('timer:stop-queue',  () => timerService.stopQueue());
  ipcMain.handle('timer:clear-queue', () => timerService.clearQueue());
  ipcMain.handle('timer:get-status',  () => timerService.getStatus());

  // ─── Humanized Scheduler ─────────────────────────────────────────────────
  ipcMain.handle('humanized:get-status', () => humanizedService.getStatus());
  // Renderer display ordering deliberately delegates to the same canonical
  // normalization and ordering implementation used by schedule generation.
  ipcMain.handle('humanized:order-achievements', (_e, payload) => {
    const { achievements, orderMode } = sanitizeOrderingPayload(payload);
    return orderAchievements(achievements, orderMode);
  });
  ipcMain.handle('humanized:create', (_e, payload) => humanizedService.create(sanitizeHumanizedPayload(payload)));
  ipcMain.handle('humanized:replace', (_e, payload) => humanizedService.replace(sanitizeHumanizedPayload(payload)));
  ipcMain.handle('humanized:start', () => humanizedService.start());
  ipcMain.handle('humanized:pause', () => humanizedService.pause());
  ipcMain.handle('humanized:recheck-now', () => humanizedService.recheckNow());
  ipcMain.handle('humanized:clear', () => humanizedService.clear());

  // ─── Credential settings (status only; plaintext never crosses IPC) ───────
  ipcMain.handle('credentials:get-status', () => credentialStore.getStatus());
  ipcMain.handle('credentials:save-steam-api-key', (_e, value) => {
    const status = credentialStore.saveApiKey(value);
    invalidateLibraryCache();
    return status;
  });
  ipcMain.handle('credentials:clear-steam-api-key', () => {
    const status = credentialStore.clearApiKey();
    invalidateLibraryCache();
    return status;
  });

  // ─── App Info ─────────────────────────────────────────────────────────────
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:open-external', async (_e, url) => {
    if (!TRUSTED_EXTERNAL_URLS.has(url)) throw new Error('This external link is not permitted.');
    await shell.openExternal(url);
    return true;
  });

  // console.log('[IPC] ✓ All handlers registered.');
}

module.exports = { registerIpcHandlers };
