/**
 * Pure achievement normalization and ordering utilities.
 * These functions intentionally contain no Electron, Steam, persistence, or execution code.
 */

const ORDER_MODES = Object.freeze({
  ORIGINAL: 'original',
  NATURAL_STORY: 'natural-story-progression',
  MOST_COMMON_TO_RAREST: 'most-common-to-rarest',
  RAREST_TO_MOST_COMMON: 'rarest-to-most-common',
});

const BENDY_AND_THE_DARK_REVIVAL_APP_ID = 1_063_660;

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
  // Missing values are deliberately sorted after known completion percentages.
  return achievement.globalPercent === null ? Number.POSITIVE_INFINITY : achievement.globalPercent;
}

function percentForDescending(achievement) {
  // Missing values are deliberately sorted after known completion percentages.
  return achievement.globalPercent === null ? Number.NEGATIVE_INFINITY : achievement.globalPercent;
}

function stableTieBreak(left, right) {
  return left.originalIndex - right.originalIndex || compareText(left.id, right.id);
}

function evidenceKey(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Explicit public evidence for Steam App 1063660 only. Ranks encode known
 * prologue/chapter/finale constraints from the Bendy Wiki achievement list and
 * the chapter-organized Steam Community achievement guide. The map is keyed by
 * exact English display name, because public sources do not expose a reliable
 * Steam schema API-name map. No title is inferred: unmatched achievements use
 * the conservative original-schema fallback below.
 */
const BENDY_STORY_RANKS = new Map([
  ['the ritual', 10],
  ['avid worker', 11],
  ['time to reflect', 12],
  ['did you see that', 13],

  ['welcome to the studio', 100],
  ['armed and ready', 110],
  ['banish the darkness', 120],
  ['plaything', 130],
  ['cartoon madness', 190],

  ['rubberhose nightmare', 290],

  ['crawling killer', 300],
  ['next in line', 310],
  ['thrills and spills', 390],

  ['it stinks', 400],
  ['timeless remains', 490],

  ['socialite', 500],
  ['to the darkest reaches', 590],

  ['the master s pen', 900],
  ['a butchered decision', 910],
  ['studio starter', 920],
  ['studio scrapper', 921],
  ['studio breaker', 922],
  ['ink master', 923],
  ['the ink provides', 930],
  ['written in ink', 931],
  ['the well of voices', 932],
  ['self discovery', 933],
  ['the insane reader', 934],
  ['familiar faces', 935],
]);

function normalizedAppId(value) {
  const appId = toFiniteNumber(value);
  return appId !== null && Number.isInteger(appId) && appId > 0 ? appId : null;
}

function naturalStoryRank(achievement, context = {}) {
  if (normalizedAppId(context.appId) !== BENDY_AND_THE_DARK_REVIVAL_APP_ID) return null;
  return BENDY_STORY_RANKS.get(evidenceKey(achievement.name)) ?? null;
}

function compareNaturalStory(left, right, context) {
  const leftRank = naturalStoryRank(left, context);
  const rightRank = naturalStoryRank(right, context);

  if (leftRank !== null && rightRank !== null) return leftRank - rightRank || stableTieBreak(left, right);
  if (leftRank !== null) return -1;
  if (rightRank !== null) return 1;

  // For unknown titles and every unsupported app, preserve Steam schema order.
  return stableTieBreak(left, right);
}

function orderAchievements(achievements, mode = ORDER_MODES.ORIGINAL, context = {}) {
  const normalized = normalizeAchievements(achievements);
  const ordered = [...normalized];

  switch (mode) {
    case ORDER_MODES.NATURAL_STORY:
      ordered.sort((left, right) => compareNaturalStory(left, right, context));
      break;
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
  BENDY_AND_THE_DARK_REVIVAL_APP_ID,
  normalizeAchievement,
  normalizeAchievements,
  normalizePercent,
  naturalStoryRank,
  orderAchievements,
};
