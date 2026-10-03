'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RELOCK_STATE } = require('../electron/relockTracker');

// ── In-memory settingsStore mock ─────────────────────────────────────────

function createMockSettingsStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (key) => data[key] ?? null,
    set: (key, value) => { data[key] = value; return true; },
    delete: (key) => { delete data[key]; return true; },
    _data: data,
  };
}

// ── Minimal steamManager mock ────────────────────────────────────────────

function createMockSteamManager({ verificationResults = {} } = {}) {
  const calls = { verification: [], publishRelocked: [] };
  const positions = new Map();

  return {
    calls,
    getAchievementVerification: async (appId, achievementId) => {
      const key = `${appId}:${achievementId}`;
      const index = positions.get(key) ?? 0;
      positions.set(key, index + 1);
      calls.verification.push({ appId, achievementId, index });

      const configured = Array.isArray(verificationResults[achievementId])
        ? verificationResults[achievementId]
        : [verificationResults[achievementId]];
      const result = configured[index] ?? configured[configured.length - 1];
      if (!result) return { success: true, unlocked: false };
      return result;
    },
    publishAchievementRelocked: (appId, achievementId) => {
      calls.publishRelocked.push({ appId, achievementId });
    },
  };
}

// ── Fresh tracker per test ───────────────────────────────────────────────

function loadTracker() {
  // Each test gets a fresh module instance to avoid shared state
  delete require.cache[require.resolve('../electron/relockTracker')];
  return require('../electron/relockTracker');
}

// ── Tests ────────────────────────────────────────────────────────────────

test('trackPendingRelock creates a persisted verification-pending entry', () => {
  const tracker = loadTracker();
  const store = createMockSettingsStore();
  const manager = createMockSteamManager();
  tracker.init({ settingsStore: store, steamManager: manager });
  tracker.stopPollLoop(); // Prevent background polling

  const entry = tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_1' });
  assert.ok(entry);
  assert.equal(entry.state, RELOCK_STATE.VERIFICATION_PENDING);
  assert.equal(entry.achievementId, 'ACH_1');
  assert.equal(entry.appId, 480);
  assert.ok(entry.localAcceptedAt > 0);

  // Persisted in the store
  const persisted = store.get('relockPendingVerifications');
  assert.ok(persisted['480:ACH_1']);
  assert.equal(persisted['480:ACH_1'].state, RELOCK_STATE.VERIFICATION_PENDING);

  tracker.shutdown();
});

test('trackPendingRelock does not overwrite an existing pending entry (no duplicate relock)', () => {
  const tracker = loadTracker();
  const store = createMockSettingsStore();
  const manager = createMockSteamManager();
  tracker.init({ settingsStore: store, steamManager: manager });
  tracker.stopPollLoop();

  const first = tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_1' });
  const firstSeq = first.sequence;
  const second = tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_1' });

  // Should return the existing entry, not create a new one
  assert.equal(second.sequence, firstSeq);

  tracker.shutdown();
});

test('getPendingRelocks returns per-achievement states for a given appId', () => {
  const tracker = loadTracker();
  const store = createMockSettingsStore();
  const manager = createMockSteamManager();
  tracker.init({ settingsStore: store, steamManager: manager });
  tracker.stopPollLoop();

  tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_1' });
  tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_2' });
  tracker.trackPendingRelock({ appId: 999, achievementId: 'OTHER' });

  const pending480 = tracker.getPendingRelocks(480);
  assert.ok(pending480['ACH_1']);
  assert.ok(pending480['ACH_2']);
  assert.equal(pending480['OTHER'], undefined);

  const pendingAll = tracker.getPendingRelocks();
  assert.ok(pendingAll['ACH_1']);
  assert.ok(pendingAll['ACH_2']);
  assert.ok(pendingAll['OTHER']);

  tracker.shutdown();
});

test('mixed batch: 10 achievements with individual success/pending/failed states', () => {
  const tracker = loadTracker();
  const store = createMockSettingsStore();
  const manager = createMockSteamManager();
  tracker.init({ settingsStore: store, steamManager: manager });
  tracker.stopPollLoop();

  // Simulate: some succeeded immediately (not tracked), some are pending, some failed (not tracked)
  // Only verification-pending entries are tracked
  tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_1' }); // pending
  tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_3' }); // pending
  tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_5' }); // pending
  tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_7' }); // pending

  const pending = tracker.getPendingRelocks(480);
  // Each tracked achievement has its own individual state
  assert.equal(Object.keys(pending).length, 4);
  for (const id of ['ACH_1', 'ACH_3', 'ACH_5', 'ACH_7']) {
    assert.equal(pending[id].state, RELOCK_STATE.VERIFICATION_PENDING);
  }
  // Non-tracked achievements are absent (they succeeded or failed at the steamManager level)
  for (const id of ['ACH_2', 'ACH_4', 'ACH_6', 'ACH_8', 'ACH_9', 'ACH_10']) {
    assert.equal(pending[id], undefined);
  }

  tracker.shutdown();
});

