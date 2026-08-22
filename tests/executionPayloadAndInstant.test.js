'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  IpcValidationError,
  sanitizeHumanizedPayload,
  sanitizeTimerPayload,
} = require('../electron/ipc/validation');

const ROOT = path.join(__dirname, '..');
const payloadModule = pathToFileURL(path.join(ROOT, 'src/lib/executionAchievementPayload.mjs')).href;

function source(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function canonicalAchievement(overrides = {}) {
  return {
    id: 'ACH_SINGLE',
    name: 'Single achievement',
    description: 'Test achievement',
    originalIndex: 0,
    globalPercent: 42,
    hidden: false,
    unlocked: false,
    ...overrides,
  };
}

describe('execution achievement IPC boundary', () => {
  test('projects read-only UI fields out before strict execution IPC', async () => {
    const { projectExecutionAchievement, projectExecutionAchievements } = await import(payloadModule);
    const uiAchievement = canonicalAchievement({
      unlockTime: 1_725_000_000,
      iconUrl: 'https://cdn.example/icon.jpg',
      localOnlyMarker: 'must-not-cross-ipc',
    });
    const projected = projectExecutionAchievement(uiAchievement);

    assert.deepEqual(projected, canonicalAchievement());
    assert.equal(Object.hasOwn(projected, 'unlockTime'), false);
    assert.equal(Object.hasOwn(projected, 'localOnlyMarker'), false);
    assert.deepEqual(projectExecutionAchievements([uiAchievement]), [projected]);
    assert.equal(sanitizeTimerPayload({ achievements: [projected], base: 1, variance: 0, fixedMins: 1 }).achievements[0].id, 'ACH_SINGLE');
  });

  test('strict validator still rejects a leaked unlockTime field instead of accepting arbitrary data', () => {
    const withUiOnlyTimestamp = canonicalAchievement({ unlockTime: 1_725_000_000 });
    for (const validate of [
      () => sanitizeTimerPayload({ achievements: [withUiOnlyTimestamp], base: 1, variance: 0, fixedMins: 1 }),
      () => sanitizeHumanizedPayload({
        appId: 480,
        achievements: [withUiOnlyTimestamp],
        orderMode: 'natural-story-progression',
        seed: 'strict-payload',
        startAt: 1_000,
      }),
    ]) {
      assert.throws(validate, (error) => error instanceof IpcValidationError && /unsupported field "unlockTime"/.test(error.message));
    }
  });

  test('all supported Humanized ordering modes accept canonical projected achievements', () => {
    const supportedModes = [
      'original',
      'natural-story-progression',
      'most-common-to-rarest',
      'rarest-to-most-common',
    ];
    for (const orderMode of supportedModes) {
      const payload = sanitizeHumanizedPayload({
        appId: 480,
        achievements: [canonicalAchievement()],
        orderMode,
        seed: `mode-${orderMode}`,
        startAt: 1_000,
      });
      assert.equal(payload.orderMode, orderMode);
      assert.equal(payload.achievements[0].id, 'ACH_SINGLE');
    }
  });
});

describe('single-achievement Instant result flow', () => {
  test('the renderer awaits queue acceptance, retains selection on rejection, and sends a projected payload', () => {
    const page = source('src/pages/Achievements.jsx');
    const startHandler = page.slice(page.indexOf('const handleStartQueue = async'), page.indexOf('const handleStopQueue'));

    assert.match(startHandler, /projectExecutionAchievements\(/);
    assert.match(startHandler, /await window\.steamAPI\?\.timer\.startQueue/);
    assert.match(startHandler, /selected achievements are still available/);
    const awaitIndex = startHandler.indexOf('await window.steamAPI?.timer.startQueue');
    const clearSelectionIndex = startHandler.indexOf('setSelectedIds(new Set())');
    assert.ok(awaitIndex >= 0 && clearSelectionIndex > awaitIndex, 'selection must clear only after queue IPC acknowledgement');
    assert.match(page, /Instant queue did not start/);
    assert.match(page, /Steam verification complete/);
    assert.match(page, /Steam confirmation pending/);
  });

  test('the backend keeps the selected item and actionable result when activation or verification fails', () => {
    const timer = source('electron/timerService.js');
    const manager = source('electron/steamManager.js');

    assert.match(timer, /await steamManager\.unlockAchievement\(achievement\.id, activeAppId\)/);
    assert.match(timer, /await steamManager\.getAchievementVerification\(activeAppId, pendingVerification\.achievementId\)/);
    assert.match(timer, /state: 'verification-pending'/);
    assert.match(timer, /if \(result\?\.success \|\| result\?\.operationMayHaveApplied\)/);
    assert.match(timer, /No retry activation can occur while this evidence exists/);
    assert.match(timer, /function completeVerifiedAchievement\(achievement\) \{[\s\S]*?queue\.shift\(\);/);
    assert.match(timer, /lastOutcome/);
    assert.match(manager, /Activation acceptance is not remote proof/);
    assert.doesNotMatch(manager, /if \(!expectedAppId\) publishAchievementUnlocked/);
  });
});

describe('creator profile versus project repository links', () => {
  test('creator card opens the personal profile while Settings keeps its explicitly-labelled repository link', () => {
    const sidebar = source('src/components/Sidebar.jsx');
    const settings = source('src/pages/Settings.jsx');
    const handlers = source('electron/ipc/handlers.js');

    assert.match(sidebar, /openExternal\('https:\/\/github\.com\/xKHl'\)/);
    assert.doesNotMatch(sidebar, /github\.com\/xKHl\/Smart-Steam-Unlocker/);
    assert.match(settings, /GitHub Repository/);
    assert.match(settings, /https:\/\/github\.com\/xKHl\/Smart-Steam-Unlocker/);
    assert.match(handlers, /'https:\/\/github\.com\/xKHl'/);
    assert.match(handlers, /'https:\/\/github\.com\/xKHl\/Smart-Steam-Unlocker'/);
  });
});
