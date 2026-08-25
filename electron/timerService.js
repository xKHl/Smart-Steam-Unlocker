const { BrowserWindow } = require('electron');
const settingsStore = require('./settingsStore');
const steamManager = require('./steamManager');
const { operationCoordinator } = require('./operationCoordinator');
const {
  DEFAULT_INSTANT_VERIFICATION_POLICY,
  advancePendingVerification,
  createPendingVerification,
} = require('./instantVerificationPolicy');

// ─────────────────────────────────────────────────────────────────────────────
// Timer State
// ─────────────────────────────────────────────────────────────────────────────

let queue = [];
let isActive = false;
let currentCountdown = 0;
let baseMultiplier = 1;
let varianceMins = 0;
let fixedMins = null;
let totalInQueue = 0;
let unlockedCount = 0;
let lastOutcome = null;
// Immutable evidence that native Steamworks accepted an activation but the
// authoritative Web API has not yet confirmed it. While present, the timer can
// only read/verify this achievement; it cannot activate it again.
let pendingVerification = null;
// Invalidates an in-flight read when Stop, Resume, Clear, or a manual recheck
// changes the intended verification state before that read returns.
let verificationGeneration = 0;
let tickInterval = null;
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

function init() {
  const savedState = settingsStore.get('timerState');
  if (!savedState) return;

  const status = steamManager.getStatus();
  const selectedAppId = resolveAppId() ?? status.currentAppId;
  if (savedState.appId !== selectedAppId) {
    settingsStore.delete('timerState');
    return;
  }

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
  pendingVerification = savedState.pendingVerification || null;

  // Existing queued execution still restores paused. An already accepted
  // activation is different: resuming its read-only confirmation loop cannot
  // duplicate an external write and is necessary for restart recovery.
  isActive = Boolean(pendingVerification?.autoContinue && queue.length > 0);
  if (isActive) {
    setVerificationCountdown();
    startTickLoop();
  }
  synchronizeQueueLeases();
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
    pendingVerification,
  });
}

function emitUpdate() {
  const status = getStatus();
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('timer:update', status);
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
    pendingVerification,
  };
}

function calculateNextDelay() {
  if (queue.length === 0) return 0;
  if (fixedMins !== null) return Math.max(1, Math.floor(fixedMins * 60));

  const achievement = queue[0];
  const percent = typeof achievement.globalPercent === 'number' ? achievement.globalPercent : 50;
  const baseRarityMins = 5 + ((100 - percent) / 100) * 55;
  return Math.max(1, Math.floor((baseRarityMins * baseMultiplier + Math.random() * varianceMins) * 60));
}

function setVerificationCountdown(now = Date.now()) {
  if (!pendingVerification?.nextVerificationAt) {
    currentCountdown = 0;
    return;
  }
  currentCountdown = Math.max(0, Math.ceil((pendingVerification.nextVerificationAt - now) / 1_000));
}

function verificationOutcomeFor(transition, achievement) {
  const { pending } = transition;
  const result = pending.lastResult || {};
  if (transition.state === 'verified') {
    return {
      state: 'verified',
      activation: 'accepted',
      verification: 'confirmed',
      achievementId: achievement.id,
      message: `Steam remotely verified ${achievement.name || achievement.id} as unlocked.`,
      errorCode: null,
    };
  }
  if (transition.state === 'pending') {
    if (result.kind === 'not-observed') {
      return {
        state: 'verification-pending',
        activation: 'accepted',
        verification: 'pending',
        achievementId: achievement.id,
        message: 'Steam accepted activation, but the Web API has not observed the unlock yet. Background verification will continue without another activation.',
        errorCode: 'CONFIRMATION_PENDING',
      };
    }
    return {
      state: 'verification-pending',
      activation: 'accepted',
      verification: 'unavailable',
      achievementId: achievement.id,
      message: `Steam accepted activation, but remote verification is temporarily unavailable${result.error ? `: ${result.error}` : ''}. Background verification will continue without another activation.`,
      errorCode: result.errorCode || 'VERIFICATION_UNAVAILABLE',
    };
  }
  return {
    state: 'verification-needs-attention',
    activation: 'accepted',
    verification: result.kind === 'not-observed' ? 'not-observed' : 'unavailable',
    achievementId: achievement.id,
    message: result.kind === 'not-observed'
      ? 'Steam accepted activation, but the bounded confirmation window ended before the Web API reported the unlock. The item remains queued; use Recheck when Steam data is available.'
      : `Steam accepted activation, but remote verification needs attention${result.error ? `: ${result.error}` : ''}. The item remains queued; use Recheck after correcting Steam access.`,
    errorCode: result.errorCode || 'VERIFICATION_HORIZON_EXHAUSTED',
  };
}

