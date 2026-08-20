const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('a missing settings file has no implicit selected-game value', () => {
  const settingsStore = source('electron/settingsStore.js');
  assert.match(settingsStore, /if \(error\?\.code === 'ENOENT'\) return \{\};/);
  assert.match(settingsStore, /function get\(key, defaultValue = null\)/);
  assert.match(settingsStore, /return readAll\(\)\[key\] \?\? defaultValue;/);
});

test('selected game is persisted only by an explicit sanitized switch-game request and never restored as active startup selection', () => {
  const handlers = source('electron/ipc/handlers.js');
  const main = source('electron/main.js');
  const app = source('src/App.jsx');

  const selectionWrites = handlers.match(/settingsStore\.set\('selectedGame'/g) || [];
  assert.equal(selectionWrites.length, 1);
  assert.match(handlers, /const \{ appId, name, headerImage \} = sanitizeSwitchGamePayload\(payload\);/);
  assert.match(handlers, /settingsStore\.set\('selectedGame', \{ appId, name, headerImage \}\);/);
  assert.match(handlers, /app:get-initial-state', \(\) => \(\{ selectedGame: null \}\)/);
  assert.doesNotMatch(main, /app:initial-state/);
  assert.match(app, /explicit choice in this application session/);
  assert.doesNotMatch(app, /state\?\.selectedGame/);
  assert.doesNotMatch(app, /setSelectedGame\(state\.selectedGame\)/);
});

test('first run remains library-led and does not open achievement data without a selected game', () => {
  const dashboard = source('src/pages/Dashboard.jsx');
  const achievements = source('src/pages/Achievements.jsx');

  assert.match(dashboard, /No game selected/);
  assert.match(dashboard, /Choose a game from your Steam library to view its achievement progress\./);
  assert.match(dashboard, /Browse Library/);
  assert.match(achievements, /if \(!selectedGame\) return undefined;/);
  assert.match(achievements, /Select a game from your library to browse its achievements\./);
  assert.match(achievements, /id="btn-go-to-library"/);
});

test('selected-game and activity labels remain truthful and independent', () => {
  const dashboard = source('src/pages/Dashboard.jsx');
  const sidebar = source('src/components/Sidebar.jsx');
  const card = source('src/components/GameCard.jsx');
  const steamManager = source('electron/steamManager.js');

  assert.match(dashboard, /Selected game: \$\{selectedGame\.name\}\./);
  assert.match(dashboard, /dashboard-eyebrow">Selected game/);
  assert.match(dashboard, /This game was selected from your library\./);
  assert.match(dashboard, /Recent Activity/);
  assert.match(dashboard, /playtime2Weeks/);
  assert.match(dashboard, /No recent activity reported by Steam/);
  assert.doesNotMatch(dashboard, /label: 'Last Activity'/);
  assert.doesNotMatch(dashboard, /Steam library data has no reliable last-played timestamp/);
  assert.match(sidebar, />Selected Game</);
  assert.match(card, /aria-label="Selected game"/);
  assert.match(card, />\s*Selected\s*</);
  assert.doesNotMatch(steamManager, /rtime_last_played/);
});

test('GameCard uses a native button element for reliable click handling in Electron', () => {
  const card = source('src/components/GameCard.jsx');
  const styles = source('src/index.css');

  // Must be a native button, not a div with role=button
  assert.match(card, /<button/);
  assert.match(card, /type="button"/);
  assert.doesNotMatch(card, /role="button"/);

  // onClick must be wired directly to the button
  assert.match(card, /onClick=\{onClick\}/);

  // CSS must reset native button styles so the card looks correct
  assert.match(styles, /\.game-card \{[\s\S]*?-webkit-appearance: none/);
  assert.match(styles, /\.game-card \{[\s\S]*?padding: 0/);
  assert.match(styles, /\.game-card \{[\s\S]*?width: 100%/);

  // Library must still wire onClick to onGameSelect
  const library = source('src/pages/Library.jsx');
  assert.match(library, /onClick=\{\(\) => onGameSelect\(game\)\}/);
});

test('the protected route-restoration guard remains one-time only', () => {
  const app = source('src/App.jsx');
  assert.match(app, /const initialStateApplied = useRef\(false\);/);
  assert.match(app, /if \(!active \|\| initialStateApplied\.current\) return;/);
  assert.match(app, /initialStateApplied\.current = true;/);
  assert.match(app, /previously fixed route behavior/);
});

test('normal verification hides manual recheck while safety states remain presentation-controlled', () => {
  const panel = source('src/components/HumanizedSchedulePanel.jsx');
  assert.match(panel, /\{verificationView\?\.showRecheck && \(/);
  assert.doesNotMatch(panel, /\{verificationItem && \(\s*<button[\s\S]*?humanized-recheck-action/);
});


test('author ownership branding is visible in Sidebar and Settings through the trusted external-link boundary', () => {
  const sidebar = source('src/components/Sidebar.jsx');
  const settings = source('src/pages/Settings.jsx');
  const handlers = source('electron/ipc/handlers.js');
  const preload = source('electron/preload.js');

  for (const ui of [sidebar, settings]) {
    assert.match(ui, /Khalid Alotaibi/);
    assert.match(ui, /Smart Steam Unlocker/);
    assert.match(ui, /© 2026 Khalid Alotaibi/);
    assert.match(ui, /window\.steamAPI\?\.app\?\.openExternal/);
    assert.match(ui, /https:\/\/github\.com\/xKHI\/Smart-Steam-Unlocker/);
    assert.match(ui, /https:\/\/alotaibi\.dev/);
  }

  assert.match(sidebar, /sidebar-credit/);
  assert.match(sidebar, /GitHub<\/button>/);
  assert.match(sidebar, /Website<\/button>/);
  assert.match(settings, /ABOUT &amp; CREDITS/);
  assert.match(settings, /Created by Khalid Alotaibi/);
  assert.match(settings, /GitHub Repository/);
  assert.match(handlers, /'https:\/\/github\.com\/xKHI\/Smart-Steam-Unlocker'/);
  assert.match(handlers, /'https:\/\/alotaibi\.dev'/);
  assert.match(preload, /openExternal:\s+\(url\) => ipcRenderer\.invoke\('app:open-external', url\)/);
});

test('Dashboard stays product-focused while Sidebar layout and existing navigation remain usable', () => {
  const dashboard = source('src/pages/Dashboard.jsx');
  const sidebar = source('src/components/Sidebar.jsx');
  const styles = source('src/index.css');

  assert.doesNotMatch(dashboard, /dashboard-footer/);
  assert.doesNotMatch(dashboard, /GitHub: xkhi/);
  assert.match(sidebar, /nav-dashboard/);
  assert.match(sidebar, /nav-library/);
  assert.match(sidebar, /nav-achievements/);
  assert.match(sidebar, /nav-trading-cards/);
  assert.match(sidebar, /nav-settings/);
  assert.match(sidebar, /sidebar-navigation-region/);
  assert.match(sidebar, /sidebar-spacer/);
  assert.match(sidebar, /sidebar-credit[\s\S]*?sidebar-footer/);
  assert.match(styles, /\.sidebar-navigation-region \{\s*flex: 0 0 auto;/);
  assert.doesNotMatch(styles, /\.sidebar-nav \{[^}]*overflow-y: auto/);
  assert.match(styles, /@media \(max-height: 720px\) \{\s*\.sidebar-navigation-region \{ flex: 1 1 auto; overflow-y: auto;/);
  assert.match(styles, /\.sidebar-spacer \{ flex: 1 1 auto;/);
  assert.match(styles, /\.settings-about-links/);
});

test('Dashboard game-selection actions route through the existing Library selection flow', () => {
  const dashboard = source('src/pages/Dashboard.jsx');
  const library = source('src/pages/Library.jsx');
  const app = source('src/App.jsx');

  assert.match(dashboard, /const openGameSelection = \(\) => navigate\('\/library'\);/);
  assert.match(dashboard, /onClick=\{openGameSelection\}/);
  assert.match(dashboard, /const opensGameSelection = !selectedGame && \(id === 'stat-unlocked' \|\| id === 'stat-rate'\);/);
  assert.match(dashboard, /role=\{opensGameSelection \? 'button' : undefined\}/);
  assert.match(library, /onClick=\{\(\) => onGameSelect\(game\)\}/);
  assert.match(app, /<Route path="\/library"[\s\S]*?onGameSelect=\{handleGameSelect\}/);
  assert.match(app, /setSelectedGame\(game\);[\s\S]*?navigate\('\/achievements'\);/);
});

test('Library Browse Achievements click surfaces a visible error instead of silently failing', () => {
  const app = source('src/App.jsx');
  const library = source('src/pages/Library.jsx');
  const styles = source('src/index.css');

  // handleGameSelect must expose the error through state, not only console.error
  assert.match(app, /setSwitchGameError\(err\?\.message/);
  assert.match(app, /setSwitchGameError\(null\)/);

  // Library route must receive the error state and a dismiss callback
  assert.match(app, /switchError=\{switchGameError\}/);
  assert.match(app, /onDismissSwitchError=\{/);

  // Library must accept and render the error
  assert.match(library, /switchError, onDismissSwitchError/);
  assert.match(library, /library-switch-error/);
  assert.match(library, /role="alert"/);
  assert.match(library, /aria-live="assertive"/);
  assert.match(library, /onDismissSwitchError/);

  // The error banner must have CSS
  assert.match(styles, /\.library-switch-error \{/);
  assert.match(styles, /\.library-switch-error-dismiss/);

  // The existing selection path must be unchanged
  assert.match(library, /onClick=\{\(\) => onGameSelect\(game\)\}/);
  assert.match(app, /<Route path="\/library"[\s\S]*?onGameSelect=\{handleGameSelect\}/);
  assert.match(app, /setSelectedGame\(game\);[\s\S]*?navigate\('\/achievements'\);/);
});

test('assertGameSwitchAllowed only blocks on a running schedule, not on paused or stale persisted schedules', () => {
  const handlers = source('electron/ipc/handlers.js');

  // The guard must check schedule.state === 'running', not item-level statuses.
  // This ensures that paused schedules restored at startup do not block Library.
  assert.match(handlers, /schedule\?\.state === 'running'/);
  assert.match(handlers, /isActivelyRunning/);

  // The old item-level check (hasNonterminalItem) must no longer be the gate.
  assert.doesNotMatch(handlers, /hasNonterminalItem/);

  // The guard must still throw ACTIVE_SCHEDULE_APP_ID_CONFLICT for running schedules.
  assert.match(handlers, /ACTIVE_SCHEDULE_APP_ID_CONFLICT/);
  assert.match(handlers, /Stop the active Humanized schedule before selecting another game/);

  // recoverSchedule must downgrade 'running' -> 'paused' on restart (no auto-resume
  // without a pending verification), confirming stale schedules are always paused.
  const engine = source('electron/humanized/schedulerEngine.js');
  assert.match(engine, /recovered\.state = SCHEDULE_STATE\.PAUSED/);
  assert.match(engine, /recovered\.state = SCHEDULE_STATE\.RUNNING/);
});
