/**
 * Typed Steam Web API read client. It intentionally contains no Electron,
 * settings, scheduler, or logging dependencies. Callers receive normalized error
 * categories and never receive request URLs containing credentials.
 */

const STEAM_READ_ERROR = Object.freeze({
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_STEAM_ID: 'MISSING_STEAM_ID',
  INVALID_API_KEY: 'INVALID_API_KEY',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  HTTP_CLIENT_ERROR: 'HTTP_CLIENT_ERROR',
  HTTP_SERVER_ERROR: 'HTTP_SERVER_ERROR',
  STEAM_SERVICE_UNAVAILABLE: 'STEAM_SERVICE_UNAVAILABLE',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  PLAYER_STATE_INVALID: 'PLAYER_STATE_INVALID',
  PLAYER_ACHIEVEMENT_MISSING: 'PLAYER_ACHIEVEMENT_MISSING',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  ACHIEVEMENT_NOT_FOUND: 'ACHIEVEMENT_NOT_FOUND',
});

function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return STEAM_READ_ERROR.INVALID_API_KEY;
  if (status === 429) return STEAM_READ_ERROR.RATE_LIMITED;
  if (status >= 500 && status <= 599) return STEAM_READ_ERROR.STEAM_SERVICE_UNAVAILABLE;
  if (status >= 400 && status <= 499) return STEAM_READ_ERROR.HTTP_CLIENT_ERROR;
  return STEAM_READ_ERROR.HTTP_SERVER_ERROR;
}

function readError(errorCode, endpoint, detail = null) {
  return { success: false, errorCode, endpoint, detail };
}

function steamApiUrl(interfaceName, method, params) {
  const search = new URLSearchParams(params);
  return `https://api.steampowered.com/${interfaceName}/${method}/?${search}`;
}

async function requestJson(fetchImpl, url, endpoint, timeoutMs = 10_000) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return readError(timeout ? STEAM_READ_ERROR.TIMEOUT : STEAM_READ_ERROR.CONNECTION_FAILED, endpoint);
  }

  if (!response?.ok) return readError(classifyHttpStatus(response?.status), endpoint, response?.status ?? null);
  try {
    return { success: true, endpoint, data: await response.json() };
  } catch {
    return readError(STEAM_READ_ERROR.MALFORMED_RESPONSE, endpoint);
  }
}

function createSteamApiClient({ fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  async function getPlayerAchievementState({ apiKey, appId, steamId, achievementId }) {
    if (!apiKey) return readError(STEAM_READ_ERROR.MISSING_API_KEY, 'player-achievements');
    if (!steamId) return readError(STEAM_READ_ERROR.MISSING_STEAM_ID, 'player-achievements');
    const url = steamApiUrl('ISteamUserStats', 'GetPlayerAchievements/v0001', {
      appid: String(appId), key: apiKey, steamid: String(steamId),
    });
    const result = await requestJson(fetchImpl, url, 'player-achievements', timeoutMs);
    if (!result.success) return result;

    const achievements = result.data?.playerstats?.achievements;
    if (!Array.isArray(achievements)) return readError(STEAM_READ_ERROR.PLAYER_STATE_INVALID, 'player-achievements');
    const matching = achievements.find((achievement) => achievement?.apiname === achievementId);
    if (!matching) return readError(STEAM_READ_ERROR.PLAYER_ACHIEVEMENT_MISSING, 'player-achievements');
    if (typeof matching.achieved !== 'number' && typeof matching.achieved !== 'boolean') {
      return readError(STEAM_READ_ERROR.PLAYER_STATE_INVALID, 'player-achievements');
    }
    return { success: true, endpoint: 'player-achievements', unlocked: Number(matching.achieved) === 1 || matching.achieved === true };
  }

  async function hasSchemaAchievement({ apiKey, appId, achievementId }) {
    if (!apiKey) return readError(STEAM_READ_ERROR.MISSING_API_KEY, 'achievement-schema');
    const url = steamApiUrl('ISteamUserStats', 'GetSchemaForGame/v2', { key: apiKey, appid: String(appId) });
    const result = await requestJson(fetchImpl, url, 'achievement-schema', timeoutMs);
    if (!result.success) return result;

    const achievements = result.data?.game?.availableGameStats?.achievements;
    if (!Array.isArray(achievements)) return readError(STEAM_READ_ERROR.SCHEMA_INVALID, 'achievement-schema');
    return { success: true, endpoint: 'achievement-schema', found: achievements.some((achievement) => achievement?.name === achievementId) };
  }

  return { getPlayerAchievementState, hasSchemaAchievement, requestJson };
}

module.exports = {
  STEAM_READ_ERROR,
  classifyHttpStatus,
  createSteamApiClient,
};
