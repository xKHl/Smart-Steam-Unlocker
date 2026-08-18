/**
 * Deterministic timeline generation.
 * A seeded PRNG makes a generated timeline reproducible for the same inputs.
 */

const MIN_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 12 * 60 * 60 * 1000;

function hashSeed(input) {
  const text = String(input ?? 'humanized-schedule');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeTimelineOptions(options = {}) {
  const startAt = options.startAt === undefined ? Date.now() : options.startAt;
  const minIntervalMs = options.minIntervalMs === undefined ? MIN_INTERVAL_MS : options.minIntervalMs;
  const maxIntervalMs = options.maxIntervalMs === undefined ? MAX_INTERVAL_MS : options.maxIntervalMs;
  const maxRetries = options.maxRetries === undefined ? 2 : options.maxRetries;
  if (!Number.isFinite(startAt) || startAt < 0) throw new Error('Timeline start time must be a non-negative finite timestamp.');
  if (!Number.isInteger(minIntervalMs) || minIntervalMs <= 0 || minIntervalMs > MAX_INTERVAL_MS) throw new Error('Timeline minimum interval is invalid.');
  if (!Number.isInteger(maxIntervalMs) || maxIntervalMs <= 0 || maxIntervalMs > MAX_INTERVAL_MS) throw new Error('Timeline maximum interval is invalid.');
  if (minIntervalMs > maxIntervalMs) throw new Error('Timeline minimum interval cannot exceed maximum interval.');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) throw new Error('Timeline retry policy is invalid.');
  return { ...options, startAt: Math.floor(startAt), minIntervalMs, maxIntervalMs, maxRetries };
}

function rarityIntervalMs(globalPercent, random, options = {}) {
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : MIN_INTERVAL_MS;
  const maxIntervalMs = Number.isFinite(options.maxIntervalMs) ? options.maxIntervalMs : MAX_INTERVAL_MS;
  const percent = Number.isFinite(globalPercent) ? clamp(globalPercent, 0, 100) : 50;
  const rarity = 1 - percent / 100;
  const base = minIntervalMs + rarity * (maxIntervalMs - minIntervalMs) * 0.68;
  const jitter = 0.9 + random() * 0.2;
  return Math.round(clamp(base * jitter, minIntervalMs, maxIntervalMs));
}

function createScheduleTimeline(orderedAchievements, options = {}) {
  if (!Array.isArray(orderedAchievements)) throw new Error('Timeline achievements must be an array.');
  const normalizedOptions = normalizeTimelineOptions(options);
  const seed = String(normalizedOptions.seed ?? 'humanized-schedule');
  const startAt = normalizedOptions.startAt;
  const random = createSeededRandom(seed);
  let cursor = startAt;

  return orderedAchievements.map((achievement, index) => {
    const delayMs = index === 0
      ? 0
      : rarityIntervalMs(achievement.globalPercent, random, normalizedOptions);
    cursor += delayMs;

    return {
      id: achievement.id,
      name: achievement.name,
      originalIndex: achievement.originalIndex,
      globalPercent: achievement.globalPercent,
      hidden: achievement.hidden,
      sequencePosition: index + 1,
      scheduledAt: cursor,
      delayMs,
      status: 'scheduled',
      verification: 'unverified',
      attempts: 0,
      maxRetries: normalizedOptions.maxRetries,
      executionToken: null,
      interruptedExecutionToken: null,
      executionHistory: [],
      recoveryPending: false,
      lastError: null,
      completedAt: null,
      nextAttemptAt: null,
    };
  });
}

module.exports = {
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  createSeededRandom,
  createScheduleTimeline,
  hashSeed,
  normalizeTimelineOptions,
  rarityIntervalMs,
};
