const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');

test('persisted selected-game restoration is guarded to a single startup application', () => {
  const restorationBlock = appSource.slice(
    appSource.indexOf('// ── Restore persisted state once at application startup'),
    appSource.indexOf('// ── Game Selection Handler'),
  );

  assert.match(restorationBlock, /initialStateApplied\.current/);
  assert.match(restorationBlock, /if \(!active \|\| initialStateApplied\.current\) return;/);
  assert.match(restorationBlock, /initialStateApplied\.current = true;/);
  assert.match(restorationBlock, /\}, \[\]\);/);
  assert.doesNotMatch(restorationBlock, /\}, \[navigate\]\);/);
});