function completeVerifiedAchievement(achievement) {
  steamManager.confirmVerifiedAchievement(activeAppId, achievement.id);
  queue.shift();
  unlockedCount += 1;
  pendingVerification = null;
  synchronizeQueueLeases();

  if (queue.length > 0 && isActive) {
    currentCountdown = calculateNextDelay();
    saveState();
    emitUpdate();
    if (!tickInterval) startTickLoop();
    return;
  }
  stopQueue();
}

async function verifyPendingActivation({ lockAlreadyHeld = false } = {}) {
  if (!pendingVerification || queue.length === 0) return getStatus();
  if (pendingVerification.achievementId !== queue[0].id) {
    lastOutcome = {
      state: 'verification-needs-attention',
      activation: 'accepted',
      verification: 'context-invalid',
      achievementId: pendingVerification.achievementId,
      message: 'The queued achievement no longer matches the pending Steam confirmation context. The item remains queued for review.',
      errorCode: 'VERIFICATION_CONTEXT_MISMATCH',
    };
    pendingVerification.autoContinue = false;
    pendingVerification.exhausted = true;
    pendingVerification.nextVerificationAt = null;
    stopQueue();
    return getStatus();
  }
  if (!activeAppId || String(resolveAppId()) !== String(activeAppId)) {
    lastOutcome = {
      state: 'verification-needs-attention',
      activation: 'accepted',
      verification: 'context-invalid',
      achievementId: pendingVerification.achievementId,
      message: 'The selected Steam game no longer matches the pending confirmation. The item remains queued for review.',
      errorCode: 'APP_ID_MISMATCH',
    };
    pendingVerification.autoContinue = false;
    pendingVerification.exhausted = true;
    pendingVerification.nextVerificationAt = null;
    stopQueue();
    return getStatus();
  }
  if (isUnlocking && !lockAlreadyHeld) return getStatus();

  if (!lockAlreadyHeld) isUnlocking = true;
  const expectedVerificationGeneration = verificationGeneration;
  try {
    let verification;
    try {
      verification = await steamManager.getAchievementVerification(activeAppId, pendingVerification.achievementId);
    } catch (error) {
      verification = {
        success: false,
        errorCode: 'VERIFICATION_EXCEPTION',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Pause/Clear/Resume may have changed state while the Web API was in
    // flight. Ignore this stale response rather than reactivating the queue.
    if (expectedVerificationGeneration !== verificationGeneration) return getStatus();

    const transition = advancePendingVerification({
      pending: pendingVerification,
      result: verification,
      now: Date.now(),
      policy: DEFAULT_INSTANT_VERIFICATION_POLICY,
    });
    pendingVerification = transition.pending;
    lastOutcome = verificationOutcomeFor(transition, queue[0]);

    if (transition.state === 'verified') {
      completeVerifiedAchievement(queue[0]);
    } else if (transition.state === 'pending') {
      isActive = true;
      setVerificationCountdown();
      synchronizeQueueLeases();
      saveState();
      emitUpdate();
      if (!tickInterval) startTickLoop();
    } else {
      stopQueue();
    }
    return getStatus();
  } finally {
    if (!lockAlreadyHeld) isUnlocking = false;
  }
}

async function unlockNext() {
  if (isUnlocking) return;
  if (!isActive || queue.length === 0) {
    stopQueue();
    return;
  }
  if (pendingVerification?.autoContinue) {
    await verifyPendingActivation();
    return;
  }
  if (!activeAppId || String(resolveAppId()) !== String(activeAppId)) {
    stopQueue();
    return;
  }

  isUnlocking = true;
  const achievement = queue[0];
  try {
    let result;
    try {
      result = await steamManager.unlockAchievement(achievement.id, activeAppId);
    } catch (error) {
      result = { success: false, achievementId: achievement.id, error: error instanceof Error ? error.message : String(error) };
    }

    if (result?.success || result?.operationMayHaveApplied) {
      // An accepted or uncertain post-activation result becomes a verification
      // barrier. No retry activation can occur while this evidence exists.
      pendingVerification = createPendingVerification({
        achievementId: achievement.id,
        now: Date.now(),
        policy: DEFAULT_INSTANT_VERIFICATION_POLICY,
      });
      lastOutcome = {
        state: 'verification-pending',
        activation: result?.success ? 'accepted' : 'uncertain',
        verification: 'pending',
        achievementId: achievement.id,
        message: result?.success
          ? 'Steam accepted activation. Confirming the reported Steam state in the background.'
          : `${result?.error || 'Steam execution became uncertain after activation.'} Checking Steam before any further action.`,
        errorCode: result?.success ? 'ACTIVATION_ACCEPTED' : (result?.errorCode || 'OPERATION_UNCERTAIN'),
      };
      await verifyPendingActivation({ lockAlreadyHeld: true });
      return;
    }

    // A rejected activation is distinct from an accepted activation whose Web
    // API visibility is delayed. Preserve the selected item and report it.
    lastOutcome = {
      state: 'failed',
      activation: 'rejected',
      verification: 'not-started',
      achievementId: achievement.id,
      message: result?.error || 'Steam could not unlock this achievement. The item remains queued.',
      errorCode: result?.errorCode || 'STEAM_EXECUTION_FAILED',
    };
    currentCountdown = 0;
    stopQueue();
  } finally {
    isUnlocking = false;
  }
}

function startTickLoop() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    if (!isActive || isUnlocking) return;
    if (pendingVerification?.autoContinue) {
      setVerificationCountdown();
      emitUpdate();
      if (currentCountdown <= 0) verifyPendingActivation();
      return;
    }

    currentCountdown -= 1;
    emitUpdate();
    if (currentCountdown <= 0) unlockNext();
  }, 1_000);
}

