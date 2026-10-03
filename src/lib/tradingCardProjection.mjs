export const TRADING_CARD_FILTERS = Object.freeze([
  'All',
  'With Cards',
  'Without Cards',
  'Drops Remaining',
  'Drops Exhausted',
  'Currently Monitoring',
]);

export const TRADING_CARD_SORTS = Object.freeze({
  RECENT: 'recent',
  DROPS: 'drops',
  ALPHABETICAL: 'alphabetical',
});

function compareName(left, right) {
  return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base', numeric: true });
}

function dropValue(game) {
  return Number.isInteger(game?.remainingDrops) ? game.remainingDrops : -1;
}

function matchesFilter(game, filter, monitoredAppId) {
  switch (filter) {
    case 'With Cards': return game.eligibility === 'with-cards';
    case 'Without Cards': return game.eligibility === 'no-cards';
    case 'Drops Remaining': return game.dropStatus === 'remaining';
    case 'Drops Exhausted': return game.dropStatus === 'exhausted';
    case 'Currently Monitoring': return Number(game.appId) === Number(monitoredAppId);
    case 'All':
    default: return true;
  }
}

function recencyRank(appId, recentAppIds) {
  const index = recentAppIds.indexOf(Number(appId));
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

export function projectTradingCardLibrary({ games, filter = 'All', search = '', sort = TRADING_CARD_SORTS.RECENT, recentAppIds = [], monitoredAppId = null } = {}) {
  const normalizedSearch = String(search || '').trim().toLocaleLowerCase('en-US');
  const visible = (Array.isArray(games) ? games : [])
    .filter((game) => matchesFilter(game, filter, monitoredAppId))
    .filter((game) => !normalizedSearch || String(game?.name || '').toLocaleLowerCase('en-US').includes(normalizedSearch));

  return [...visible].sort((left, right) => {
    if (sort === TRADING_CARD_SORTS.DROPS) return dropValue(right) - dropValue(left) || compareName(left, right);
    if (sort === TRADING_CARD_SORTS.ALPHABETICAL) return compareName(left, right);
    return recencyRank(left.appId, recentAppIds) - recencyRank(right.appId, recentAppIds) || compareName(left, right);
  });
}

export function buildRecentAppIds(appId, previous = []) {
  const numericAppId = Number(appId);
  if (!Number.isInteger(numericAppId) || numericAppId <= 0) return [...previous];
  return [numericAppId, ...previous.filter((value) => Number(value) !== numericAppId)].slice(0, 50);
}
