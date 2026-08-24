import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, ChevronRight, RotateCcw, Clock, Play, Square, Settings2, Trash2, Trophy, Loader2 } from 'lucide-react';
import AchievementCard from '../components/AchievementCard';
import HumanizedSchedulePanel from '../components/HumanizedSchedulePanel';
import { achievementOrderRevision, projectAchievementDisplay } from '../lib/achievementDisplayProjection.mjs';
import {
  addVisibleLockedSelection,
  areAllVisibleLockedSelected,
  removeVisibleLockedSelection,
  visibleLockedAchievementIds,
} from '../lib/achievementBulkSelection.mjs';
import { projectExecutionAchievements } from '../lib/executionAchievementPayload.mjs';
import { useI18n } from '../i18n';

const FILTERS = [
  { value: 'All', key: 'achievements.filters.all' },
  { value: 'Locked', key: 'achievements.filters.locked' },
  { value: 'Unlocked', key: 'achievements.filters.unlocked' },
];

const HUMANIZED_ORDER_LABELS = {
  original: 'mode.original',
  'natural-story-progression': 'mode.naturalStory',
  'most-common-to-rarest': 'mode.commonToRare',
  'rarest-to-most-common': 'mode.rareToCommon',
};

function formatTime(seconds) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Achievements — Achievement browser page with Smart Delay Timer
 */
