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
  const seed = String(options.seed ?? 'humanized-schedule');
  const startAt = Number.isFinite(options.startAt) ? Math.floor(options.startAt) : Date.now();
  const random = createSeededRandom(seed);
  let cursor = startAt;

  return orderedAchievements.map((achievement, index) => {
    const delayMs = index === 0
      ? 0
      : rarityIntervalMs(achievement.globalPercent, random, options);
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
      maxRetries: Number.isInteger(options.maxRetries) ? Math.max(0, options.maxRetries) : 2,
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
  rarityIntervalMs,
};
