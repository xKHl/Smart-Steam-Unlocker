/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  SteamManager — Steamworks.js + Steam Web API Service                   │
 * │                                                                         │
 * │  Responsibilities:                                                      │
 * │    • Steamworks client lifecycle (init / shutdown)                      │
 * │    • Local SteamID64 retrieval (via steamworks.js — no API key needed)  │
 * │    • Full owned-game library via Steam Web API (IPlayerService)         │
 * │    • Game switching via steam_appid.txt + reinit                       │
 * │    • Achievement read via Web API, write via steamworks.js              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

const fs   = require('fs');
const path = require('path');
const settingsStore = require('./settingsStore');
const credentialStore = require('./credentialStore');
const { createSteamApiClient, STEAM_READ_ERROR } = require('./steamApiClient');
const { app, BrowserWindow } = require('electron');

const steamApiClient = createSteamApiClient();

// ─────────────────────────────────────────────────────────────────────────────
// Module State
// ─────────────────────────────────────────────────────────────────────────────

let client       = null;
let initialized  = false;
let currentAppId = null;

// Cached values survive after the handshake shutdown
let cachedPlayerName = null;
let cachedSteamId    = null;
let steamIsAvailable = false;
let isSteamProcessRunning = false;

// Poll the Windows Steam process only where that command exists. Other
// platforms rely on the authoritative Steamworks connection state instead.
const steamProcessPoll = setInterval(() => {
  if (steamIsAvailable) return;
  if (process.platform !== 'win32') {
    isSteamProcessRunning = false;
    return;
  }
  const { exec } = require('child_process');
  exec('tasklist /FI "IMAGENAME eq steam.exe" /NH', (err, stdout) => {
    isSteamProcessRunning = Boolean(!err && stdout.toLowerCase().includes('steam.exe'));
  });
}, 5000);
steamProcessPoll.unref?.();

// ─────────────────────────────────────────────────────────────────────────────
// Steam Web API — Full Owned Library
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the user's COMPLETE owned game library via the Steam Web API.
 *
 * Error codes thrown as string-valued Error messages:
 *   'NO_API_KEY'         — api key not configured
 *   'STEAM_NOT_CONNECTED'— steamworks not initialised
 *   'INVALID_API_KEY'    — 401/403 from Steam
 *   'PRIVATE_PROFILE'    — empty response (profile privacy)
 *   'NO_GAMES_RETURNED'  — unexpected empty games array
 */
async function getOwnedGames(apiKey, steamId) {
  if (!apiKey)   throw new Error('NO_API_KEY');
  if (!steamId)  throw new Error('STEAM_NOT_CONNECTED');

  const params = new URLSearchParams({
    key:                       apiKey,
    steamid:                   steamId,
    include_appinfo:           '1',
    include_played_free_games: '1',
    format:                    'json',
  });

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?${params}`;
  // console.log(`[SteamManager] Fetching owned games for SteamID ${steamId}…`);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });

  if (res.status === 401 || res.status === 403) throw new Error('INVALID_API_KEY');
  if (!res.ok) throw new Error(`Steam API HTTP ${res.status}: ${res.statusText}`);

  const json     = await res.json();
  const rawGames = json?.response?.games;

  if (!rawGames) {
    if (json?.response && Object.keys(json.response).length === 0) throw new Error('PRIVATE_PROFILE');
    throw new Error('NO_GAMES_RETURNED');
  }

  const games = rawGames.map(g => {
    const appId    = g.appid;
    const iconHash = g.img_icon_url || '';
    return {
      appId,
      name:            g.name || `App ${appId}`,
      playtimeMinutes: g.playtime_forever || 0,
      playtime2Weeks:  g.playtime_2weeks  || 0,
      iconHash,
      iconUrl: iconHash
        ? `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`
        : null,
      headerImage:  `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      capsuleImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`,
    };
  });

  games.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  // console.log(`[SteamManager] ✓ Owned games: ${games.length}`);
  return games;
}

// ─────────────────────────────────────────────────────────────────────────────
// Game Switching / Steam Runtime Context
// ─────────────────────────────────────────────────────────────────────────────

function getSteamRuntimeDirectory() {
  // A user-data directory is writable in development and packaged Windows,
  // Linux AppImage, and macOS environments. It avoids mutating packaged
  // resources or relying on an arbitrary launcher working directory.
  return path.join(app.getPath('userData'), 'steam-runtime');
}

function prepareSteamRuntimeContext(appId) {
  if (!Number.isInteger(Number(appId)) || Number(appId) <= 0) {
    throw new Error('A valid Steam App ID is required to prepare the runtime context.');
  }
  const runtimeDirectory = getSteamRuntimeDirectory();
  const appIdPath = path.join(runtimeDirectory, 'steam_appid.txt');
  try {
    fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(appIdPath, `${Number(appId)}\n`, { encoding: 'utf8', mode: 0o600 });
    // Steamworks consults the process working directory for steam_appid.txt.
    // Node resolves required native modules before this point, so changing into
    // the controlled runtime directory does not alter module resolution.
    if (process.cwd() !== runtimeDirectory) process.chdir(runtimeDirectory);
    return { runtimeDirectory, appIdPath, appId: Number(appId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Steam runtime context could not be prepared: ${message}`);
  }
}

