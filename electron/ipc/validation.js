const { ORDER_MODES } = require('../humanized/ordering');

const MAX_ACHIEVEMENTS = 5_000;
const MAX_ACHIEVEMENT_ID_LENGTH = 256;
const MAX_TEXT_LENGTH = 512;
const MAX_SEED_LENGTH = 128;
const ACHIEVEMENT_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

class IpcValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IpcValidationError';
    this.code = 'INVALID_IPC_PAYLOAD';
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new IpcValidationError(`${label} must be an object.`);
  return value;
}

function assertNoUnexpectedFields(value, allowed, label) {
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) throw new IpcValidationError(`${label} contains unsupported field "${key}".`);
  });
}

function assertString(value, label, { required = true, maxLength = MAX_TEXT_LENGTH, pattern = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new IpcValidationError(`${label} is required.`);
  }
  if (typeof value !== 'string') throw new IpcValidationError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized && required) throw new IpcValidationError(`${label} is required.`);
  if (normalized.length > maxLength) throw new IpcValidationError(`${label} is too long.`);
  if (pattern && normalized && !pattern.test(normalized)) throw new IpcValidationError(`${label} has an invalid format.`);
  return normalized;
}

function assertAppId(value, label = 'App ID') {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 2_147_483_647) {
    throw new IpcValidationError(`${label} must be a positive integer.`);
  }
  return numeric;
}

function assertFiniteNumber(value, label, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max || (integer && !Number.isInteger(numeric))) {
    throw new IpcValidationError(`${label} is invalid.`);
  }
  return numeric;
}

function sanitizeAchievement(value) {
  const source = assertPlainObject(value, 'Achievement');
  assertNoUnexpectedFields(source, new Set(['id', 'name', 'description', 'originalIndex', 'globalPercent', 'hidden', 'unlocked', 'iconUrl', 'iconColorUrl', 'iconGrayUrl']), 'Achievement');
  const id = assertString(source.id, 'Achievement ID', { maxLength: MAX_ACHIEVEMENT_ID_LENGTH, pattern: ACHIEVEMENT_ID_PATTERN });
  const normalized = { id };
  if (source.name !== undefined) normalized.name = assertString(source.name, 'Achievement name', { required: false, maxLength: MAX_TEXT_LENGTH }) || id;
  if (source.description !== undefined) normalized.description = assertString(source.description, 'Achievement description', { required: false, maxLength: 4_000 }) || '';
  if (source.originalIndex !== undefined) normalized.originalIndex = assertFiniteNumber(source.originalIndex, 'Achievement original index', { min: 0, max: MAX_ACHIEVEMENTS, integer: true });
  if (source.globalPercent !== undefined && source.globalPercent !== null) normalized.globalPercent = assertFiniteNumber(source.globalPercent, 'Achievement global percentage', { min: 0, max: 100 });
  if (source.hidden !== undefined) normalized.hidden = Boolean(source.hidden);
  if (source.unlocked !== undefined) normalized.unlocked = Boolean(source.unlocked);
  return normalized;
}

function sanitizeAchievements(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ACHIEVEMENTS) {
    throw new IpcValidationError(`Achievements must contain between 1 and ${MAX_ACHIEVEMENTS} entries.`);
  }
  const achievements = value.map(sanitizeAchievement);
  const seen = new Set();
  achievements.forEach((achievement) => {
    if (seen.has(achievement.id)) throw new IpcValidationError('Achievements must not contain duplicate IDs.');
    seen.add(achievement.id);
  });
  return achievements;
}

function sanitizeOrderMode(value) {
  const mode = assertString(value, 'Order mode', { maxLength: 64 });
  if (!Object.values(ORDER_MODES).includes(mode)) throw new IpcValidationError('Order mode is not supported.');
  return mode;
}

function sanitizeOrderingPayload(value) {
  const source = assertPlainObject(value, 'Achievement ordering request');
  assertNoUnexpectedFields(source, new Set(['achievements', 'orderMode']), 'Achievement ordering request');
  if (!Array.isArray(source.achievements) || source.achievements.length > MAX_ACHIEVEMENTS) {
    throw new IpcValidationError(`Achievements must contain at most ${MAX_ACHIEVEMENTS} entries.`);
  }
  return {
    achievements: source.achievements.length ? sanitizeAchievements(source.achievements) : [],
    orderMode: sanitizeOrderMode(source.orderMode),
  };
}

