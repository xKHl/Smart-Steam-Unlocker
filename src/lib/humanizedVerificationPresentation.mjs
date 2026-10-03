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
      title: 'Unlock submitted',
      titleKey: 'scheduler.unlockSubmitted',
      detailKey: 'scheduler.verifySubmittedDetail',
      bodyKey: 'scheduler.verifySubmittedBody',
      detail: 'Confirming with Steam in background…',
      body: 'Steam confirmation continues automatically in the background. You can keep using the app; no action is needed.',
      showRecheck: false,
      recheckDisabled: true,
    };
  }

  if (terminal) {
    return {
      tone: 'danger',
      title: 'Steam confirmation needs attention',
      titleKey: 'scheduler.verifyAttentionTitle',
      detailKey: 'scheduler.verifyAttentionDetail',
      bodyKey: 'scheduler.verifyNoDuplicate',
      detail: 'Fix the Steam connection or configuration, then check again.',
      body: 'No duplicate unlock was attempted.',
      showRecheck: true,
      recheckDisabled: false,
    };
  }

  return {
    tone: scheduleState === 'paused' ? 'warning' : 'progress',
    title: 'Pending Steam confirmation',
    titleKey: 'scheduler.verifyPendingTitle',
    detailKey: 'scheduler.verifyPendingDetail',
    bodyKey: 'scheduler.verifyNoDuplicate',
    detail: 'Steam has not confirmed the unlock yet.',
    body: 'No duplicate unlock was attempted.',
    showRecheck: true,
    recheckDisabled: false,
  };
}

/** Resolves catalog keys so the renderer never shows the English fallbacks. */
export function localizeVerificationPresentation(view, t) {
  if (!view) return view;
  return {
    ...view,
    title: view.titleKey ? t(view.titleKey) : view.title,
    detail: view.detailKey ? t(view.detailKey) : view.detail,
    body: view.bodyKey ? t(view.bodyKey) : view.body,
  };
}

export function itemStatusPresentation(status) {
  const statuses = {
    scheduled: { label: 'Scheduled', tone: 'neutral' },
    executing: { label: 'Activating', tone: 'active' },
    'verification-required': { label: 'Confirming in background', tone: 'progress' },
    retry: { label: 'Retry scheduled', tone: 'warning' },
    completed: { label: 'Completed', tone: 'success' },
    failed: { label: 'Failed', tone: 'danger' },
  };
  return statuses[status] ?? { label: 'Waiting', tone: 'neutral' };
}