function startQueue(achievements, multiplier, variance, overrideMins = null) {
  baseMultiplier = multiplier ?? 1;
  varianceMins = variance ?? 0;
  fixedMins = overrideMins;

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
    pendingVerification = null;
    verificationGeneration += 1;
    currentCountdown = calculateNextDelay();
  } else if (queue.length > 0) {
    // Resume is read-only whenever the queue head has accepted activation.
    if (pendingVerification) {
      verificationGeneration += 1;
      pendingVerification = {
        ...pendingVerification,
        autoContinue: true,
        exhausted: false,
        nextVerificationAt: Date.now(),
      };
      setVerificationCountdown();
    } else if (currentCountdown <= 0) {
      currentCountdown = calculateNextDelay();
    }
  }

  if (queue.length === 0) return getStatus();
  isActive = true;
  synchronizeQueueLeases();
  saveState();
  startTickLoop();
  emitUpdate();
  return getStatus();
}

function stopQueue({ pauseVerification = true } = {}) {
  isActive = false;
  if (pauseVerification && pendingVerification) {
    verificationGeneration += 1;
    pendingVerification = {
      ...pendingVerification,
      autoContinue: false,
      nextVerificationAt: null,
    };
    lastOutcome = {
      state: 'verification-pending',
      activation: lastOutcome?.activation || 'accepted',
      verification: 'paused',
      achievementId: pendingVerification.achievementId,
      message: 'Background Steam confirmation is paused. Resume the queue or use Recheck to continue without another activation.',
      errorCode: 'VERIFICATION_PAUSED',
    };
  }
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
  synchronizeQueueLeases();
  saveState();
  emitUpdate();
  return getStatus();
}

async function recheckVerificationNow() {
  if (!pendingVerification || queue.length === 0) {
    throw new Error('No Instant achievement is awaiting Steam confirmation.');
  }
  verificationGeneration += 1;
  pendingVerification = {
    ...pendingVerification,
    autoContinue: true,
    exhausted: false,
    nextVerificationAt: Date.now(),
  };
  isActive = true;
  synchronizeQueueLeases();
  saveState();
  startTickLoop();
  emitUpdate();
  return verifyPendingActivation();
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
  pendingVerification = null;
  verificationGeneration += 1;
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
  clearQueue,
  recheckVerificationNow,
};
