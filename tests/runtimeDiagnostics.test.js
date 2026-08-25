const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');
const diagnosticsModule = path.join(projectRoot, 'electron', 'runtimeDiagnostics.js');
const packageJson = require(path.join(projectRoot, 'package.json'));

function isEnabledWith(args, env = {}) {
  const output = execFileSync(process.execPath, ['-e', `process.stdout.write(String(require(${JSON.stringify(diagnosticsModule)}).isEnabled()))`, '--', ...args], {
    cwd: projectRoot,
    env: { ...process.env, SSU_DIAGNOSTICS: '', ...env },
    encoding: 'utf8',
  });
  return output.trim() === 'true';
}

test('runtime diagnostics accept the documented command-line flags without loading Electron', () => {
  assert.equal(isEnabledWith(['--enable-diagnostics']), true);
  assert.equal(isEnabledWith(['--ssu-diagnostics']), true);
  assert.equal(isEnabledWith([]), false);
  assert.equal(isEnabledWith([], { SSU_DIAGNOSTICS: '1' }), true);
});

test('diagnostic development launcher explicitly enables the Electron process', () => {
  assert.match(packageJson.scripts['electron:dev:diagnostics'], /SSU_DIAGNOSTICS=1/);
  assert.match(packageJson.scripts['electron:dev:diagnostics'], /--enable-diagnostics/);
  assert.match(packageJson.scripts['dev:diagnostics'], /electron:dev:diagnostics/);
});

test('diagnostic writer exports a JSONL event log and explicit status manifest contract', () => {
  const source = fs.readFileSync(diagnosticsModule, 'utf8');
  assert.match(source, /runtime-diagnostics\.jsonl/);
  assert.match(source, /runtime-diagnostics-status\.json/);
  assert.match(source, /console\.error\(\`\[SSU diagnostics\] write failed:/);
});
