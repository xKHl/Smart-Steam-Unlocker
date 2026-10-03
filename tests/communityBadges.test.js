const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  COMMUNITY_ERROR,
  parseBadgesPage,
  createCommunityBadgesClient,
  steamIdFromLoginCookie,
  isAllowedSignInUrl,
} = require('../electron/tradingCards/communityBadges');

const STEAM_ID = '76561198000000001';

function badgeRow(appId, dropsText) {
  return `<div class="badge_row is_link">
    <a class="badge_row_overlay" href="https://steamcommunity.com/profiles/${STEAM_ID}/gamecards/${appId}/"></a>
    <div class="badge_title_stats"><div class="badge_title_stats_content">
      <div class="badge_title_stats_playtime">&nbsp;12.3 hrs on record</div>
      <div class="badge_title_stats_drops">${dropsText ? `<span class="progress_info_bold">${dropsText}</span>` : ''}</div>
    </div></div>
  </div>`;
}

function page({ steamId = STEAM_ID, rows = [], next = null } = {}) {
  return `<script>g_steamID = ${steamId ? `"${steamId}"` : 'false'};</script>
    <div class="badges_sheet">${rows.join('\n')}</div>
    <div class="pageLinks">${next ? `<a class="pagelink" href="?p=${next}">${next}</a>` : ''}</div>`;
}

test('badge page parser reads remaining, single, and exhausted drops per app and the signed-in account', () => {
  const parsed = parseBadgesPage(page({
    rows: [
      badgeRow(8870, '3 card drops remaining'),
      badgeRow(620, '1 card drop remaining'),
      badgeRow(400, 'No card drops remaining'),
      badgeRow(10, ''),
    ],
    next: 2,
  }), 1);
  assert.equal(parsed.steamId, STEAM_ID);
  assert.deepEqual(parsed.entries, [
    { appId: 8870, remainingDrops: 3 },
    { appId: 620, remainingDrops: 1 },
    { appId: 400, remainingDrops: 0 },
  ]);
  assert.equal(parsed.nextPage, true);
  assert.equal(parseBadgesPage(page({ steamId: null }), 1).steamId, null);
});

test('community client pages through all badge pages and refuses signed-out or other-account pages', async () => {
  const pages = {
    1: page({ rows: [badgeRow(8870, '3 card drops remaining')], next: 2 }),
    2: page({ rows: [badgeRow(620, 'No card drops remaining')] }),
  };
  const urls = [];
  const client = createCommunityBadgesClient({
    fetchImpl: async (url) => {
      urls.push(url);
      const pageNumber = new URL(url).searchParams.get('p');
      return { ok: true, text: async () => pages[pageNumber] };
    },
  });
  assert.deepEqual(await client.getRemainingDrops(STEAM_ID), {
    success: true,
    badges: [{ appId: 8870, remainingDrops: 3 }, { appId: 620, remainingDrops: 0 }],
  });
  assert.ok(urls.every((url) => url.includes(`/profiles/${STEAM_ID}/badges/`) && url.includes('l=english')));

  const signedOut = createCommunityBadgesClient({ fetchImpl: async () => ({ ok: true, text: async () => page({ steamId: null }) }) });
  assert.equal((await signedOut.getRemainingDrops(STEAM_ID)).errorCode, COMMUNITY_ERROR.NOT_SIGNED_IN);

  const otherAccount = createCommunityBadgesClient({ fetchImpl: async () => ({ ok: true, text: async () => page({ steamId: '76561198000000002' }) }) });
  assert.equal((await otherAccount.getRemainingDrops(STEAM_ID)).errorCode, COMMUNITY_ERROR.ACCOUNT_MISMATCH);

  const failing = createCommunityBadgesClient({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await failing.getRemainingDrops(STEAM_ID)).errorCode, COMMUNITY_ERROR.FETCH_FAILED);
  assert.equal((await failing.getRemainingDrops('bad')).errorCode, COMMUNITY_ERROR.MISSING_STEAM_ID);
});

test('sign-in helpers read only the Steam ID from the login cookie and keep the window on Steam hosts', () => {
  assert.equal(steamIdFromLoginCookie(`${STEAM_ID}%7C%7CeyJ0eXAi`), STEAM_ID);
  assert.equal(steamIdFromLoginCookie('garbage'), null);
  assert.equal(steamIdFromLoginCookie('%E0%A4%A'), null);
  assert.equal(isAllowedSignInUrl('https://steamcommunity.com/login/home/'), true);
  assert.equal(isAllowedSignInUrl('https://login.steampowered.com/jwt'), true);
  assert.equal(isAllowedSignInUrl('http://steamcommunity.com/login/home/'), false);
  assert.equal(isAllowedSignInUrl('https://steamcommunity.com.evil.example/'), false);
});

test('community sign-in runs in an isolated sandboxed partition and the renderer passes no sign-in input', () => {
  const sessionSource = fs.readFileSync(path.join(__dirname, '../electron/tradingCards/communitySession.js'), 'utf8');
  const handlers = fs.readFileSync(path.join(__dirname, '../electron/ipc/handlers.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8');
  assert.match(sessionSource, /partition: PARTITION/);
  assert.match(sessionSource, /sandbox: true/);
  assert.match(sessionSource, /nodeIntegration: false/);
  assert.doesNotMatch(sessionSource, /preload:/);
  assert.match(preload, /communitySignIn: \(\) => ipcRenderer\.invoke\('trading-cards:community-sign-in'\)/);
  assert.match(handlers, /'trading-cards:community-sign-in', \(event\) =>/);
});
