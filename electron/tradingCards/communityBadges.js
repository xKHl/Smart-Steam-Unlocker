/**
 * Remaining Trading Card drops from the signed-in Steam Community badges page.
 *
 * The Steam Web API has no remaining-drop field (IPlayerService/GetBadges only
 * describes crafted badges). The owner's own badges page shows "N card drops
 * remaining" per game, but only to a signed-in session for that same account.
 * This module stays pure: it parses HTML and pages through results with an
 * injected fetch, so it never touches cookies or Electron directly.
 */

const COMMUNITY_BASE = 'https://steamcommunity.com';
const MAX_PAGES = 40;

const COMMUNITY_ERROR = Object.freeze({
  NOT_SIGNED_IN: 'COMMUNITY_NOT_SIGNED_IN',
  ACCOUNT_MISMATCH: 'COMMUNITY_ACCOUNT_MISMATCH',
  FETCH_FAILED: 'COMMUNITY_FETCH_FAILED',
  MISSING_STEAM_ID: 'MISSING_STEAM_ID',
});

const SIGN_IN_HOSTS = new Set([
  'steamcommunity.com',
  'store.steampowered.com',
  'login.steampowered.com',
  'help.steampowered.com',
  'checkout.steampowered.com',
]);

/** Steam's steamLoginSecure cookie starts with "<steamid64>||<token>". */
function steamIdFromLoginCookie(value) {
  let decoded = '';
  try {
    decoded = decodeURIComponent(String(value || ''));
  } catch {
    return null;
  }
  const match = /^(\d{17})\|\|/.exec(decoded);
  return match ? match[1] : null;
}

/** The sign-in window may only navigate within Steam's own HTTPS sign-in hosts. */
function isAllowedSignInUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && SIGN_IN_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function signedInSteamId(html) {
  const match = /g_steamID\s*=\s*"(\d{17})"/.exec(String(html || ''));
  return match ? match[1] : null;
}

/**
 * Parses one English badges page (requested with l=english so the drop text is
 * stable). Each game badge row links to /gamecards/<appid>/ and, for the owner,
 * shows "<n> card drop(s) remaining" or "No card drops remaining".
 */
function parseBadgesPage(html, currentPage = 1) {
  const source = String(html || '');
  const entries = [];
  const seen = new Set();
  const rows = source.split(/class="badge_row[\s"]/).slice(1);

  rows.forEach((row) => {
    const appMatch = /\/gamecards\/(\d+)\//.exec(row);
    if (!appMatch) return;
    const appId = Number(appMatch[1]);
    if (!Number.isInteger(appId) || appId <= 0 || seen.has(appId)) return;

    let remainingDrops = null;
    const countMatch = /(\d+)\s+card drops?\s+remaining/i.exec(row);
    if (countMatch) remainingDrops = Number(countMatch[1]);
    else if (/No card drops remaining/i.test(row)) remainingDrops = 0;
    if (remainingDrops === null) return;

    seen.add(appId);
    entries.push({ appId, remainingDrops });
  });

  const nextPage = new RegExp(`[?&]p=${currentPage + 1}["&]`).test(source);
  return { steamId: signedInSteamId(source), entries, nextPage };
}

function createCommunityBadgesClient({ fetchImpl, maxPages = MAX_PAGES } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  async function getRemainingDrops(steamId) {
    if (!/^\d{17}$/.test(String(steamId || ''))) return { success: false, errorCode: COMMUNITY_ERROR.MISSING_STEAM_ID, badges: [] };

    const badges = [];
    const seen = new Set();
    for (let page = 1; page <= maxPages; page += 1) {
      let html;
      try {
        const response = await fetchImpl(`${COMMUNITY_BASE}/profiles/${steamId}/badges/?l=english&p=${page}`);
        if (!response?.ok) return { success: false, errorCode: COMMUNITY_ERROR.FETCH_FAILED, badges: [] };
        html = await response.text();
      } catch {
        return { success: false, errorCode: COMMUNITY_ERROR.FETCH_FAILED, badges: [] };
      }

      const parsed = parseBadgesPage(html, page);
      if (!parsed.steamId) return { success: false, errorCode: COMMUNITY_ERROR.NOT_SIGNED_IN, badges: [] };
      // Another account's page never shows drop counts, so a mismatch must not
      // be read as "no drops remaining".
      if (parsed.steamId !== String(steamId)) return { success: false, errorCode: COMMUNITY_ERROR.ACCOUNT_MISMATCH, badges: [] };

      parsed.entries.forEach((entry) => {
        if (seen.has(entry.appId)) return;
        seen.add(entry.appId);
        badges.push(entry);
      });
      if (!parsed.nextPage) break;
    }
    return { success: true, badges };
  }

  return { getRemainingDrops };
}

module.exports = {
  COMMUNITY_BASE,
  COMMUNITY_ERROR,
  signedInSteamId,
  steamIdFromLoginCookie,
  isAllowedSignInUrl,
  parseBadgesPage,
  createCommunityBadgesClient,
};
