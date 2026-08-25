const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

async function refreshModule() {
  return import('../src/lib/humanizedCountdownRefresh.mjs');
}

test('Humanized countdown refresh activates only for running schedules with a finite execution or background-verification due time', async () => {
  const { shouldRefreshHumanizedCountdown } = await refreshModule();

  assert.equal(shouldRefreshHumanizedCountdown({ scheduleState: 'running', nextUnlockAt: 10_000 }), true);
  assert.equal(shouldRefreshHumanizedCountdown({ scheduleState: 'running', nextVerificationAt: 10_000, verificationExhausted: false }), true);
  assert.equal(shouldRefreshHumanizedCountdown({ scheduleState: 'running', nextVerificationAt: 10_000, verificationExhausted: true }), false);
  assert.equal(shouldRefreshHumanizedCountdown({ scheduleState: 'paused', nextUnlockAt: 10_000 }), false);
  assert.equal(shouldRefreshHumanizedCountdown({ scheduleState: 'running' }), false);
});

test('Humanized panel uses a local one-second presentation clock without changing persisted schedule timing', () => {
  const panel = fs.readFileSync(path.join(root, 'src/components/HumanizedSchedulePanel.jsx'), 'utf8');

  assert.match(panel, /const \[clockNow, setClockNow\] = useState\(\(\) => Date\.now\(\)\);/);
  assert.match(panel, /shouldRefreshHumanizedCountdown/);
  assert.match(panel, /setInterval\(refresh, 1_000\)/);
  assert.match(panel, /clearInterval\(interval\)/);
  assert.match(panel, /localizedRemaining\(nextUnlockAt, clockNow, t\)/);
  assert.match(panel, /localizedRemaining\(item\.verificationMeta\?\.nextVerificationAt, clockNow, t\)/);
});
