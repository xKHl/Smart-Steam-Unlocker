/**
 * Public Steam Store metadata reader for Trading Card eligibility.
 *
 * The Store response is public and does not need account credentials. A game is
 * classified only when its response contains a categories array; otherwise the
 * caller receives no entry and keeps the UI state unavailable.
 */

const { STORE_TRADING_CARD_CATEGORY_ID } = require('./cardClassification');

const STORE_ENDPOINT = 'https://store.steampowered.com/api/appdetails';
// Steam's appdetails endpoint rejects comma-separated app IDs with HTTP 400
// unless the only filter is price_overview, so every app is requested on its
// own with filters=categories (a tiny payload) and a small concurrency cap.
const MAX_APP_IDS_PER_REQUEST = 1;
const DEFAULT_CONCURRENCY = 4;

function normalizeAppIds(appIds) {
  const seen = new Set();
  return (Array.isArray(appIds) ? appIds : []).flatMap((value) => {
    const appId = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(appId) || appId <= 0 || seen.has(appId)) return [];
    seen.add(appId);
    return [appId];
  });
}

function eligibilityFromAppDetails(data, appId) {
  const entry = data?.[String(appId)];
  if (!entry || entry.success !== true) return null;
  // With filters=categories Steam returns `data: []` for an app that has no
  // categories at all: an explicit answer that it has no Trading Cards.
  if (Array.isArray(entry.data) && entry.data.length === 0) return false;
  if (!Array.isArray(entry.data?.categories)) return null;
  return entry.data.categories.some((category) => Number(category?.id) === STORE_TRADING_CARD_CATEGORY_ID);
}

function createStoreMetadataClient({ fetchImpl = fetch, timeoutMs = 12_000, countryCode = 'us', language = 'english', concurrency = DEFAULT_CONCURRENCY } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  async function fetchOne(appId) {
    const params = new URLSearchParams({ appids: String(appId), filters: 'categories', cc: countryCode, l: language });
    let response;
    try {
      response = await fetchImpl(`${STORE_ENDPOINT}?${params}`, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      });
    } catch {
      return { appId, eligible: null };
    }
    if (response?.status === 429) return { appId, eligible: null, rateLimited: true };
    if (!response?.ok) return { appId, eligible: null };
    try {
      return { appId, eligible: eligibilityFromAppDetails(await response.json(), appId) };
    } catch {
      return { appId, eligible: null };
    }
  }

  async function getTradingCardEligibility(appIds) {
    const queue = normalizeAppIds(appIds);
    const eligibilityByAppId = new Map();
    const unavailableAppIds = new Set();
    let rateLimited = false;

    async function worker() {
      while (queue.length) {
        const appId = queue.shift();
        if (rateLimited) {
          unavailableAppIds.add(appId);
          continue;
        }
        const result = await fetchOne(appId);
        if (result.rateLimited) rateLimited = true;
        if (result.eligible === null) unavailableAppIds.add(appId);
        else eligibilityByAppId.set(appId, result.eligible);
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
    return { eligibilityByAppId, unavailableAppIds, rateLimited };
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
