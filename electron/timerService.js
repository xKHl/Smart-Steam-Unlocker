const { BrowserWindow } = require('electron');
const settingsStore = require('./settingsStore');
const steamManager = require('./steamManager');
const { operationCoordinator } = require('./operationCoordinator');

// ─────────────────────────────────────────────────────────────────────────────
// Timer State
// ─────────────────────────────────────────────────────────────────────────────

let queue = []; // Array of achievement objects: { id, name, ... }
let isActive = false;
let currentCountdown = 0; // seconds
let baseMultiplier = 1;
let varianceMins = 0;
let fixedMins = null;
let totalInQueue = 0;
let unlockedCount = 0;
// Last user-visible Instant execution state. A failed or unverified item remains
// in the queue; it must never silently disappear from the renderer.
let lastOutcome = null;
let tickInterval = null;

// Guard: prevents concurrent unlockNext() calls from overlapping.
// If the previous native Steamworks call is still in-flight, we must not
// fire another one. Without this guard a slow/stalled unlock can trigger
// a second (and third…) unlock on subsequent ticks.
let isUnlocking = false;
let activeAppId = null;
let leaseOwnerId = null;

function resolveAppId() {
  const selectedGame = settingsStore.get('selectedGame');
  return selectedGame?.appId ?? steamManager.getStatus().currentAppId ?? null;
}

function ownerFor(appId) {
  return `instant:${appId}:${Date.now()}`;
}

function synchronizeQueueLeases(nextQueue = queue, nextAppId = activeAppId, nextOwnerId = leaseOwnerId) {
  if (!nextQueue.length || !nextAppId || !nextOwnerId) {
    if (leaseOwnerId) operationCoordinator.releaseOwner(leaseOwnerId);
    leaseOwnerId = null;
    return;
  }

  const leases = nextQueue.map((achievement) => ({
    appId: nextAppId,
    achievementId: achievement.id,
    mode: 'instant',
    ownerId: nextOwnerId,
    state: isActive ? 'running' : 'paused',
  }));
  operationCoordinator.replaceOwner(leaseOwnerId, leases);
  leaseOwnerId = nextOwnerId;
}

// ─────────────────────────────────────────────────────────────────────────────

function init() {
  const savedState = settingsStore.get('timerState');
  if (savedState) {
    const status = steamManager.getStatus();
    const selectedAppId = resolveAppId() ?? status.currentAppId;
    // Only restore if the selected game matches the saved queue.
    if (savedState.appId === selectedAppId) {
      queue = savedState.queue || [];
      activeAppId = savedState.appId;
      leaseOwnerId = savedState.leaseOwnerId || ownerFor(activeAppId);
      baseMultiplier = savedState.baseMultiplier ?? savedState.baseMins ?? 1;
      varianceMins = savedState.varianceMins || 0;
      fixedMins = savedState.fixedMins || null;
      currentCountdown = savedState.currentCountdown || 0;
      totalInQueue = savedState.totalInQueue || 0;
      unlockedCount = savedState.unlockedCount || 0;
      lastOutcome = savedState.lastOutcome || null;
      isActive = false; // Always start paused on app boot
      synchronizeQueueLeases();
      // console.log(`[TimerService] Restored queue for AppID ${savedState.appId}.`);
    } else {
      settingsStore.delete('timerState');
    }
  }
}

function saveState() {
  settingsStore.set('timerState', {
    appId: activeAppId ?? resolveAppId(),
    leaseOwnerId,
    queue,
    baseMultiplier,
    varianceMins,
    fixedMins,
    currentCountdown,
    totalInQueue,
    unlockedCount,
    lastOutcome,
  });
}

function emitUpdate() {
  const status = getStatus();
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    // Only send if the window isn't destroyed
    if (!win.isDestroyed()) {
      win.webContents.send('timer:update', status);
    }
  });
}

