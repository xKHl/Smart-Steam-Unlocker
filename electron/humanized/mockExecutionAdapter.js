/**
 * A deterministic, Steam-independent execution adapter for development and tests.
 * Callers may supply per-achievement outcome sequences, e.g. { ACH_1: ['retry', 'success'] }.
 */

function normalizeOutcome(outcome) {
  switch (outcome) {
    case 'success':
    case 'verified':
      return { outcome: 'success', verification: 'verified' };
    case 'unverified':
      return { outcome: 'success', verification: 'unverified' };
    case 'uncertain':
      return { outcome: 'uncertain', verification: 'uncertain', error: 'Verification result is uncertain.' };
    case 'retry':
      return { outcome: 'retry', verification: 'unverified', error: 'Mock adapter requested a retry.' };
    case 'failed':
    default:
      return { outcome: 'failed', verification: 'unverified', error: 'Mock adapter reported a non-retryable failure.' };
  }
}

function createMockExecutionAdapter({ outcomes = {}, defaultOutcome = 'success' } = {}) {
  const calls = [];
  const positions = new Map();

  async function executeUnlock(executionContext) {
    const context = typeof executionContext === 'string'
      ? { achievementId: executionContext }
      : executionContext ?? {};
    const achievementId = context.achievementId;
    const index = positions.get(achievementId) ?? 0;
    positions.set(achievementId, index + 1);
    calls.push({ achievementId, index, context: { ...context } });

    const configured = Array.isArray(outcomes[achievementId]) ? outcomes[achievementId] : [outcomes[achievementId]];
    const outcome = configured[index] ?? configured[configured.length - 1] ?? defaultOutcome;
    return normalizeOutcome(outcome);
  }

  return {
    kind: 'mock',
    executeUnlock,
    getCalls: () => [...calls],
  };
}

module.exports = { createMockExecutionAdapter };
