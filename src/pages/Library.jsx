import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, AlertCircle, Loader2, RefreshCw, Settings,
  ChevronRight, SlidersHorizontal, Clock, Trophy, Gamepad2,
  Library as LibraryIcon, XCircle,
} from 'lucide-react';
import GameCard from '../components/GameCard';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatPlaytime(minutes) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes}m`;
  const h = (minutes / 60).toFixed(0);
  return `${parseInt(h).toLocaleString()}h`;
}

function formatSize(bytes) {
  if (!bytes) return '';
  const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${UNITS[i]}`;
}

const SORT_OPTIONS = [
  { value: 'name-asc',      labelKey: 'library.nameAsc' },
  { value: 'name-desc',     labelKey: 'library.nameDesc' },
  { value: 'playtime-desc', labelKey: 'library.mostPlayed' },
  { value: 'playtime-asc',  labelKey: 'library.leastPlayed' },
  { value: 'recent',        labelKey: 'library.recentlyPlayed' },
];

// Human-readable error explanations
const ERROR_COPY = {
  NO_API_KEY: { titleKey: 'library.apiKeyTitle', bodyKey: 'library.apiKeyBody', ctaKey: 'library.openSettings', route: '/settings' },
  INVALID_API_KEY: { titleKey: 'library.invalidKeyTitle', bodyKey: 'library.invalidKeyBody', ctaKey: 'library.fixSettings', route: '/settings' },
  STEAM_NOT_CONNECTED: { titleKey: 'library.steamNotConnected', bodyKey: 'library.steamNotConnectedBody', route: null },
  PRIVATE_PROFILE: { titleKey: 'library.privateProfile', bodyKey: 'library.privateProfileBody', route: null },
  FETCH_ERROR: { titleKey: 'library.networkError', bodyKey: 'library.networkErrorBody', route: null },
};

// ─────────────────────────────────────────────────────────────────────────────
// Library Page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Library — Full owned game library fetched from the Steam Web API.
 *
 * States:
 *   loading     → spinner with shimmer skeleton cards
 *   no api key  → setup prompt card
 *   error       → contextual error card
 *   success     → responsive game grid with search + sort
 */