function getStatus() {
  return {
    isActive,
    queue,
    currentCountdown,
    baseMultiplier,
    varianceMins,
    fixedMins,
    totalInQueue,
    unlockedCount,
    lastOutcome,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Logic
// ─────────────────────────────────────────────────────────────────────────────

function calculateNextDelay() {
  if (queue.length === 0) return 0;
  
  if (fixedMins !== null) {
    // Manual Override completely bypasses variance and smart math
    return Math.max(1, Math.floor(fixedMins * 60));
  }
  
  const achievement = queue[0];
  const percent = typeof achievement.globalPercent === 'number' ? achievement.globalPercent : 50;
  
  // Base rarity delay (in minutes): 
  // 100% (common) -> 5 mins. 0% (rare) -> 60 mins.
  const baseRarityMins = 5 + ((100 - percent) / 100) * 55;
  
  // Scale by the user-defined multiplier
  const totalMinsScaled = baseRarityMins * baseMultiplier;
  
  // Add random variance
  const randomVariance = Math.random() * varianceMins;
  
  const finalMins = totalMinsScaled + randomVariance;
  return Math.max(1, Math.floor(finalMins * 60)); // Convert to seconds, minimum 1 second
}

/**
 * Unlocks the first item in the queue, then either:
 *   • arms the next countdown and ensures the tick loop is running, or
 *   • stops the queue if nothing remains.
 *
 * Critical invariants:
 *   1. isUnlocking is ALWAYS released in the finally block.
 *   2. The tick interval is verified/restarted after a successful unlock so a
 *      previous hang that cleared tickInterval never permanently halts the queue.
 */
async function unlockNext() {
  // Concurrency guard — never allow two unlocks in flight simultaneously
  if (isUnlocking) {
    // console.warn('[TimerService] unlockNext() called while already unlocking — skipping tick.');
    return;
  }

  if (!isActive || queue.length === 0) {
    stopQueue();
    return;
  }

  // The queued lease is App-ID bound. Never let mutable selected-game state
  // redirect an existing Instant operation to another application.
  if (!activeAppId || String(resolveAppId()) !== String(activeAppId)) {
    stopQueue();
    return;
  }

  isUnlocking = true;
  const achievement = queue[0];
  // console.log(`[TimerService] Unlocking "${achievement.name || achievement.id}" …`);

  let result;
  try {
    result = await steamManager.unlockAchievement(achievement.id, activeAppId);
  } catch (err) {
    // steamManager should never throw (it catches internally), but be safe
    result = { success: false, achievementId: achievement.id, error: err.message };
  }

  try {
  if (result.success) {
    // Native activation only confirms that steamworks accepted the call. Use the
    // established read-only verifier before publishing the renderer/cache update.
    let verification;
    try {
      verification = await steamManager.getAchievementVerification(activeAppId, achievement.id);
    } catch (error) {
      verification = { success: false, errorCode: 'VERIFICATION_EXCEPTION', error: error instanceof Error ? error.message : String(error) };
    }

    if (verification?.success && verification.unlocked) {
      steamManager.confirmVerifiedAchievement(activeAppId, achievement.id);
      queue.shift(); // Remove only after remote Steam confirmation.
      unlockedCount++;
      lastOutcome = {
        state: 'verified',
        achievementId: achievement.id,
        message: `Steam remotely verified ${achievement.name || achievement.id} as unlocked.`,
        errorCode: null,
      };
      synchronizeQueueLeases(); // Completed items deterministically release their lease.

      if (queue.length > 0 && isActive) {
        currentCountdown = calculateNextDelay();
        saveState();
        emitUpdate();
        if (!tickInterval) startTickLoop();
      } else {
        stopQueue();
      }
    } else {
      // Activation may have reached Steam, but there is no remote confirmation.
      // Keep the item visible and paused instead of consuming it as a success.
      lastOutcome = {
        state: 'verification-pending',
        achievementId: achievement.id,
        message: verification?.success
          ? 'Steam accepted activation, but has not yet reported the achievement as unlocked. The item remains queued for review.'
          : `Steam accepted activation, but remote verification is unavailable: ${verification?.error || 'unknown verification error'}`,
        errorCode: verification?.errorCode || 'VERIFICATION_UNAVAILABLE',
      };
      currentCountdown = 0;
      stopQueue();
    }
  } else {
    // Do not consume a failed selected achievement. It stays visible in the
    // paused queue together with an actionable Steam error and error code.
    lastOutcome = {
      state: result?.operationMayHaveApplied ? 'verification-pending' : 'failed',
      achievementId: achievement.id,
      message: result?.operationMayHaveApplied
        ? `${result?.error || 'Steam execution state is uncertain.'} The item remains queued because activation may have reached Steam.`
        : (result?.error || 'Steam could not unlock this achievement. The item remains queued.'),
      errorCode: result?.errorCode || 'STEAM_EXECUTION_FAILED',
    };
    currentCountdown = 0;
    stopQueue();
  }
  } finally {
    // Do not release the lock until activation and remote verification finish.
    isUnlocking = false;
  }
}

/**
 * Starts (or restarts) the 1-second tick interval.
 * Extracted so it can be called both from startQueue() and from the
 * post-unlock recovery path in unlockNext().
 */
function startTickLoop() {
  if (tickInterval) clearInterval(tickInterval);

  tickInterval = setInterval(() => {
    if (!isActive) return;

    // If an unlock is currently in-flight, freeze the countdown display
    // (don't decrement) but keep the interval alive.
    if (isUnlocking) return;

    currentCountdown--;
    emitUpdate();

    if (currentCountdown <= 0) {
      // Prevent the interval from firing again while we await the unlock
      unlockNext();
    }
  }, 1000);
}

function startQueue(achievements, multiplier, variance, overrideMins = null) {
  baseMultiplier = multiplier ?? 1;
  varianceMins = variance ?? 0;
  fixedMins = overrideMins;

  // If new parameters are passed, overwrite the queue after atomically
  // reserving every unresolved AppID + achievement lease for Instant mode.
  if (achievements && achievements.length > 0) {
    const nextAppId = resolveAppId();
    if (!nextAppId) throw new Error('No selected App ID is available for the Instant queue.');
    const nextOwnerId = ownerFor(nextAppId);
    synchronizeQueueLeases(achievements, nextAppId, nextOwnerId);
    queue = achievements;
    activeAppId = nextAppId;
    leaseOwnerId = nextOwnerId;
    totalInQueue = achievements.length;
    unlockedCount = 0;
    lastOutcome = null;
    currentCountdown = calculateNextDelay();
  } else if (queue.length > 0) {
    synchronizeQueueLeases();
  }

  if (queue.length === 0) return getStatus();

  isActive = true;
  synchronizeQueueLeases();
  saveState();
  
  startTickLoop();
  emitUpdate();
  return getStatus();
}

function stopQueue() {
  isActive = false;
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
  synchronizeQueueLeases();
  saveState();
  emitUpdate();
  return getStatus();
}

function clearQueue() {
  stopQueue();
  queue = [];
  synchronizeQueueLeases();
  activeAppId = null;
  currentCountdown = 0;
  totalInQueue = 0;
  unlockedCount = 0;
  lastOutcome = null;
  fixedMins = null;
  settingsStore.delete('timerState');
  emitUpdate();
  return getStatus();
}

module.exports = {
  init,
  getStatus,
  startQueue,
  stopQueue,
  clearQueue
};
