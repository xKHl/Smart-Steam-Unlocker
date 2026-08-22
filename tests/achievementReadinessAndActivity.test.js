/**
 * Regression tests for:
 *   1. Stats-readiness gate in unlockAchievement (first-achievement race fix)
 *   2. Removal of redundant stats.store() double-call after activate()
 *   3. Dashboard Activity card using playtime_2weeks instead of hardcoded Unavailable
 *
 * These are pure source-level tests — no Steamworks native module is loaded.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function source(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Stats-readiness gate
// ─────────────────────────────────────────────────────────────────────────────

describe('Stats-readiness gate in unlockAchievement', () => {
  test('steamManager uses a two-stage readiness gate before activate()', () => {
    const sm = source('electron/steamManager.js');
    // Stage A: isActivated() must be used as the cache-initialization probe.
    assert.match(sm, /isActivated\(achievementId\)/,
      'isActivated(achievementId) must be used as the Stage A readiness probe');
    // Stage A must set stageAReady = true.
    assert.match(sm, /stageAReady = true/,
      'Stage A must set stageAReady = true when the probe does not throw');
    // Stage B: stats.store() must be used as the write-readiness probe.
    assert.match(sm, /storeProbe = localClient\.stats\.store\(\)/,
      'stats.store() must be used as the Stage B write-readiness probe');
    // Stage B must set stageBReady = true.
    assert.match(sm, /stageBReady = true/,
      'Stage B must set stageBReady = true when stats.store() returns true');
    // The gate must have a hard timeout.
    assert.match(sm, /STATS_READY_TIMEOUT_MS/,
      'A hard timeout constant must guard the readiness poll');
    // The gate must yield to the event loop between poll ticks.
    assert.match(sm, /STATS_READY_POLL_INTERVAL_MS/,
      'A poll interval must yield to the callback pump between ticks');
    // The timeout must produce a distinct error code.
    assert.match(sm, /STATS_NOT_READY/,
      'Timeout must produce STATS_NOT_READY error code');
    // Both stages must be confirmed before activate() is called.
    assert.match(sm, /if \(!stageAReady \|\| !stageBReady\)/,
      'activate() must only be called when both stageAReady and stageBReady are true');
  });

  test('activate() is only called after both readiness stages pass', () => {
    const sm = source('electron/steamManager.js');
    // The activate call must be inside the else branch of the stageA/B check.
    assert.match(sm, /} else \{[\s\S]*?localClient\.achievement\.activate\(achievementId\)/,
      'activate() must be inside the else branch after the stageA+B check');
    // The bounded retry must be present.
    assert.match(sm, /MAX_ACTIVATE_ATTEMPTS/,
      'A bounded retry constant must be present for activate()');
    assert.match(sm, /ACTIVATE_RETRY_DELAYS_MS/,
      'Retry delays must be defined for the bounded retry');
  });

  test('STATS_READY_TIMEOUT_MS is at least 3000ms and at most 10000ms', () => {
    const sm = source('electron/steamManager.js');
    const match = sm.match(/STATS_READY_TIMEOUT_MS\s*=\s*(\d+)/);
    assert.ok(match, 'STATS_READY_TIMEOUT_MS must be defined as a numeric constant');
    const ms = Number(match[1]);
    assert.ok(ms >= 3000, `STATS_READY_TIMEOUT_MS (${ms}) must be at least 3000ms`);
    assert.ok(ms <= 10000, `STATS_READY_TIMEOUT_MS (${ms}) must be at most 10000ms`);
  });

  test('STATS_READY_POLL_INTERVAL_MS is at least one pump tick (33ms) and at most 200ms', () => {
    const sm = source('electron/steamManager.js');
    const match = sm.match(/STATS_READY_POLL_INTERVAL_MS\s*=\s*(\d+)/);
    assert.ok(match, 'STATS_READY_POLL_INTERVAL_MS must be defined as a numeric constant');
    const ms = Number(match[1]);
    assert.ok(ms >= 33, `STATS_READY_POLL_INTERVAL_MS (${ms}) must be at least one pump tick (33ms)`);
    assert.ok(ms <= 200, `STATS_READY_POLL_INTERVAL_MS (${ms}) must be at most 200ms`);
  });

  test('bounded retry uses Valve-documented safe pattern with backoff', () => {
    const sm = source('electron/steamManager.js');
    // MAX_ACTIVATE_ATTEMPTS must be defined.
    const attemptsMatch = sm.match(/MAX_ACTIVATE_ATTEMPTS\s*=\s*(\d+)/);
    assert.ok(attemptsMatch, 'MAX_ACTIVATE_ATTEMPTS must be defined');
    const attempts = Number(attemptsMatch[1]);
    assert.ok(attempts >= 2 && attempts <= 5, `MAX_ACTIVATE_ATTEMPTS (${attempts}) must be between 2 and 5`);
    // The retry must be justified by Valve documentation in a comment.
    assert.match(sm, /unlock an achievement multiple times/,
      'Bounded retry must be justified by Valve documentation comment');
  });

  test('diagnostic traces log init, readiness stages, and activate result separately', () => {
    const sm = source('electron/steamManager.js');
    assert.match(sm, /runtimeDiagnostics\.trace\('unlock', 'init-start'/,
      'Must trace init-start');
    assert.match(sm, /runtimeDiagnostics\.trace\('unlock', 'init-returned'/,
      'Must trace init-returned');
    assert.match(sm, /runtimeDiagnostics\.trace\('unlock', 'readiness-stage-a'/,
      'Must trace readiness-stage-a');
    assert.match(sm, /runtimeDiagnostics\.trace\('unlock', 'readiness-stage-b'/,
      'Must trace readiness-stage-b');
    assert.match(sm, /runtimeDiagnostics\.trace\('unlock', 'activate-result'/,
      'Must trace activate-result');
    // The diagnostic must log the likelyFailingCall field.
    assert.match(sm, /likelyFailingCall/,
      'Diagnostic must identify the likely failing call (SetAchievement vs StoreStats)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Redundant double-store removal
// ─────────────────────────────────────────────────────────────────────────────

describe('stats.store() usage in unlockAchievement', () => {
  test('stats.store() is used as a Stage B write-readiness probe, not as a post-activation double-store', () => {
    const sm = source('electron/steamManager.js');
    // Find the unlockAchievement function body.
    const unlockStart = sm.indexOf('async function unlockAchievement(');
    assert.ok(unlockStart >= 0, 'unlockAchievement function must exist');
    const afterUnlock = sm.slice(unlockStart);
    const nextFnMatch = afterUnlock.match(/\n(?:async function|function|module\.exports)/);
    const unlockBody = nextFnMatch
      ? afterUnlock.slice(0, nextFnMatch.index)
      : afterUnlock;
    // stats.store() IS present as the Stage B readiness probe (storeProbe = localClient.stats.store()).
    assert.match(unlockBody, /storeProbe = localClient\.stats\.store\(\)/,
      'stats.store() must be used as the Stage B write-readiness probe');
    // But stats.store() must NOT appear AFTER activate() as a redundant second call.
    // The activate() call is inside the else branch; stats.store() must only appear in Stage B.
    const activateIdx = unlockBody.indexOf('localClient.achievement.activate(achievementId)');
    assert.ok(activateIdx >= 0, 'activate() must be present in unlockAchievement');
    const afterActivate = unlockBody.slice(activateIdx);
    // After activate(), there must be no standalone localClient.stats.store() call.
    assert.doesNotMatch(afterActivate, /localClient\.stats\.store\(\)/,
      'localClient.stats.store() must not appear after activate() — that would be a redundant double-store');
  });

  test('activate() is documented as including an internal store_stats() call', () => {
    const sm = source('electron/steamManager.js');
    // The comment explaining the activate() semantics must be present.
    assert.match(sm, /activate\(\).*=.*set\(\).*store_stats\(\)|activate\(\).*store_stats\(\).*internally/s,
      'A comment must document that activate() includes an internal store_stats() call');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Dashboard Activity card — playtime_2weeks
// ─────────────────────────────────────────────────────────────────────────────

describe('Dashboard Activity card uses playtime_2weeks', () => {
  test('Activity card label is Recent Activity, not Last Activity', () => {
    const dash = source('src/pages/Dashboard.jsx');
    assert.match(dash, /label: 'Recent Activity'/,
      "Activity card label must be 'Recent Activity'");
    assert.doesNotMatch(dash, /label: 'Last Activity'/,
      "Activity card must not use the old 'Last Activity' label");
  });

  test('Activity card uses playtime2Weeks from library data', () => {
    const dash = source('src/pages/Dashboard.jsx');
    assert.match(dash, /playtime2Weeks/,
      'Activity card must reference playtime2Weeks from the game object');
  });

  test('Activity card shows truthful no-activity message when playtime2Weeks is zero', () => {
    const dash = source('src/pages/Dashboard.jsx');
    assert.match(dash, /No recent activity reported by Steam/,
      "Activity card must show 'No recent activity reported by Steam' when playtime2Weeks is zero");
  });

  test('Activity card shows playtime in hours and minutes when non-zero', () => {
    const dash = source('src/pages/Dashboard.jsx');
    // The formatting logic must compute hours and minutes from minutes.
    assert.match(dash, /Math\.floor\(mins \/ 60\)/,
      'Activity card must compute hours from minutes');
    assert.match(dash, /mins % 60/,
      'Activity card must compute remaining minutes');
  });

  test('Activity card shows "Played in the last 2 weeks" sub-label when active', () => {
    const dash = source('src/pages/Dashboard.jsx');
    assert.match(dash, /Played in the last 2 weeks/,
      "Activity card sub-label must say 'Played in the last 2 weeks' when playtime2Weeks > 0");
  });

  test('Activity card does not use rtime_last_played', () => {
    const dash = source('src/pages/Dashboard.jsx');
    assert.doesNotMatch(dash, /rtime_last_played/,
      'Activity card must not use the undocumented rtime_last_played field');
  });

  test('Activity card does not hardcode Unavailable as its value', () => {
    const dash = source('src/pages/Dashboard.jsx');
    // The old hardcoded value must be gone.
    assert.doesNotMatch(dash, /value: 'Unavailable',\s*\n\s*sub: 'Steam library data has no reliable last-played timestamp'/,
      'Activity card must not hardcode Unavailable as its value');
  });

  test('Activity card shows None reported when no game is selected and phase is ready', () => {
    const dash = source('src/pages/Dashboard.jsx');
    assert.match(dash, /None reported/,
      "Activity card must show 'None reported' when playtime2Weeks is zero or missing");
  });

  test('Activity card is semantically separate from Selected Game card', () => {
    const dash = source('src/pages/Dashboard.jsx');
    // stat-activity and dashboard-current-card must be separate elements.
    assert.match(dash, /id: 'stat-activity'/,
      'Activity card must have id stat-activity');
    assert.match(dash, /dashboard-current-card/,
      'Selected game card must remain as dashboard-current-card');
    // They must not be the same element.
    const activityIdx = dash.indexOf("id: 'stat-activity'");
    const currentIdx = dash.indexOf('dashboard-current-card');
    assert.ok(activityIdx !== currentIdx,
      'Activity card and Selected Game card must be separate elements');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. playtime_2weeks field is present in the library game objects
// ─────────────────────────────────────────────────────────────────────────────

describe('Library game objects include playtime2Weeks', () => {
  test('steamManager.getOwnedGames maps playtime_2weeks to playtime2Weeks', () => {
    const sm = source('electron/steamManager.js');
    assert.match(sm, /playtime2Weeks\s*:\s*g\.playtime_2weeks/,
      'getOwnedGames must map g.playtime_2weeks to playtime2Weeks on the game object');
  });
});
