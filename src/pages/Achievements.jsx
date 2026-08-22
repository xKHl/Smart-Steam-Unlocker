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

const FILTERS = ['All', 'Locked', 'Unlocked'];

const HUMANIZED_ORDER_LABELS = {
  original: 'Original Steam order',
  'natural-story-progression': 'Natural / Story Progression',
  'most-common-to-rarest': 'Most Common → Rarest',
  'rarest-to-most-common': 'Rarest → Most Common',
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
  const [humanizedOrderCache, setHumanizedOrderCache] = useState({ revision: '', byMode: {} });

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

    setSelectedIds(new Set());
    return () => {
      active = false;
      stopTimerSubscription?.();
      stopUnlockSubscription?.();
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
      setHumanizedOrderCache({ revision: orderRevision, byMode: {} });
      return () => { cancelled = true; };
    }

    const modes = ['original', 'natural-story-progression', 'most-common-to-rarest', 'rarest-to-most-common'];
    Promise.all(modes.map(async (mode) => {
      const ordered = await orderAchievements(achievements, mode, selectedGame?.appId);
      return [mode, Array.isArray(ordered) ? ordered.map((achievement) => achievement.id) : []];
    })).then((entries) => {
      if (!cancelled) setHumanizedOrderCache({ revision: orderRevision, byMode: Object.fromEntries(entries) });
    }).catch(() => {
      // Instant mode stays in Steam order. Humanized falls back safely until the
      // canonical bridge is available rather than introducing renderer sorting.
      if (!cancelled) setHumanizedOrderCache({ revision: orderRevision, byMode: {} });
    });

    return () => { cancelled = true; };
  }, [achievements, orderRevision, selectedGame?.appId]);

  const canonicalOrderedIds = humanizedOrderCache.revision === orderRevision
    ? humanizedOrderCache.byMode[humanizedOrderMode]
    : null;

  const displayedAchievements = useMemo(() => projectAchievementDisplay({
    achievements,
    orderedIds: canonicalOrderedIds,
    useCanonicalOrder: unlockMode === 'humanized',
    search,
    filter,
  }), [achievements, canonicalOrderedIds, filter, search, unlockMode]);

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
    let i = 1;
    for (const id of selectedIds) {
      map.set(id, i++);
    }
    return map;
  }, [selectedIds]);

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
          <h1 className="page-title">Achievements</h1>
          <p className="page-sub">
            {selectedGame
              ? `Viewing achievements for ${selectedGame.name}`
              : 'Select a game from your library to browse its achievements.'}
          </p>
        </div>

        {selectedGame ? (
          <button id="btn-change-game" className="btn-secondary" onClick={onChangeGame}>
            <RotateCcw size={13} /> Change Game
          </button>
        ) : (
          <button id="btn-go-to-library" className="hero-cta" onClick={onChangeGame}>
            Browse Library <ChevronRight size={15} />
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
                <span className="player-dot" style={{ width: 6, height: 6 }} /> Steam context active
              </span>
            </div>
          </div>
        </div>
      )}

      {selectedGame ? (
        <>
          {/* ── Execution Mode ── */}
          <div className="filter-tabs humanized-mode-control" role="group" aria-label="Achievement progression mode" style={{ padding: 4 }}>
            <button className={`filter-tab${unlockMode === 'instant' ? ' filter-tab-active' : ''}`} onClick={() => setUnlockMode('instant')}>
              Instant
            </button>
            <button className={`filter-tab${unlockMode === 'humanized' ? ' filter-tab-active' : ''}`} onClick={() => setUnlockMode('humanized')}>
              Humanized
            </button>
          </div>

          {unlockMode === 'instant' ? (
          <div className="timer-panel">
            <div className="timer-panel-header">
              <h2 className="timer-panel-title">
                <Clock size={18} color="#a78bfa" />
                Smart Delay Timer
              </h2>
              <div className="timer-actions">
                {timerStatus.queue.length > 0 && (
                  <button className="btn-danger" onClick={handleClearQueue} title="Clear Queue">
                    <Trash2 size={14} /> Clear
                  </button>
                )}
                {timerStatus.isActive ? (
                  <button className="btn-danger" onClick={handleStopQueue}>
                    <Square size={14} fill="currentColor" /> Stop
                  </button>
                ) : (
                  <button 
                    className="btn-success" 
                    onClick={handleStartQueue} 
                    disabled={selectedIds.size === 0 && timerStatus.queue.length === 0}
                  >
                    <Play size={14} fill="currentColor" /> 
                    {timerStatus.queue.length > 0 ? 'Resume Queue' : `Start (${selectedIds.size})`}
                  </button>
                )}
              </div>
            </div>

            <div className="timer-controls">
              <div className="timer-control-group">
                <div className="timer-slider-label">
                  <span>Speed Multiplier</span>
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
                  <span>Random Variance</span>
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
                Use Fixed Custom Time (Manual Override)
              </label>
              {useFixedTime && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                   <span>Base Time:</span>
                   <input 
                     type="number" 
                     min="0" step="1" 
                     value={fixedMins} 
                     onChange={e => setFixedMins(Math.max(0, parseFloat(e.target.value) || 0))} 
                     className="search-input" 
                     style={{ width: 80, padding: '4px 8px' }} 
                     disabled={timerStatus.isActive} 
                   />
                   <span>minutes</span>
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
                <strong>{instantOutcome.state === 'verified' ? 'Steam verification complete.' : instantOutcome.state === 'verification-pending' ? 'Steam confirmation pending.' : 'Instant execution failed.'}</strong>
                <span>{instantOutcome.message}</span>
                {instantOutcome.errorCode && <small>Code: {instantOutcome.errorCode}</small>}
              </div>
            )}

            {timerStatus.queue.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Unlocking: <strong style={{ color: 'var(--text-primary)' }}>{timerStatus.queue[0].name || timerStatus.queue[0].id}</strong>
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
              selectedIds={selectedIds}
              orderMode={humanizedOrderMode}
              onOrderModeChange={setHumanizedOrderMode}
              onScheduleCreated={() => setSelectedIds(new Set())}
            />
          )}

          {/* ── Toolbar ── */}
          {unlockMode === 'humanized' && (
            <div className="humanized-grid-context" role="status">
              <span>Grid ordered by <strong>{HUMANIZED_ORDER_LABELS[humanizedOrderMode] || 'Original Steam order'}</strong>. Select locked achievements to include them in a new schedule.</span>
            </div>
          )}
          <div className="toolbar" role="toolbar" aria-label="Achievement filters">
            <div className="search-wrap">
              <Search size={14} className="search-icon" aria-hidden="true" />
              <input
                type="search"
                className="search-input"
                placeholder="Search achievements…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-tabs" role="group">
              <Filter size={13} color="var(--text-muted)" aria-hidden="true" />
              {FILTERS.map((f) => (
                <button
                  key={f}
                  className={`filter-tab${filter === f ? ' filter-tab-active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f}
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
                {allVisibleLockedSelected ? 'Deselect Visible Locked' : 'Select All Locked'}
              </button>
            )}
            {selectedIds.size > 0 && (
              <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--accent-purple)', fontWeight: 600 }}>
                {selectedIds.size} Selected
              </div>
            )}
          </div>

          {/* ── Achievement Grid ── */}
          {isLoading ? (
            <div className="empty-state" style={{ marginTop: 40 }}>
              <Loader2 size={36} color="#a78bfa" className="animate-spin" />
              <h2 className="empty-title" style={{ marginTop: 16 }}>Fetching achievements...</h2>
              <p className="empty-sub">Syncing data with Steam servers</p>
            </div>
          ) : loadError ? (
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-icon-wrap" style={{ width: 60, height: 60, marginBottom: 16 }}>
                <Trophy size={28} color="#fca5a5" />
              </div>
              <h2 className="empty-title">Could not load achievements</h2>
              <p className="empty-sub">{loadError}</p>
              <button className="btn-secondary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
                Try Again
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
                  />
                ))}
              </div>
              {displayedAchievements.length === 0 && (
                <div className="empty-state" style={{ marginTop: 40 }}>
                  <div className="empty-icon-wrap" style={{ width: 60, height: 60, marginBottom: 16 }}>
                    <Trophy size={28} color="#94a3b8" />
                  </div>
                  <h2 className="empty-title">No achievements found</h2>
                  <p className="empty-sub">Check if this game supports Steam achievements.</p>
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
          <h2 className="empty-title">No Game Selected</h2>
          <p className="empty-sub">
            Head to the Library, pick a game, and the app will automatically
            restart with the correct Steam context to fetch its achievements.
          </p>
        </div>
      )}
    </div>
  );
}
