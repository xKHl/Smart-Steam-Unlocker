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
    result = await steamManager.unlockAchievement(achievement.id);
  } catch (err) {
    // steamManager should never throw (it catches internally), but be safe
    result = { success: false, achievementId: achievement.id, error: err.message };
  } finally {
    // Release the lock unconditionally
    isUnlocking = false;
  }

  if (result.success) {
    queue.shift(); // Remove the successfully unlocked item
    unlockedCount++;
    synchronizeQueueLeases(); // Completed items deterministically release their lease.
    // console.log(`[TimerService] ✓ Unlocked ${result.achievementId} (${unlockedCount}/${totalInQueue})`);

    if (queue.length > 0 && isActive) {
      // Arm the countdown for the next achievement
      currentCountdown = calculateNextDelay();
      // console.log(`[TimerService] Next unlock in ${currentCountdown}s — "${queue[0].name || queue[0].id}"`);
      saveState();
      emitUpdate();

      // ── CRITICAL: ensure the tick loop is still alive ──────────────────
      // If a previous Steamworks hang blocked the event loop long enough
      // for the interval to have been cleared, restart it now so the
      // countdown actually ticks down instead of sitting frozen forever.
      if (!tickInterval) {
        // console.warn('[TimerService] Tick interval was dead — restarting it now.');
        startTickLoop();
      }
    } else {
      // console.log('[TimerService] Queue finished.');
      stopQueue();
    }
  } else {
    // A terminal failure releases this item. Remaining queued items stay paused
    // and retain their leases so a later resume cannot conflict with Humanized.
    queue.shift();
    synchronizeQueueLeases();
    // console.error(`[TimerService] ✗ Failed to unlock ${achievement.id}:`, result.error);
    stopQueue();
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
    currentCountdown = calculateNextDelay();
  } else if (queue.length > 0) {
    synchronizeQueueLeases();
  }

  if (queue.length === 0) return;

  isActive = true;
  synchronizeQueueLeases();
  saveState();
  
  startTickLoop();
  emitUpdate();
}

function stopQueue() {
  isActive = false;
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
  synchronizeQueueLeases();
  saveState();
  emitUpdate();
}

function clearQueue() {
  stopQueue();
  queue = [];
  synchronizeQueueLeases();
  activeAppId = null;
  currentCountdown = 0;
  totalInQueue = 0;
  unlockedCount = 0;
  fixedMins = null;
  settingsStore.delete('timerState');
  emitUpdate();
}

module.exports = {
  init,
  getStatus,
  startQueue,
  stopQueue,
  clearQueue
};
