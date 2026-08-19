const assert = require('node:assert/strict');
const test = require('node:test');

async function presentationModule() {
  return import('../src/lib/humanizedVerificationPresentation.mjs');
}

function verificationItem(metadata = {}) {
  return {
    id: 'ACHIEVEMENT_ONE',
    status: 'verification-required',
    verificationMeta: metadata,
  };
}

test('successful submission uses calm background-confirmation copy and hides manual recheck', async () => {
  const { verificationPresentation, itemStatusPresentation } = await presentationModule();
  const view = verificationPresentation(verificationItem({ attemptCount: 1, exhausted: false }), 'running');

  assert.deepEqual(view, {
    tone: 'progress',
    title: 'Unlock submitted',
    detail: 'Confirming with Steam in background…',
    body: 'Steam confirmation continues automatically in the background. You can keep using the app; no action is needed.',
    showRecheck: false,
    recheckDisabled: true,
  });
  assert.deepEqual(itemStatusPresentation('verification-required'), { label: 'Confirming in background', tone: 'progress' });
});

test('exhausted nonterminal confirmation remains calm and explicitly protects against duplicate unlocks', async () => {
  const { verificationPresentation } = await presentationModule();
  const view = verificationPresentation(verificationItem({ exhausted: true, reasonCode: 'CONFIRMED_NOT_UNLOCKED_HORIZON' }), 'paused');

  assert.equal(view.tone, 'warning');
  assert.equal(view.title, 'Pending Steam confirmation');
  assert.equal(view.body, 'No duplicate unlock was attempted.');
  assert.equal(view.recheckDisabled, false);
});

test('terminal verification configuration failures retain danger semantics', async () => {
  const { verificationPresentation } = await presentationModule();
  const view = verificationPresentation(verificationItem({ exhausted: true, reasonCode: 'INVALID_API_KEY' }), 'paused');

  assert.equal(view.tone, 'danger');
  assert.equal(view.title, 'Steam confirmation needs attention');
  assert.equal(view.recheckDisabled, false);
});
