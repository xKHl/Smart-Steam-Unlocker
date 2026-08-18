/**
 * Pure achievement normalization and ordering utilities.
 * These functions intentionally contain no Electron, Steam, persistence, or execution code.
 */

const ORDER_MODES = Object.freeze({
  ORIGINAL: 'original',
  EASIEST_TO_HARDEST: 'easiest-to-hardest',
  MOST_COMMON_TO_RAREST: 'most-common-to-rarest',
  RAREST_TO_MOST_COMMON: 'rarest-to-most-common',
});

function toFiniteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePercent(value) {
  const number = toFiniteNumber(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number));
}

function normalizeAchievement(achievement, fallbackIndex = 0) {
  const source = achievement && typeof achievement === 'object' ? achievement : {};
  const rawId = source.id ?? source.name ?? source.apiname;
  const id = typeof rawId === 'string' ? rawId.trim() : String(rawId ?? '').trim();
  const originalIndexValue = toFiniteNumber(source.originalIndex);

  return {
    id,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : id || `Achievement ${fallbackIndex + 1}`,
    description: typeof source.description === 'string' ? source.description : '',
    originalIndex: originalIndexValue !== null && originalIndexValue >= 0 ? Math.floor(originalIndexValue) : fallbackIndex,
    globalPercent: normalizePercent(source.globalPercent ?? source.percent ?? source.completionPercent),
    hidden: Boolean(source.hidden),
    unlocked: Boolean(source.unlocked),
    source: source.source ?? 'steam-web-api',
  };
}

function normalizeAchievements(achievements) {
  if (!Array.isArray(achievements)) return [];

  const usedIds = new Set();
  return achievements
    .map((achievement, index) => normalizeAchievement(achievement, index))
    .filter((achievement) => {
      if (!achievement.id || usedIds.has(achievement.id)) return false;
      usedIds.add(achievement.id);
      return true;
    });
}

function compareText(left, right) {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

function percentForAscending(achievement) {
  // Missing values are deliberately sorted after known difficulty values.
  return achievement.globalPercent === null ? Number.POSITIVE_INFINITY : achievement.globalPercent;
}

function percentForDescending(achievement) {
  // Missing values are deliberately sorted after known difficulty values.
  return achievement.globalPercent === null ? Number.NEGATIVE_INFINITY : achievement.globalPercent;
}

function stableTieBreak(left, right) {
  return left.originalIndex - right.originalIndex || compareText(left.id, right.id);
}

function orderAchievements(achievements, mode = ORDER_MODES.ORIGINAL) {
  const normalized = normalizeAchievements(achievements);
  const ordered = [...normalized];

  switch (mode) {
    case ORDER_MODES.EASIEST_TO_HARDEST:
    case ORDER_MODES.MOST_COMMON_TO_RAREST:
      ordered.sort((left, right) => percentForDescending(right) - percentForDescending(left) || stableTieBreak(left, right));
      break;
    case ORDER_MODES.RAREST_TO_MOST_COMMON:
      ordered.sort((left, right) => percentForAscending(left) - percentForAscending(right) || stableTieBreak(left, right));
      break;
    case ORDER_MODES.ORIGINAL:
    default:
      ordered.sort(stableTieBreak);
      break;
  }

  return ordered.map((achievement, position) => ({ ...achievement, sequencePosition: position + 1 }));
}

module.exports = {
  ORDER_MODES,
  normalizeAchievement,
  normalizeAchievements,
  normalizePercent,
  orderAchievements,
};
