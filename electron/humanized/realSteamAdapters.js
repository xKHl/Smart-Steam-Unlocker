/**
 * Steam-specific adapters for the Humanized integration boundary.
 * The scheduler core receives only normalized outcome/verification objects.
 */

const runtimeDiagnostics = require('../runtimeDiagnostics');

const RETRYABLE_CODES = new Set([
  'STEAM_EXECUTION_FAILED',
  'STEAM_READ_UNAVAILABLE',
  'STEAM_INITIALIZATION_FAILED',
  'STEAM_UNAVAILABLE',
]);

const TERMINAL_CODES = new Set([
  'INVALID_CONTEXT',
  'APP_ID_MISMATCH',
  'NO_SELECTED_GAME',
  'ACHIEVEMENT_NOT_FOUND',
  'ACTIVATION_REJECTED',
  'MISSING_API_KEY',
  'INVALID_API_KEY',
  'UNAUTHORIZED',
  'CREDENTIAL_STORAGE_UNAVAILABLE',
  'CREDENTIAL_MIGRATION_REQUIRED',
  'CREDENTIAL_DECRYPT_FAILED',
  'MISSING_STEAM_ID',
]);

function validateExecutionContext(context, steamManager) {
  if (!context || typeof context !== 'object') {
    return { valid: false, outcome: 'failed', error: 'A valid execution context is required.' };
  }
  if (context.appId === undefined || context.appId === null || context.appId === '') {
    return { valid: false, outcome: 'failed', error: 'Execution context is missing App ID.' };
  }
  if (!context.achievementId || !context.scheduleId || !context.itemId || !context.executionToken) {
    return { valid: false, outcome: 'failed', error: 'Execution context is missing immutable operation identity.' };
  }
  if (String(context.itemId) !== String(context.achievementId)) {
    return { valid: false, outcome: 'failed', error: 'Execution context achievement identity is inconsistent.' };
  }

  const activeAppId = typeof steamManager.getSelectedAppId === 'function'
    ? steamManager.getSelectedAppId()
    : steamManager.getStatus?.().currentAppId;
  if (activeAppId === undefined || activeAppId === null) {
    return { valid: false, outcome: 'failed', error: 'No active Steam App ID is selected.' };
  }
  if (String(activeAppId) !== String(context.appId)) {
    return {
      valid: false,
      outcome: 'failed',
      error: `Active Steam App ID ${activeAppId} does not match scheduled App ID ${context.appId}.`,
    };
  }
  return { valid: true };
}

function classifyExecutionFailure(result) {
  const code = result?.errorCode;
  const error = result?.error || 'Steam execution failed.';
  if (result?.operationMayHaveApplied || code === 'OPERATION_UNCERTAIN') {
    return { outcome: 'uncertain', verification: 'uncertain', error };
  }
  if (TERMINAL_CODES.has(code)) {
    return { outcome: 'failed', verification: 'unverified', error };
  }
  if (RETRYABLE_CODES.has(code) || /steam|client|init|network|timeout|temporar|disconnect/i.test(error)) {
    return { outcome: 'retry', verification: 'unverified', error };
  }
  return { outcome: 'failed', verification: 'unverified', error };
}

function createRealSteamExecutionAdapter({ steamManager }) {
  if (!steamManager || typeof steamManager.unlockAchievement !== 'function') {
    throw new Error('A Steam manager with unlockAchievement is required.');
  }

  return {
    kind: 'steam',
    validateContext: async (context) => validateExecutionContext(context, steamManager),
    async executeUnlock(context) {
      const validation = validateExecutionContext(context, steamManager);
      if (!validation.valid) return { outcome: validation.outcome, verification: 'unverified', error: validation.error };

      let result;
      try {
        result = await steamManager.unlockAchievement(context.achievementId, context.appId);
      } catch (error) {
        return { outcome: 'retry', verification: 'unverified', error: error instanceof Error ? error.message : String(error) };
      }
      if (result?.success) return { outcome: 'success', verification: 'unverified' };
      return classifyExecutionFailure(result);
    },
  };
}

function createRealSteamVerificationAdapter({ steamManager }) {
  if (!steamManager || typeof steamManager.getAchievementVerification !== 'function') {
    throw new Error('A Steam manager with getAchievementVerification is required.');
  }

  return {
    kind: 'steam-web-api',
    async verify({ schedule, item, executionResult } = {}) {
      const context = executionResult?.context ?? item?.executionContext;
      const appId = context?.appId ?? schedule?.appId;
      const achievementId = context?.achievementId ?? item?.id;
      if (!appId || !achievementId || !schedule || String(schedule.appId) !== String(appId)) {
        return { verification: 'uncertain', error: 'Verification context does not match the persisted schedule.' };
      }

      let result;
      try {
        result = await steamManager.getAchievementVerification(appId, achievementId);
      } catch (error) {
        runtimeDiagnostics.trace('verification', 'remote-read', { appId, achievementId, outcome: 'exception', errorCode: 'VERIFICATION_EXCEPTION' });
        return { verification: 'uncertain', errorCode: 'VERIFICATION_EXCEPTION', error: error instanceof Error ? error.message : String(error) };
      }
      runtimeDiagnostics.trace('verification', 'remote-read', {
        appId,
        achievementId,
        scheduleId: schedule.id,
        verificationAttempt: (item?.verificationMeta?.attemptCount ?? 0) + 1,
        outcome: result?.success ? (result.unlocked ? 'unlocked' : 'not-unlocked') : 'error',
        errorCode: result?.errorCode ?? null,
        endpoint: result?.endpoint ?? null,
      });
      if (!result?.success) {
        const code = result?.errorCode;
        if (TERMINAL_CODES.has(code)) return { verification: 'failed', errorCode: code, error: result?.error || 'Steam verification rejected the operation.' };
        return { verification: 'uncertain', errorCode: code || 'STEAM_READ_UNAVAILABLE', error: result?.error || 'Steam verification is unavailable.' };
      }
      if (result.unlocked) {
        // Reuse the existing optimistic-cache and renderer unlock event only
        // after the authoritative remote read confirms the Steam state.
        steamManager.confirmVerifiedAchievement?.(appId, achievementId);
        return { verification: 'verified' };
      }
      return { verification: 'unverified', errorCode: 'CONFIRMED_NOT_UNLOCKED', retryable: true, error: 'Steam has not yet reported this achievement as unlocked.' };
    },
  };
}

module.exports = {
  RETRYABLE_CODES,
  TERMINAL_CODES,
  classifyExecutionFailure,
  createRealSteamExecutionAdapter,
  createRealSteamVerificationAdapter,
  validateExecutionContext,
};
