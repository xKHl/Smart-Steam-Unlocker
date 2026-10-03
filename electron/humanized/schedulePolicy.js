/**
 * Service-layer policy for replacing persisted Humanized schedules.
 * Keeping it pure makes the App-ID guard independently testable.
 */

function assertScheduleReplacementAllowed(currentSchedule, requestedAppId, { replace = false } = {}) {
  if (!currentSchedule || String(currentSchedule.appId) === String(requestedAppId) || replace) return true;

  const error = new Error(
    `A Humanized schedule already exists for AppID ${currentSchedule.appId}. Explicitly discard or replace it before creating one for AppID ${requestedAppId}.`,
  );
  error.code = 'CROSS_GAME_SCHEDULE_EXISTS';
  throw error;
}

module.exports = { assertScheduleReplacementAllowed };
