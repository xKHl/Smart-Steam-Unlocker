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
const { BrowserWindow } = require('electron');

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

// Poll for steam.exe every 5 seconds if we haven't officially connected
setInterval(() => {
  if (!steamIsAvailable) {
    const { exec } = require('child_process');
    exec('tasklist /FI "IMAGENAME eq steam.exe" /NH', (err, stdout) => {
      if (!err && stdout.toLowerCase().includes('steam.exe')) {
        isSteamProcessRunning = true;
      } else {
        isSteamProcessRunning = false;
      }
    });
  }
}, 5000);

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
// Game Switching
// ─────────────────────────────────────────────────────────────────────────────

async function switchGame(appId) {
  // console.log(`[SteamManager] Preparing switch → AppID: ${appId}`);
  
  // Shutdown current client to release Steam context
  shutdown();
  
  try {
    fs.writeFileSync(path.join(process.cwd(), 'steam_appid.txt'), String(appId), 'utf8');
    // console.log(`[SteamManager] steam_appid.txt → ${appId}`);
  } catch (err) {
    // console.warn('[SteamManager] Could not update steam_appid.txt:', err.message);
  }
  
  currentAppId = appId;
  
  // We no longer eagerly initialize on switch! 
  // We remain 100% idle and lazy.
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Steamworks Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

async function initSteam(forceAppId = null) {
  // Use the provided AppID, or 480 (Spacewar) for the boot-time handshake
  let appId = forceAppId || 480;
  
  // Ensure steam_appid.txt exists so steamworks.js can identify the game context
  try {
    fs.writeFileSync(path.join(process.cwd(), 'steam_appid.txt'), String(appId), 'utf8');
  } catch { /* ignore */ }

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

async function getAchievements(appId, apiKey, steamId) {
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

    // Merge local optimistic cache (for immediate persistence across app restarts before Steam API updates)
    const cacheKey = `unlocked_cache_${appId}`;
    const optimisticCache = settingsStore.get(cacheKey) || [];
    for (const id of optimisticCache) {
      unlockedMap[id] = true;
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
async function unlockAchievement(achievementId) {
  // We determine the active AppID from the settings store
  const selectedGame = settingsStore.get('selectedGame');
  if (!selectedGame || !selectedGame.appId) {
    return { success: false, achievementId, error: 'No game selected' };
  }

  const targetAppId = selectedGame.appId;
  // console.log(`[SteamManager] Lazy unlocking "${achievementId}" for AppID ${targetAppId}...`);

  // Ensure any previous session is fully dead before we begin
  shutdown();

  // Ensure steam_appid.txt is set to the correct game before we spin up the context
  try {
    fs.writeFileSync(path.join(process.cwd(), 'steam_appid.txt'), String(targetAppId), 'utf8');
  } catch (err) {
    // console.warn('[SteamManager] Could not write steam_appid.txt:', err.message);
  }

  let localClient = null;
  let success = false;
  let errorMsg = null;

  try {
    // 1. Initialize Steamworks for this single operation
    const steamworks = require('steamworks.js');
    localClient = steamworks.init(targetAppId);
    // We don't touch module-level `client` here — we use a local reference
    // so our finally block can clean up even if the module state was mucked with

    // 2. Perform the unlock
    const activated = localClient.achievement.activate(achievementId);
    if (activated) {
      localClient.achievement.store();
      // console.log(`[SteamManager] ✓ Unlocked: ${achievementId}`);
      success = true;

      // Update local optimistic cache
      const cacheKey = `unlocked_cache_${targetAppId}`;
      const cache = settingsStore.get(cacheKey) || [];
      if (!cache.includes(achievementId)) {
        cache.push(achievementId);
        settingsStore.set(cacheKey, cache);
      }

      // Broadcast real-time unlock event to all windows
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('steam:achievement-unlocked', achievementId);
        }
      });
    } else {
      errorMsg = 'Activation returned false';
      // console.error(`[SteamManager] ✗ Activate returned false for: ${achievementId}`);
    }
  } catch (err) {
    errorMsg = err.message;
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
    return { success: true, achievementId };
  } else {
    return { success: false, achievementId, error: errorMsg || 'Unknown error' };
  }
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
  getOwnedGames,
  switchGame,
  getAchievements,
  getGlobalAchievementPercentages,
  unlockAchievement,
};
