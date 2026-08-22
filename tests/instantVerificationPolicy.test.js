'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  advancePendingVerification,
  createPendingVerification,
  verificationDelayMs,
} = require('../electron/instantVerificationPolicy');
const { createSteamApiClient } = require('../electron/steamApiClient');

const ROOT = path.join(__dirname, '..');
function source(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const policy = { backoffMs: [0, 5_000, 15_000], horizonMs: 60_000 };
function pending(at = 1_000) {
  return createPendingVerification({ achievementId: 'ACH_ONE', now: at, policy });
}

test('Immediate remote confirmation completes a pending accepted activation', () => {
  const transition = advancePendingVerification({
    pending: pending(),
    result: { success: true, unlocked: true, endpoint: 'player-achievements' },
    now: 1_000,
    policy,
  });

  assert.equal(transition.state, 'verified');
  assert.equal(transition.pending.attemptCount, 1);
  assert.equal(transition.pending.nextVerificationAt, null);
  assert.equal(transition.pending.autoContinue, false);
});

test('Delayed Steam propagation remains pending and later confirms without another activation', () => {
  const first = advancePendingVerification({
    pending: pending(),
    result: { success: true, unlocked: false, endpoint: 'player-achievements' },
    now: 1_000,
    policy,
  });
  assert.equal(first.state, 'pending');
  assert.equal(first.pending.confirmedNotUnlockedCount, 1);
  assert.equal(first.pending.nextVerificationAt, 1_000 + verificationDelayMs(1, policy));
  assert.equal(first.pending.autoContinue, true);

  const eventual = advancePendingVerification({
    pending: first.pending,
    result: { success: true, unlocked: true, endpoint: 'player-achievements' },
    now: first.pending.nextVerificationAt,
    policy,
  });
  assert.equal(eventual.state, 'verified');
  assert.equal(eventual.pending.attemptCount, 2);
});

test('Temporary Web API unavailability stays in bounded background verification', () => {
  const transition = advancePendingVerification({
    pending: pending(),
    result: { success: false, errorCode: 'TIMEOUT', error: 'The request timed out.', endpoint: 'player-achievements' },
    now: 1_000,
    policy,
  });

  assert.equal(transition.state, 'pending');
  assert.equal(transition.pending.lastResult.kind, 'unavailable');
  assert.equal(transition.pending.autoContinue, true);
  assert.equal(transition.pending.exhausted, false);
});

test('A non-recoverable remote verification failure preserves activation evidence and requires recovery', () => {
  const transition = advancePendingVerification({
    pending: pending(),
    result: { success: false, errorCode: 'INVALID_API_KEY', error: 'Credential rejected.', endpoint: 'player-achievements' },
    now: 1_000,
    policy,
  });

  assert.equal(transition.state, 'needs-attention');
  assert.equal(transition.pending.autoContinue, false);
  assert.equal(transition.pending.exhausted, true);
  assert.equal(transition.pending.nextVerificationAt, null);
});

test('A bounded horizon ends automatic polling without fabricating completion or failure', () => {
  const first = advancePendingVerification({
    pending: pending(),
    result: { success: true, unlocked: false, endpoint: 'player-achievements' },
    now: 1_000,
    policy,
  });
  const exhausted = advancePendingVerification({
    pending: first.pending,
    result: { success: true, unlocked: false, endpoint: 'player-achievements' },
    now: 61_000,
    policy,
  });

  assert.equal(exhausted.state, 'needs-attention');
  assert.equal(exhausted.pending.lastResult.kind, 'not-observed');
  assert.equal(exhausted.pending.exhausted, true);
});

test('Player-achievement reads do not use stale local cache between verification attempts', async () => {
  let requests = 0;
  const client = createSteamApiClient({
    fetchImpl: async () => {
      requests += 1;
      const achieved = requests === 1 ? 0 : 1;
      return {
        ok: true,
        json: async () => ({ playerstats: { achievements: [{ apiname: 'ACH_ONE', achieved }] } }),
      };
    },
  });

  const first = await client.getPlayerAchievementState({ apiKey: 'key', appId: 480, steamId: '76561198000000000', achievementId: 'ACH_ONE' });
  const second = await client.getPlayerAchievementState({ apiKey: 'key', appId: 480, steamId: '76561198000000000', achievementId: 'ACH_ONE' });
  assert.equal(first.unlocked, false);
  assert.equal(second.unlocked, true);
  assert.equal(requests, 2);
});

test('Instant queue performs background verification only while pending and never executes the same accepted item again', () => {
  const timer = source('electron/timerService.js');
  const handlers = source('electron/ipc/handlers.js');
  const preload = source('electron/preload.js');
  const page = source('src/pages/Achievements.jsx');

  assert.match(timer, /if \(pendingVerification\?\.autoContinue\) \{\s*await verifyPendingActivation\(\);\s*return;/);
  assert.match(timer, /No retry activation can occur while this evidence exists/);
  assert.match(timer, /queue\.shift\(\);/);
  assert.match(timer, /if \(transition\.state === 'verified'\) \{\s*completeVerifiedAchievement/);
  assert.match(timer, /pendingVerification = savedState\.pendingVerification \|\| null/);
  assert.match(timer, /isActive = Boolean\(pendingVerification\?\.autoContinue && queue\.length > 0\)/);
  assert.match(handlers, /timer:recheck-verification/);
  assert.match(preload, /recheckVerification: \(\) => ipcRenderer\.invoke\('timer:recheck-verification'\)/);
  assert.match(page, /Recheck Steam confirmation/);
  assert.match(page, /timerStatus\.pendingVerification/);
});
