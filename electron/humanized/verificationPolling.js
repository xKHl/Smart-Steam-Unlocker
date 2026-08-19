async function pollForVerifiedUnlock({ delays, waitForDelay, probe }) {
  if (!Array.isArray(delays) || delays.length === 0) {
    throw new Error('A non-empty verification delay policy is required.');
  }
  if (typeof waitForDelay !== 'function' || typeof probe !== 'function') {
    throw new Error('Verification polling requires delay and probe functions.');
  }

  let lastResult = null;
  for (const delayMs of delays) {
    await waitForDelay(delayMs);
    lastResult = await probe();
    if (lastResult?.success && lastResult.unlocked === true) return lastResult;
  }
  return lastResult;
}

module.exports = { pollForVerifiedUnlock };
