const { ITEM_STATUS, SCHEDULE_STATE } = require('./schedulerEngine');

const SCHEDULE_VERSION = 2;
const VALID_ITEM_STATES = new Set(Object.values(ITEM_STATUS));
const VALID_SCHEDULE_STATES = new Set(Object.values(SCHEDULE_STATE));

class ScheduleValidationError extends Error {
  constructor(message, code = 'INVALID_SCHEDULE_STATE') {
    super(message);
    this.name = 'ScheduleValidationError';
    this.code = code;
  }
}

function assert(condition, message, code) {
  if (!condition) throw new ScheduleValidationError(message, code);
}

function validateVerificationMetadata(metadata) {
  if (metadata === undefined || metadata === null) return;
  assert(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'Verification metadata must be an object.');
  for (const key of ['attemptCount', 'confirmedNotUnlockedCount']) {
    if (metadata[key] !== undefined) assert(Number.isInteger(metadata[key]) && metadata[key] >= 0, `Verification ${key} must be a non-negative integer.`);
  }
  for (const key of ['firstVerificationAt', 'lastVerificationAt', 'nextVerificationAt', 'horizonAt']) {
    if (metadata[key] !== undefined && metadata[key] !== null) assert(Number.isFinite(metadata[key]) && metadata[key] >= 0, `Verification ${key} is invalid.`);
  }
  if (metadata.exhausted !== undefined) assert(typeof metadata.exhausted === 'boolean', 'Verification exhausted flag must be boolean.');
  if (metadata.autoContinue !== undefined) assert(typeof metadata.autoContinue === 'boolean', 'Verification auto-continue flag must be boolean.');
}

function validateTiming(timing) {
  if (timing === undefined || timing === null) return;
  assert(timing && typeof timing === 'object' && !Array.isArray(timing), 'Schedule timing must be an object.');
  for (const key of ['initialDelayMs', 'varianceMs', 'minIntervalMs', 'maxIntervalMs', 'maxRetries']) {
    if (timing[key] !== undefined) assert(Number.isInteger(timing[key]) && timing[key] >= 0, `Schedule timing ${key} is invalid.`);
  }
  if (timing.baseIntervalMs !== undefined && timing.baseIntervalMs !== null) {
    assert(Number.isInteger(timing.baseIntervalMs) && timing.baseIntervalMs >= 0, 'Schedule timing baseIntervalMs is invalid.');
  }
  if (timing.preset !== undefined && timing.preset !== null) {
    assert(typeof timing.preset === 'string' && timing.preset.length > 0 && timing.preset.length <= 32, 'Schedule timing preset is invalid.');
  }
  if (Number.isInteger(timing.minIntervalMs) && Number.isInteger(timing.maxIntervalMs)) {
    assert(timing.minIntervalMs > 0 && timing.minIntervalMs <= timing.maxIntervalMs, 'Schedule timing bounds are invalid.');
  }
  if (Number.isInteger(timing.baseIntervalMs) && Number.isInteger(timing.minIntervalMs) && Number.isInteger(timing.maxIntervalMs)) {
    assert(timing.baseIntervalMs >= timing.minIntervalMs && timing.baseIntervalMs <= timing.maxIntervalMs, 'Schedule timing base interval is outside its bounds.');
  }
}

function validateSchedule(schedule) {
  assert(schedule && typeof schedule === 'object' && !Array.isArray(schedule), 'Schedule must be an object.');
  assert(schedule.version === SCHEDULE_VERSION, `Unsupported schedule version ${String(schedule.version)}.`, 'UNSUPPORTED_SCHEDULE_VERSION');
  assert(typeof schedule.id === 'string' && schedule.id.trim().length > 0 && schedule.id.length <= 256, 'Schedule identity is invalid.');
  assert(Number.isInteger(schedule.appId) && schedule.appId > 0 && schedule.appId <= 2_147_483_647, 'Schedule App ID is invalid.');
  assert(VALID_SCHEDULE_STATES.has(schedule.state), 'Schedule state is invalid.');
  assert(Array.isArray(schedule.items) && schedule.items.length > 0 && schedule.items.length <= 5_000, 'Schedule items are invalid.');
  validateTiming(schedule.timing);

  const seen = new Set();
  schedule.items.forEach((item, index) => {
    assert(item && typeof item === 'object' && !Array.isArray(item), `Schedule item ${index + 1} is invalid.`);
    assert(typeof item.id === 'string' && item.id.trim().length > 0 && item.id.length <= 256, `Schedule item ${index + 1} has an invalid achievement ID.`);
    assert(!seen.has(item.id), `Schedule contains duplicate achievement ID ${item.id}.`);
    seen.add(item.id);
    assert(VALID_ITEM_STATES.has(item.status), `Schedule item ${item.id} has an invalid state.`);
    assert(Number.isInteger(item.sequencePosition) && item.sequencePosition > 0 && item.sequencePosition <= schedule.items.length, `Schedule item ${item.id} has an invalid sequence position.`);
    assert(Number.isInteger(item.attempts) && item.attempts >= 0 && item.attempts <= 100, `Schedule item ${item.id} has invalid attempts.`);
    assert(Number.isInteger(item.maxRetries) && item.maxRetries >= 0 && item.maxRetries <= 10, `Schedule item ${item.id} has invalid retry policy.`);
    assert(Number.isFinite(item.scheduledAt) && item.scheduledAt >= 0, `Schedule item ${item.id} has invalid scheduled time.`);
    validateVerificationMetadata(item.verificationMeta);
  });

  return schedule;
}

module.exports = {
  SCHEDULE_VERSION,
  ScheduleValidationError,
  validateSchedule,
};
