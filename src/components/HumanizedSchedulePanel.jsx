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

const ORDER_OPTIONS = [
  { value: 'original', label: 'Original', description: 'Steam’s original achievement order' },
  { value: 'easiest-to-hardest', label: 'Ease proxy: common → rare', description: 'Completion-rate proxy; not measured gameplay difficulty' },
  { value: 'most-common-to-rarest', label: 'Most Common → Rarest', description: 'Progress from common to rare achievements' },
  { value: 'rarest-to-most-common', label: 'Rarest → Most Common', description: 'Start with the least commonly completed achievements' },
];

const ITEM_STATUS = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  executing: { label: 'Unlocking', tone: 'active' },
  'verification-required': { label: 'Verifying', tone: 'warning' },
  retry: { label: 'Retry scheduled', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

const SCHEDULE_STATE = {
  running: { label: 'In progress', tone: 'active' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Needs attention', tone: 'danger' },
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

function itemStatusMeta(status) {
  return ITEM_STATUS[status] || { label: 'Waiting', tone: 'neutral' };
}

function scheduleStateMeta(state) {
  return SCHEDULE_STATE[state] || { label: 'Preparing', tone: 'neutral' };
}

export default function HumanizedSchedulePanel({ selectedGame, achievements, selectedIds, orderMode, onOrderModeChange, onScheduleCreated }) {
  const [status, setStatus] = useState({ schedule: null, summary: null });
  const [seed, setSeed] = useState('humanized-schedule');
  const [error, setError] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [showAllItems, setShowAllItems] = useState(false);

  useEffect(() => {
    let active = true;
    const applyStatus = (nextStatus) => {
      if (active && nextStatus) setStatus(nextStatus);
    };

    window.steamAPI?.humanized?.getStatus().then(applyStatus).catch(() => {
      if (active) setError('Humanized Mode is unavailable. Restart the application and try again.');
    });
    const unsubscribe = window.steamAPI?.humanized?.onUpdate(applyStatus);

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const schedule = status.schedule;
  const summary = status.summary;
  const selectedAchievements = useMemo(
    () => achievements.filter((achievement) => selectedIds.has(achievement.id) && !achievement.unlocked),
    [achievements, selectedIds],
  );
  const scheduleMatchesGame = !schedule || String(schedule.appId) === String(selectedGame?.appId);
  const activeItem = schedule?.items?.find((item) => ['executing', 'verification-required'].includes(item.status));
  const verificationItem = schedule?.items?.find((item) => item.status === 'verification-required');
  const nextItem = schedule?.items?.find((item) => ['scheduled', 'retry'].includes(item.status));
  const nextVerificationAt = verificationItem?.verificationMeta?.nextVerificationAt;
  const verificationReason = verificationItem?.verificationMeta?.reasonCode;
  const completedPercent = summary?.total ? Math.round((summary.completed / summary.total) * 100) : 0;
  const runtimeError = status.runtime?.error?.message || '';
  const itemError = schedule?.items?.find((item) => item.lastError)?.lastError || '';
  const scheduleMeta = scheduleStateMeta(schedule?.state);
  const visibleItems = showAllItems ? (schedule?.items || []) : (schedule?.items || []).slice(0, 6);
  const currentOrder = ORDER_OPTIONS.find((option) => option.value === orderMode) || ORDER_OPTIONS[0];
  const verificationDetail = verificationItem
    ? (verificationItem.verificationMeta?.exhausted
      ? `Verification needs attention${verificationReason ? ` (${verificationReason.replaceAll('_', ' ').toLowerCase()})` : ''}.`
      : `Verification attempt ${verificationItem.verificationMeta?.attemptCount ?? 0}; next check ${formatDate(nextVerificationAt)}.`)
    : null;

  async function invoke(action) {
    setIsWorking(true);
    setError('');
    try {
      const nextStatus = await action();
      if (nextStatus) setStatus(nextStatus);
      return nextStatus;
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Humanized Mode could not complete that action.');
      return null;
    } finally {
      setIsWorking(false);
    }
  }

  function handleCreate() {
    if (!selectedGame || selectedAchievements.length === 0) return;
    invoke(async () => {
      const result = await window.steamAPI.humanized.create({
        appId: selectedGame.appId,
        achievements: selectedAchievements,
        orderMode,
        seed: seed.trim() || 'humanized-schedule',
        startAt: Date.now(),
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
            <p className="humanized-eyebrow">Achievement progression</p>
            <h2 id="humanized-title">Humanized Mode</h2>
            <p>Choose a progression order, create a schedule, and let it move forward at a thoughtful pace.</p>
          </div>
        </div>
        {schedule && scheduleMatchesGame && (
          <span className={`humanized-status humanized-status-${scheduleMeta.tone}`}>
            <span className="humanized-status-dot" aria-hidden="true" />
            {scheduleMeta.label}
          </span>
        )}
      </header>

      {!schedule || !scheduleMatchesGame ? (
        <div className="humanized-setup">
          <div className="humanized-setup-copy">
            <div>
              <h3>Choose how to progress</h3>
              <p>The achievement grid updates immediately to reflect your choice.</p>
            </div>
            <span className="humanized-selection-count">{selectedAchievements.length} selected</span>
          </div>

          <div className="humanized-order-grid" role="radiogroup" aria-label="Achievement order">
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
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="humanized-create-row">
            <div className="humanized-create-summary">
              <span className="humanized-summary-icon"><CalendarClock size={16} /></span>
              <span>
                <strong>{currentOrder.label}</strong>
                <small>{selectedAchievements.length ? `${selectedAchievements.length} selected achievement${selectedAchievements.length === 1 ? '' : 's'} will be included.` : 'Select locked achievements from the grid to begin.'}</small>
              </span>
            </div>
            <button className="btn-success humanized-primary-action" onClick={handleCreate} disabled={isWorking || selectedAchievements.length === 0}>
              <CalendarClock size={15} /> Create schedule
            </button>
          </div>

          <details className="humanized-advanced">
            <summary>Advanced schedule options <ChevronDown size={14} /></summary>
            <label htmlFor="humanized-seed">Schedule reference</label>
            <input id="humanized-seed" className="search-input humanized-seed-input" value={seed} onChange={(event) => setSeed(event.target.value)} disabled={isWorking} />
            <p>Use the same reference to recreate the same timing pattern for a new schedule.</p>
          </details>
        </div>
      ) : (
        <div className="humanized-schedule-view">
          <div className="humanized-progress-card">
            <div className="humanized-progress-head">
              <div>
                <p className="humanized-eyebrow">Schedule progress</p>
                <h3>{summary?.completed ?? 0} <span>/ {summary?.total ?? 0}</span></h3>
              </div>
              <span className="humanized-progress-percent">{completedPercent}% complete</span>
            </div>
            <div className="humanized-progress-track" aria-label={`${completedPercent}% complete`}>
              <div className="humanized-progress-fill" style={{ width: `${completedPercent}%` }} />
            </div>
            <div className="humanized-progress-context">
              <div>
                <span>Current</span>
                <strong>{activeItem?.name || activeItem?.id || 'Waiting to begin'}</strong>
              </div>
              <div>
                <span>Next</span>
                <strong>{nextItem?.name || nextItem?.id || 'No upcoming achievement'}</strong>
              </div>
            </div>
          </div>

          <div className="humanized-schedule-toolbar">
            <div>
              <h3>Your schedule</h3>
              <p>{schedule.orderMode === 'original' ? 'Original Steam order' : ORDER_OPTIONS.find((option) => option.value === schedule.orderMode)?.label || 'Custom order'} · {verificationDetail || (summary?.verificationRequired ? `${summary.verificationRequired} awaiting verification` : 'Ready to continue')}</p>
            </div>
            <div className="humanized-actions">
              {verificationItem && (
                <button className="btn-secondary" onClick={() => invoke(() => window.steamAPI.humanized.recheckNow())} disabled={isWorking}><RefreshCw size={14} /> Recheck now</button>
              )}
              {schedule.state === 'running' ? (
                <button className="btn-secondary" onClick={() => invoke(() => window.steamAPI.humanized.pause())} disabled={isWorking}><Pause size={14} /> Pause</button>
              ) : schedule.state !== 'completed' && schedule.state !== 'failed' ? (
                <button className="btn-success" onClick={() => invoke(() => window.steamAPI.humanized.start())} disabled={isWorking}><Play size={14} fill="currentColor" /> {schedule.state === 'paused' ? 'Resume' : 'Start'}</button>
              ) : null}
              <button className="btn-danger humanized-clear-action" onClick={() => invoke(() => window.steamAPI.humanized.clear())} disabled={isWorking}><Trash2 size={14} /> Clear</button>
            </div>
          </div>

          <div className="humanized-timeline" aria-label="Humanized schedule queue">
            {visibleItems.map((item) => {
              const itemMeta = itemStatusMeta(item.status);
              return (
                <article className={`humanized-timeline-item is-${itemMeta.tone}`} key={item.id}>
                  <div className="humanized-timeline-index">{String(item.sequencePosition || 0).padStart(2, '0')}</div>
                  <div className="humanized-timeline-content">
                    <div className="humanized-timeline-title-row">
                      <h4>{item.name || item.id}</h4>
                      <time dateTime={Number.isFinite(item.verificationMeta?.nextVerificationAt || item.nextAttemptAt || item.scheduledAt) ? new Date(item.verificationMeta?.nextVerificationAt || item.nextAttemptAt || item.scheduledAt).toISOString() : undefined}>
                        <Clock3 size={13} /> {item.status === 'verification-required' ? `Recheck ${formatDate(item.verificationMeta?.nextVerificationAt)}` : formatDate(item.nextAttemptAt || item.scheduledAt)}
                      </time>
                    </div>
                    <div className="humanized-timeline-meta">
                      <span>{formatRarity(item.globalPercent)}</span>
                      <span className={`humanized-item-status is-${itemMeta.tone}`}>{itemMeta.label}</span>
                      {item.attempts > 0 && <span>{item.attempts} attempt{item.attempts === 1 ? '' : 's'}</span>}
                    </div>
                    {item.lastError && <p className="humanized-item-error">{item.lastError}</p>}
                  </div>
                </article>
              );
            })}
          </div>

          {(schedule.items?.length || 0) > 6 && (
            <button className="humanized-show-more" type="button" onClick={() => setShowAllItems((value) => !value)}>
              {showAllItems ? 'Show less' : `View all ${schedule.items.length} achievements`}
            </button>
          )}
        </div>
      )}

      {schedule && !scheduleMatchesGame && (
        <div className="humanized-message humanized-message-warning" role="alert">
          <CircleAlert size={17} />
          <span><strong>A different game has an active schedule.</strong> Discard it before creating one here.</span>
          <button className="btn-danger" onClick={() => invoke(() => window.steamAPI.humanized.clear())} disabled={isWorking}>Discard schedule</button>
        </div>
      )}
      {schedule?.state === 'completed' && (
        <div className="humanized-message humanized-message-success" role="status">
          <CheckCircle2 size={17} /> <span><strong>Schedule complete.</strong> Every planned achievement has been verified.</span>
        </div>
      )}
      {schedule?.state === 'failed' && (
        <div className="humanized-message humanized-message-danger" role="alert">
          <AlertTriangle size={17} /> <span><strong>Schedule needs attention.</strong> Review the failed item, then clear and create a new schedule when ready.</span>
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
