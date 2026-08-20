import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Gamepad2,
  Loader2,
  RefreshCw,
  Settings,
  Sparkles,
  Target,
  Trophy,
  TrendingUp,
} from 'lucide-react';

const DATA_ERROR_COPY = {
  NO_API_KEY: 'Add a Steam Web API key in Settings to load your library.',
  INVALID_API_KEY: 'Steam rejected the configured API key. Update it in Settings.',
  STEAM_NOT_CONNECTED: 'Steam needs to be connected before Overview can load data.',
  PRIVATE_PROFILE: 'Steam returned no library data. Check that game details are public.',
  FETCH_ERROR: 'Steam data could not be retrieved right now. Try again shortly.',
};

function metricStateValue({ phase, value, unavailableValue = 'Unavailable' }) {
  if (phase === 'loading') return 'Loading…';
  if (phase === 'error' || phase === 'unavailable') return unavailableValue;
  return value;
}

function formatCompletion(unlocked, total) {
  if (!total) return 'No data';
  return `${Math.round((unlocked / total) * 100)}%`;
}

/**
 * Dashboard — concise product overview driven by the existing Steam IPC data.
 * Library metrics cover the real owned-game response; achievement metrics are
 * explicitly scoped to the selected game because the application does not keep
 * an all-library achievement aggregate in memory.
 */
