/**
 * Card idling: runs several games "in the background" at once so Trading Card
 * drops accrue, and stops each game when Steam reports no drops left.
 *
 * Planning functions are pure; the manager takes an injected `spawnWorker` so
 * process handling is testable without Electron or Steam.
 */

// Steam allows at most 32 games to be "in game" at once; stay safely below.
const MAX_SIMULTANEOUS_GAMES = 30;

const IDLE_STATE = Object.freeze({
  IDLE: 'inactive',
  RUNNING: 'running',
  COMPLETED: 'completed',
});

/** Games with an explicit positive remaining-drop count, most drops first. */
function selectIdleCandidates(games, { appIds = null, max = MAX_SIMULTANEOUS_GAMES } = {}) {
  const wanted = Array.isArray(appIds) && appIds.length ? new Set(appIds.map(Number)) : null;
  return (Array.isArray(games) ? games : [])
    .filter((game) => game?.dropStatus === 'remaining' && Number.isInteger(game.remainingDrops) && game.remainingDrops > 0)
    .filter((game) => !wanted || wanted.has(Number(game.appId)))
    .sort((left, right) => right.remainingDrops - left.remainingDrops || String(left.name).localeCompare(String(right.name)))
    .slice(0, Math.max(1, max))
    .map((game) => ({ appId: Number(game.appId), name: String(game.name || `App ${game.appId}`), remainingDrops: game.remainingDrops }));
}

/** Splits idled games into those still dropping and those Steam reports as finished. */
function reconcileWithLibrary(entries, games) {
  const byAppId = new Map((Array.isArray(games) ? games : []).map((game) => [Number(game.appId), game]));
  const keep = [];
  const finished = [];
  entries.forEach((entry) => {
    const game = byAppId.get(entry.appId);
    if (game?.dropStatus === 'exhausted') finished.push({ ...entry, remainingDrops: 0 });
    else if (game?.dropStatus === 'remaining' && Number.isInteger(game.remainingDrops)) keep.push({ ...entry, remainingDrops: game.remainingDrops });
    else keep.push(entry);
  });
  return { keep, finished };
}

function createIdleManager({ spawnWorker, now = () => Date.now(), onChange = () => {} } = {}) {
  if (typeof spawnWorker !== 'function') throw new Error('A worker spawner is required.');

  let state = IDLE_STATE.IDLE;
  let startedAt = null;
  let entries = [];
  let finishedEntries = [];
  const workers = new Map();

  function snapshot() {
    return {
      state,
      startedAt,
      elapsedMs: startedAt ? now() - startedAt : 0,
      games: entries.map((entry) => ({ ...entry, running: workers.has(entry.appId) })),
      finished: finishedEntries.map((entry) => ({ ...entry })),
      totalRemainingDrops: entries.reduce((sum, entry) => sum + (entry.remainingDrops || 0), 0),
    };
  }

  function emit() {
    try { onChange(snapshot()); } catch { /* listeners must not break idling */ }
  }

  function stopWorker(appId) {
    const worker = workers.get(appId);
    workers.delete(appId);
    if (worker) {
      try { worker.stop(); } catch { /* already exited */ }
    }
  }

  function startWorker(entry) {
    const worker = spawnWorker(entry.appId, {
      onExit: (code) => {
        if (workers.get(entry.appId) !== worker) return;
        workers.delete(entry.appId);
        const current = entries.find((item) => item.appId === entry.appId);
        if (current) current.error = code === 0 ? null : `EXITED_${code}`;
        emit();
      },
      onError: (error) => {
        const current = entries.find((item) => item.appId === entry.appId);
        if (current) current.error = String(error || 'WORKER_ERROR');
        emit();
      },
    });
    workers.set(entry.appId, worker);
  }

  function start(candidates) {
    stopAll({ silent: true });
    entries = candidates.map((candidate) => ({ ...candidate, error: null }));
    finishedEntries = [];
    if (!entries.length) {
      state = IDLE_STATE.IDLE;
      startedAt = null;
      emit();
      return snapshot();
    }
    state = IDLE_STATE.RUNNING;
    startedAt = now();
    entries.forEach(startWorker);
    emit();
    return snapshot();
  }

  /** Applies fresh Steam drop data: stops finished games, completes when none are left. */
  function applyLibrary(games) {
    if (state !== IDLE_STATE.RUNNING) return snapshot();
    const { keep, finished } = reconcileWithLibrary(entries, games);
    finished.forEach((entry) => stopWorker(entry.appId));
    finishedEntries = [...finishedEntries, ...finished];
    entries = keep;
    if (!entries.length) {
      state = IDLE_STATE.COMPLETED;
    }
    emit();
    return snapshot();
  }

  function stopGame(appId) {
    const id = Number(appId);
    stopWorker(id);
    entries = entries.filter((entry) => entry.appId !== id);
    if (!entries.length && state === IDLE_STATE.RUNNING) {
      state = IDLE_STATE.IDLE;
      startedAt = null;
    }
    emit();
    return snapshot();
  }

  function stopAll({ silent = false } = {}) {
    [...workers.keys()].forEach(stopWorker);
    entries = [];
    state = IDLE_STATE.IDLE;
    startedAt = null;
    if (!silent) emit();
    return snapshot();
  }

  return { start, applyLibrary, stopGame, stopAll, status: snapshot, isRunning: () => state === IDLE_STATE.RUNNING };
}

module.exports = {
  MAX_SIMULTANEOUS_GAMES,
  IDLE_STATE,
  selectIdleCandidates,
  reconcileWithLibrary,
  createIdleManager,
};