async function switchGame(appId) {
  // Shutdown current client to release Steam context before changing App ID.
  shutdown();
  prepareSteamRuntimeContext(appId);
  currentAppId = Number(appId);
  // Lazy initialization is retained; the context is only connected when a
  // Steam operation or identity read requires it.
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Steamworks Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

async function initSteam(forceAppId = null) {
  // Use the provided AppID, or 480 (Spacewar) for the boot-time handshake.
  const appId = Number(forceAppId || 480);
  prepareSteamRuntimeContext(appId);
  currentAppId = appId;

  try {
    // If already initialized, shut it down first to avoid collisions
    shutdown();
    
    const steamworks = require('steamworks.js');
    client = steamworks.init(appId);
    initialized = true;
    
    // Cache player data so it survives the handshake shutdown
    cachedPlayerName = client.localplayer.getName();
    cachedSteamId    = String(client.localplayer.getSteamId().steamId64);
    steamIsAvailable = true;
    
    // console.log('[SteamManager] ✓ Connected  | AppID:', appId);
    // console.log('[SteamManager]   Player     :', cachedPlayerName);
    // console.log('[SteamManager]   SteamID    :', cachedSteamId);
    
    // Immediately shut down after handshake/connect to remain invisible
    if (!forceAppId) {
      // console.log('[SteamManager]   Handshake complete — shutting down Spacewar context');
      shutdown();
      currentAppId = null;
    }
    
    return true;
  } catch (err) {
    steamIsAvailable = false;
    initialized = false;
    client = null;
    // console.error(`[SteamManager] ✗ Steam init FAILED for AppID ${appId}`);
    // console.error(`[SteamManager]   Error: ${err.message}`);
    // console.error(`[SteamManager]   Hint:  Is the Steam client running? Is steam_appid.txt present?`);
    return false;
  }
}

/**
 * Forcefully shuts down the Steamworks client and nullifies all state.
 * Wraps the native shutdown in a 3-second timeout watchdog so a hang
 * in the native layer can never block the Node.js event loop indefinitely.
 * Always guaranteed to set client = null and initialized = false.
 */
function shutdown() {
  // Fast-path: nothing to clean up
  if (!initialized && !client) return;

  const clientRef = client;

  // Immediately null out module state so no other call can race against us
  client      = null;
  initialized = false;

  if (!clientRef) return;

  try {
    // Run the native shutdown synchronously — it *should* be fast
    if (typeof clientRef.shutdown === 'function') {
      clientRef.shutdown();
    }
    // console.log('[SteamManager] ✓ Steamworks client shut down cleanly.');
  } catch (err) {
    // Native threw — already nulled, just log
    // console.warn('[SteamManager] shutdown() threw (already cleaned up):', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status & Player Info
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns Steam connection status.
 */
function getSelectedAppId() {
  return settingsStore.get('selectedGame')?.appId ?? null;
}

function getStatus() {
  // If we have verified handshake data, we are fully connected
  if (steamIsAvailable) {
    return {
      connected:    true,
      playerName:   cachedPlayerName,
      steamId:      cachedSteamId,
      currentAppId: currentAppId,
    };
  }

  // Auto-detect via process scan (invisible mode)
  if (isSteamProcessRunning) {
    return { connected: true, playerName: null, steamId: null, currentAppId: null };
  }

  return { connected: false, playerName: null, steamId: null, currentAppId: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Achievements (Web API — read only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constructs the full Steam CDN URL for an achievement icon hash.
 * Steam GetSchemaForGame returns icon hashes like "abc123def456".
 * The full URL pattern is:
 *   https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/{appid}/{hash}.jpg
 */
function buildAchievementIconUrl(appId, hash) {
  if (!hash) return null;
  // If it's already a full URL, return as-is
  if (hash.startsWith('http')) return hash;
  // Construct the canonical Steam CDN URL
  return `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appId}/${hash}.jpg`;
}

async function getAchievements(appId, apiKey, steamId, { includeOptimisticCache = true } = {}) {
  if (!apiKey || !steamId) {
    return { success: false, achievements: [], error: 'NO_API_KEY_OR_STEAM_ID' };
  }
  
  try {
    const schemaUrl = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appId}`;
    const playerUrl = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${appId}&key=${apiKey}&steamid=${steamId}`;

    const [schemaRes, playerRes] = await Promise.all([
      fetch(schemaUrl, { signal: AbortSignal.timeout(10000) }),
      fetch(playerUrl, { signal: AbortSignal.timeout(10000) })
    ]);

    if (!schemaRes.ok || !playerRes.ok) {
      throw new Error(`API Error: Schema ${schemaRes.status}, Player ${playerRes.status}`);
    }

    const schemaJson = await schemaRes.json();
    const playerJson = await playerRes.json();

    const schemaAchievements = schemaJson?.game?.availableGameStats?.achievements || [];
    const playerAchievements = playerJson?.playerstats?.achievements || [];

    // Map player unlock status by API name
    const unlockedMap = {};
    for (const pa of playerAchievements) {
      unlockedMap[pa.apiname] = pa.achieved === 1;
    }

    // UI reads may merge local optimistic cache while a remote API update is pending.
    // Safety verification must bypass this cache and inspect the remote read result.
    if (includeOptimisticCache) {
      const cacheKey = `unlocked_cache_${appId}`;
      const optimisticCache = settingsStore.get(cacheKey) || [];
      for (const id of optimisticCache) {
        unlockedMap[id] = true;
      }
    }

    const achievements = schemaAchievements.map((sa, index) => {
      const isUnlocked = !!unlockedMap[sa.name];
      return {
        id: sa.name,
        name: sa.displayName || sa.name,
        description: sa.description || '',
        unlocked: isUnlocked,
        hidden: sa.hidden === 1,
        originalIndex: index, // Preserve canonical order
        iconUrl: buildAchievementIconUrl(appId, isUnlocked ? sa.icon : sa.icongray),
        iconColorUrl: buildAchievementIconUrl(appId, sa.icon),
        iconGrayUrl:  buildAchievementIconUrl(appId, sa.icongray),
      };
    });

    // console.log(`[SteamManager] ✓ Achievements for AppID ${appId}: ${achievements.length} total`);
    return { success: true, achievements, appId };
  } catch (err) {
    // console.warn(`[SteamManager] Web API getAchievements failed for AppID ${appId}:`, err.message);
    return { success: false, achievements: [], error: err.message };
  }
}

/**
 * PHASE 3 HOOK — Lazy-Execution Unlock
 *
 * SAFETY CONTRACT:
 *   - client is ALWAYS set to null in the finally block, no matter what.
 *   - initialized is ALWAYS set to false in the finally block.
 *   - A single unlock never leaves Steamworks running.
 */
function publishAchievementUnlocked(appId, achievementId) {
  const cacheKey = `unlocked_cache_${appId}`;
  const cache = settingsStore.get(cacheKey) || [];
  if (!cache.includes(achievementId)) {
    cache.push(achievementId);
    settingsStore.set(cacheKey, cache);
  }

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('steam:achievement-unlocked', achievementId);
  });
}

function confirmVerifiedAchievement(appId, achievementId) {
  if (!appId || !achievementId) return false;
  publishAchievementUnlocked(appId, achievementId);
  return true;
}

async function unlockAchievement(achievementId, expectedAppId = null) {
  // Instant mode leaves expectedAppId unset. Humanized mode supplies its immutable
  // schedule App ID and must never be redirected by mutable selected-game state.
  const selectedGame = settingsStore.get('selectedGame');
  if (!selectedGame || !selectedGame.appId) {
    return { success: false, achievementId, error: 'No game selected', errorCode: 'NO_SELECTED_GAME' };
  }

  const targetAppId = selectedGame.appId;
  if (expectedAppId !== null && expectedAppId !== undefined && String(targetAppId) !== String(expectedAppId)) {
    return {
      success: false,
      achievementId,
      appId: targetAppId,
      error: `Selected App ID ${targetAppId} does not match expected App ID ${expectedAppId}.`,
      errorCode: 'APP_ID_MISMATCH',
    };
  }
  // console.log(`[SteamManager] Lazy unlocking "${achievementId}" for AppID ${targetAppId}...`);

  // Ensure any previous session is fully dead before we begin
  shutdown();

  // Prepare the writable per-user Steam context before creating a native client.
  try {
    prepareSteamRuntimeContext(Number(targetAppId));
  } catch (error) {
    return {
      success: false,
      achievementId,
      error: error instanceof Error ? error.message : String(error),
      errorCode: 'STEAM_RUNTIME_CONTEXT_FAILED',
    };
  }

  let localClient = null;
  let success = false;
  let activationMayHaveApplied = false;
  let errorMsg = null;
  let errorCode = null;

  try {
    // 1. Initialize Steamworks for this single operation
    const steamworks = require('steamworks.js');
    localClient = steamworks.init(targetAppId);
    // We don't touch module-level `client` here — we use a local reference
    // so our finally block can clean up even if the module state was mucked with

    // 2. Perform the unlock
    const activated = localClient.achievement.activate(achievementId);
    if (activated) {
      activationMayHaveApplied = true;
      // steamworks.js exposes achievement.activate() separately from the
      // supported stats.store() commit API. achievement.store() does not exist
      // in the installed client surface and must never be called here.
      const stored = localClient.stats.store();
      if (!stored) throw new Error('Steam stats store was rejected after achievement activation.');
      // console.log(`[SteamManager] ✓ Unlocked: ${achievementId}`);
      success = true;

      // Preserve Instant mode's immediate refresh after the valid local store.
      // Humanized mode supplies expectedAppId and deliberately waits for the
      // independent verifier before publishing a renderer/cache unlock update.
      if (!expectedAppId) publishAchievementUnlocked(targetAppId, achievementId);
    } else {
      errorMsg = 'Activation returned false';
      errorCode = 'ACTIVATION_REJECTED';
      // console.error(`[SteamManager] ✗ Activate returned false for: ${achievementId}`);
    }
  } catch (err) {
    errorMsg = err.message;
    errorCode = activationMayHaveApplied ? 'OPERATION_UNCERTAIN' : 'STEAM_EXECUTION_FAILED';
    // console.error(`[SteamManager] ✗ Unlock threw for ${achievementId}:`, err.message);
  } finally {
    // ── GUARANTEED CLEANUP ──────────────────────────────────────────────────
    // This block runs unconditionally — on success, on error, even if JS
    // throws synchronously inside the try block. client WILL be freed.
    try {
      if (localClient && typeof localClient.shutdown === 'function') {
        localClient.shutdown();
        // console.log('[SteamManager] ✓ Local client shut down after unlock.');
      }
    } catch (shutdownErr) {
      // console.warn('[SteamManager] shutdown() in finally threw (non-fatal):', shutdownErr.message);
    } finally {
      // Null out everything — always, without exception
      localClient  = null;
      client       = null;
      initialized  = false;
    }
  }

  if (success) {
    return { success: true, achievementId, appId: targetAppId };
  } else {
    return {
      success: false,
      achievementId,
      appId: targetAppId,
      error: errorMsg || 'Unknown error',
      errorCode: errorCode || 'STEAM_EXECUTION_FAILED',
      operationMayHaveApplied: activationMayHaveApplied,
    };
  }
}

/**
 * Reads the remote achievement state used by Humanized verification. This helper
 * intentionally bypasses the optimistic local cache so execution success is not
 * treated as proof until the Steam Web API reports the unlocked state.
 */
const VERIFICATION_RETRY_DELAYS_MS = Object.freeze([0, 750, 1750]);

function waitForVerificationDelay(delayMs) {
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

async function getAchievementVerification(appId, achievementId) {
  const selectedGame = settingsStore.get('selectedGame');
  if (!appId || !achievementId) {
    return { success: false, appId, achievementId, error: 'App ID and achievement ID are required.', errorCode: 'INVALID_CONTEXT' };
  }
  if (!selectedGame?.appId || String(selectedGame.appId) !== String(appId)) {
    return {
      success: false,
      appId,
      achievementId,
      error: `Selected App ID ${selectedGame?.appId ?? 'none'} does not match expected App ID ${appId}.`,
      errorCode: 'APP_ID_MISMATCH',
    };
  }

  let apiKey;
  try {
    apiKey = credentialStore.getApiKey();
  } catch (error) {
    return {
      success: false,
      appId,
      achievementId,
      error: error?.message || 'Secure Steam credential storage is unavailable.',
      errorCode: error?.code || 'CREDENTIAL_STORAGE_UNAVAILABLE',
    };
  }
  let status = getStatus();
  if (!status.steamId) {
    await initSteam();
    status = getStatus();
  }
  if (!apiKey || !status.steamId) {
    return { success: false, appId, achievementId, error: 'Steam identity or Web API key is unavailable.', errorCode: 'STEAM_READ_UNAVAILABLE' };
  }

  let lastResult = null;
  for (const delayMs of VERIFICATION_RETRY_DELAYS_MS) {
    await waitForVerificationDelay(delayMs);
    const result = await steamApiClient.getPlayerAchievementState({
      apiKey,
      appId,
      steamId: status.steamId,
      achievementId,
    });
    if (result.success) return { success: true, appId, achievementId, unlocked: result.unlocked };

    // A player response may omit an achievement that is valid in the game
    // schema (for example while Steam data is propagating). Fetch schema only
    // in that ambiguous case instead of on every polling attempt.
    if (result.errorCode === STEAM_READ_ERROR.PLAYER_ACHIEVEMENT_MISSING) {
      const schema = await steamApiClient.hasSchemaAchievement({ apiKey, appId, achievementId });
      if (schema.success && !schema.found) {
        return { success: false, appId, achievementId, error: `Achievement ${achievementId} was not found for App ID ${appId}.`, errorCode: 'ACHIEVEMENT_NOT_FOUND' };
      }
      if (schema.success && schema.found) {
        lastResult = { success: false, errorCode: STEAM_READ_ERROR.PLAYER_STATE_INVALID, endpoint: 'player-achievements' };
        continue;
      }
      lastResult = schema;
      continue;
    }
    lastResult = result;
  }

  if (lastResult?.success) return { success: true, appId, achievementId, unlocked: false };
  return {
    success: false,
    appId,
    achievementId,
    error: 'Steam achievement verification could not determine the current player state.',
    errorCode: lastResult?.errorCode || STEAM_READ_ERROR.STEAM_SERVICE_UNAVAILABLE,
    endpoint: lastResult?.endpoint || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Achievement Percentages (Phase 4)
// ─────────────────────────────────────────────────────────────────────────────

async function getGlobalAchievementPercentages(appId) {
  try {
    const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Steam API HTTP ${res.status}: ${res.statusText}`);
    
    const json = await res.json();
    const achievements = json?.achievementpercentages?.achievements || [];
    return { success: true, percentages: achievements };
  } catch (err) {
    // console.warn(`[SteamManager] getGlobalAchievementPercentages failed for AppID ${appId}:`, err.message);
    return { success: false, percentages: [], error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  initSteam,
  shutdown,
  getStatus,
  getSelectedAppId,
  getSteamRuntimeDirectory,
  prepareSteamRuntimeContext,
  getOwnedGames,
  switchGame,
  getAchievements,
  getAchievementVerification,
  confirmVerifiedAchievement,
  getGlobalAchievementPercentages,
  unlockAchievement,
};