export default function Achievements({ selectedGame, onChangeGame }) {
  const { t } = useI18n();
  // ── UI State ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  
  // ── Data State ──────────────────────────────────────────────────────────
  const [achievements, setAchievements] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  
  // ── Timer State ─────────────────────────────────────────────────────────
  const [timerStatus, setTimerStatus] = useState({
    isActive: false, queue: [], currentCountdown: 0,
    baseMultiplier: 1, varianceMins: 15, totalInQueue: 0, unlockedCount: 0, lastOutcome: null,
  });
  const [instantError, setInstantError] = useState('');
  
  const [baseMultiplier, setBaseMultiplier] = useState(1);
  const [varianceMins, setVarianceMins] = useState(15);
  const [useFixedTime, setUseFixedTime] = useState(false);
  const [fixedMins, setFixedMins] = useState(1);
  const [unlockMode, setUnlockMode] = useState('instant');
  const [humanizedOrderMode, setHumanizedOrderMode] = useState('natural-story-progression');
  const [humanizedOrderCache, setHumanizedOrderCache] = useState({ revision: '', byMode: {}, metadataByMode: {} });
  const [humanizedOrderError, setHumanizedOrderError] = useState('');
  const [relockDialogAchievement, setRelockDialogAchievement] = useState(null);
  const [relockStates, setRelockStates] = useState({});
  const [relockMessage, setRelockMessage] = useState(null);

  // ── Initialization ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedGame) return undefined;
    let active = true;
    const appId = selectedGame.appId;

    // Each selected-game revision owns its responses. A slower request for the
    // previous game is ignored instead of overwriting the current achievement grid.
    const fetchAchievements = async () => {
      if (!window.steamAPI) return;
      if (active) {
        setIsLoading(true);
        setLoadError('');
      }
      try {
        const [achRes, pctRes] = await Promise.all([
          window.steamAPI.steam.getAchievements(appId),
          window.steamAPI.steam.getGlobalAchievementPercentages(appId),
        ]);
        if (!active) return;

        if (achRes?.success) {
          const pctMap = Object.fromEntries((pctRes?.success && Array.isArray(pctRes.percentages) ? pctRes.percentages : [])
            .map((percentage) => [percentage.name, percentage.percent]));
          const merged = achRes.achievements
            .map((achievement) => (pctMap[achievement.id] !== undefined ? { ...achievement, globalPercent: pctMap[achievement.id] } : achievement))
            .sort((left, right) => (left.originalIndex ?? 0) - (right.originalIndex ?? 0));
          setAchievements(merged);
        } else {
          setAchievements([]);
          setLoadError(achRes?.error || 'Steam could not return achievement data for this game.');
        }
      } catch {
        if (active) {
          setAchievements([]);
          setLoadError('Could not load achievements. Check the Steam connection and try again.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    fetchAchievements();
    window.steamAPI?.timer.getStatus().then((timer) => {
      if (!active || !timer) return;
      setTimerStatus(timer);
      if (timer.baseMultiplier > 0) setBaseMultiplier(timer.baseMultiplier);
      if (timer.varianceMins > 0) setVarianceMins(timer.varianceMins);
      if (timer.fixedMins !== null && timer.fixedMins !== undefined) {
        setUseFixedTime(true);
        setFixedMins(timer.fixedMins);
      }
    }).catch(() => {});

    const stopTimerSubscription = window.steamAPI?.timer.onUpdate((timer) => {
      if (!active) return;
      setTimerStatus(timer);
      if (!timer.isActive && timer.queue.length === 0 && timer.unlockedCount > 0) fetchAchievements();
    });
    const stopUnlockSubscription = window.steamAPI?.steam.onAchievementUnlocked((achievementId) => {
      if (!active) return;
      setAchievements((previous) => previous.map((achievement) => (
        achievement.id === achievementId ? { ...achievement, unlocked: true, iconUrl: achievement.iconColorUrl || achievement.iconUrl } : achievement
      )));
      setSelectedIds((previous) => {
        const next = new Set(previous);
        next.delete(achievementId);
        return next;
      });
    });
    const stopRelockSubscription = window.steamAPI?.steam.onAchievementRelocked((achievementId) => {
      if (!active) return;
      setAchievements((previous) => previous.map((achievement) => (
        achievement.id === achievementId ? { ...achievement, unlocked: false, unlockTime: null, iconUrl: achievement.iconGrayUrl || achievement.iconUrl } : achievement
      )));
      setRelockStates((previous) => ({ ...previous, [achievementId]: 'verified' }));
    });

    setSelectedIds(new Set());
    return () => {
      active = false;
      stopTimerSubscription?.();
      stopUnlockSubscription?.();
      stopRelockSubscription?.();
    };
  }, [selectedGame?.appId]);

  // ── Derived State ───────────────────────────────────────────────────────
  // The main process remains the sole ordering authority. Fetch every canonical
  // mode for the current achievement revision once, then derive the visible grid
  // from the selected mode synchronously alongside the existing filters. A mode
  // click therefore updates the rendered cards immediately from this cache and
  // never reads or changes a persisted Humanized schedule.
  const orderRevision = useMemo(() => achievementOrderRevision(achievements), [achievements]);

  useEffect(() => {
    let cancelled = false;
    const orderAchievements = window.steamAPI?.humanized?.orderAchievements;
    if (!orderAchievements || !achievements.length) {
      setHumanizedOrderCache({ revision: orderRevision, byMode: {}, metadataByMode: {} });
      return () => { cancelled = true; };
    }

    const modes = ['original', 'natural-story-progression', 'most-common-to-rarest', 'rarest-to-most-common'];
    // Achievement view models also carry read-only evidence such as unlockTime.
    // The strict ordering IPC accepts the canonical ordering contract only; do
    // not let one UI-only field reject every mode and silently leave the grid in
    // its Steam-source fallback order.
    const canonicalOrderingInput = projectExecutionAchievements(achievements);
    setHumanizedOrderError('');
    Promise.all(modes.map(async (mode) => {
      const result = await orderAchievements(canonicalOrderingInput, mode, selectedGame?.appId);
      // The main process returns the sole canonical ordered data plus a
      // mode-specific capability explanation. Preserve legacy array handling
      // only for development compatibility; no renderer sort is performed.
      const ordered = Array.isArray(result) ? result : result?.ordered;
      return {
        mode,
        ids: Array.isArray(ordered) ? ordered.map((achievement) => achievement.id) : [],
        metadata: Array.isArray(result) ? null : (result?.metadata || null),
      };
    })).then((entries) => {
      if (!cancelled) setHumanizedOrderCache({
        revision: orderRevision,
        byMode: Object.fromEntries(entries.map(({ mode, ids }) => [mode, ids])),
        metadataByMode: Object.fromEntries(entries.map(({ mode, metadata }) => [mode, metadata])),
      });
    }).catch(() => {
      // Do not label an original-order fallback as the selected Humanized mode.
      // The renderer never creates a second sorting algorithm; it waits for the
      // main-process canonical ordering bridge and surfaces the unavailable state.
      if (!cancelled) {
        setHumanizedOrderCache({ revision: orderRevision, byMode: {}, metadataByMode: {} });
        setHumanizedOrderError(t('achievements.gridFallback'));
      }
    });

    return () => { cancelled = true; };
  }, [achievements, orderRevision, selectedGame?.appId, t]);

  const canonicalOrderedIds = humanizedOrderCache.revision === orderRevision
    ? humanizedOrderCache.byMode[humanizedOrderMode]
    : null;
  const selectedOrderingMetadata = humanizedOrderCache.revision === orderRevision
    ? humanizedOrderCache.metadataByMode?.[humanizedOrderMode]
    : null;

  // One projection pipeline is shared by the grid, Humanized selection badges,
  // bulk selection, and schedule input: canonical data → canonical order →
  // search/filter visibility. Instant deliberately retains Steam source order.
  const canonicalOrderedAchievements = useMemo(() => projectAchievementDisplay({
    achievements,
    orderedIds: canonicalOrderedIds,
    useCanonicalOrder: unlockMode === 'humanized',
  }), [achievements, canonicalOrderedIds, unlockMode]);

  const displayedAchievements = useMemo(() => projectAchievementDisplay({
    achievements: canonicalOrderedAchievements,
    useCanonicalOrder: false,
    search,
    filter,
  }), [canonicalOrderedAchievements, filter, search]);

  const instantOutcome = timerStatus.lastOutcome;
  const instantOutcomeTone = instantOutcome?.state === 'verified'
    ? 'success'
    : instantOutcome?.state === 'verification-pending'
      ? 'warning'
      : 'danger';

  // Set of IDs currently in the queue
  const queueIds = useMemo(() => new Set(timerStatus.queue.map(q => q.id)), [timerStatus.queue]);

  const queueIndexMap = useMemo(() => {
    const map = new Map();
    timerStatus.queue.forEach((q, idx) => map.set(q.id, idx + 1));
    return map;
  }, [timerStatus.queue]);

  const selectedIndexMap = useMemo(() => {
    const map = new Map();
    const selectedOrder = unlockMode === 'humanized'
      ? canonicalOrderedAchievements.map((achievement) => achievement.id).filter((id) => selectedIds.has(id))
      : [...selectedIds];
    selectedOrder.forEach((id, index) => map.set(id, index + 1));
    return map;
  }, [canonicalOrderedAchievements, selectedIds, unlockMode]);

  // Bulk selection is deliberately derived from the rendered projection. In
  // Humanized mode that projection already uses main-process canonical IDs;
  // search and filter are applied before this list is created.
  const visibleLockedIds = useMemo(
    () => visibleLockedAchievementIds(displayedAchievements),
    [displayedAchievements],
  );
  const allVisibleLockedSelected = useMemo(
    () => areAllVisibleLockedSelected(selectedIds, visibleLockedIds),
    [selectedIds, visibleLockedIds],
  );

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleToggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAllLocked = () => {
    setSelectedIds((current) => (
      allVisibleLockedSelected
        ? removeVisibleLockedSelection(current, visibleLockedIds)
        : addVisibleLockedSelection(current, visibleLockedIds)
    ));
  };

  const handleStartQueue = async () => {
    if (selectedIds.size === 0 && timerStatus.queue.length === 0) return;
    setInstantError('');

    try {
      if (selectedIds.size > 0) {
        // The achievement view model can carry display-only Steam evidence such
        // as unlockTime. Project it to the strict execution IPC contract.
        const selectedItems = projectExecutionAchievements(
          achievements.filter((achievement) => selectedIds.has(achievement.id)),
        );
        const nextStatus = await window.steamAPI?.timer.startQueue(
          selectedItems,
          parseFloat(baseMultiplier),
          parseInt(varianceMins),
          useFixedTime ? parseFloat(fixedMins) : null,
        );
        if (!nextStatus?.isActive || nextStatus.queue.length !== selectedItems.length) {
          throw new Error('Instant queue did not start. Your selected achievements are still available.');
        }
        setTimerStatus(nextStatus);
        // Only clear selection after the main process has accepted the full queue.
        setSelectedIds(new Set());
      } else {
        const nextStatus = await window.steamAPI?.timer.startQueue(
          [],
          parseFloat(baseMultiplier),
          parseInt(varianceMins),
          useFixedTime ? parseFloat(fixedMins) : null,
        );
        if (nextStatus) setTimerStatus(nextStatus);
      }
    } catch (error) {
      setInstantError(error?.message || 'Instant queue could not start. Your selection was kept.');
    }
  };

  const handleStopQueue = () => {
    window.steamAPI?.timer.stopQueue();
  };

  const handleRecheckVerification = async () => {
    setInstantError('');
    try {
      const nextStatus = await window.steamAPI?.timer.recheckVerification();
      if (nextStatus) setTimerStatus(nextStatus);
    } catch (error) {
      setInstantError(error?.message || 'Steam confirmation could not be rechecked.');
    }
  };

  const handleRequestRelock = (achievement) => {
    if (!achievement?.unlocked || !selectedGame || relockStates[achievement.id] === 'requested') return;
    setRelockMessage(null);
    setRelockDialogAchievement(achievement);
  };

  const handleConfirmRelock = async () => {
    const achievement = relockDialogAchievement;
    if (!achievement || !selectedGame) return;
    setRelockStates((previous) => ({ ...previous, [achievement.id]: 'requested' }));
    setRelockMessage(null);
    try {
      const result = await window.steamAPI?.steam.relockAchievement(selectedGame.appId, achievement.id);
      if (!result?.success) {
        setRelockStates((previous) => ({ ...previous, [achievement.id]: 'failed' }));
        setRelockMessage({ tone: 'danger', text: result?.error || t('achievements.relockFailedDetail') });
        return;
      }
      if (result.state === 'relocked') {
        // Do not hide a completion based only on a click or local clear: this
        // update follows local acceptance and remote locked-state confirmation.
        setAchievements((previous) => previous.map((item) => (
          item.id === achievement.id ? { ...item, unlocked: false, unlockTime: null, iconUrl: item.iconGrayUrl || item.iconUrl } : item
        )));
        setRelockStates((previous) => ({ ...previous, [achievement.id]: 'verified' }));
        setRelockMessage({ tone: 'success', text: t('achievements.relockVerified') });
      } else {
        setRelockStates((previous) => ({ ...previous, [achievement.id]: 'verification-pending' }));
        setRelockMessage({ tone: 'warning', text: result.message || t('achievements.relockRemotePending') });
      }
    } catch (error) {
      setRelockStates((previous) => ({ ...previous, [achievement.id]: 'failed' }));
      setRelockMessage({ tone: 'danger', text: error?.message || t('achievements.relockFailedDetail') });
    } finally {
      setRelockDialogAchievement(null);
    }
  };

  const handleClearQueue = () => {
    window.steamAPI?.timer.clearQueue();
    // Refresh achievements to ensure our UI is perfectly synced
    if (selectedGame) {
       window.steamAPI?.steam.getAchievements(selectedGame.appId).then(res => {
         if (res?.success) setAchievements(res.achievements);
       });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="page-container animate-fade-in">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('achievements.title')}</h1>
          <p className="page-sub">
            {selectedGame
              ? t('achievements.viewing', { game: selectedGame.name })
              : t('achievements.selectGame')}
          </p>
        </div>

        {selectedGame ? (
          <button id="btn-change-game" className="btn-secondary" onClick={onChangeGame}>
            <RotateCcw size={13} /> {t('achievements.changeGame')}
          </button>
        ) : (
          <button id="btn-go-to-library" className="hero-cta" onClick={onChangeGame}>
            {t('achievements.browseLibrary')} <ChevronRight size={15} className="directional-chevron" />
          </button>
        )}
      </div>

      {/* ── Selected Game Banner ── */}
      {selectedGame && (
        <div className="selected-game-banner">
          <div className="selected-game-banner-glow" aria-hidden="true" />
          <img
            src={selectedGame.headerImage}
            alt={selectedGame.name}
            className="selected-game-banner-image"
            onError={(e) => (e.target.style.display = 'none')}
          />
          <div className="selected-game-banner-info">
            <p className="selected-game-banner-name">{selectedGame.name}</p>
            <div className="selected-game-banner-meta">
              <span>AppID {selectedGame.appId}</span>
              <span className="status-divider">·</span>
              <span className="badge badge-green" style={{ padding: '2px 8px' }}>
                <span className="player-dot" style={{ width: 6, height: 6 }} /> {t('achievements.steamContext')}
              </span>
            </div>
          </div>
        </div>
      )}

      {selectedGame ? (
        <>
          {/* ── Execution Mode ── */}
          <div className="filter-tabs humanized-mode-control" role="group" aria-label={t('achievements.progressionMode')} style={{ padding: 4 }}>
            <button className={`filter-tab${unlockMode === 'instant' ? ' filter-tab-active' : ''}`} onClick={() => setUnlockMode('instant')}>
              {t('mode.instant')}
            </button>
            <button className={`filter-tab${unlockMode === 'humanized' ? ' filter-tab-active' : ''}`} onClick={() => setUnlockMode('humanized')}>
              {t('mode.humanized')}
            </button>
          </div>

          {unlockMode === 'instant' ? (
          <div className="timer-panel">
            <div className="timer-panel-header">
              <h2 className="timer-panel-title">
                <Clock size={18} color="#a78bfa" />
                {t('achievements.smartDelay')}
              </h2>
              <div className="timer-actions">
                {timerStatus.queue.length > 0 && (
                  <button className="btn-danger" onClick={handleClearQueue} title="Clear Queue">
                    <Trash2 size={14} /> {t('achievements.clearQueue')}
                  </button>
                )}
                {timerStatus.isActive ? (
                  <button className="btn-danger" onClick={handleStopQueue}>
                    <Square size={14} fill="currentColor" /> {t('common.stop')}
                  </button>
                ) : (
                  <button 
                    className="btn-success" 
                    onClick={handleStartQueue} 
                    disabled={selectedIds.size === 0 && timerStatus.queue.length === 0}
                  >
                    <Play size={14} fill="currentColor" /> 
                    {timerStatus.queue.length > 0 ? t('achievements.resumeQueue') : t('achievements.startQueue', { count: selectedIds.size })}
                  </button>
                )}
              </div>
            </div>

            <div className="timer-controls">
              <div className="timer-control-group">
                <div className="timer-slider-label">
                  <span>{t('achievements.speed')}</span>
                  <span>{baseMultiplier}x</span>
                </div>
                <input 
                  type="range" 
                  min="0.5" max="5" step="0.5" 
                  value={baseMultiplier} 
                  onChange={e => setBaseMultiplier(parseFloat(e.target.value))} 
                  className="timer-slider"
                  disabled={timerStatus.isActive}
                />
              </div>
              <div className="timer-control-group">
                <div className="timer-slider-label">
                  <span>{t('achievements.variance')}</span>
                  <span>± {varianceMins} mins</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="60" step="1" 
                  value={varianceMins} 
                  onChange={e => setVarianceMins(e.target.value)} 
                  className="timer-slider"
                  disabled={timerStatus.isActive}
                />
              </div>
            </div>

            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-hover)', borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: timerStatus.isActive ? 'default' : 'pointer', fontSize: 13, fontWeight: 500 }}>
                <input 
                  type="checkbox" 
                  checked={useFixedTime} 
                  onChange={e => setUseFixedTime(e.target.checked)} 
                  disabled={timerStatus.isActive} 
                />
                {t('achievements.fixedTime')}
              </label>
              {useFixedTime && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                   <span>{t('achievements.baseTime')}</span>
                   <input 
                     type="number" 
                     min="0" step="1" 
                     value={fixedMins} 
                     onChange={e => setFixedMins(Math.max(0, parseFloat(e.target.value) || 0))} 
                     className="search-input" 
                     style={{ width: 80, padding: '4px 8px' }} 
                     disabled={timerStatus.isActive} 
                   />
                   <span>{t('achievements.minutes')}</span>
                </div>
              )}
            </div>

            {instantError && (
              <div className="timer-execution-message danger" role="alert">
                <strong>Instant queue did not start.</strong>
                <span>{instantError}</span>
              </div>
            )}

            {instantOutcome && (
              <div className={`timer-execution-message ${instantOutcomeTone}`} role={instantOutcomeTone === 'danger' ? 'alert' : 'status'}>
                <strong>{instantOutcome.state === 'verified' ? t('achievements.confirmationComplete') : instantOutcome.state === 'verification-pending' ? t('achievements.confirmationPending') : instantOutcome.state === 'verification-needs-attention' ? t('achievements.confirmationAttention') : t('common.failed')}</strong>
                <span>{instantOutcome.message}</span>
                {instantOutcome.errorCode && <small>Code: {instantOutcome.errorCode}</small>}
                {timerStatus.pendingVerification && !timerStatus.isActive && (
                  <button type="button" className="btn-secondary timer-recheck-action" onClick={handleRecheckVerification}>
                    {t('achievements.recheck')}
                  </button>
                )}
              </div>
            )}

            {timerStatus.queue.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {timerStatus.pendingVerification ? `${t('achievements.confirming')} ` : `${t('achievements.unlocking')} `}<strong style={{ color: 'var(--text-primary)' }}>{timerStatus.queue[0].name || timerStatus.queue[0].id}</strong>
                  </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(timerStatus.currentCountdown)}
                  </span>
                </div>
                <div className="timer-progress-wrap">
                  <div 
                    className="timer-progress-bar" 
                    style={{ width: `${(timerStatus.unlockedCount / timerStatus.totalInQueue) * 100}%` }} 
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'right' }}>
                  {timerStatus.unlockedCount} / {timerStatus.totalInQueue} Completed
                </div>
              </div>
            )}
          </div>
          ) : (
            <HumanizedSchedulePanel
              selectedGame={selectedGame}
              achievements={achievements}
              canonicalAchievements={canonicalOrderedAchievements}
              selectedIds={selectedIds}
              orderMode={humanizedOrderMode}
              onOrderModeChange={setHumanizedOrderMode}
              onScheduleCreated={() => setSelectedIds(new Set())}
            />
          )}

          {relockMessage && (
            <div className={`timer-execution-message ${relockMessage.tone}`} role={relockMessage.tone === 'danger' ? 'alert' : 'status'}>
              <strong>{relockMessage.tone === 'success' ? t('achievements.relockSucceeded') : relockMessage.tone === 'warning' ? t('achievements.relockPendingTitle') : t('achievements.relockFailed')}</strong>
              <span>{relockMessage.text}</span>
            </div>
          )}

          {/* ── Toolbar ── */}
          {unlockMode === 'humanized' && (
            <div className="humanized-grid-context" role="status">
              <span>{humanizedOrderError
                ? humanizedOrderError
                : selectedOrderingMetadata?.message
                  ? selectedOrderingMetadata.message
                  : <>{t('achievements.gridOrder', { mode: t(HUMANIZED_ORDER_LABELS[humanizedOrderMode] || 'mode.original') })}</>}</span>
            </div>
          )}
          <div className="toolbar" role="toolbar" aria-label="Achievement filters">
            <div className="search-wrap">
              <Search size={14} className="search-icon" aria-hidden="true" />
              <input
                type="search"
                className="search-input"
                placeholder={t('achievements.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-tabs" role="group">
              <Filter size={13} color="var(--text-muted)" aria-hidden="true" />
              {FILTERS.map(({ value, key }) => (
                <button
                  key={value}
                  className={`filter-tab${filter === value ? ' filter-tab-active' : ''}`}
                  onClick={() => setFilter(value)}
                >
                  {t(key)}
                </button>
              ))}
            </div>
            {visibleLockedIds.length > 0 && (
              <button 
                className="btn-secondary" 
                style={{ marginLeft: 8, padding: '5px 12px', fontSize: 12 }}
                onClick={handleSelectAllLocked}
                title="Select only the currently visible locked achievements in grid order"
              >
                {allVisibleLockedSelected ? t('achievements.deselectVisibleLocked') : t('achievements.selectAllLocked')}
              </button>
            )}
            {selectedIds.size > 0 && (
              <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--accent-purple)', fontWeight: 600 }}>
                {t('common.selected', { count: selectedIds.size })}
              </div>
            )}
          </div>

          {/* ── Achievement Grid ── */}
          {isLoading ? (
            <div className="empty-state" style={{ marginTop: 40 }}>
              <Loader2 size={36} color="#a78bfa" className="animate-spin" />
              <h2 className="empty-title" style={{ marginTop: 16 }}>{t('achievements.fetching')}</h2>
              <p className="empty-sub">{t('achievements.syncing')}</p>
            </div>
          ) : loadError ? (
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-icon-wrap" style={{ width: 60, height: 60, marginBottom: 16 }}>
                <Trophy size={28} color="#fca5a5" />
              </div>
              <h2 className="empty-title">{t('achievements.loadFailed')}</h2>
              <p className="empty-sub">{loadError}</p>
              <button className="btn-secondary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <>
              <div className="achievement-grid">
                {displayedAchievements.map(ach => (
                  <AchievementCard 
                    key={ach.id} 
                    achievement={ach} 
                    isSelected={selectedIds.has(ach.id)}
                    inQueue={queueIds.has(ach.id)}
                    queueIndex={queueIndexMap.get(ach.id) || selectedIndexMap.get(ach.id)}
                    onToggleSelect={() => handleToggleSelect(ach.id)}
                    onRelock={handleRequestRelock}
                    relockState={relockStates[ach.id]}
                  />
                ))}
              </div>
              {displayedAchievements.length === 0 && (
                <div className="empty-state" style={{ marginTop: 40 }}>
                  <div className="empty-icon-wrap" style={{ width: 60, height: 60, marginBottom: 16 }}>
                    <Trophy size={28} color="#94a3b8" />
                  </div>
                  <h2 className="empty-title">{t('achievements.noResults')}</h2>
                  <p className="empty-sub">{t('achievements.noResultsSub')}</p>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-icon-wrap">
            <div className="empty-icon-ring" />
            <div className="empty-icon-ring-inner" />
            <Trophy size={42} color="#7c3aed" style={{ opacity: 0.7 }} />
          </div>
          <h2 className="empty-title">{t('achievements.noGame')}</h2>
          <p className="empty-sub">{t('achievements.noGameSub')}</p>
        </div>
      )}

      {relockDialogAchievement && (
        <div className="relock-dialog-backdrop" role="presentation">
          <section className="relock-dialog" role="dialog" aria-modal="true" aria-labelledby="relock-dialog-title">
            <h2 id="relock-dialog-title">{t('achievements.relockTitle')}</h2>
            <p>{t('achievements.relockWarning', { achievement: relockDialogAchievement.name || relockDialogAchievement.id })}</p>
            <div className="relock-dialog-actions">
              <button type="button" className="btn-secondary" onClick={() => setRelockDialogAchievement(null)}>{t('common.cancel')}</button>
              <button type="button" className="btn-danger" onClick={handleConfirmRelock}>{t('achievements.confirmRelock')}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
