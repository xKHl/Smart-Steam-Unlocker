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
import { useI18n } from '../i18n';

const DATA_ERROR_COPY = {
  NO_API_KEY: 'library.apiKeyRequired',
  INVALID_API_KEY: 'settings.invalidApiKey',
  STEAM_NOT_CONNECTED: 'library.steamUnavailable',
  PRIVATE_PROFILE: 'library.noGamesDetail',
  FETCH_ERROR: 'dashboard.snapshotUnavailable',
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
  const { locale, t } = useI18n();
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
        id: 'stat-games', icon: Gamepad2, label: t('dashboard.ownedGames'), color: 'purple',
        value: metricStateValue({ phase, value: overview.games.length.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US'), unavailableValue: t('dashboard.unavailable') }),
        sub: phase === 'ready'
          ? overview.games.length ? t('dashboard.fromLibrary') : t('dashboard.noGames')
          : t('dashboard.libraryAvailability'),
      },
      {
        id: 'stat-unlocked', icon: Trophy, label: t('dashboard.achievementsUnlocked'), color: 'blue',
        value: hasCurrentGameData ? unlocked.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US') : metricStateValue({ phase, value: t('dashboard.selectGame'), unavailableValue: t('dashboard.unavailable') }),
        sub: hasCurrentGameData ? selectedGame.name : selectedGame ? t('dashboard.achievementUnavailable') : t('dashboard.chooseProgress'),
      },
      {
        id: 'stat-rate', icon: Target, label: t('dashboard.completionRate'), color: 'indigo',
        value: hasCurrentGameData ? formatCompletion(unlocked, total) : metricStateValue({ phase, value: t('dashboard.selectGame'), unavailableValue: t('dashboard.unavailable') }),
        sub: hasCurrentGameData ? total ? `${unlocked} / ${total}` : t('dashboard.noAchievementData') : t('dashboard.selectedGameOnly'),
      },
      {
        id: 'stat-activity', icon: TrendingUp, label: t('dashboard.recentActivity'), color: 'violet',
        value: (() => {
          if (!selectedGame) return metricStateValue({ phase, value: t('dashboard.selectGame'), unavailableValue: t('dashboard.unavailable') });
          const gameData = overview.games.find(g => String(g.appId) === String(selectedGame.appId));
          const mins = gameData?.playtime2Weeks ?? 0;
          if (mins <= 0) return t('dashboard.noneReported');
          const hrs = Math.floor(mins / 60);
          const rem = mins % 60;
          return hrs > 0 ? `${hrs}h ${rem}m` : `${rem}m`;
        })(),
        sub: (() => {
          if (!selectedGame) return t('dashboard.selectRecent');
          const gameData = overview.games.find(g => String(g.appId) === String(selectedGame.appId));
          const mins = gameData?.playtime2Weeks ?? 0;
          return mins > 0
            ? t('dashboard.recentActivityFor', { game: selectedGame.name })
            : t('status.noRecent');
        })(),
      },
    ];
  }, [locale, overview, selectedGame, t]);

  const featuredGames = useMemo(() => (
    [...overview.games]
      .sort((a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0))
      .slice(0, 3)
  ), [overview.games]);

  const greeting = steamStatus.connected && steamStatus.playerName
    ? t('dashboard.welcome', { name: steamStatus.playerName })
    : t('app.name');
  const subline = steamStatus.connected
    ? selectedGame ? t('dashboard.selectedGame', { game: selectedGame.name }) : t('dashboard.connectedStart')
    : t('dashboard.connectStart');
  const overviewError = overview.errorCode ? t(DATA_ERROR_COPY[overview.errorCode] || DATA_ERROR_COPY.FETCH_ERROR) : null;
  const openGameSelection = () => navigate('/library');

  return (
    <div className="page-container dashboard-page animate-fade-in">
      <section className="dashboard-hero" aria-labelledby="dashboard-welcome">
        <div className="dashboard-hero-glow" aria-hidden="true" />
        <div className="dashboard-hero-content">
          <div className="dashboard-hero-icon" aria-hidden="true"><Trophy size={25} /></div>
          <div>
            <p className="dashboard-eyebrow">{t('dashboard.companion')}</p>
            <h1 id="dashboard-welcome">{greeting}</h1>
            <p>{subline}</p>
          </div>
        </div>
        <div className="dashboard-hero-actions">
          <button className="hero-cta" onClick={() => selectedGame ? navigate('/achievements') : openGameSelection()}>
            {selectedGame ? t('dashboard.openSelected') : t('dashboard.browseLibrary')} <ChevronRight size={15} className="directional-chevron" />
          </button>
          <button className="btn-secondary" onClick={() => navigate('/settings')}><Settings size={13} /> {t('nav.settings')}</button>
        </div>
      </section>

      {!steamStatus.connected && (
        <div className="alert-card" role="alert">
          <AlertCircle size={18} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <p className="alert-title">{t('dashboard.steamDisconnected')}</p>
            <p className="alert-sub">{t('dashboard.steamDisconnectedDetail')}</p>
          </div>
          <button className="btn-secondary" onClick={handleReconnect} disabled={isReconnecting}>
            {isReconnecting ? <><Loader2 size={13} className="animate-spin" /> {t('dashboard.connecting')}</> : <><RefreshCw size={13} /> {t('dashboard.connectSteam')}</>}
          </button>
        </div>
      )}

      <section className="dashboard-overview" aria-labelledby="section-overview">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow">{t('dashboard.glance')}</p>
            <h2 id="section-overview"><Sparkles size={15} aria-hidden="true" /> {t('dashboard.overview')}</h2>
          </div>
          {overview.phase === 'loading' ? <span className="dashboard-data-state"><Loader2 size={13} className="animate-spin" /> {t('dashboard.updating')}</span> : (
            <button className="dashboard-refresh" onClick={loadOverview} disabled={overview.phase === 'unavailable'} title={t('dashboard.refreshOverview')}><RefreshCw size={13} /> {t('dashboard.refresh')}</button>
          )}
        </div>

        {overviewError && (
          <div className="dashboard-data-message" role="alert">
            <AlertCircle size={16} /> <span>{overviewError}</span>
            <button type="button" onClick={loadOverview}>{t('dashboard.tryAgain')}</button>
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
                aria-label={opensGameSelection ? t('dashboard.chooseFor', { label }) : undefined}
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
          <p className="dashboard-inline-note">{t('dashboard.progressUnavailable', { game: selectedGame.name })}</p>
        )}
      </section>

      <section className="dashboard-lower-grid" aria-label={t('dashboard.actionsAria')}>
        <article className="dashboard-current-card">
          <div className="dashboard-card-heading">
            <div className="dashboard-card-icon"><Gamepad2 size={16} /></div>
            <div><p className="dashboard-eyebrow">{t('nav.selectedGame')}</p><h2>{t('dashboard.currentSelection')}</h2></div>
          </div>
          {selectedGame ? (
            <>
              <p className="dashboard-current-game">{selectedGame.name}</p>
              <p>{t('dashboard.selectedFromLibrary')}</p>
              <div className="dashboard-current-actions">
                <button className="btn-success" onClick={() => navigate('/achievements')}><Trophy size={14} /> {t('dashboard.browseAchievements')}</button>
                <button className="btn-secondary" onClick={() => navigate('/library')}><BookOpen size={14} /> {t('dashboard.changeGame')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="dashboard-current-game">{t('dashboard.noGameSelected')}</p>
              <p>{t('dashboard.chooseProgress')}</p>
              <button className="btn-secondary" onClick={openGameSelection}><BookOpen size={14} /> {t('dashboard.browseLibrary')}</button>
            </>
          )}
        </article>

        <article className="dashboard-actions-card">
          <div className="dashboard-card-heading">
            <div className="dashboard-card-icon"><CheckCircle2 size={16} /></div>
            <div><p className="dashboard-eyebrow">{t('dashboard.quickActions')}</p><h2>{t('dashboard.keepMoving')}</h2></div>
          </div>
          <div className="dashboard-action-list">
            <button onClick={openGameSelection}><BookOpen size={15} /><span><strong>{t('dashboard.openLibrary')}</strong><small>{t('dashboard.browseReturned')}</small></span><ChevronRight size={15} className="directional-chevron" /></button>
            <button onClick={() => selectedGame ? navigate('/achievements') : openGameSelection()}><Trophy size={15} /><span><strong>{selectedGame ? t('dashboard.browseAchievements') : t('dashboard.chooseGame')}</strong><small>{selectedGame ? t('dashboard.viewProgress', { game: selectedGame.name }) : t('dashboard.selectToView')}</small></span><ChevronRight size={15} className="directional-chevron" /></button>
            <button onClick={() => navigate('/settings')}><Settings size={15} /><span><strong>{t('dashboard.steamSettings')}</strong><small>{t('dashboard.manageConnection')}</small></span><ChevronRight size={15} className="directional-chevron" /></button>
          </div>
        </article>
      </section>

      <section className="dashboard-library-snapshot" aria-labelledby="dashboard-library-snapshot-title">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow">{t('dashboard.yourLibrary')}</p>
            <h2 id="dashboard-library-snapshot-title"><BookOpen size={15} aria-hidden="true" /> {t('dashboard.librarySnapshot')}</h2>
          </div>
          <button className="dashboard-refresh" onClick={openGameSelection}>{t('dashboard.viewLibrary')} <ChevronRight size={13} className="directional-chevron" /></button>
        </div>
        {overview.phase === 'loading' ? (
          <div className="dashboard-snapshot-state"><Loader2 size={15} className="animate-spin" /> {t('dashboard.loadingLibrary')}</div>
        ) : featuredGames.length ? (
          <div className="dashboard-snapshot-list">
            {featuredGames.map((game) => {
              const played = Math.round((game.playtimeMinutes ?? 0) / 60);
              return (
                <button key={game.appId} type="button" onClick={openGameSelection}>
                  <span className="dashboard-snapshot-game-mark"><Gamepad2 size={14} /></span>
                  <span className="dashboard-snapshot-game-name">{game.name}</span>
                  <span className="dashboard-snapshot-game-meta">{played ? t('dashboard.played', { hours: played.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US') }) : t('dashboard.notPlayed')}</span>
                  <ChevronRight size={14} className="directional-chevron" />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-snapshot-state">
            {overview.phase === 'ready' ? t('dashboard.noSnapshot') : t('dashboard.snapshotUnavailable')}
          </div>
        )}
      </section>

    </div>
  );
}
