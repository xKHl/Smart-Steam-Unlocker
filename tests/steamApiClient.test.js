const assert = require('node:assert/strict');
const test = require('node:test');
const { STEAM_READ_ERROR, createSteamApiClient } = require('../electron/steamApiClient');

function response({ status = 200, body, jsonError = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonError) throw jsonError;
      return body;
    },
  };
}

function clientFor(sequence) {
  let index = 0;
  return createSteamApiClient({
    fetchImpl: async () => {
      const next = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  });
}

const baseRequest = { apiKey: 'a'.repeat(32), appId: 480, steamId: '76561198000000000', achievementId: 'ACH_WIN' };

test('player achievement contract parses confirmed unlocked and confirmed not-unlocked responses', async () => {
  let client = clientFor([response({ body: { playerstats: { achievements: [{ apiname: 'ACH_WIN', achieved: 1 }] } } })]);
  assert.deepEqual(await client.getPlayerAchievementState(baseRequest), { success: true, endpoint: 'player-achievements', unlocked: true });

  client = clientFor([response({ body: { playerstats: { achievements: [{ apiname: 'ACH_WIN', achieved: 0 }] } } })]);
  assert.deepEqual(await client.getPlayerAchievementState(baseRequest), { success: true, endpoint: 'player-achievements', unlocked: false });
});

test('player achievement contract normalizes auth, rate-limit, and service failures', async () => {
  for (const [status, expected] of [[401, STEAM_READ_ERROR.INVALID_API_KEY], [403, STEAM_READ_ERROR.INVALID_API_KEY], [429, STEAM_READ_ERROR.RATE_LIMITED], [503, STEAM_READ_ERROR.STEAM_SERVICE_UNAVAILABLE]]) {
    const client = clientFor([response({ status })]);
    const result = await client.getPlayerAchievementState(baseRequest);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, expected);
    assert.equal(result.endpoint, 'player-achievements');
  }
});

test('player achievement contract distinguishes timeout, connection, malformed JSON, and missing player fields', async () => {
  const timeout = new Error('request timed out');
  timeout.name = 'TimeoutError';
  let client = clientFor([timeout]);
  assert.equal((await client.getPlayerAchievementState(baseRequest)).errorCode, STEAM_READ_ERROR.TIMEOUT);

  client = clientFor([new Error('socket reset')]);
  assert.equal((await client.getPlayerAchievementState(baseRequest)).errorCode, STEAM_READ_ERROR.CONNECTION_FAILED);

  client = clientFor([response({ jsonError: new Error('invalid JSON') })]);
  assert.equal((await client.getPlayerAchievementState(baseRequest)).errorCode, STEAM_READ_ERROR.MALFORMED_RESPONSE);

  client = clientFor([response({ body: { playerstats: {} } })]);
  assert.equal((await client.getPlayerAchievementState(baseRequest)).errorCode, STEAM_READ_ERROR.PLAYER_STATE_INVALID);
});

test('player-achievement absence is distinct from a known schema absence', async () => {
  const client = clientFor([
    response({ body: { playerstats: { achievements: [] } } }),
    response({ body: { game: { availableGameStats: { achievements: [{ name: 'ACH_WIN' }] } } } }),
  ]);
  const player = await client.getPlayerAchievementState(baseRequest);
  assert.equal(player.errorCode, STEAM_READ_ERROR.PLAYER_ACHIEVEMENT_MISSING);
  assert.deepEqual(await client.hasSchemaAchievement(baseRequest), { success: true, endpoint: 'achievement-schema', found: true });
});

test('credential and Steam identity preconditions do not make network requests', async () => {
  const client = createSteamApiClient({ fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal((await client.getPlayerAchievementState({ ...baseRequest, apiKey: '' })).errorCode, STEAM_READ_ERROR.MISSING_API_KEY);
  assert.equal((await client.getPlayerAchievementState({ ...baseRequest, steamId: '' })).errorCode, STEAM_READ_ERROR.MISSING_STEAM_ID);
});