function sanitizeSwitchGamePayload(value) {
  const source = assertPlainObject(value, 'Game selection');
  assertNoUnexpectedFields(source, new Set(['appId', 'name', 'headerImage']), 'Game selection');
  const result = { appId: assertAppId(source.appId), name: assertString(source.name, 'Game name') };
  if (source.headerImage !== undefined && source.headerImage !== null) {
    const headerImage = assertString(source.headerImage, 'Game header image', { required: false, maxLength: 2_048 });
    if (headerImage && !/^https:\/\//i.test(headerImage)) throw new IpcValidationError('Game header image must use HTTPS.');
    result.headerImage = headerImage;
  }
  return result;
}

function sanitizeHumanizedPayload(value) {
  const source = assertPlainObject(value, 'Humanized schedule');
  assertNoUnexpectedFields(source, new Set(['appId', 'achievements', 'orderMode', 'seed', 'startAt', 'timelineOptions']), 'Humanized schedule');
  const payload = {
    appId: assertAppId(source.appId),
    achievements: sanitizeAchievements(source.achievements),
    orderMode: sanitizeOrderMode(source.orderMode),
    seed: assertString(source.seed, 'Schedule reference', { maxLength: MAX_SEED_LENGTH }),
    startAt: assertFiniteNumber(source.startAt, 'Schedule start time', { min: 0, max: 8_640_000_000_000 }),
  };
  if (source.timelineOptions !== undefined) {
    const options = assertPlainObject(source.timelineOptions, 'Timeline options');
    assertNoUnexpectedFields(options, new Set(['minIntervalMs', 'maxIntervalMs', 'maxRetries']), 'Timeline options');
    payload.timelineOptions = {};
    if (options.minIntervalMs !== undefined) payload.timelineOptions.minIntervalMs = assertFiniteNumber(options.minIntervalMs, 'Minimum interval', { min: 1, max: 86_400_000, integer: true });
    if (options.maxIntervalMs !== undefined) payload.timelineOptions.maxIntervalMs = assertFiniteNumber(options.maxIntervalMs, 'Maximum interval', { min: 1, max: 86_400_000, integer: true });
    if (payload.timelineOptions.minIntervalMs !== undefined && payload.timelineOptions.maxIntervalMs !== undefined && payload.timelineOptions.minIntervalMs > payload.timelineOptions.maxIntervalMs) {
      throw new IpcValidationError('Minimum interval cannot exceed maximum interval.');
    }
    if (options.maxRetries !== undefined) payload.timelineOptions.maxRetries = assertFiniteNumber(options.maxRetries, 'Maximum retries', { min: 0, max: 10, integer: true });
  }
  return payload;
}

function sanitizeUnlockPayload(value) {
  const source = assertPlainObject(value, 'Unlock request');
  assertNoUnexpectedFields(source, new Set(['appId', 'achievementId']), 'Unlock request');
  return {
    appId: assertAppId(source.appId),
    achievementId: assertString(source.achievementId, 'Achievement ID', { maxLength: MAX_ACHIEVEMENT_ID_LENGTH, pattern: ACHIEVEMENT_ID_PATTERN }),
  };
}

function sanitizeOwnedGamesOptions(value) {
  if (value === undefined) return { forceRefresh: false };
  const source = assertPlainObject(value, 'Library options');
  assertNoUnexpectedFields(source, new Set(['forceRefresh']), 'Library options');
  if (source.forceRefresh !== undefined && typeof source.forceRefresh !== 'boolean') {
    throw new IpcValidationError('forceRefresh must be a boolean.');
  }
  return { forceRefresh: Boolean(source.forceRefresh) };
}

function sanitizeTimerPayload(value) {
  const source = assertPlainObject(value, 'Instant queue');
  assertNoUnexpectedFields(source, new Set(['achievements', 'base', 'variance', 'fixedMins']), 'Instant queue');
  const achievements = source.achievements === undefined || source.achievements === null || source.achievements.length === 0 ? [] : sanitizeAchievements(source.achievements);
  const result = { achievements };
  if (source.base !== undefined) result.base = assertFiniteNumber(source.base, 'Speed multiplier', { min: 0.1, max: 10 });
  if (source.variance !== undefined) result.variance = assertFiniteNumber(source.variance, 'Variance', { min: 0, max: 240, integer: true });
  if (source.fixedMins !== undefined && source.fixedMins !== null) result.fixedMins = assertFiniteNumber(source.fixedMins, 'Fixed minutes', { min: 0, max: 43_200 });
  return result;
}

module.exports = {
  IpcValidationError,
  assertAppId,
  assertString,
  sanitizeAchievements,
  sanitizeHumanizedPayload,
  sanitizeOrderMode,
  sanitizeOrderingPayload,
  sanitizeOwnedGamesOptions,
  sanitizeSwitchGamePayload,
  sanitizeTimerPayload,
  sanitizeUnlockPayload,
};
