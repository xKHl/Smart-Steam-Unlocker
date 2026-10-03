const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const {
  MAX_SIMULTANEOUS_GAMES,
  IDLE_STATE,
  selectIdleCandidates,
  reconcileWithLibrary,
  createIdleManager,
} = require('../electron/tradingCards/idleManager');

const game = (appId, dropStatus, remainingDrops = null, name = `Game ${appId}`) => ({ appId, name, dropStatus, remainingDrops });

test('idle candidates are only games with an explicit positive drop count, most drops first, capped below Steam limit', () => {
  const games = [game(1, 'remaining', 1), game(2, 'remaining', 4), game(3, 'exhausted', 0), game(4, 'unavailable'), game(5, 'remaining', 0)];
  assert.deepEqual(selectIdleCandidates(games).map((entry) => entry.appId), [2, 1]);
  assert.deepEqual(selectIdleCandidates(games, { appIds: [1] }).map((entry) => entry.appId), [1]);
  const many = Array.from({ length: 40 }, (_, index) => game(index + 1, 'remaining', 2));
  assert.equal(selectIdleCandidates(many).length, MAX_SIMULTANEOUS_GAMES);
  assert.ok(MAX_SIMULTANEOUS_GAMES < 32);
});

test('reconcile stops exhausted games, updates counts, and keeps games whose data is temporarily unknown', () => {
  const entries = [{ appId: 1, remainingDrops: 3 }, { appId: 2, remainingDrops: 1 }, { appId: 3, remainingDrops: 2 }];
  const { keep, finished } = reconcileWithLibrary(entries, [game(1, 'remaining', 2), game(2, 'exhausted', 0), game(3, 'unavailable')]);
  assert.deepEqual(keep, [{ appId: 1, remainingDrops: 2 }, { appId: 3, remainingDrops: 2 }]);
  assert.deepEqual(finished, [{ appId: 2, remainingDrops: 0 }]);
});

test('idle manager runs one worker per game, stops finished games, and completes when no drops are left', () => {
  const spawned = new Map();
  const stopped = [];
  const updates = [];
  const manager = createIdleManager({
    now: () => 10_000,
    onChange: (status) => updates.push(status.state),
    spawnWorker: (appId, handlers) => {
      spawned.set(appId, handlers);
      return { stop: () => stopped.push(appId) };
    },
  });

  const started = manager.start(selectIdleCandidates([game(1, 'remaining', 2), game(2, 'remaining', 1)]));
  assert.equal(started.state, IDLE_STATE.RUNNING);
  assert.deepEqual([...spawned.keys()].sort(), [1, 2]);
  assert.equal(started.totalRemainingDrops, 3);
  assert.ok(started.games.every((entry) => entry.running));

  let status = manager.applyLibrary([game(1, 'remaining', 1), game(2, 'exhausted', 0)]);
  assert.deepEqual(stopped, [2]);
  assert.deepEqual(status.games.map((entry) => entry.appId), [1]);
  assert.deepEqual(status.finished.map((entry) => entry.appId), [2]);

  status = manager.applyLibrary([game(1, 'exhausted', 0)]);
  assert.equal(status.state, IDLE_STATE.COMPLETED);
  assert.deepEqual(stopped, [2, 1]);
  assert.ok(updates.includes(IDLE_STATE.COMPLETED));
});

test('stopping all games kills every worker and a crashed worker is reported, not silently counted as idling', () => {
  const handlers = new Map();
  const stopped = [];
  const manager = createIdleManager({
    spawnWorker: (appId, callbacks) => { handlers.set(appId, callbacks); return { stop: () => stopped.push(appId) }; },
  });
  manager.start([{ appId: 7, name: 'Seven', remainingDrops: 2 }, { appId: 8, name: 'Eight', remainingDrops: 1 }]);
  handlers.get(7).onExit(1);
  const afterCrash = manager.status();
  assert.equal(afterCrash.games.find((entry) => entry.appId === 7).running, false);
  assert.equal(afterCrash.games.find((entry) => entry.appId === 7).error, 'EXITED_1');

  const afterStop = manager.stopAll();
  assert.equal(afterStop.state, IDLE_STATE.IDLE);
  assert.deepEqual(stopped, [8]);
  assert.equal(manager.isRunning(), false);
});

test('idle worker refuses an invalid App ID and exits instead of idling', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../electron/tradingCards/idleWorker.js'), 'not-a-number'], { timeout: 10_000 });
  assert.equal(result.status, 2);
});

test('idling requires Steam Community drop data, exits with the app, and never overlaps the launch monitor', () => {
  const service = fs.readFileSync(path.join(__dirname, '../electron/tradingCardsService.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '../electron/tradingCards/idleWorker.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  assert.match(service, /code: 'COMMUNITY_REQUIRED'/);
  assert.match(service, /code: 'CARD_IDLE_ACTIVE'/);
  assert.match(service, /code: 'TRADING_CARD_MONITOR_ACTIVE'/);
  assert.match(worker, /process\.on\('disconnect', \(\) => process\.exit\(0\)\)/);
  assert.match(main, /shutdownIdle\(\)/);
});
