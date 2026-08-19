export function shouldRefreshHumanizedCountdown({ scheduleState, nextUnlockAt, nextVerificationAt, verificationExhausted = false } = {}) {
  if (scheduleState !== 'running') return false;
  if (Number.isFinite(nextUnlockAt)) return true;
  return !verificationExhausted && Number.isFinite(nextVerificationAt);
}
