const TERMINAL_VERIFICATION_CODES = new Set([
  'INVALID_API_KEY',
  'STEAM_AUTHORIZATION_FAILED',
  'MISSING_STEAM_ID',
  'APP_ID_MISMATCH',
  'ACHIEVEMENT_NOT_FOUND',
  'VERIFICATION_HORIZON_EXHAUSTED',
  'VERIFICATION_FAILED',
]);

export function verificationPresentation(item, scheduleState) {
  if (!item || item.status !== 'verification-required') return null;

  const metadata = item.verificationMeta ?? {};
  const reasonCode = metadata.reasonCode ?? null;
  const exhausted = Boolean(metadata.exhausted);
  const terminal = exhausted && TERMINAL_VERIFICATION_CODES.has(reasonCode);

  if (!exhausted) {
    return {
      tone: 'progress',
      title: 'Confirming with Steam...',
      detail: metadata.attemptCount > 0 ? 'Waiting for Steam confirmation...' : 'Checking with Steam...',
      body: 'The unlock was submitted. We will confirm it safely before any retry.',
      showRecheck: false,
      recheckDisabled: true,
    };
  }

  if (terminal) {
    return {
      tone: 'danger',
      title: 'Steam confirmation needs attention',
      detail: 'Fix the Steam connection or configuration, then check again.',
      body: 'No duplicate unlock was attempted.',
      showRecheck: true,
      recheckDisabled: false,
    };
  }

  return {
    tone: scheduleState === 'paused' ? 'warning' : 'progress',
    title: 'Pending Steam confirmation',
    detail: 'Steam has not confirmed the unlock yet.',
    body: 'No duplicate unlock was attempted.',
    showRecheck: true,
    recheckDisabled: false,
  };
}

export function itemStatusPresentation(status) {
  const statuses = {
    scheduled: { label: 'Scheduled', tone: 'neutral' },
    executing: { label: 'Activating', tone: 'active' },
    'verification-required': { label: 'Confirming with Steam', tone: 'progress' },
    retry: { label: 'Retry scheduled', tone: 'warning' },
    completed: { label: 'Completed', tone: 'success' },
    failed: { label: 'Failed', tone: 'danger' },
  };
  return statuses[status] ?? { label: 'Waiting', tone: 'neutral' };
}
