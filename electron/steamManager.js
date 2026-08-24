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
const runtimeDiagnostics = require('./runtimeDiagnostics');
const { pollForVerifiedUnlock } = require('./humanized/verificationPolling');
const { app, BrowserWindow } = require('electron');
const { operationCoordinator, OperationLeaseConflictError } = require('./operationCoordinator');

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
let relockSequence = 0;

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
async function getTradingCardBadges(apiKey, steamId) {
  return steamApiClient.getPlayerBadges({ apiKey, steamId });
}

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
  runtimeDiagnostics.trace('steam', 'init-start', { appId, forceAppId: Boolean(forceAppId) });
  prepareSteamRuntimeContext(appId);
  runtimeDiagnostics.trace('steam', 'runtime-context-ready', { appId });
  currentAppId = appId;

  try {
    // If already initialized, shut it down first to avoid collisions
    shutdown();
    
    const steamworks = require('steamworks.js');
    runtimeDiagnostics.trace('steam', 'native-init-start', { appId });
    client = steamworks.init(appId);
    runtimeDiagnostics.trace('steam', 'native-init-end', { appId });
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
    
    runtimeDiagnostics.trace('steam', 'init-end', { appId, outcome: 'success' });
    return true;
  } catch (err) {
    runtimeDiagnostics.trace('steam', 'init-end', { appId, outcome: 'error', error: err instanceof Error ? err.message : String(err) });
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
  runtimeDiagnostics.trace('steam', 'shutdown-start');

  // Immediately null out module state so no other call can race against us
  client      = null;
  initialized = false;

  if (!clientRef) return;

  try {
    // Run the native shutdown synchronously — it *should* be fast
    if (typeof clientRef.shutdown === 'function') {
      clientRef.shutdown();
    }
    runtimeDiagnostics.trace('steam', 'shutdown-end', { outcome: 'success' });
    // console.log('[SteamManager] ✓ Steamworks client shut down cleanly.');
  } catch (err) {
    runtimeDiagnostics.trace('steam', 'shutdown-end', { outcome: 'error', error: err instanceof Error ? err.message : String(err) });
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

    // Map the remote unlock state by API name. Steam's `unlocktime` is a Unix
    // timestamp in seconds; it is preserved verbatim when Steam reports one.
    // The renderer may use this read-only evidence for a chronological integrity
    // timeline, but must never infer a time for optimistic local cache entries.
    const unlockStateMap = {};
    for (const pa of playerAchievements) {
      unlockStateMap[pa.apiname] = {
        unlocked: pa.achieved === 1,
        unlockTime: Number.isFinite(Number(pa.unlocktime)) && Number(pa.unlocktime) > 0
          ? Number(pa.unlocktime)
          : null,
      };
    }

    // UI reads may merge local optimistic cache while a remote API update is pending.
    // Safety verification must bypass this cache and inspect the remote read result.
    if (includeOptimisticCache) {
      const cacheKey = `unlocked_cache_${appId}`;
      const optimisticCache = settingsStore.get(cacheKey) || [];
      for (const id of optimisticCache) {
        unlockStateMap[id] = { ...(unlockStateMap[id] || {}), unlocked: true };
      }
    }

    const achievements = schemaAchievements.map((sa, index) => {
      const unlockState = unlockStateMap[sa.name] || { unlocked: false, unlockTime: null };
      const isUnlocked = unlockState.unlocked;
      return {
        id: sa.name,
        name: sa.displayName || sa.name,
        description: sa.description || '',
        unlocked: isUnlocked,
        // This field is remote Steam evidence only. Null means Steam did not
        // report a timestamp; it must not be fabricated by this application.
        unlockTime: unlockState.unlockTime ?? null,
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

function publishAchievementRelocked(appId, achievementId) {
  const cacheKey = `unlocked_cache_${appId}`;
  const cache = settingsStore.get(cacheKey) || [];
  const nextCache = cache.filter((id) => id !== achievementId);
  if (nextCache.length !== cache.length) settingsStore.set(cacheKey, nextCache);

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('steam:achievement-relocked', achievementId);
  });
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
    // ── DIAGNOSTIC: lifecycle trace for first-achievement investigation ──────
    // Each step is logged to runtimeDiagnostics so the Windows runtime can confirm
    // exactly which of SetAchievement / StoreStats fails and at what readiness state.
    // These traces are redacted (no credentials, no API keys).
    runtimeDiagnostics.trace('unlock', 'init-start', { appId: targetAppId, achievementId });

    // 1. Initialize Steamworks for this single operation.
    //    steamworks.init() calls request_current_stats() internally but returns
    //    BEFORE the UserStatsReceived callback fires (the 30fps pump delivers it
    //    asynchronously). We must not call activate() until StoreStats is ready.
    const steamworks = require('steamworks.js');
    localClient = steamworks.init(targetAppId);
    runtimeDiagnostics.trace('unlock', 'init-returned', { appId: targetAppId });
    // We don't touch module-level `client` here — we use a local reference
    // so our finally block can clean up even if the module state was mucked with.

    // 2. Two-stage stats-readiness gate.
    //
    //    ROOT CAUSE (confirmed from Rust source + Steam Game Idler SteamworksSession.cs):
    //    - activate() = set() + store_stats() collapsed into one boolean.
    //    - is_activated() = get().unwrap_or(false) — ALWAYS returns false when the
    //      cache is not yet populated (unwrap_or(false) hides the error).
    //    - Therefore: is_activated() returning false does NOT prove write-readiness.
    //    - StoreStats fails when RequestCurrentStats has not completed its callback.
    //    - The 0.2.3 probe was detecting false from an empty cache and treating it as ready.
    //
    //    CORRECT GATE (mirrors Steam Game Idler's RequestUserStats spin-wait):
    //    Stage A: Wait for is_activated() to return false without throwing — confirms
    //             the cache has been initialized (RequestCurrentStats was sent).
    //    Stage B: Wait for stats.store() to return true — confirms RequestCurrentStats
    //             callback has fired and StoreStats will succeed.
    //    Both stages use async yields so the 30fps pump can fire between ticks.
    //    Hard timeout: 5 seconds per stage.
    const STATS_READY_TIMEOUT_MS = 5000;
    const STATS_READY_POLL_INTERVAL_MS = 40; // slightly longer than one pump tick (33ms)
    let stageAReady = false;
    let stageBReady = false;
    let stageAElapsed = 0;
    let stageBElapsed = 0;

    // Stage A: wait for is_activated() to not throw (cache initialized)
    const stageAStart = Date.now();
    while (!stageAReady) {
      try {
        localClient.achievement.isActivated(achievementId); // result ignored; we just need it not to throw
        stageAReady = true;
      } catch (_probeErr) {
        // Cache not yet initialized — continue polling.
      }
      if (!stageAReady) {
        if (Date.now() - stageAStart >= STATS_READY_TIMEOUT_MS) break;
        await new Promise(resolve => setTimeout(resolve, STATS_READY_POLL_INTERVAL_MS));
      }
    }
    stageAElapsed = Date.now() - stageAStart;
    runtimeDiagnostics.trace('unlock', 'readiness-stage-a', { stageAReady, stageAElapsedMs: stageAElapsed });

    if (stageAReady) {
      // Stage B: wait for stats.store() to return true (RequestCurrentStats callback fired)
      const stageBStart = Date.now();
      while (!stageBReady) {
        try {
          const storeProbe = localClient.stats.store();
          runtimeDiagnostics.trace('unlock', 'readiness-stage-b-probe', { storeProbe });
          if (storeProbe) {
            stageBReady = true;
          }
        } catch (_storeErr) {
          // store() threw — not ready yet.
        }
        if (!stageBReady) {
          if (Date.now() - stageBStart >= STATS_READY_TIMEOUT_MS) break;
          await new Promise(resolve => setTimeout(resolve, STATS_READY_POLL_INTERVAL_MS));
        }
      }
      stageBElapsed = Date.now() - stageBStart;
      runtimeDiagnostics.trace('unlock', 'readiness-stage-b', { stageBReady, stageBElapsedMs: stageBElapsed });
    }

    if (!stageAReady || !stageBReady) {
      errorMsg = `Steam stats not ready for writes (stageA=${stageAReady}, stageB=${stageBReady}).`;
      errorCode = 'STATS_NOT_READY';
    } else {
      // 3. Perform the unlock with bounded retry.
      //
      //    activate() = set() + store_stats() in one atomic Rust call.
      //    Valve documents: "You can unlock an achievement multiple times so you don't
      //    need to worry about only setting achievements that aren't already set."
      //    A bounded retry (up to MAX_ACTIVATE_ATTEMPTS) is therefore a documented-safe
      //    pattern — not a blind retry — justified by Valve's own guarantee.
      //    The retry is a safety net for transient Steam IPC hiccups, not a substitute
      //    for proper readiness gating (which Stage A + B already provide).
      const MAX_ACTIVATE_ATTEMPTS = 3;
      const ACTIVATE_RETRY_DELAYS_MS = [0, 2000, 5000];
      let attemptNum = 0;
      let lastActivateResult = false;
      while (attemptNum < MAX_ACTIVATE_ATTEMPTS && !success) {
        if (ACTIVATE_RETRY_DELAYS_MS[attemptNum] > 0) {
          await new Promise(resolve => setTimeout(resolve, ACTIVATE_RETRY_DELAYS_MS[attemptNum]));
        }
        runtimeDiagnostics.trace('unlock', 'activate-attempt', { achievementId, attempt: attemptNum + 1 });
        lastActivateResult = localClient.achievement.activate(achievementId);
        // DIAGNOSTIC: log the collapsed boolean. Since activate() = set() + store_stats(),
        // a false here means either SetAchievement or StoreStats failed. With Stage B
        // confirming StoreStats readiness, a false here most likely means SetAchievement
        // itself failed (e.g., achievement ID not found, already unlocked, or Steam error).
        runtimeDiagnostics.trace('unlock', 'activate-result', {
          achievementId,
          attempt: attemptNum + 1,
          activated: lastActivateResult,
          // Note: activate() collapses SetAchievement + StoreStats into one boolean.
          // Stage B above confirmed StoreStats readiness, so a false here is most likely
          // SetAchievement failing (not StoreStats). This is the diagnostic evidence.
          likelyFailingCall: lastActivateResult ? 'none' : 'SetAchievement (StoreStats confirmed ready by Stage B)',
        });
        if (lastActivateResult) {
          activationMayHaveApplied = true;
          success = true;
        }
        attemptNum++;
      }
      if (success) {
        // Activation acceptance is not remote proof. Both Instant and Humanized
        // callers now publish renderer/cache state only after their independent
        // verification path confirms Steam's reported unlock state.
      } else {
        errorMsg = `Activation returned false after ${attemptNum} attempt(s)`;
        errorCode = 'ACTIVATION_REJECTED';
      }
    }
    // If !stageAReady || !stageBReady, errorMsg/errorCode are set above; fall through to finally.
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
 * Relocks one currently-unlocked achievement through Steamworks ClearAchievement
 * followed by StoreStats. This is deliberately isolated from the existing
 * activation path: no global ResetAllStats call, no Humanized retargeting, and
 * no optimistic renderer/cache mutation before a defensible state is reached.
 */
async function relockAchievement(achievementId, expectedAppId = null) {
  const selectedGame = settingsStore.get('selectedGame');
  if (!selectedGame?.appId) {
    return { success: false, achievementId, error: 'No game selected.', errorCode: 'NO_SELECTED_GAME' };
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

  const ownerId = `relock-${Date.now()}-${++relockSequence}`;
  try {
    operationCoordinator.claim({ appId: targetAppId, achievementId, mode: 'relock', ownerId });
  } catch (error) {
    if (error instanceof OperationLeaseConflictError) {
      return {
        success: false,
        achievementId,
        appId: targetAppId,
        error: 'This achievement is already being processed by another operation.',
        errorCode: error.code,
      };
    }
    throw error;
  }

  const finalizeFailure = (result) => {
    operationCoordinator.release(targetAppId, achievementId, ownerId);
    return result;
  };
  let localClient = null;
  let localAccepted = false;
  let errorCode = null;
  let errorMessage = null;
  try {
    shutdown();
    prepareSteamRuntimeContext(Number(targetAppId));
    runtimeDiagnostics.trace('relock', 'init-start', { appId: targetAppId, achievementId });
    const steamworks = require('steamworks.js');
    localClient = steamworks.init(targetAppId);
    runtimeDiagnostics.trace('relock', 'init-returned', { appId: targetAppId, achievementId });

    // The installed client requests stats during init but returns before the
    // callback pump has populated the cache. Match the established unlock gate
    // before reading state, clearing an achievement, or storing changed stats.
    const timeoutMs = 5000;
    const pollMs = 40;
    const startedAt = Date.now();
    let cacheReady = false;
    while (!cacheReady && Date.now() - startedAt < timeoutMs) {
      try {
        localClient.achievement.isActivated(achievementId);
        cacheReady = true;
      } catch (_error) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
    runtimeDiagnostics.trace('relock', 'readiness-stage-a', { appId: targetAppId, achievementId, cacheReady, elapsedMs: Date.now() - startedAt });
    if (!cacheReady) {
      errorCode = 'STATS_NOT_READY';
      errorMessage = 'Steam achievement stats were not ready for a relock operation.';
      return finalizeFailure({ success: false, achievementId, appId: targetAppId, error: errorMessage, errorCode });
    }

    const wasUnlocked = localClient.achievement.isActivated(achievementId) === true;
    runtimeDiagnostics.trace('relock', 'local-state', { appId: targetAppId, achievementId, wasUnlocked });
    if (!wasUnlocked) {
      return finalizeFailure({
        success: false,
        achievementId,
        appId: targetAppId,
        error: 'Steam currently reports this achievement as locked; it was not changed.',
        errorCode: 'ACHIEVEMENT_ALREADY_LOCKED',
      });
    }

    // ClearAchievement mutates only Steam's in-memory state. StoreStats is the
    // required explicit persistence call documented by Valve. This is one local
    // operation with no retry and no global reset fallback.
    const clearAccepted = localClient.achievement.clear(achievementId) === true;
    runtimeDiagnostics.trace('relock', 'clear-result', { appId: targetAppId, achievementId, clearAccepted });
    if (!clearAccepted) {
      return finalizeFailure({
        success: false,
        achievementId,
        appId: targetAppId,
        error: 'Steam rejected the achievement clear request.',
        errorCode: 'RELOCK_REJECTED',
      });
    }
    const storeAccepted = localClient.stats.store() === true;
    runtimeDiagnostics.trace('relock', 'store-result', { appId: targetAppId, achievementId, storeAccepted });
    if (!storeAccepted) {
      return finalizeFailure({
        success: false,
        achievementId,
        appId: targetAppId,
        error: 'Steam did not accept the relock stats update.',
        errorCode: 'RELOCK_STORE_REJECTED',
      });
    }
    localAccepted = true;
  } catch (error) {
    errorCode = 'RELOCK_EXECUTION_FAILED';
    errorMessage = error instanceof Error ? error.message : String(error);
    runtimeDiagnostics.trace('relock', 'execution-failure', { appId: targetAppId, achievementId, errorCode, reason: errorMessage });
  } finally {
    try {
      localClient?.shutdown?.();
    } catch (_error) {
      // Cleanup never changes the operation outcome.
    } finally {
      localClient = null;
      client = null;
      initialized = false;
    }
  }

  if (!localAccepted) {
    return finalizeFailure({
      success: false,
      achievementId,
      appId: targetAppId,
      error: errorMessage || 'Steam could not relock this achievement.',
      errorCode: errorCode || 'RELOCK_EXECUTION_FAILED',
    });
  }

  try {
    let verification;
    try {
      verification = await getAchievementVerification(targetAppId, achievementId);
    } catch (error) {
      verification = {
        success: false,
        appId: targetAppId,
        achievementId,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'RELOCK_VERIFICATION_UNAVAILABLE',
      };
    }
    if (verification.success && verification.unlocked === false) {
      publishAchievementRelocked(targetAppId, achievementId);
      runtimeDiagnostics.trace('relock', 'verified-locked', { appId: targetAppId, achievementId, endpoint: verification.endpoint });
      return {
        success: true,
        state: 'relocked',
        achievementId,
        appId: targetAppId,
        localAccepted: true,
        verification,
      };
    }
    // A local StoreStats acceptance is meaningful, while a stale/unavailable
    // remote response is not proof of failure. Keep the UI in an explicit pending
    // state and never change the displayed lock state optimistically.
    const pendingReason = verification.success
      ? 'Steam still reports the previous unlocked state; relock verification is pending.'
      : 'Steam accepted the relock locally, but remote verification is currently unavailable.';
    runtimeDiagnostics.trace('relock', 'verification-pending', {
      appId: targetAppId,
      achievementId,
      verificationSuccess: verification.success,
      verificationUnlocked: verification.unlocked ?? null,
      errorCode: verification.errorCode || null,
    });
    return {
      success: true,
      state: 'verification-pending',
      achievementId,
      appId: targetAppId,
      localAccepted: true,
      message: pendingReason,
      verification,
    };
  } finally {
    operationCoordinator.release(targetAppId, achievementId, ownerId);
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
  if (!apiKey) {
    return { success: false, appId, achievementId, error: 'Steam Web API credential is unavailable.', errorCode: 'MISSING_API_KEY' };
  }
  if (!status.steamId) {
    return { success: false, appId, achievementId, error: 'Steam player identity is unavailable.', errorCode: 'MISSING_STEAM_ID' };
  }

  runtimeDiagnostics.trace('verification', 'request-start', {
    appId,
    achievementId,
    steamIdentityAvailable: Boolean(status.steamId),
    attemptDelaysMs: VERIFICATION_RETRY_DELAYS_MS,
  });
  const lastResult = await pollForVerifiedUnlock({
    delays: VERIFICATION_RETRY_DELAYS_MS,
    waitForDelay: waitForVerificationDelay,
    probe: async () => {
      const result = await steamApiClient.getPlayerAchievementState({
        apiKey,
        appId,
        steamId: status.steamId,
        achievementId,
      });
      if (result.success) return result;

      // A player response may omit an achievement that is valid in the game
      // schema (for example while Steam data is propagating). Fetch schema only
      // in that ambiguous case instead of on every polling attempt.
      if (result.errorCode === STEAM_READ_ERROR.PLAYER_ACHIEVEMENT_MISSING) {
        const schema = await steamApiClient.hasSchemaAchievement({ apiKey, appId, achievementId });
        if (schema.success && !schema.found) {
          return { success: false, errorCode: 'ACHIEVEMENT_NOT_FOUND', endpoint: 'achievement-schema' };
        }
        if (schema.success && schema.found) {
          return { success: false, errorCode: STEAM_READ_ERROR.PLAYER_STATE_INVALID, endpoint: 'player-achievements' };
        }
        return schema;
      }
      return result;
    },
  });

  if (lastResult?.success) {
    const verified = { success: true, appId, achievementId, unlocked: lastResult.unlocked === true, endpoint: lastResult.endpoint || 'player-achievements' };
    runtimeDiagnostics.trace('verification', 'request-result', {
      appId,
      achievementId,
      outcome: verified.unlocked ? 'confirmed-unlocked' : 'not-observed-yet',
      endpoint: verified.endpoint,
      errorCode: null,
    });
    return verified;
  }
  const unavailable = {
    success: false,
    appId,
    achievementId,
    error: 'Steam achievement verification could not determine the current player state.',
    errorCode: lastResult?.errorCode || STEAM_READ_ERROR.STEAM_SERVICE_UNAVAILABLE,
    endpoint: lastResult?.endpoint || null,
  };
  runtimeDiagnostics.trace('verification', 'request-result', {
    appId,
    achievementId,
    outcome: 'unavailable',
    endpoint: unavailable.endpoint,
    errorCode: unavailable.errorCode,
  });
  return unavailable;
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
  getTradingCardBadges,
  switchGame,
  getAchievements,
  getAchievementVerification,
  confirmVerifiedAchievement,
  getGlobalAchievementPercentages,
  unlockAchievement,
  relockAchievement,
  publishAchievementRelocked,
};