export default function Library({ selectedGame, onGameSelect, switchError, onDismissSwitchError }) {
  const { locale, t } = useI18n();
  const navigate = useNavigate();

  const [games,     setGames]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [errorCode, setErrorCode] = useState(null);
  const [errorMsg,  setErrorMsg]  = useState('');
  const [search,    setSearch]    = useState('');
  const [sort,      setSort]      = useState('name-asc');
  const [count,     setCount]     = useState(0);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchLibrary = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setErrorCode(null);
    setErrorMsg('');
    try {
      let result = await window.steamAPI?.steam.getOwnedGames({ forceRefresh });

      if (result?.success) {
        setGames(result.games);
        setCount(result.count);
      } else {
        setErrorCode(result?.errorCode ?? 'FETCH_ERROR');
        setErrorMsg(result?.detail ?? '');
      }
    } catch (err) {
      setErrorCode('FETCH_ERROR');
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLibrary(false); }, [fetchLibrary]);

  // ── Sort + Filter ────────────────────────────────────────────────────────
  const displayedGames = useMemo(() => {
    let list = games;

    // Search
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(g => g.name.toLowerCase().includes(q) || String(g.appId).includes(q));

    // Sort
    const sorted = [...list];
    switch (sort) {
      case 'name-asc':      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); break;
      case 'name-desc':     sorted.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' })); break;
      case 'playtime-desc': sorted.sort((a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0)); break;
      case 'playtime-asc':  sorted.sort((a, b) => (a.playtimeMinutes ?? 0) - (b.playtimeMinutes ?? 0)); break;
      case 'recent':        sorted.sort((a, b) => (b.playtime2Weeks ?? 0) - (a.playtime2Weeks ?? 0)); break;
    }
    return sorted;
  }, [games, search, sort]);

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalPlaytimeHours = useMemo(
    () => Math.round(games.reduce((s, g) => s + (g.playtimeMinutes ?? 0), 0) / 60),
    [games]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  // Loading spinner shown while fetching
  const SkeletonGrid = () => (
    <div className="empty-state" style={{ minHeight: '50vh' }}>
      <Loader2 size={48} color="#a78bfa" className="animate-spin" style={{ marginBottom: 16 }} />
      <h2 className="empty-title">{t('library.fetching')}</h2>
      <p className="empty-sub">{t('library.connectingApi')}</p>
    </div>
  );

  // Error + setup states
  const errorInfo = errorCode ? ERROR_COPY[errorCode] ?? ERROR_COPY.FETCH_ERROR : null;

  const ErrorCard = () => (
    <div className="library-error-card">
      <div className="library-error-icon">
        {errorCode === 'NO_API_KEY'
          ? <Settings size={28} color="#a78bfa" />
          : <AlertCircle size={28} color="#fbbf24" />}
      </div>
      <h2 className="library-error-title">{t(errorInfo?.titleKey || 'library.networkError')}</h2>
      <p className="library-error-body">
        {t(errorInfo?.bodyKey || 'library.networkErrorBody')}
        {errorMsg && errorCode === 'FETCH_ERROR' && (
          <><br /><code style={{ fontSize: 11, opacity: 0.6 }}>{errorMsg}</code></>
        )}
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {errorInfo?.ctaKey && errorInfo?.route && (
          <button className="hero-cta" onClick={() => navigate(errorInfo.route)}>
            {t(errorInfo.ctaKey)}
            <ChevronRight size={14} className="directional-chevron" />
          </button>
        )}
        <button className="btn-secondary" onClick={() => fetchLibrary(true)}>
          <RefreshCw size={13} />
          {t('library.retry')}
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────

  const subtitle = loading
    ? t('library.loadingSubtitle')
    : errorCode
    ? t(errorInfo?.titleKey || 'library.error')
    : `${t('library.ownedSummary', { count: count.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US') })}${totalPlaytimeHours ? ` · ${t('library.totalPlaytime', { hours: totalPlaytimeHours.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US') })}` : ''}`;

  return (
    <div className="page-container library-page animate-fade-in">

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('library.gameLibrary')}</h1>
          <p className="page-sub">{subtitle}</p>
        </div>

        {/* Toolbar: only when data is loaded */}
        {!loading && !errorCode && games.length > 0 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search */}
            <div className="search-wrap" style={{ maxWidth: 240 }}>
              <Search size={14} className="search-icon" aria-hidden="true" />
              <input
                id="input-library-search"
                type="search"
                className="search-input"
                placeholder={t('library.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t('library.searchGames')}
              />
            </div>

            {/* Sort */}
            <div className="sort-wrap">
              <SlidersHorizontal size={13} color="var(--text-muted)" aria-hidden="true" />
              <select
                id="select-sort"
                className="bg-gray-800 text-white border border-gray-700 rounded py-1 px-2 text-xs ml-2 outline-none focus:border-purple-500"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label={t('library.sortGames')}
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </select>
            </div>

            {/* Refresh */}
            <button
              className="btn-secondary"
              onClick={() => fetchLibrary(true)}
              title={t('library.refreshSteam')}
              aria-label={t('library.refresh')}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        )}
      </div>

      {/* ── Game-switch error banner ─────────────────────────────────────── */}
      {switchError && (
        <div className="library-switch-error" role="alert" aria-live="assertive">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{switchError}</span>
          <button
            type="button"
            className="library-switch-error-dismiss"
            onClick={onDismissSwitchError}
            aria-label={t('library.dismissError')}
          >
            <XCircle size={15} />
          </button>
        </div>
      )}

      {/* ── Stats Strip ───────────────────────────────────────────────────── */}
      {!loading && !errorCode && games.length > 0 && (
        <div className="library-stats-strip">
          <div className="lib-stat">
            <LibraryIcon size={13} color="var(--text-muted)" />
            <span><strong>{count.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US')}</strong> {t('library.gamesOwned')}</span>
          </div>
          <div className="lib-stat">
            <Clock size={13} color="var(--text-muted)" />
            <span><strong>{totalPlaytimeHours.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US')}h</strong> {t('library.totalPlaytimeLabel')}</span>
          </div>
          <div className="lib-stat">
            <Trophy size={13} color="var(--text-muted)" />
            <span>
              <strong>
                {games.filter(g => (g.playtimeMinutes ?? 0) > 0).length.toLocaleString()}
              </strong>{' '}
              {t('library.played')}
            </span>
          </div>
          {search && (
            <div className="lib-stat lib-stat-filter">
              <span>{t('library.matching', { count: displayedGames.length.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US') })}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {loading && <SkeletonGrid />}

      {/* ── Error / Setup ─────────────────────────────────────────────────── */}
      {!loading && errorCode && <ErrorCard />}

      {/* ── Game Grid ─────────────────────────────────────────────────────── */}
      {!loading && !errorCode && (
        displayedGames.length > 0 ? (
          <div className="library-grid" role="list" aria-label={t('library.gameList')}>
            {displayedGames.map((game) => (
              <div key={game.appId} role="listitem">
                <GameCard
                  game={game}
                  onClick={() => onGameSelect(game)}
                  isSelected={selectedGame?.appId === game.appId}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon-wrap">
              <div className="empty-icon-ring"       aria-hidden="true" />
              <div className="empty-icon-ring-inner" aria-hidden="true" />
              <Gamepad2 size={42} color="#7c3aed" style={{ opacity: 0.65 }} aria-hidden="true" />
            </div>
            <h2 className="empty-title">{search ? t('library.noSearchResults') : t('library.noGames')}</h2>
            <p className="empty-sub">{search ? t('library.changeSearch') : t('library.noGamesHint')}</p>
          </div>
        )
      )}

    </div>
  );
}
