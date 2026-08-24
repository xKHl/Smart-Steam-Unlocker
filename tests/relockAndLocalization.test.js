'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { sanitizeRelockPayload, IpcValidationError } = require('../electron/ipc/validation');

const ROOT = path.join(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('Relock IPC accepts only one validated App ID and achievement ID', () => {
  assert.deepEqual(sanitizeRelockPayload({ appId: 50130, achievementId: 'MDL_CHOP_CHOP!' }), {
    appId: 50130,
    achievementId: 'MDL_CHOP_CHOP!',
  });
  assert.throws(
    () => sanitizeRelockPayload({ appId: 50130, achievementId: 'ACH_ONE', resetAll: true }),
    IpcValidationError,
  );
  assert.throws(
    () => sanitizeRelockPayload({ appId: 0, achievementId: 'ACH_ONE' }),
    IpcValidationError,
  );
});

test('Relock uses native single-achievement clear plus StoreStats, never global reset, and treats remote observation separately', () => {
  const manager = source('electron/steamManager.js');
  const relock = manager.slice(manager.indexOf('async function relockAchievement'), manager.indexOf('/**\n * Reads the remote achievement state'));

  assert.match(relock, /localClient\.achievement\.clear\(achievementId\)/);
  assert.match(relock, /localClient\.stats\.store\(\)/);
  assert.doesNotMatch(relock, /resetAll/);
  assert.match(relock, /operationCoordinator\.claim/);
  assert.match(relock, /operationCoordinator\.release/);
  assert.match(relock, /ACHIEVEMENT_ALREADY_LOCKED/);
  assert.match(relock, /RELOCK_REJECTED/);
  assert.match(relock, /RELOCK_STORE_REJECTED/);
  assert.match(relock, /getAchievementVerification\(targetAppId, achievementId\)/);
  assert.match(relock, /state: 'verification-pending'/);
  assert.match(relock, /publishAchievementRelocked/);
});

test('Relock is exposed only through the validated preload and is blocked while a Humanized schedule is running', () => {
  const handlers = source('electron/ipc/handlers.js');
  const preload = source('electron/preload.js');

  assert.match(handlers, /steam:relock-achievement/);
  assert.match(handlers, /sanitizeRelockPayload/);
  assert.match(handlers, /schedule\?\.state === 'running'/);
  assert.match(handlers, /HUMANIZED_SCHEDULE_RUNNING/);
  assert.match(preload, /relockAchievement: \(appId, achievementId\)/);
  assert.match(preload, /onAchievementRelocked/);
});

test('Achievement renderer requires explicit Relock confirmation and does not change grid state before a verified response', () => {
  const page = source('src/pages/Achievements.jsx');
  const card = source('src/components/AchievementCard.jsx');

  assert.match(card, /\{unlocked && \(/);
  assert.match(page, /setRelockDialogAchievement\(achievement\)/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /result\.state === 'relocked'/);
  assert.match(page, /\[achievement\.id\]: 'verification-pending'/);
  assert.match(page, /onAchievementRelocked/);
});

test('English and Arabic locale infrastructure persists only supported values and applies true RTL metadata', async () => {
  const handlers = source('electron/ipc/handlers.js');
  const preload = source('electron/preload.js');
  const provider = source('src/i18n/index.jsx');
  const styles = source('src/index.css');
  const { translations } = await import('../src/i18n/translations.mjs');

  assert.match(handlers, /app:get-locale/);
  assert.match(handlers, /app:set-locale/);
  assert.match(handlers, /value !== 'en' && value !== 'ar'/);
  assert.match(preload, /getLocale/);
  assert.match(preload, /setLocale/);
  assert.equal(translations.en.mode.humanized, 'Humanized Mode');
  assert.equal(translations.ar.mode.humanized, 'محاكاة الإنسان');
  assert.equal(translations.ar.common.relock, 'إعادة قفل الإنجاز');
  assert.equal(translations.ar.scheduler.backgroundVerification, 'التحقق في الخلفية');
  assert.match(provider, /document\.documentElement\.dir = direction/);
  assert.match(provider, /document\.documentElement\.lang = locale/);
  assert.match(styles, /html\[dir='rtl'\] \.app-body \{ flex-direction: row-reverse; \}/);
  assert.match(styles, /html\[dir='rtl'\] \.sidebar \{ border-right: 0; border-left: 1px solid var\(--border\); \}/);
  assert.match(styles, /html\[dir='rtl'\] \.nav-link-active::before/);
});