export default function Dashboard({ steamStatus, selectedGame, onSteamReconnect }) {
  const navigate = useNavigate();
  const [isReconnecting, setIsReconnecting] = useState(false);
  const overviewRequestVersion = useRef(0);
  const [overview, setOverview] = useState({
    phase: 'loading',
    games: [],
    achievementResult: null,
    errorCode: null,
    detail: '',
  });

  const loadOverview = useCallback(async () => {
    const requestVersion = ++overviewRequestVersion.current;
    if (!steamStatus.connected) {
      setOverview({ phase: 'unavailable', games: [], achievementResult: null, errorCode: 'STEAM_NOT_CONNECTED', detail: '' });
      return;
    }

    setOverview((current) => ({ ...current, phase: 'loading', errorCode: null, detail: '' }));
    try {
      const libraryResult = await window.steamAPI?.steam.getOwnedGames({ forceRefresh: false });
      if (requestVersion !== overviewRequestVersion.current) return;
      if (!libraryResult?.success) {
        setOverview({
          phase: 'error', games: [], achievementResult: null,
          errorCode: libraryResult?.errorCode || 'FETCH_ERROR', detail: libraryResult?.detail || '',
        });
        return;
      }

      let achievementResult = null;
      if (selectedGame?.appId) {
        achievementResult = await window.steamAPI?.steam.getAchievements(selectedGame.appId);
      }
      if (requestVersion !== overviewRequestVersion.current) return;
      setOverview({ phase: 'ready', games: libraryResult.games || [], achievementResult, errorCode: null, detail: '' });
    } catch (error) {
      if (requestVersion !== overviewRequestVersion.current) return;
      setOverview({ phase: 'error', games: [], achievementResult: null, errorCode: 'FETCH_ERROR', detail: error instanceof Error ? error.message : '' });
    }
  }, [selectedGame?.appId, steamStatus.connected]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  useEffect(() => {
    const handleUnlock = () => loadOverview();
    const unsubscribe = window.steamAPI?.steam.onAchievementUnlocked(handleUnlock);
    return () => unsubscribe?.();
  }, [loadOverview]);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await onSteamReconnect();
      await loadOverview();
    } finally {
      setIsReconnecting(false);
    }
  };

  const metrics = useMemo(() => {
    const achievements = overview.achievementResult?.success ? overview.achievementResult.achievements || [] : [];
    const unlocked = achievements.filter((achievement) => achievement.unlocked).length;
    const total = achievements.length;
    const hasCurrentGameData = Boolean(selectedGame?.appId && overview.achievementResult?.success);
    const phase = overview.phase;

    return [
      {
        id: 'stat-games', icon: Gamepad2, label: 'Owned Games', color: 'purple',
        value: metricStateValue({ phase, value: overview.games.length.toLocaleString() }),
        sub: phase === 'ready'
          ? overview.games.length ? 'From your Steam library' : 'Steam returned no games'
          : 'Steam library availability',
      },
      {
        id: 'stat-unlocked', icon: Trophy, label: 'Achievements Unlocked', color: 'blue',
        value: hasCurrentGameData ? unlocked.toLocaleString() : metricStateValue({ phase, value: 'Select a game', unavailableValue: 'Unavailable' }),
        sub: hasCurrentGameData ? `In ${selectedGame.name}` : selectedGame ? 'Achievement data unavailable' : 'Choose a game to view progress',
      },
      {
        id: 'stat-rate', icon: Target, label: 'Completion Rate', color: 'indigo',
        value: hasCurrentGameData ? formatCompletion(unlocked, total) : metricStateValue({ phase, value: 'Select a game', unavailableValue: 'Unavailable' }),
        sub: hasCurrentGameData ? total ? `${unlocked} of ${total} unlocked` : 'This game has no achievement data' : 'For the selected game',
      },
      {
        id: 'stat-activity', icon: TrendingUp, label: 'Recent Activity', color: 'violet',
        value: (() => {
          if (!selectedGame) return metricStateValue({ phase, value: 'Select a game', unavailableValue: 'Unavailable' });
          const gameData = overview.games.find(g => String(g.appId) === String(selectedGame.appId));
          const mins = gameData?.playtime2Weeks ?? 0;
          if (mins <= 0) return 'None reported';
          const hrs = Math.floor(mins / 60);
          const rem = mins % 60;
          return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
        })(),
        sub: (() => {
          if (!selectedGame) return 'Select a game to view recent activity';
          const gameData = overview.games.find(g => String(g.appId) === String(selectedGame.appId));
          const mins = gameData?.playtime2Weeks ?? 0;
          return mins > 0
            ? `Played in the last 2 weeks · ${selectedGame.name}`
            : 'No recent activity reported by Steam';
        })(),
      },
    ];
  }, [overview, selectedGame]);

  const featuredGames = useMemo(() => (
    [...overview.games]
      .sort((a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0))
      .slice(0, 3)
  ), [overview.games]);

  const greeting = steamStatus.connected && steamStatus.playerName
    ? `Welcome back, ${steamStatus.playerName}`
    : 'Smart Steam Unlocker';
  const subline = steamStatus.connected
    ? selectedGame ? `Selected game: ${selectedGame.name}.` : 'Your Steam client is connected. Choose a game to begin.'
    : 'Connect to Steam to start managing your achievements.';
  const overviewError = overview.errorCode ? DATA_ERROR_COPY[overview.errorCode] || DATA_ERROR_COPY.FETCH_ERROR : null;
  const openGameSelection = () => navigate('/library');

  return (
    <div className="page-container dashboard-page animate-fade-in">
      <section className="dashboard-hero" aria-labelledby="dashboard-welcome">
        <div className="dashboard-hero-glow" aria-hidden="true" />
        <div className="dashboard-hero-content">
          <div className="dashboard-hero-icon" aria-hidden="true"><Trophy size={25} /></div>
          <div>
            <p className="dashboard-eyebrow">Steam achievement companion</p>
            <h1 id="dashboard-welcome">{greeting}</h1>
            <p>{subline}</p>
          </div>
        </div>
        <div className="dashboard-hero-actions">
          <button className="hero-cta" onClick={() => selectedGame ? navigate('/achievements') : openGameSelection()}>
            {selectedGame ? 'Open Selected Game' : 'Browse Library'} <ChevronRight size={15} />
          </button>
          <button className="btn-secondary" onClick={() => navigate('/settings')}><Settings size={13} /> Settings</button>
        </div>
      </section>

      {!steamStatus.connected && (
        <div className="alert-card" role="alert">
          <AlertCircle size={18} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <p className="alert-title">Steam is not connected</p>
            <p className="alert-sub">Start the Steam client on this machine, then establish a connection to load your library and achievement data.</p>
          </div>
          <button className="btn-secondary" onClick={handleReconnect} disabled={isReconnecting}>
            {isReconnecting ? <><Loader2 size={13} className="animate-spin" /> Connecting…</> : <><RefreshCw size={13} /> Connect to Steam</>}
          </button>
        </div>
      )}

      <section className="dashboard-overview" aria-labelledby="section-overview">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow">At a glance</p>
            <h2 id="section-overview"><Sparkles size={15} aria-hidden="true" /> Overview</h2>
          </div>
          {overview.phase === 'loading' ? <span className="dashboard-data-state"><Loader2 size={13} className="animate-spin" /> Updating</span> : (
            <button className="dashboard-refresh" onClick={loadOverview} disabled={overview.phase === 'unavailable'} title="Refresh Overview data"><RefreshCw size={13} /> Refresh</button>
          )}
        </div>

        {overviewError && (
          <div className="dashboard-data-message" role="alert">
            <AlertCircle size={16} /> <span>{overviewError}</span>
            <button type="button" onClick={loadOverview}>Try again</button>
          </div>
        )}

        <div className="stats-grid dashboard-stats-grid">
          {metrics.map(({ id, icon: Icon, label, value, sub, color }) => {
            const opensGameSelection = !selectedGame && (id === 'stat-unlocked' || id === 'stat-rate');
            return (
              <article
                key={id}
                id={id}
                className={`stat-card${opensGameSelection ? ' stat-card-actionable' : ''}`}
                onClick={opensGameSelection ? openGameSelection : undefined}
                onKeyDown={opensGameSelection ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openGameSelection();
                  }
                } : undefined}
                role={opensGameSelection ? 'button' : undefined}
                tabIndex={opensGameSelection ? 0 : undefined}
                aria-label={opensGameSelection ? `Choose a game to view ${label.toLowerCase()}` : undefined}
              >
                <div className={`stat-icon stat-icon--${color}`} aria-hidden="true"><Icon size={19} /></div>
                <div>
                  <p className="stat-value" aria-label={`${label}: ${value}`}>{value}</p>
                  <p className="stat-label">{label}</p>
                  <p className="stat-sub">{sub}</p>
                </div>
              </article>
            );
          })}
        </div>
        {selectedGame && overview.achievementResult && !overview.achievementResult.success && overview.phase === 'ready' && (
          <p className="dashboard-inline-note">Achievement progress for {selectedGame.name} is unavailable. Library data remains up to date.</p>
        )}
      </section>

      <section className="dashboard-lower-grid" aria-label="Dashboard actions and current game">
        <article className="dashboard-current-card">
          <div className="dashboard-card-heading">
            <div className="dashboard-card-icon"><Gamepad2 size={16} /></div>
            <div><p className="dashboard-eyebrow">Selected game</p><h2>Your current selection</h2></div>
          </div>
          {selectedGame ? (
            <>
              <p className="dashboard-current-game">{selectedGame.name}</p>
              <p>This game was selected from your library. Review its achievements or continue its existing schedule.</p>
              <div className="dashboard-current-actions">
                <button className="btn-success" onClick={() => navigate('/achievements')}><Trophy size={14} /> Browse achievements</button>
                <button className="btn-secondary" onClick={() => navigate('/library')}><BookOpen size={14} /> Change game</button>
              </div>
            </>
          ) : (
            <>
              <p className="dashboard-current-game">No game selected</p>
              <p>Choose a game from your Steam library to view its achievement progress.</p>
              <button className="btn-secondary" onClick={openGameSelection}><BookOpen size={14} /> Browse Library</button>
            </>
          )}
        </article>

        <article className="dashboard-actions-card">
          <div className="dashboard-card-heading">
            <div className="dashboard-card-icon"><CheckCircle2 size={16} /></div>
            <div><p className="dashboard-eyebrow">Quick actions</p><h2>Keep moving</h2></div>
          </div>
          <div className="dashboard-action-list">
            <button onClick={openGameSelection}><BookOpen size={15} /><span><strong>Open Library</strong><small>Browse the games Steam has returned</small></span><ChevronRight size={15} /></button>
            <button onClick={() => selectedGame ? navigate('/achievements') : openGameSelection()}><Trophy size={15} /><span><strong>{selectedGame ? 'Browse Achievements' : 'Choose a Game'}</strong><small>{selectedGame ? `View progress for ${selectedGame.name}` : 'Select a game to view achievements'}</small></span><ChevronRight size={15} /></button>
            <button onClick={() => navigate('/settings')}><Settings size={15} /><span><strong>Steam Settings</strong><small>Manage connection and Web API access</small></span><ChevronRight size={15} /></button>
          </div>
        </article>
      </section>

      <section className="dashboard-library-snapshot" aria-labelledby="dashboard-library-snapshot-title">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow">Your library</p>
            <h2 id="dashboard-library-snapshot-title"><BookOpen size={15} aria-hidden="true" /> Library Snapshot</h2>
          </div>
          <button className="dashboard-refresh" onClick={openGameSelection}>View library <ChevronRight size={13} /></button>
        </div>
        {overview.phase === 'loading' ? (
          <div className="dashboard-snapshot-state"><Loader2 size={15} className="animate-spin" /> Loading library details…</div>
        ) : featuredGames.length ? (
          <div className="dashboard-snapshot-list">
            {featuredGames.map((game) => {
              const played = Math.round((game.playtimeMinutes ?? 0) / 60);
              return (
                <button key={game.appId} type="button" onClick={openGameSelection}>
                  <span className="dashboard-snapshot-game-mark"><Gamepad2 size={14} /></span>
                  <span className="dashboard-snapshot-game-name">{game.name}</span>
                  <span className="dashboard-snapshot-game-meta">{played ? `${played.toLocaleString()}h played` : 'Not played yet'}</span>
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-snapshot-state">
            {overview.phase === 'ready' ? 'Steam has not returned any games for this library.' : 'Connect Steam and add a Web API key to view your library snapshot.'}
          </div>
        )}
      </section>

    </div>
  );
}
