import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { itemStatusPresentation, verificationPresentation } from '../lib/humanizedVerificationPresentation.mjs';
import { shouldRefreshHumanizedCountdown } from '../lib/humanizedCountdownRefresh.mjs';
import { projectExecutionAchievements } from '../lib/executionAchievementPayload.mjs';
import { useI18n } from '../i18n';
import {
  DEFAULT_TIMING_PRESET,
  HUMANIZED_TIMING_PRESETS,
  timingOptionsFromMinutes,
  timingPresetById,
} from '../lib/humanizedTimingPresets.mjs';

const ORDER_OPTIONS = [
  { value: 'original', labelKey: 'mode.original', descriptionKey: 'scheduler.orderOriginalDescription' },
  { value: 'natural-story-progression', labelKey: 'mode.naturalStory', descriptionKey: 'scheduler.orderNaturalDescription' },
  { value: 'most-common-to-rarest', labelKey: 'mode.commonToRare', descriptionKey: 'scheduler.orderCommonDescription' },
  { value: 'rarest-to-most-common', labelKey: 'mode.rareToCommon', descriptionKey: 'scheduler.orderRareDescription' },
];

const ITEM_STATUS = {
  scheduled: { labelKey: 'common.scheduled', tone: 'neutral' },
  executing: { labelKey: 'achievements.unlocking', tone: 'active' },
  'verification-required': { labelKey: 'scheduler.backgroundVerification', tone: 'warning' },
  retry: { labelKey: 'scheduler.retryScheduled', tone: 'warning' },
  completed: { labelKey: 'common.completed', tone: 'success' },
  failed: { labelKey: 'common.failed', tone: 'danger' },
};

const SCHEDULE_STATE = {
  running: { labelKey: 'scheduler.inProgress', tone: 'active' },
  paused: { labelKey: 'common.pause', tone: 'warning' },
  completed: { labelKey: 'common.completed', tone: 'success' },
  failed: { labelKey: 'scheduler.scheduleNeedsAttention', tone: 'danger' },
};

