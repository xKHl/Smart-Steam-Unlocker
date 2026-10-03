/**
 * Persistent background relock verification tracker.
 *
 * After a successful local ClearAchievement + StoreStats, the relock operation
 * is recorded here. A background polling loop performs read-only verification
 * checks (never re-issues ClearAchievement) until Steam confirms the locked
 * state or the verification horizon is exhausted.
 *
 * State model per achievement:
 *   RELOCK_EXECUTION_SUCCEEDED → verification-pending → verified | exhausted
 *
 * The tracker:
 *   - Persists pending entries to settingsStore (survives restart)
 *   - Uses monotonic sequence numbers to reject stale responses
 *   - Never duplicates the ClearAchievement call
 *   - Publishes steam:achievement-relocked only after confirmed locked state
 *   - Is safe after pause/resume/restart
 */

const STORAGE_KEY = 'relockPendingVerifications';

const RELOCK_STATE = Object.freeze({
  VERIFICATION_PENDING: 'verification-pending',
  VERIFIED: 'verified',
  EXHAUSTED: 'exhausted',
});

const VERIFICATION_BACKOFF_MS = Object.freeze([0, 3_000, 8_000, 15_000, 30_000, 60_000, 120_000, 300_000]);
const VERIFICATION_HORIZON_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;

let settingsStore = null;
let steamManager = null;
let pollTimer = null;
let globalSequence = 0;

function now() {
  return Date.now();
}

function loadPending() {
  try {
    return settingsStore.get(STORAGE_KEY) || {};
  } catch {
    return {};
  }
}

function savePending(entries) {
  try {
    settingsStore.set(STORAGE_KEY, entries);
  } catch {
    // Preserve existing behavior — persistence errors are non-fatal here.
  }
}

function entryKey(appId, achievementId) {
  return `${appId}:${achievementId}`;
}

/**
 * Register a new relock that succeeded locally but whose remote verification
 * is still pending.
 */
function trackPendingRelock({ appId, achievementId }) {
  if (!appId || !achievementId) return null;
  const entries = loadPending();
  const key = entryKey(appId, achievementId);

  // Do not overwrite an existing pending entry (no duplicate relock)
  if (entries[key]?.state === RELOCK_STATE.VERIFICATION_PENDING) {
    return entries[key];
  }

  globalSequence += 1;
  const entry = {
    appId,
    achievementId,
    state: RELOCK_STATE.VERIFICATION_PENDING,
    localAcceptedAt: now(),
    verificationAttempts: 0,
    lastVerificationAt: null,
    nextVerificationAt: now(),
    horizonAt: now() + VERIFICATION_HORIZON_MS,
    sequence: globalSequence,
  };
  entries[key] = entry;
  savePending(entries);
  ensurePollLoop();
  return entry;
}

/**
 * Returns all pending relock entries for the given appId, or all if unspecified.
 */
function getPendingRelocks(appId = null) {
  const entries = loadPending();
  const results = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (appId !== null && String(entry.appId) !== String(appId)) continue;
    results[entry.achievementId] = { ...entry };
  }
  return results;
}

function verificationDelayMs(attemptCount) {
  const index = Math.min(Math.max(0, attemptCount), VERIFICATION_BACKOFF_MS.length - 1);
  return VERIFICATION_BACKOFF_MS[index];
}

/**
 * Background poll tick. Checks all pending relocks and verifies them
 * in a read-only manner (never re-issues ClearAchievement).
 */
async function pollTick() {
  if (!steamManager || !settingsStore) return;
  const entries = loadPending();
  const keys = Object.keys(entries);
  if (!keys.length) {
    stopPollLoop();
    return;
  }

  const currentTime = now();
  let changed = false;

  for (const key of keys) {
    const entry = entries[key];
    if (!entry || entry.state !== RELOCK_STATE.VERIFICATION_PENDING) continue;

    // Not due yet
    if (entry.nextVerificationAt && entry.nextVerificationAt > currentTime) continue;

    // Horizon exhausted — stop trying
    if (entry.horizonAt && currentTime >= entry.horizonAt) {
      entry.state = RELOCK_STATE.EXHAUSTED;
      entry.lastVerificationAt = currentTime;
      changed = true;
      continue;
    }

    // Capture the sequence before verification
    const capturedSequence = entry.sequence;

    let verification;
    try {
      verification = await steamManager.getAchievementVerification(entry.appId, entry.achievementId);
    } catch {
      // Verification unavailable — schedule next attempt
      entry.verificationAttempts += 1;
      entry.lastVerificationAt = currentTime;
      entry.nextVerificationAt = currentTime + verificationDelayMs(entry.verificationAttempts);
      changed = true;
      continue;
    }

    // Stale response protection: if sequence has changed since we started,
    // skip applying the result — a newer operation has replaced this entry.
    const currentEntries = loadPending();
    const currentEntry = currentEntries[key];
    if (!currentEntry || currentEntry.sequence !== capturedSequence) continue;

    entry.verificationAttempts += 1;
    entry.lastVerificationAt = currentTime;

    if (verification?.success && verification.unlocked === false) {
      // Steam now reports locked — relock verified
      entry.state = RELOCK_STATE.VERIFIED;
      changed = true;

      // Publish the relock event to the renderer and update optimistic cache
      try {
        steamManager.publishAchievementRelocked(entry.appId, entry.achievementId);
      } catch {
        // Non-fatal — state is already persisted as verified
      }
    } else {
      // Steam still reports unlocked or unavailable — schedule next attempt
      entry.nextVerificationAt = currentTime + verificationDelayMs(entry.verificationAttempts);
      changed = true;
    }
  }

  if (changed) savePending(entries);

  // Clean up verified/exhausted entries
  const currentEntries = loadPending();
  const remaining = {};
  let hasActive = false;
  for (const [key, entry] of Object.entries(currentEntries)) {
    if (entry.state === RELOCK_STATE.VERIFICATION_PENDING) {
      remaining[key] = entry;
      hasActive = true;
    }
    // Verified and exhausted entries are removed from persistence
  }
  if (Object.keys(remaining).length !== Object.keys(currentEntries).length) {
    savePending(remaining);
  }
  if (!hasActive) stopPollLoop();
}

function ensurePollLoop() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    pollTick().catch(() => {});
  }, POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

function stopPollLoop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * Initialize the tracker. Call at app startup after settingsStore and
 * steamManager are available.
 */
function init({ settingsStore: store, steamManager: manager }) {
  settingsStore = store;
  steamManager = manager;

  // Restore pending entries from persistence
  const entries = loadPending();
  const hasActive = Object.values(entries).some(
    (entry) => entry.state === RELOCK_STATE.VERIFICATION_PENDING
  );
  if (hasActive) ensurePollLoop();
}

function shutdown() {
  stopPollLoop();
}

module.exports = {
  RELOCK_STATE,
  ensurePollLoop,
  getPendingRelocks,
  init,
  shutdown,
  stopPollLoop,
  trackPendingRelock,
};
