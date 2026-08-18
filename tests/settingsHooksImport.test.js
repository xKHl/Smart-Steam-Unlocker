const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const settingsPath = path.join(__dirname, '..', 'src', 'pages', 'Settings.jsx');

test('Settings imports every React hook it invokes so credential status states render without a route crash', () => {
  const source = fs.readFileSync(settingsPath, 'utf8');
  const importMatch = source.match(/import\s+React\s*,\s*\{([^}]+)\}\s+from\s+['"]react['"]/);
  assert.ok(importMatch, 'Settings must import React hooks from react.');
  const importedHooks = new Set(importMatch[1].split(',').map((value) => value.trim()));
  const invokedHooks = [...source.matchAll(/\b(use[A-Z][A-Za-z0-9]*)\s*\(/g)].map((match) => match[1]);

  for (const hook of new Set(invokedHooks)) {
    assert.ok(importedHooks.has(hook), `Settings invokes ${hook} but does not import it from react.`);
  }
  assert.ok(source.includes('window.steamAPI?.credentials.getStatus()'), 'Settings must retain the credential-status UI path.');
});
