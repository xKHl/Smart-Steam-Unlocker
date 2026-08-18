const assert = require('node:assert/strict');
const test = require('node:test');
const {
  IpcValidationError,
  assertAppId,
  sanitizeHumanizedPayload,
  sanitizeOrderingPayload,
  sanitizeOwnedGamesOptions,
  sanitizeSwitchGamePayload,
  sanitizeTimerPayload,
  sanitizeUnlockPayload,
} = require('../electron/ipc/validation');

const achievement = { id: 'ACH_WIN', name: 'Win', originalIndex: 0, globalPercent: 50, unlocked: false };

test('IPC validators accept bounded canonical payloads', () => {
  assert.equal(assertAppId('480'), 480);
  assert.deepEqual(sanitizeSwitchGamePayload({ appId: 480, name: 'Spacewar', headerImage: 'https://cdn.akamai.steamstatic.com/steam/apps/480/header.jpg' }), {
    appId: 480, name: 'Spacewar', headerImage: 'https://cdn.akamai.steamstatic.com/steam/apps/480/header.jpg',
  });
  assert.deepEqual(sanitizeUnlockPayload({ appId: 480, achievementId: 'ACH_WIN' }), { appId: 480, achievementId: 'ACH_WIN' });
  assert.equal(sanitizeOrderingPayload({ achievements: [], orderMode: 'original' }).achievements.length, 0);
  assert.equal(sanitizeTimerPayload({ achievements: [achievement], base: 1, variance: 15, fixedMins: 2 }).achievements[0].id, 'ACH_WIN');
  assert.equal(sanitizeOwnedGamesOptions({ forceRefresh: true }).forceRefresh, true);
  assert.equal(sanitizeHumanizedPayload({
    appId: 480, achievements: [achievement], orderMode: 'original', seed: 'safe-seed', startAt: 1_000,
    timelineOptions: { minIntervalMs: 1_000, maxIntervalMs: 2_000, maxRetries: 2 },
  }).appId, 480);
});

test('IPC validators reject wrong types, unsafe URLs, unexpected fields, duplicates, and invalid timing', () => {
  const invalid = (callback) => assert.throws(callback, (error) => error instanceof IpcValidationError && error.code === 'INVALID_IPC_PAYLOAD');
  invalid(() => assertAppId(0));
  invalid(() => sanitizeSwitchGamePayload({ appId: 480, name: 'Game', headerImage: 'file:///tmp/untrusted' }));
  invalid(() => sanitizeUnlockPayload({ appId: 480, achievementId: '../unsafe' }));
  invalid(() => sanitizeOwnedGamesOptions({ forceRefresh: 'yes' }));
  invalid(() => sanitizeOrderingPayload({ achievements: [], orderMode: 'not-a-mode' }));
  invalid(() => sanitizeTimerPayload({ achievements: [achievement], unexpected: true }));
  invalid(() => sanitizeHumanizedPayload({
    appId: 480, achievements: [achievement, { ...achievement, originalIndex: 1 }], orderMode: 'original', seed: 'safe', startAt: 1,
  }));
  invalid(() => sanitizeHumanizedPayload({
    appId: 480, achievements: [achievement], orderMode: 'original', seed: 'safe', startAt: 1,
    timelineOptions: { minIntervalMs: 2_000, maxIntervalMs: 1_000 },
  }));
});
