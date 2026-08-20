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
  test('steamManager uses isActivated as the readiness probe before activate()', () => {
    const sm = source('electron/steamManager.js');
    // The readiness poll must use isActivated as the probe.
    assert.match(sm, /isActivated\(achievementId\)/,
      'isActivated(achievementId) must be used as the stats-readiness probe');
    // The probe result must be checked for typeof boolean.
    assert.match(sm, /typeof probeResult === 'boolean'/,
      'Readiness is confirmed by a boolean return from isActivated');
    // The gate must have a hard timeout.
    assert.match(sm, /STATS_READY_TIMEOUT_MS/,
      'A hard timeout constant must guard the readiness poll');
    // The gate must yield to the event loop between poll ticks.
    assert.match(sm, /STATS_READY_POLL_INTERVAL_MS/,
      'A poll interval must yield to the callback pump between ticks');
    // The timeout must produce a distinct error code.
    assert.match(sm, /STATS_NOT_READY/,
      'Timeout must produce STATS_NOT_READY error code');
  });

  test('activate() is only called after statsReady is true', () => {
    const sm = source('electron/steamManager.js');
    // The activate call must be guarded by the statsReady flag.
    assert.match(sm, /if \(statsReady\)/,
      'activate() must be inside an if(statsReady) block');
    // The readiness loop must break on success.
    assert.match(sm, /statsReady = true/,
      'statsReady must be set to true when the probe returns a boolean');
  });

  test('STATS_READY_TIMEOUT_MS is at least 2000ms and at most 5000ms', () => {
    const sm = source('electron/steamManager.js');
    const match = sm.match(/STATS_READY_TIMEOUT_MS\s*=\s*(\d+)/);
    assert.ok(match, 'STATS_READY_TIMEOUT_MS must be defined as a numeric constant');
    const ms = Number(match[1]);
    assert.ok(ms >= 2000, `STATS_READY_TIMEOUT_MS (${ms}) must be at least 2000ms`);
    assert.ok(ms <= 5000, `STATS_READY_TIMEOUT_MS (${ms}) must be at most 5000ms`);
  });

  test('STATS_READY_POLL_INTERVAL_MS is shorter than one callback pump tick (33ms)', () => {
    const sm = source('electron/steamManager.js');
    const match = sm.match(/STATS_READY_POLL_INTERVAL_MS\s*=\s*(\d+)/);
    assert.ok(match, 'STATS_READY_POLL_INTERVAL_MS must be defined as a numeric constant');
    const ms = Number(match[1]);
    assert.ok(ms < 33, `STATS_READY_POLL_INTERVAL_MS (${ms}) must be shorter than one 30fps pump tick (33ms)`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Redundant double-store removal
// ─────────────────────────────────────────────────────────────────────────────

describe('Redundant stats.store() removal after activate()', () => {
  test('unlockAchievement does not call stats.store() after activate()', () => {
    const sm = source('electron/steamManager.js');
    // Find the unlockAchievement function body.
    const unlockStart = sm.indexOf('async function unlockAchievement(');
    assert.ok(unlockStart >= 0, 'unlockAchievement function must exist');
    // Find the end of the function (next top-level async function or module.exports).
    const afterUnlock = sm.slice(unlockStart);
    const nextFnMatch = afterUnlock.match(/\n(?:async function|function|module\.exports)/);
    const unlockBody = nextFnMatch
      ? afterUnlock.slice(0, nextFnMatch.index)
      : afterUnlock;
    // The body must not contain localClient.stats.store() — that is the redundant call.
    assert.doesNotMatch(unlockBody, /localClient\.stats\.store\(\)/,
      'localClient.stats.store() must not appear in unlockAchievement — activate() already calls store_stats() internally');
  });

  test('activate() is documented as including an internal store_stats() call', () => {
    const sm = source('electron/steamManager.js');
    // The comment explaining why stats.store() is not needed must be present.
    assert.match(sm, /activate\(\).*calls.*SetAchievement.*StoreStats|activate\(\).*store_stats\(\).*internally/s,
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