test('tracker persists state across simulated restart', () => {
  // Phase 1: create pending entries
  const tracker1 = loadTracker();
  const store = createMockSettingsStore();
  const manager = createMockSteamManager();
  tracker1.init({ settingsStore: store, steamManager: manager });
  tracker1.stopPollLoop();
  tracker1.trackPendingRelock({ appId: 480, achievementId: 'ACH_1' });
  tracker1.trackPendingRelock({ appId: 480, achievementId: 'ACH_2' });
  tracker1.shutdown();

  // Phase 2: simulate restart — new tracker instance, same store
  const tracker2 = loadTracker();
  tracker2.init({ settingsStore: store, steamManager: manager });
  tracker2.stopPollLoop();

  const pending = tracker2.getPendingRelocks(480);
  assert.equal(Object.keys(pending).length, 2);
  assert.equal(pending['ACH_1'].state, RELOCK_STATE.VERIFICATION_PENDING);
  assert.equal(pending['ACH_2'].state, RELOCK_STATE.VERIFICATION_PENDING);

  tracker2.shutdown();
});

test('relock tracker source code never calls ClearAchievement or activate', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const trackerSource = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'relockTracker.js'),
    'utf8'
  );

  // Strip comments (both // and /* */) before checking for disallowed calls
  const codeOnly = trackerSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  assert.doesNotMatch(codeOnly, /\.clear\(/);
  assert.doesNotMatch(codeOnly, /\.activate\(/);
  assert.doesNotMatch(codeOnly, /unlockAchievement/);
  // Only getAchievementVerification (read-only) and publishAchievementRelocked are used
  assert.match(trackerSource, /getAchievementVerification/);
  assert.match(trackerSource, /publishAchievementRelocked/);
});

test('relock verification state contract: each entry has the required fields', () => {
  const tracker = loadTracker();
  const store = createMockSettingsStore();
  const manager = createMockSteamManager();
  tracker.init({ settingsStore: store, steamManager: manager });
  tracker.stopPollLoop();

  tracker.trackPendingRelock({ appId: 480, achievementId: 'ACH_1' });
  const pending = tracker.getPendingRelocks(480);
  const entry = pending['ACH_1'];

  assert.ok(Number.isFinite(entry.appId));
  assert.ok(typeof entry.achievementId === 'string');
  assert.ok(typeof entry.state === 'string');
  assert.ok(Number.isFinite(entry.localAcceptedAt));
  assert.ok(Number.isInteger(entry.verificationAttempts));
  assert.ok(Number.isFinite(entry.nextVerificationAt));
  assert.ok(Number.isFinite(entry.horizonAt));
  assert.ok(Number.isInteger(entry.sequence));

  tracker.shutdown();
});

test('steamManager.relockAchievement source registers pending relocks with the tracker', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const managerSource = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'steamManager.js'),
    'utf8'
  );

  // After verification-pending, the tracker is called
  assert.match(managerSource, /relockTracker\.trackPendingRelock/);
  // The tracker is imported
  assert.match(managerSource, /require\('\.\/relockTracker'\)/);
  // The result includes localExecutionSucceeded
  assert.match(managerSource, /localExecutionSucceeded: true/);
});

test('preload exposes getRelockPending and IPC handler is registered', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const preload = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'preload.js'),
    'utf8'
  );
  const handlers = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'ipc', 'handlers.js'),
    'utf8'
  );

  assert.match(preload, /getRelockPending/);
  assert.match(preload, /steam:get-relock-pending/);
  assert.match(handlers, /steam:get-relock-pending/);
  assert.match(handlers, /relockTracker/);
  assert.match(handlers, /getPendingRelocks/);
});

test('Achievements page restores pending relock states from backend on mount', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'pages', 'Achievements.jsx'),
    'utf8'
  );

  assert.match(page, /getRelockPending/);
  assert.match(page, /restoredStates/);
  assert.match(page, /verification-pending/);
});
