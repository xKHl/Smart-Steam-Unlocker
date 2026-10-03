/**
 * Pure Trading Card classification utilities.
 *
 * These functions deliberately know nothing about Electron, credentials, timers,
 * or launch behavior. They only turn explicit Steam metadata into truthful UI
 * states. Missing data stays unavailable; it is never converted into a guess.
 */

const CARD_ELIGIBILITY = Object.freeze({
  WITH_CARDS: 'with-cards',
  NO_CARDS: 'no-cards',
  UNAVAILABLE: 'unavailable',
});

const DROP_STATUS = Object.freeze({
  REMAINING: 'remaining',
  EXHAUSTED: 'exhausted',
  UNAVAILABLE: 'unavailable',
  NOT_APPLICABLE: 'not-applicable',
});

const STORE_TRADING_CARD_CATEGORY_ID = 29;

function normalizeAppId(value) {
  const appId = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(appId) && appId > 0 ? appId : null;
}

function normalizeRemainingDrops(value) {
  if (value === undefined || value === null || value === '') return null;
  const drops = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(drops) && drops >= 0 ? drops : null;
}

function normalizeStoreEligibility(value) {
  if (value === true || value === false) return value;
  return null;
}

function normalizeBadgeRecords(records) {
  const byAppId = new Map();
  if (!Array.isArray(records)) return byAppId;

  records.forEach((record) => {
    const appId = normalizeAppId(record?.appId ?? record?.appid);
    const remainingDrops = normalizeRemainingDrops(record?.remainingDrops ?? record?.cards_remaining);
    if (appId === null || remainingDrops === null) return;
    byAppId.set(appId, remainingDrops);
  });
  return byAppId;
}

function classifyTradingCardGame(game, { storeEligibility = null, badgeRemainingDrops = null } = {}) {
  const appId = normalizeAppId(game?.appId ?? game?.appid);
  const hasCards = normalizeStoreEligibility(storeEligibility);
  const remainingDrops = normalizeRemainingDrops(badgeRemainingDrops);

  // A positive or zero badge count is account-scoped evidence that this app has
  // a card badge. It is stronger than an unavailable Store response.
  const eligibility = hasCards === true || remainingDrops !== null
    ? CARD_ELIGIBILITY.WITH_CARDS
    : hasCards === false
      ? CARD_ELIGIBILITY.NO_CARDS
      : CARD_ELIGIBILITY.UNAVAILABLE;

  let dropStatus = DROP_STATUS.UNAVAILABLE;
  if (eligibility === CARD_ELIGIBILITY.NO_CARDS) dropStatus = DROP_STATUS.NOT_APPLICABLE;
  if (eligibility === CARD_ELIGIBILITY.WITH_CARDS && remainingDrops !== null) {
    dropStatus = remainingDrops > 0 ? DROP_STATUS.REMAINING : DROP_STATUS.EXHAUSTED;
  }

  return {
    appId,
    eligibility,
    dropStatus,
    remainingDrops: dropStatus === DROP_STATUS.REMAINING ? remainingDrops : null,
    isEligibleForLaunch: eligibility === CARD_ELIGIBILITY.WITH_CARDS && dropStatus === DROP_STATUS.REMAINING,
  };
}

function classifyTradingCardLibrary(games, { eligibilityByAppId = new Map(), badgeRecords = [] } = {}) {
  const badgesByAppId = normalizeBadgeRecords(badgeRecords);
  const source = Array.isArray(games) ? games : [];
  const seen = new Set();

  return source
    .map((game) => {
      const appId = normalizeAppId(game?.appId ?? game?.appid);
      if (appId === null || seen.has(appId)) return null;
      seen.add(appId);
      const classification = classifyTradingCardGame(game, {
        storeEligibility: eligibilityByAppId instanceof Map ? eligibilityByAppId.get(appId) : eligibilityByAppId?.[appId],
        badgeRemainingDrops: badgesByAppId.get(appId),
      });
      return { ...game, ...classification };
    })
    .filter(Boolean);
}

function summarizeTradingCardLibrary(games) {
  const summary = {
    totalGames: 0,
    withCards: 0,
    withoutCards: 0,
    dropsRemaining: 0,
    dropsExhausted: 0,
    unavailable: 0,
  };

  (Array.isArray(games) ? games : []).forEach((game) => {
    summary.totalGames += 1;
    if (game?.eligibility === CARD_ELIGIBILITY.WITH_CARDS) summary.withCards += 1;
    if (game?.eligibility === CARD_ELIGIBILITY.NO_CARDS) summary.withoutCards += 1;
    if (game?.eligibility === CARD_ELIGIBILITY.UNAVAILABLE) summary.unavailable += 1;
    if (game?.dropStatus === DROP_STATUS.REMAINING) summary.dropsRemaining += 1;
    if (game?.dropStatus === DROP_STATUS.EXHAUSTED) summary.dropsExhausted += 1;
  });

  return summary;
}

module.exports = {
  CARD_ELIGIBILITY,
  DROP_STATUS,
  STORE_TRADING_CARD_CATEGORY_ID,
  normalizeAppId,
  normalizeRemainingDrops,
  normalizeStoreEligibility,
  normalizeBadgeRecords,
  classifyTradingCardGame,
  classifyTradingCardLibrary,
  summarizeTradingCardLibrary,
};
