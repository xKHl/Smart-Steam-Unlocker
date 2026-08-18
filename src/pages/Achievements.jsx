import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, ChevronRight, RotateCcw, Clock, Play, Square, Settings2, Trash2, Trophy, Loader2 } from 'lucide-react';
import AchievementCard from '../components/AchievementCard';
import HumanizedSchedulePanel from '../components/HumanizedSchedulePanel';

const FILTERS = ['All', 'Locked', 'Unlocked'];

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
    baseMultiplier: 1, varianceMins: 15, totalInQueue: 0, unlockedCount: 0
  });
  
  const [baseMultiplier, setBaseMultiplier] = useState(1);
  const [varianceMins, setVarianceMins] = useState(15);
  const [useFixedTime, setUseFixedTime] = useState(false);
  const [fixedMins, setFixedMins] = useState(1);
  const [unlockMode, setUnlockMode] = useState('instant');
  const [humanizedOrderMode, setHumanizedOrderMode] = useState('original');
  const [humanizedOrderedIds, setHumanizedOrderedIds] = useState(null);

  // ── Initialization ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedGame) return;

    // Fetch actual achievements and global percentages from Steam
    const fetchAchievements = async () => {
      if (!window.steamAPI) return;
      setIsLoading(true);
      setLoadError('');
      try {
        const [achRes, pctRes] = await Promise.all([
          window.steamAPI.steam.getAchievements(selectedGame.appId),
          window.steamAPI.steam.getGlobalAchievementPercentages(selectedGame.appId)
        ]);

        if (achRes?.success) {
          let merged = achRes.achievements;
          
          if (pctRes?.success && pctRes.percentages) {
            const pctMap = {};
            pctRes.percentages.forEach(p => { pctMap[p.name] = p.percent; });
            
            merged = merged.map(a => (
              pctMap[a.id] !== undefined
                ? { ...a, globalPercent: pctMap[a.id] }
                : a
            ));
          }

          // Auto-Sort logic: Strictly chronological using the internal schema index
          merged = [...merged].sort((a, b) => {
             const indexA = a.originalIndex ?? 0;
             const indexB = b.originalIndex ?? 0;
             return indexA - indexB;
          });

          setAchievements(merged);
        } else {
          setAchievements([]);
          setLoadError(achRes?.error || 'Steam could not return achievement data for this game.');
        }
      } catch (err) {
        setAchievements([]);
        setLoadError('Could not load achievements. Check the Steam connection and try again.');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchAchievements();

    // Fetch persisted timer status
    window.steamAPI?.timer.getStatus().then(status => {
      if (status) {
        setTimerStatus(status);
        if (status.baseMultiplier > 0) setBaseMultiplier(status.baseMultiplier);
        if (status.varianceMins > 0) setVarianceMins(status.varianceMins);
        if (status.fixedMins !== null && status.fixedMins !== undefined) {
          setUseFixedTime(true);
          setFixedMins(status.fixedMins);
        }
      }
    });

    // Subscribe to live timer ticks
    window.steamAPI?.timer.onUpdate((status) => {
      setTimerStatus(status);
      
      // If the timer stopped and queue finished, refresh achievements to reflect unlocked state
      if (!status.isActive && status.queue.length === 0 && status.unlockedCount > 0) {
        fetchAchievements();
      }
    });

    // Subscribe to real-time unlock events
    window.steamAPI?.steam.onAchievementUnlocked((achievementId) => {
      console.log('Real-time unlock received:', achievementId);
      
      // Instantly update the achievement array to reflect unlocked state & icon
      setAchievements(prev => prev.map(ach => 
        ach.id === achievementId 
          ? { ...ach, unlocked: true, iconUrl: ach.iconColorUrl || ach.iconUrl }
          : ach
      ));
      
      // Ensure it is removed from the manual selection set if it was selected
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(achievementId)) {
          next.delete(achievementId);
        }
        return next;
      });
    });

    setSelectedIds(new Set());
  }, [selectedGame]);

  // ── Derived State ───────────────────────────────────────────────────────
  // Humanized display order is fetched from the main-process canonical ordering
  // module. This changes presentation only; the persisted schedule is never read
  // or rewritten when the user changes this selector.
  useEffect(() => {
    let cancelled = false;
    if (unlockMode !== 'humanized' || !window.steamAPI?.humanized?.orderAchievements) {
      setHumanizedOrderedIds(null);
      return () => { cancelled = true; };
    }

    window.steamAPI.humanized.orderAchievements(achievements, humanizedOrderMode)
      .then((ordered) => {
        if (!cancelled) setHumanizedOrderedIds(Array.isArray(ordered) ? ordered.map((achievement) => achievement.id) : []);
      })
      .catch(() => {
        // Preserve a safe original-order view if the display-only bridge is unavailable.
        if (!cancelled) setHumanizedOrderedIds(null);
      });

    return () => { cancelled = true; };
  }, [achievements, humanizedOrderMode, unlockMode]);

  const achievementDisplaySource = useMemo(() => {
    if (unlockMode !== 'humanized' || !humanizedOrderedIds) return achievements;
    const byId = new Map(achievements.map((achievement) => [achievement.id, achievement]));
    return humanizedOrderedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [achievements, humanizedOrderedIds, unlockMode]);

  const displayedAchievements = useMemo(() => {
    let list = achievementDisplaySource;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(a => (a.name || a.id).toLowerCase().includes(q));
    
    if (filter === 'Locked')   list = list.filter(a => !a.unlocked);
    if (filter === 'Unlocked') list = list.filter(a => a.unlocked);
    
    return list;
  }, [achievementDisplaySource, search, filter]);

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

  const lockedAchievements = useMemo(() => achievements.filter(a => !a.unlocked), [achievements]);
  const allLockedSelected = lockedAchievements.length > 0 && lockedAchievements.every(a => selectedIds.has(a.id));

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleToggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSelectAllLocked = () => {
    if (allLockedSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set(selectedIds);
      lockedAchievements.forEach(a => next.add(a.id));
      setSelectedIds(next);
    }
  };

  const handleStartQueue = () => {
    if (selectedIds.size === 0 && timerStatus.queue.length === 0) return;
    
    if (selectedIds.size > 0) {
      // Start a brand new queue with selected items
      const selectedItems = achievements.filter(a => selectedIds.has(a.id));
      window.steamAPI?.timer.startQueue(selectedItems, parseFloat(baseMultiplier), parseInt(varianceMins), useFixedTime ? parseFloat(fixedMins) : null);
      setSelectedIds(new Set()); // clear selection
    } else {
      // Resume existing queue
      window.steamAPI?.timer.startQueue([], parseFloat(baseMultiplier), parseInt(varianceMins), useFixedTime ? parseFloat(fixedMins) : null);
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
              <span>Grid ordered by <strong>{humanizedOrderMode === 'original' ? 'Original Steam order' : humanizedOrderMode === 'easiest-to-hardest' ? 'Easiest → Hardest' : humanizedOrderMode === 'most-common-to-rarest' ? 'Most Common → Rarest' : 'Rarest → Most Common'}</strong>. Select locked achievements to include them in a new schedule.</span>
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
            {lockedAchievements.length > 0 && (
              <button 
                className="btn-secondary" 
                style={{ marginLeft: 8, padding: '5px 12px', fontSize: 12 }}
                onClick={handleSelectAllLocked}
              >
                {allLockedSelected ? 'Deselect All Locked' : 'Select All Locked'}
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
