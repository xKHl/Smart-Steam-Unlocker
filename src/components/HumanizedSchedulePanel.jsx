import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleAlert, CircleCheck, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';

const ORDER_OPTIONS = [
  { value: 'original', label: 'Original Steam order' },
  { value: 'easiest-to-hardest', label: 'Easiest → Hardest' },
  { value: 'most-common-to-rarest', label: 'Most Common → Rarest' },
  { value: 'rarest-to-most-common', label: 'Rarest → Most Common' },
];

function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return 'Not scheduled';
  return new Date(timestamp).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusLabel(status) {
  return String(status || 'pending').replace(/-/g, ' ');
}

export default function HumanizedSchedulePanel({ selectedGame, achievements, selectedIds, orderMode, onOrderModeChange, onScheduleCreated }) {
  const [status, setStatus] = useState({ schedule: null, summary: null, adapter: 'steam' });
  const [seed, setSeed] = useState('humanized-schedule');
  const [error, setError] = useState('');
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    let active = true;
    const applyStatus = (nextStatus) => {
      if (active && nextStatus) setStatus(nextStatus);
    };

    window.steamAPI?.humanized?.getStatus().then(applyStatus).catch(() => {
      if (active) setError('The Humanized scheduler is not available. Restart the application and try again.');
    });
    window.steamAPI?.humanized?.onUpdate(applyStatus);

    return () => { active = false; };
  }, []);

  const schedule = status.schedule;
  const summary = status.summary;
  const selectedAchievements = useMemo(
    () => achievements.filter((achievement) => selectedIds.has(achievement.id) && !achievement.unlocked),
    [achievements, selectedIds],
  );
  const scheduleMatchesGame = !schedule || String(schedule.appId) === String(selectedGame?.appId);
  const nextItem = schedule?.items?.find((item) => ['scheduled', 'retry', 'executing', 'verification-required'].includes(item.status));
  const completedPercent = summary?.total ? Math.round((summary.completed / summary.total) * 100) : 0;
  const runtimeError = status.runtime?.error?.message || '';
  const itemError = schedule?.items?.find((item) => item.lastError)?.lastError || '';

  async function invoke(action) {
    setIsWorking(true);
    setError('');
    try {
      const nextStatus = await action();
      if (nextStatus) setStatus(nextStatus);
      return nextStatus;
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'The scheduler could not complete that action.');
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
    <div className="timer-panel" aria-label="Humanized scheduler">
      <div className="timer-panel-header">
        <div>
          <h2 className="timer-panel-title">
            <CalendarClock size={18} color="#a78bfa" />
            Humanized Schedule
          </h2>
          <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
            Deterministic, App-ID-bound schedule with Steam execution and independent verification. The selected Steam App ID must match the persisted schedule before execution.
          </p>
        </div>
        <span className="badge badge-purple" style={{ padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {status.adapter || 'mock'} adapter
        </span>
      </div>

      {!schedule || !scheduleMatchesGame ? (
        <div className="timer-controls" style={{ marginTop: 14 }}>
          <div className="timer-control-group">
            <label className="timer-slider-label" htmlFor="humanized-order">
              <span>Deterministic order</span>
            </label>
            <select id="humanized-order" className="search-input" value={orderMode} onChange={(event) => onOrderModeChange(event.target.value)} disabled={isWorking}>
              {ORDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="timer-control-group">
            <label className="timer-slider-label" htmlFor="humanized-seed"><span>Schedule seed</span></label>
            <input id="humanized-seed" className="search-input" value={seed} onChange={(event) => setSeed(event.target.value)} disabled={isWorking} />
          </div>
          <div className="timer-control-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn-success" onClick={handleCreate} disabled={isWorking || selectedAchievements.length === 0}>
              <CalendarClock size={14} /> Generate Schedule ({selectedAchievements.length})
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 16, fontSize: 13 }}>
            <div>
              <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{schedule.state}</strong>
              <span style={{ color: 'var(--text-muted)' }}> · {summary?.completed ?? 0} of {summary?.total ?? 0} verified{summary?.verificationRequired ? ` · ${summary.verificationRequired} need verification` : ''}</span>
            </div>
            <div className="timer-actions">
              {schedule.state === 'running' ? (
                <button className="btn-danger" onClick={() => invoke(() => window.steamAPI.humanized.pause())} disabled={isWorking}><Pause size={14} /> Pause</button>
              ) : schedule.state !== 'completed' && schedule.state !== 'failed' ? (
                <button className="btn-success" onClick={() => invoke(() => window.steamAPI.humanized.start())} disabled={isWorking}><Play size={14} fill="currentColor" /> Resume</button>
              ) : null}
              <button className="btn-danger" onClick={() => invoke(() => window.steamAPI.humanized.clear())} disabled={isWorking}><Trash2 size={14} /> Clear</button>
            </div>
          </div>

          <div className="timer-progress-wrap" style={{ marginTop: 12 }}>
            <div className="timer-progress-bar" style={{ width: `${completedPercent}%` }} />
          </div>

          {nextItem && (
            <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-hover)', borderRadius: 8, fontSize: 12 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Next: {nextItem.name || nextItem.id}</strong>
              <span style={{ color: 'var(--text-muted)' }}> · {statusLabel(nextItem.status)} · {formatDate(nextItem.nextAttemptAt || nextItem.scheduledAt)}</span>
            </div>
          )}

          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            {schedule.items.slice(0, 5).map((item) => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--text-secondary)', fontSize: 12 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{item.sequencePosition} {item.name || item.id}</span>
                <span style={{ color: item.status === 'failed' ? '#fca5a5' : item.status === 'completed' ? '#86efac' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{statusLabel(item.status)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {schedule && !scheduleMatchesGame && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, color: '#fbbf24', fontSize: 12 }}>
          <CircleAlert size={15} />
          <span>A schedule exists for another game. Discard it explicitly before creating one for this game.</span>
          <button className="btn-danger" style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: 11 }} onClick={() => invoke(() => window.steamAPI.humanized.clear())} disabled={isWorking}>
            Discard Existing Schedule
          </button>
        </div>
      )}
      {schedule?.state === 'completed' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, color: '#86efac', fontSize: 12 }}>
          <CircleCheck size={15} /> The schedule completed with Steam-verified outcomes.
        </div>
      )}
      {schedule?.state === 'failed' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, color: '#fca5a5', fontSize: 12 }}>
          <RotateCcw size={15} /> One or more Steam operations failed after their configured retry limit. Clear and regenerate to retry.
        </div>
      )}
      {(runtimeError || error || itemError) && <p style={{ color: '#fca5a5', fontSize: 12, margin: '12px 0 0' }}>{runtimeError || error || itemError}</p>}
    </div>
  );
}
