'use strict';

const { DEFAULT_VERIFICATION_POLICY, normalizeVerificationPolicy } = require('./humanized/schedulerEngine');
const { STEAM_READ_ERROR } = require('./steamApiClient');

// Configuration/authentication/schema errors cannot safely be treated as a
// propagation delay. Every other result remains a recoverable verification
// state until the bounded visibility horizon is exhausted.
const NON_RECOVERABLE_VERIFICATION_CODES = new Set([
  STEAM_READ_ERROR.MISSING_API_KEY,
  STEAM_READ_ERROR.MISSING_STEAM_ID,
  STEAM_READ_ERROR.INVALID_API_KEY,
  STEAM_READ_ERROR.UNAUTHORIZED,
  STEAM_READ_ERROR.ACHIEVEMENT_NOT_FOUND,
  'APP_ID_MISMATCH',
  'INVALID_CONTEXT',
]);

function normalizeInstantVerificationPolicy(policy = DEFAULT_VERIFICATION_POLICY) {
  return normalizeVerificationPolicy(policy);
}

function createPendingVerification({ achievementId, now = Date.now(), previous = null, policy = DEFAULT_VERIFICATION_POLICY } = {}) {
  const normalized = normalizeInstantVerificationPolicy(policy);
  const firstVerificationAt = Number.isFinite(previous?.firstVerificationAt)
    ? previous.firstVerificationAt
    : now;
  return {
    achievementId,
    activationAcceptedAt: Number.isFinite(previous?.activationAcceptedAt) ? previous.activationAcceptedAt : now,
    firstVerificationAt,
    lastVerificationAt: Number.isFinite(previous?.lastVerificationAt) ? previous.lastVerificationAt : null,
    nextVerificationAt: Number.isFinite(previous?.nextVerificationAt) ? previous.nextVerificationAt : now,
    horizonAt: Number.isFinite(previous?.horizonAt) ? previous.horizonAt : firstVerificationAt + normalized.horizonMs,
    attemptCount: Number.isInteger(previous?.attemptCount) && previous.attemptCount >= 0 ? previous.attemptCount : 0,
    confirmedNotUnlockedCount: Number.isInteger(previous?.confirmedNotUnlockedCount) && previous.confirmedNotUnlockedCount >= 0
      ? previous.confirmedNotUnlockedCount
      : 0,
    autoContinue: previous?.autoContinue !== false,
    exhausted: Boolean(previous?.exhausted),
    lastResult: previous?.lastResult ?? null,
  };
}

function verificationDelayMs(attemptCount, policy = DEFAULT_VERIFICATION_POLICY) {
  const normalized = normalizeInstantVerificationPolicy(policy);
  const index = Math.min(Math.max(0, attemptCount), normalized.backoffMs.length - 1);
  return normalized.backoffMs[index];
}

function isRecoverableVerificationResult(result) {
  if (result?.success) return true;
  return !NON_RECOVERABLE_VERIFICATION_CODES.has(result?.errorCode);
}

function verificationResultKind(result) {
  if (result?.success && result.unlocked === true) return 'verified';
  if (result?.success) return 'not-observed';
  return 'unavailable';
}

function advancePendingVerification({ pending, result, now = Date.now(), policy = DEFAULT_VERIFICATION_POLICY } = {}) {
  const next = createPendingVerification({
    achievementId: pending?.achievementId,
    now,
    previous: pending,
    policy,
  });
  next.attemptCount += 1;
  next.lastVerificationAt = now;
  next.lastResult = {
    kind: verificationResultKind(result),
    errorCode: result?.errorCode ?? null,
    error: result?.error ?? null,
    endpoint: result?.endpoint ?? null,
    unlocked: result?.unlocked === true,
  };

  if (result?.success && result.unlocked === true) {
    next.nextVerificationAt = null;
    next.autoContinue = false;
    next.exhausted = false;
    return { state: 'verified', pending: next };
  }

  if (result?.success && result.unlocked === false) next.confirmedNotUnlockedCount += 1;
  const recoverable = isRecoverableVerificationResult(result);
  if (recoverable && now < next.horizonAt) {
    next.nextVerificationAt = now + verificationDelayMs(next.attemptCount, policy);
    next.autoContinue = true;
    next.exhausted = false;
    return { state: 'pending', pending: next };
  }

  next.nextVerificationAt = null;
  next.autoContinue = false;
  next.exhausted = true;
  return { state: 'needs-attention', pending: next };
}

module.exports = {
  DEFAULT_INSTANT_VERIFICATION_POLICY: DEFAULT_VERIFICATION_POLICY,
  NON_RECOVERABLE_VERIFICATION_CODES,
  advancePendingVerification,
  createPendingVerification,
  isRecoverableVerificationResult,
  normalizeInstantVerificationPolicy,
  verificationDelayMs,
  verificationResultKind,
};
