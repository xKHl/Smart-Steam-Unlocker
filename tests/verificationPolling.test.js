const assert = require('node:assert/strict');
const test = require('node:test');
const { pollForVerifiedUnlock } = require('../electron/humanized/verificationPolling');

test('verification polling completes on the first confirmation read', async () => {
  const delays = [];
  let probes = 0;
  const result = await pollForVerifiedUnlock({
    delays: [0, 750, 1750],
    waitForDelay: async (delay) => { delays.push(delay); },
    probe: async () => {
      probes += 1;
      return { success: true, unlocked: true, endpoint: 'player-achievements' };
    },
  });

  assert.equal(result.unlocked, true);
  assert.equal(probes, 1);
  assert.deepEqual(delays, [0]);
});

test('verification polling continues after a normal false read and returns a later confirmed unlock', async () => {
  const delays = [];
  const responses = [
    { success: true, unlocked: false, endpoint: 'player-achievements' },
    { success: true, unlocked: true, endpoint: 'player-achievements' },
  ];
  let probes = 0;

  const result = await pollForVerifiedUnlock({
    delays: [0, 750, 1750],
    waitForDelay: async (delay) => { delays.push(delay); },
    probe: async () => {
      const response = responses[probes] || responses.at(-1);
      probes += 1;
      return response;
    },
  });

  assert.equal(result.unlocked, true);
  assert.equal(probes, 2);
  assert.deepEqual(delays, [0, 750]);
});

test('verification polling completes on the third confirmation read', async () => {
  const delays = [];
  const responses = [
    { success: true, unlocked: false, endpoint: 'player-achievements' },
    { success: true, unlocked: false, endpoint: 'player-achievements' },
    { success: true, unlocked: true, endpoint: 'player-achievements' },
  ];
  let probes = 0;
  const result = await pollForVerifiedUnlock({
    delays: [0, 750, 1750],
    waitForDelay: async (delay) => { delays.push(delay); },
    probe: async () => responses[probes++],
  });

  assert.equal(result.unlocked, true);
  assert.equal(probes, 3);
  assert.deepEqual(delays, [0, 750, 1750]);
});

test('verification polling returns the final normal false state only after the bounded policy is exhausted', async () => {
  const delays = [];
  let probes = 0;
  const result = await pollForVerifiedUnlock({
    delays: [0, 750, 1750],
    waitForDelay: async (delay) => { delays.push(delay); },
    probe: async () => {
      probes += 1;
      return { success: true, unlocked: false, endpoint: 'player-achievements' };
    },
  });

  assert.equal(result.unlocked, false);
  assert.equal(probes, 3);
  assert.deepEqual(delays, [0, 750, 1750]);
});