function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return 'Time pending';
  return new Date(timestamp).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatRarity(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)}% common` : 'Rarity unavailable';
}

function localizedDuration(milliseconds, t) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? t('scheduler.durationHoursMinutes', { hours, minutes: String(minutes).padStart(2, '0') })
    : t('scheduler.durationMinutesSeconds', { minutes, seconds: String(seconds).padStart(2, '0') });
}

function localizedRemaining(timestamp, now, t) {
  if (!Number.isFinite(timestamp)) return t('scheduler.timePending');
  return timestamp <= now ? t('scheduler.dueNow') : t('scheduler.inDuration', { time: localizedDuration(timestamp - now, t) });
}

function timingPresetCopy(preset, t) {
  const key = preset.id[0].toUpperCase() + preset.id.slice(1);
  return { label: t(`scheduler.preset${key}`), description: t(`scheduler.preset${key}Description`) };
}

function itemStatusMeta(status) {
  return ITEM_STATUS[status] || itemStatusPresentation(status) || { labelKey: 'scheduler.waiting', tone: 'neutral' };
}

function scheduleStateMeta(state) {
  return SCHEDULE_STATE[state] || { labelKey: 'scheduler.preparing', tone: 'neutral' };
}

export default function HumanizedSchedulePanel({ selectedGame, achievements, canonicalAchievements = achievements, selectedIds, orderMode, onOrderModeChange, onScheduleCreated }) {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState({ schedule: null, summary: null });
  const [seed, setSeed] = useState('humanized-schedule');
  const [timingPreset, setTimingPreset] = useState(DEFAULT_TIMING_PRESET);
  const [timing, setTiming] = useState(() => ({ ...timingPresetById(DEFAULT_TIMING_PRESET) }));
  const [error, setError] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [showAllItems, setShowAllItems] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const applyStatus = (nextStatus) => {
      if (active && nextStatus) setStatus(nextStatus);
    };

    window.steamAPI?.humanized?.getStatus().then(applyStatus).catch(() => {
      if (active) setError(t('scheduler.unavailable'));
    });
    const unsubscribe = window.steamAPI?.humanized?.onUpdate(applyStatus);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const schedule = status.schedule;
  const summary = status.summary;
  // The parent supplies the same main-process canonical ordering projection used
  // by the visible grid. Scheduler ordering remains authoritative in main, while
  // this preserves order parity through selected-ID projection and IPC input.
  const selectedAchievements = useMemo(
    () => canonicalAchievements.filter((achievement) => selectedIds.has(achievement.id) && !achievement.unlocked),
    [canonicalAchievements, selectedIds],
  );
  const scheduleMatchesGame = !schedule || String(schedule.appId) === String(selectedGame?.appId);
  const executingItem = schedule?.items?.find((item) => item.status === 'executing');
  const verificationItem = schedule?.items?.find((item) => item.status === 'verification-required');
  const activeItem = executingItem || verificationItem;
  const nextItem = schedule?.items?.find((item) => ['scheduled', 'retry'].includes(item.status));
  const nextVerificationAt = verificationItem?.verificationMeta?.nextVerificationAt;
  const verificationReason = verificationItem?.verificationMeta?.reasonCode;
  const verificationView = verificationPresentation(verificationItem, schedule?.state);
  const completedPercent = summary?.total ? Math.round((summary.completed / summary.total) * 100) : 0;
  const runtimeError = status.runtime?.error?.message || '';
  const itemError = schedule?.items?.find((item) => item.lastError && item.status !== 'verification-required')?.lastError || '';
  const scheduleMeta = scheduleStateMeta(schedule?.state);
  const visibleItems = showAllItems ? (schedule?.items || []) : (schedule?.items || []).slice(0, 6);
  const currentOrder = ORDER_OPTIONS.find((option) => option.value === orderMode) || ORDER_OPTIONS[0];
  const verificationDetail = verificationView?.detail || (verificationItem
    ? `${t('scheduler.checkingShortly')}${verificationReason ? ` (${verificationReason.replaceAll('_', ' ').toLowerCase()})` : ''}`
    : null);
  const scheduleTiming = schedule?.timing;
  const currentActivity = executingItem
    ? t('scheduler.activating')
    : verificationView?.title || (nextItem ? t('scheduler.waiting') : t('scheduler.preparing'));
  const nextUnlockAt = nextItem?.nextAttemptAt || nextItem?.scheduledAt;
  const refreshCountdown = shouldRefreshHumanizedCountdown({
    scheduleState: schedule?.state,
    nextUnlockAt,
    nextVerificationAt,
    verificationExhausted: verificationItem?.verificationMeta?.exhausted,
  });

  useEffect(() => {
    if (!refreshCountdown) return undefined;
    const refresh = () => setClockNow(Date.now());
    refresh();
    const interval = setInterval(refresh, 1_000);
    return () => clearInterval(interval);
  }, [refreshCountdown, nextUnlockAt, nextVerificationAt, verificationItem?.verificationMeta?.exhausted]);

  async function invoke(action) {
    setIsWorking(true);
    setError('');
    try {
      const nextStatus = await action();
      if (nextStatus) setStatus(nextStatus);
      return nextStatus;
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : t('scheduler.actionFailed'));
      return null;
    } finally {
      setIsWorking(false);
    }
  }

  function applyTimingPreset(presetId) {
    setTimingPreset(presetId);
    if (presetId !== 'custom') setTiming({ ...timingPresetById(presetId) });
  }

  function updateTiming(field, value) {
    setTimingPreset('custom');
    setTiming((current) => ({ ...current, [field]: Number(value) }));
  }

  function handleCreate() {
    if (!selectedGame || selectedAchievements.length === 0) return;
    invoke(async () => {
      const result = await window.steamAPI.humanized.create({
        appId: selectedGame.appId,
        // The renderer keeps read-only display evidence (such as unlockTime)
        // alongside achievements. Scheduler IPC receives canonical fields only.
        achievements: projectExecutionAchievements(selectedAchievements),
        orderMode,
        seed: seed.trim() || 'humanized-schedule',
        startAt: Date.now(),
        timingPreset,
        timelineOptions: timingOptionsFromMinutes(timing),
      });
      onScheduleCreated?.();
      return result;
    });
  }

  return (
    <section className="humanized-panel" aria-labelledby="humanized-title">
      <header className="humanized-panel-header">
        <div className="humanized-title-wrap">
          <div className="humanized-icon" aria-hidden="true"><Sparkles size={18} /></div>
          <div>
            <p className="humanized-eyebrow">{t('achievements.progressionMode')}</p>
            <h2 id="humanized-title">{t('scheduler.title')}</h2>
            <p>{t('scheduler.intro')}</p>
          </div>
        </div>
        {schedule && scheduleMatchesGame && (
          <span className={`humanized-status humanized-status-${scheduleMeta.tone}`}>
            <span className="humanized-status-dot" aria-hidden="true" />
            {t(scheduleMeta.labelKey || scheduleMeta.label)}
          </span>
        )}
      </header>

      {!schedule || !scheduleMatchesGame ? (
        <div className="humanized-setup">
          <div className="humanized-setup-copy">
            <div>
              <h3>{t('scheduler.chooseProgress')}</h3>
              <p>{t('scheduler.gridUpdates')}</p>
            </div>
            <span className="humanized-selection-count">{t('scheduler.selected', { count: selectedAchievements.length })}</span>
          </div>

          <div className="humanized-order-grid" role="radiogroup" aria-label={t('scheduler.chooseProgress')}>
            {ORDER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`humanized-order-option${orderMode === option.value ? ' is-selected' : ''}`}
                onClick={() => onOrderModeChange(option.value)}
                aria-pressed={orderMode === option.value}
                disabled={isWorking}
              >
                <span className="humanized-order-radio" aria-hidden="true" />
                <span>
                  <strong>{t(option.labelKey)}</strong>
                  <small>{t(option.descriptionKey)}</small>
                </span>
              </button>
            ))}
          </div>

          <section className="humanized-timing-setup" aria-labelledby="humanized-timing-title">
            <div className="humanized-setup-copy">
              <div>
                <h3 id="humanized-timing-title">{t('scheduler.pace')}</h3>
                <p>{t('scheduler.timingSaved')}</p>
              </div>
            </div>
            <div className="humanized-timing-presets" role="radiogroup" aria-label={t('scheduler.timingPreset')}>
              {HUMANIZED_TIMING_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`humanized-timing-preset${timingPreset === preset.id ? ' is-selected' : ''}`}
                  onClick={() => applyTimingPreset(preset.id)}
                  aria-pressed={timingPreset === preset.id}
                  disabled={isWorking}
                >
                  <strong>{timingPresetCopy(preset, t).label}</strong>
                  <small>{timingPresetCopy(preset, t).description}</small>
                  <span>{t('scheduler.initialDelaySummary', { time: localizedDuration(preset.initialDelayMinutes * 60_000, t) })} · {localizedDuration(preset.baseIntervalMinutes * 60_000, t)} ± {localizedDuration(preset.varianceMinutes * 60_000, t)}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="humanized-create-row">
            <div className="humanized-create-summary">
              <span className="humanized-summary-icon"><CalendarClock size={16} /></span>
              <span>
                <strong>{t(currentOrder.labelKey)}</strong>
                <small>{selectedAchievements.length ? t('scheduler.selectedSummary', { count: selectedAchievements.length }) : t('scheduler.selectLocked')}</small>
              </span>
            </div>
            <button className="btn-success humanized-primary-action" onClick={handleCreate} disabled={isWorking || selectedAchievements.length === 0}>
              <CalendarClock size={15} /> {t('scheduler.create')}
            </button>
          </div>

          <details className="humanized-advanced">
            <summary>{t('scheduler.advanced')} <ChevronDown size={14} className="directional-chevron" /></summary>
            <div className="humanized-timing-input-grid">
              <label htmlFor="humanized-initial-delay">{t('scheduler.initialDelay')}
                <input id="humanized-initial-delay" type="number" min="0" max="720" step="1" value={timing.initialDelayMinutes} onChange={(event) => updateTiming('initialDelayMinutes', event.target.value)} disabled={isWorking} />
              </label>
              <label htmlFor="humanized-base-interval">{t('scheduler.baseInterval')}
                <input id="humanized-base-interval" type="number" min="1" max="720" step="1" value={timing.baseIntervalMinutes} onChange={(event) => updateTiming('baseIntervalMinutes', event.target.value)} disabled={isWorking} />
              </label>
              <label htmlFor="humanized-variance">{t('scheduler.randomVariance')}
                <input id="humanized-variance" type="number" min="0" max="720" step="1" value={timing.varianceMinutes} onChange={(event) => updateTiming('varianceMinutes', event.target.value)} disabled={isWorking} />
              </label>
              <label htmlFor="humanized-min-interval">{t('scheduler.safeMinimum')}
                <input id="humanized-min-interval" type="number" min="1" max="720" step="1" value={timing.minIntervalMinutes} onChange={(event) => updateTiming('minIntervalMinutes', event.target.value)} disabled={isWorking} />
              </label>
              <label htmlFor="humanized-max-interval">{t('scheduler.safeMaximum')}
                <input id="humanized-max-interval" type="number" min="1" max="720" step="1" value={timing.maxIntervalMinutes} onChange={(event) => updateTiming('maxIntervalMinutes', event.target.value)} disabled={isWorking} />
              </label>
            </div>
            <label htmlFor="humanized-seed">{t('scheduler.scheduleReference')}</label>
            <input id="humanized-seed" className="search-input humanized-seed-input" value={seed} onChange={(event) => setSeed(event.target.value)} disabled={isWorking} />
            <p>{t('scheduler.referenceHelp')}</p>
          </details>
        </div>
      ) : (
        <div className="humanized-schedule-view">
          <div className="humanized-progress-card">
            <div className="humanized-progress-head">
              <div>
                <p className="humanized-eyebrow">{t('scheduler.progress')}</p>
                <h3>{summary?.completed ?? 0} <span>/ {summary?.total ?? 0}</span></h3>
              </div>
              <span className="humanized-progress-percent">{t('scheduler.completePercent', { percent: completedPercent })}</span>
            </div>
            <div className="humanized-progress-track" aria-label={t('scheduler.completePercent', { percent: completedPercent })}>
              <div className="humanized-progress-fill" style={{ width: `${completedPercent}%` }} />
            </div>
            <div className="humanized-progress-context">
              <div>
                <span>{t('scheduler.current')}</span>
                <strong>{activeItem?.name || activeItem?.id || currentActivity}</strong>
              </div>
              <div>
                <span>{t('scheduler.next')}</span>
                <strong>{nextItem?.name || nextItem?.id || t('scheduler.noUpcoming')}</strong>
              </div>
            </div>
            <div className="humanized-live-progress" aria-live="polite">
              <span>{currentActivity}</span>
              <strong>{nextItem ? t('scheduler.nextUnlock', { time: localizedRemaining(nextUnlockAt, clockNow, t) }) : (verificationItem ? verificationDetail : t('scheduler.noUpcoming'))}</strong>
            </div>
            {scheduleTiming && (
              <p className="humanized-timing-summary">
                {scheduleTiming.preset ? `${timingPresetCopy({ id: scheduleTiming.preset }, t).label} ${t('scheduler.pace')}` : t('scheduler.customPace')} · {t('scheduler.initialDelaySummary', { time: localizedDuration(scheduleTiming.initialDelayMs, t) })} · {localizedDuration(scheduleTiming.baseIntervalMs, t)} ± {localizedDuration(scheduleTiming.varianceMs, t)}
              </p>
            )}
          </div>

          <div className="humanized-schedule-toolbar">
            <div>
              <h3>{t('scheduler.yourSchedule')}</h3>
              <p>{schedule.orderMode === 'original' ? t('mode.original') : t(ORDER_OPTIONS.find((option) => option.value === schedule.orderMode)?.labelKey || 'mode.original')} · {verificationDetail || (summary?.verificationRequired ? t('scheduler.awaitingVerification', { count: summary.verificationRequired }) : t('scheduler.readyToContinue'))}</p>
            </div>
            <div className="humanized-actions">
              {verificationView?.showRecheck && (
                <button
                  className="btn-secondary humanized-recheck-action"
                  onClick={() => invoke(() => window.steamAPI.humanized.recheckNow())}
                  disabled={isWorking || verificationView?.recheckDisabled}
                  title={verificationView?.recheckDisabled ? t('scheduler.recheckAuto') : t('scheduler.recheckSafe')}
                >
                  <RefreshCw size={14} className={isWorking ? 'is-spinning' : ''} />
                  {isWorking ? t('scheduler.recheckBusy') : t('scheduler.recheckNow')}
                </button>
              )}
              {schedule.state === 'running' ? (
                <button className="btn-secondary" onClick={() => invoke(() => window.steamAPI.humanized.pause())} disabled={isWorking}><Pause size={14} /> {t('common.pause')}</button>
              ) : schedule.state !== 'completed' && schedule.state !== 'failed' ? (
                <button className="btn-success" onClick={() => invoke(() => window.steamAPI.humanized.start())} disabled={isWorking}><Play size={14} fill="currentColor" /> {schedule.state === 'paused' ? t('common.resume') : t('common.start')}</button>
              ) : null}
              <button className="btn-danger humanized-clear-action" onClick={() => invoke(() => window.steamAPI.humanized.clear())} disabled={isWorking}><Trash2 size={14} /> {t('common.clear')}</button>
            </div>
          </div>

          {verificationView && (
            <div className={`humanized-message humanized-message-${verificationView.tone}`} role={verificationView.tone === 'danger' ? 'alert' : 'status'}>
              <RefreshCw size={17} className={verificationView.tone === 'progress' ? 'is-spinning' : ''} />
              <span><strong>{verificationView.title}</strong> {verificationView.body}</span>
            </div>
          )}

          <div className="humanized-timeline" aria-label={t('scheduler.queue')}>
            {visibleItems.map((item) => {
              const itemMeta = itemStatusMeta(item.status);
              return (
                <article className={`humanized-timeline-item is-${itemMeta.tone}`} key={item.id}>
                  <div className="humanized-timeline-index">{String(item.sequencePosition || 0).padStart(2, '0')}</div>
                  <div className="humanized-timeline-content">
                    <div className="humanized-timeline-title-row">
                      <h4>{item.name || item.id}</h4>
                      <time dateTime={Number.isFinite(item.verificationMeta?.nextVerificationAt || item.nextAttemptAt || item.scheduledAt) ? new Date(item.verificationMeta?.nextVerificationAt || item.nextAttemptAt || item.scheduledAt).toISOString() : undefined}>
                        <Clock3 size={13} /> {item.status === 'verification-required' ? (item.verificationMeta?.exhausted ? t('scheduler.pendingConfirmation') : t('scheduler.confirmingBackground', { time: localizedRemaining(item.verificationMeta?.nextVerificationAt, clockNow, t) })) : t('scheduler.scheduledAt', { time: localizedRemaining(item.nextAttemptAt || item.scheduledAt, clockNow, t) })}
                      </time>
                    </div>
                    <div className="humanized-timeline-meta">
                      <span>{Number.isFinite(Number(item.globalPercent)) ? t('scheduler.rarity', { value: Math.round(Number(item.globalPercent)) }) : t('scheduler.rarityUnavailable')}</span>
                      <span className={`humanized-item-status is-${itemMeta.tone}`}>{t(itemMeta.labelKey || itemMeta.label)}</span>
                      {item.attempts > 0 && <span>{t('scheduler.attempts', { count: item.attempts })}</span>}
                    </div>
                                          {item.lastError && item.status !== 'verification-required' && <p className="humanized-item-error">{item.lastError}</p>}

                  </div>
                </article>
              );
            })}
          </div>

          {(schedule.items?.length || 0) > 6 && (
            <button className="humanized-show-more" type="button" onClick={() => setShowAllItems((value) => !value)}>
              {showAllItems ? t('scheduler.showLess') : t('scheduler.viewAll', { count: schedule.items.length })}
            </button>
          )}
        </div>
      )}

      {schedule && !scheduleMatchesGame && (
        <div className="humanized-message humanized-message-warning" role="alert">
          <CircleAlert size={17} />
          <span><strong>{t('scheduler.otherGameActive')}</strong> {t('scheduler.discardHere')}</span>
          <button className="btn-danger" onClick={() => invoke(() => window.steamAPI.humanized.clear())} disabled={isWorking}>{t('scheduler.discardSchedule')}</button>
        </div>
      )}
      {schedule?.state === 'completed' && (
        <div className="humanized-message humanized-message-success" role="status">
          <CheckCircle2 size={17} /> <span><strong>{t('scheduler.scheduleComplete')}</strong> {t('scheduler.scheduleCompleteDetail')}</span>
        </div>
      )}
      {schedule?.state === 'failed' && (
        <div className="humanized-message humanized-message-danger" role="alert">
          <AlertTriangle size={17} /> <span><strong>{t('scheduler.scheduleNeedsAttention')}</strong> {t('scheduler.scheduleNeedsAttentionDetail')}</span>
        </div>
      )}
      {(runtimeError || error || itemError) && (
        <div className="humanized-message humanized-message-danger" role="alert">
          <CircleAlert size={17} /> <span>{runtimeError || error || itemError}</span>
        </div>
      )}
    </section>
  );
}
