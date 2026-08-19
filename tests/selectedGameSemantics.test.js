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

test('selected game is persisted only by an explicit sanitized switch-game request and restored as selection state', () => {
  const handlers = source('electron/ipc/handlers.js');
  const main = source('electron/main.js');
  const app = source('src/App.jsx');

  const selectionWrites = handlers.match(/settingsStore\.set\('selectedGame'/g) || [];
  assert.equal(selectionWrites.length, 1);
  assert.match(handlers, /const \{ appId, name, headerImage \} = sanitizeSwitchGamePayload\(payload\);/);
  assert.match(handlers, /settingsStore\.set\('selectedGame', \{ appId, name, headerImage \}\);/);
  assert.match(handlers, /app:get-initial-state', \(\) => \(\{ selectedGame: settingsStore\.get\('selectedGame'\) \}\)/);
  assert.match(main, /const selectedGame = settingsStore\.get\('selectedGame'\);/);
  assert.match(app, /if \(state\?\.selectedGame\) \{/);
  assert.match(app, /setSelectedGame\(state\.selectedGame\);/);
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
  assert.match(dashboard, /Last Activity/);
  assert.match(dashboard, /Steam library data has no reliable last-played timestamp/);
  assert.match(sidebar, />Selected Game</);
  assert.match(card, /aria-label="Selected game"/);
  assert.match(card, />\s*Selected\s*</);
  assert.doesNotMatch(steamManager, /rtime_last_played/);
});

test('the protected route-restoration guard remains one-time only', () => {
  const app = source('src/App.jsx');
  assert.match(app, /const initialStateApplied = useRef\(false\);/);
  assert.match(app, /if \(!active \|\| initialStateApplied\.current\) return;/);
  assert.match(app, /initialStateApplied\.current = true;/);
  assert.match(app, /Initial-state restoration must not depend on location-sensitive navigate\./);
});

test('normal verification hides manual recheck while safety states remain presentation-controlled', () => {
  const panel = source('src/components/HumanizedSchedulePanel.jsx');
  assert.match(panel, /\{verificationView\?\.showRecheck && \(/);
  assert.doesNotMatch(panel, /\{verificationItem && \(\s*<button[\s\S]*?humanized-recheck-action/);
});
