'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const integrityModule = pathToFileURL(path.join(ROOT, 'src/lib/achievementIntegrity.mjs')).href;

function source(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

async function integrity() {
  return import(integrityModule);
}

function achievement(index, {
  unlocked = true,
  unlockTime = null,
  id = `ACH_${index}`,
} = {}) {
  return {
    id,
    name: `Achievement ${index}`,
    unlocked,
    unlockTime,
    originalIndex: index,
  };
}

describe('Achievement Integrity local analysis', () => {
  test('returns Normal when the available evidence has no material anomaly signal', async () => {
    const { analyzeAchievementIntegrity, INTEGRITY_TIERS } = await integrity();
    const analysis = analyzeAchievementIntegrity({
      achievements: [achievement(0, { unlockTime: 1000 }), achievement(1, { unlockTime: 1000 + 86400 })],
      game: { playtimeMinutes: 240 },
    });
    assert.equal(analysis.tier, INTEGRITY_TIERS.NORMAL);
    assert.equal(analysis.score, 0);
    assert.equal(analysis.context.analysisLocalOnly, true);
    assert.equal(analysis.context.steamReportedTimelineOnly, true);
  });

  test('identifies a compressed timestamp burst without claiming intent', async () => {
    const { analyzeAchievementIntegrity, INTEGRITY_TIERS } = await integrity();
    const analysis = analyzeAchievementIntegrity({
      achievements: [0, 1, 2, 3].map((index) => achievement(index, { unlockTime: 10_000 + index * 20 })),
      game: { playtimeMinutes: 300 },
    });
    assert.equal(analysis.tier, INTEGRITY_TIERS.UNUSUAL);
    assert.equal(analysis.score, 15);
    assert.equal(analysis.signals[0].id, 'timing-burst');
    assert.match(analysis.tierCopy.description, /non-conclusive patterns/i);
  });

  test('combines timing and reverse schema progression as High Anomaly evidence', async () => {
    const { analyzeAchievementIntegrity, INTEGRITY_TIERS } = await integrity();
    const achievements = [7, 6, 5, 4, 3, 2, 1, 0].map((index, timelineIndex) => achievement(index, { unlockTime: 20_000 + timelineIndex * 30 }));
    const analysis = analyzeAchievementIntegrity({ achievements, game: { playtimeMinutes: 180 } });
    assert.equal(analysis.tier, INTEGRITY_TIERS.HIGH);
    assert.equal(analysis.score, 50);
    assert.deepEqual(analysis.signals.map((signal) => signal.id), ['timing-burst', 'progression-order']);
  });

  test('assigns Extreme Anomaly only when multiple strong observed signals compound', async () => {
    const { analyzeAchievementIntegrity, INTEGRITY_TIERS } = await integrity();
    const achievements = Array.from({ length: 12 }, (_, timelineIndex) => achievement(11 - timelineIndex, { unlockTime: 30_000 + timelineIndex * 15 }));
    const analysis = analyzeAchievementIntegrity({ achievements, game: { playtimeMinutes: 5 } });
    assert.equal(analysis.tier, INTEGRITY_TIERS.EXTREME);
    assert.equal(analysis.score, 95);
    assert.equal(analysis.summary.playtimeMinutes, 5);
  });

  test('sorts the evidence timeline chronologically and excludes absent Steam timestamps', async () => {
    const { buildEvidenceTimeline } = await integrity();
    const timeline = buildEvidenceTimeline([
      achievement(2, { unlockTime: 300 }),
      achievement(1, { unlockTime: 100 }),
      achievement(0, { unlockTime: null }),
      achievement(3, { unlocked: false, unlockTime: 200 }),
    ]);
    assert.deepEqual(timeline.map((entry) => entry.id), ['ACH_1', 'ACH_2']);
    assert.deepEqual(timeline.map((entry) => entry.unlockTime), [100, 300]);
  });
});

describe('Achievement Integrity integration boundaries', () => {
  test('keeps the integrity workflow read-only and registered in route and navigation', () => {
    const page = source('src/pages/AchievementIntegrity.jsx');
    const app = source('src/App.jsx');
    const sidebar = source('src/components/Sidebar.jsx');
    const preload = source('electron/preload.js');
    const handlers = source('electron/ipc/handlers.js');

    assert.match(page, /getAchievementIntegrityData/);
    assert.doesNotMatch(page, /unlockAchievement|humanized\.(?:create|replace|start)|timer\.(?:startQueue|clearQueue)/);
    assert.match(page, /Local-first and privacy-first/);
    assert.match(page, /not unlock, modify, submit, or publish achievements/);
    assert.match(app, /path="\/integrity"/);
    assert.match(sidebar, /nav-integrity/);
    assert.match(preload, /getAchievementIntegrityData/);
    assert.match(handlers, /steam:get-achievement-integrity-data/);
    assert.match(handlers, /includeOptimisticCache: false/);
  });

  test('preserves only a positive Steam unlocktime and does not fabricate cache timestamps', () => {
    const manager = source('electron/steamManager.js');
    assert.match(manager, /unlockTime: Number\.isFinite\(Number\(pa\.unlocktime\)\) && Number\(pa\.unlocktime\) > 0/);
    assert.match(manager, /unlockStateMap\[id\] = \{ \.\.\.\(unlockStateMap\[id\] \|\| \{\}\), unlocked: true \}/);
    assert.match(manager, /unlockTime: unlockState\.unlockTime \?\? null/);
  });
});
