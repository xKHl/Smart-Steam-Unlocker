/**
 * Steam-independent verifier for development and tests.
 * Per-achievement outcomes may be configured as sequences, e.g. { ACH_1: ['uncertain', 'verified'] }.
 */

function normalizeVerification(outcome) {
  switch (outcome) {
    case 'verified':
    case 'success':
      return { verification: 'verified' };
    case 'unverified':
      return { verification: 'unverified', error: 'Mock verifier could not confirm the result.' };
    case 'uncertain':
      return { verification: 'uncertain', error: 'Mock verifier returned an uncertain result.' };
    case 'failed':
    default:
      return { verification: 'failed', error: 'Mock verifier reported a verification failure.' };
  }
}

function createMockVerifier({ outcomes = {}, defaultVerification = 'verified' } = {}) {
  const calls = [];
  const positions = new Map();

  async function verify({ item, schedule, executionResult } = {}) {
    const achievementId = item?.id;
    const index = positions.get(achievementId) ?? 0;
    positions.set(achievementId, index + 1);
    calls.push({ achievementId, index, scheduleId: schedule?.id ?? null, executionResult });

    const configured = Array.isArray(outcomes[achievementId]) ? outcomes[achievementId] : [outcomes[achievementId]];
    const outcome = configured[index] ?? configured[configured.length - 1] ?? defaultVerification;
    return normalizeVerification(outcome);
  }

  return {
    kind: 'mock',
    verify,
    getCalls: () => [...calls],
  };
}

module.exports = { createMockVerifier };
