/**
 * Public Steam Store metadata reader for Trading Card eligibility.
 *
 * The Store response is public and does not need account credentials. A game is
 * classified only when its response contains a categories array; otherwise the
 * caller receives no entry and keeps the UI state unavailable.
 */

const { STORE_TRADING_CARD_CATEGORY_ID } = require('./cardClassification');

const STORE_ENDPOINT = 'https://store.steampowered.com/api/appdetails';
const MAX_APP_IDS_PER_REQUEST = 25;

function normalizeAppIds(appIds) {
  const seen = new Set();
  return (Array.isArray(appIds) ? appIds : []).flatMap((value) => {
    const appId = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(appId) || appId <= 0 || seen.has(appId)) return [];
    seen.add(appId);
    return [appId];
  });
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function eligibilityFromAppDetails(data, appId) {
  const entry = data?.[String(appId)];
  if (!entry || entry.success !== true || !Array.isArray(entry.data?.categories)) return null;
  return entry.data.categories.some((category) => Number(category?.id) === STORE_TRADING_CARD_CATEGORY_ID);
}

function createStoreMetadataClient({ fetchImpl = fetch, timeoutMs = 12_000, countryCode = 'us', language = 'english' } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  async function getTradingCardEligibility(appIds) {
    const requested = normalizeAppIds(appIds);
    const eligibilityByAppId = new Map();
    const unavailableAppIds = new Set();

    for (const batch of chunks(requested, MAX_APP_IDS_PER_REQUEST)) {
      const params = new URLSearchParams({ appids: batch.join(','), cc: countryCode, l: language });
      let response;
      try {
        response = await fetchImpl(`${STORE_ENDPOINT}?${params}`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: 'application/json' },
        });
      } catch {
        batch.forEach((appId) => unavailableAppIds.add(appId));
        continue;
      }

      if (!response?.ok) {
        batch.forEach((appId) => unavailableAppIds.add(appId));
        continue;
      }

      let data;
      try {
        data = await response.json();
      } catch {
        batch.forEach((appId) => unavailableAppIds.add(appId));
        continue;
      }

      batch.forEach((appId) => {
        const eligible = eligibilityFromAppDetails(data, appId);
        if (eligible === null) unavailableAppIds.add(appId);
        else eligibilityByAppId.set(appId, eligible);
      });
    }

    return { eligibilityByAppId, unavailableAppIds };
  }

  return { getTradingCardEligibility };
}

module.exports = {
  STORE_ENDPOINT,
  MAX_APP_IDS_PER_REQUEST,
  normalizeAppIds,
  eligibilityFromAppDetails,
  createStoreMetadataClient,
};
