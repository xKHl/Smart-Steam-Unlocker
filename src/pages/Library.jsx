import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, AlertCircle, Loader2, RefreshCw, Settings,
  ChevronRight, SlidersHorizontal, Clock, Trophy, Gamepad2,
  Library as LibraryIcon,
} from 'lucide-react';
import GameCard from '../components/GameCard';
import { useNavigate } from 'react-router-dom';

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
  { value: 'name-asc',      label: 'Name A → Z' },
  { value: 'name-desc',     label: 'Name Z → A' },
  { value: 'playtime-desc', label: 'Most Played' },
  { value: 'playtime-asc',  label: 'Least Played' },
  { value: 'recent',        label: 'Recently Played' },
];

// Human-readable error explanations
const ERROR_COPY = {
  NO_API_KEY: {
    title: 'Steam API Key Required',
    body:  'To show your full library, enter a free Steam Web API key in Settings.',
    cta:   'Open Settings',
    route: '/settings',
  },
  INVALID_API_KEY: {
    title: 'Invalid API Key',
    body:  'Steam rejected your API key. Please check it in Settings.',
    cta:   'Fix in Settings',
    route: '/settings',
  },
  STEAM_NOT_CONNECTED: {
    title: 'Steam Not Connected',
    body:  'Make sure Steam is running on this machine, then restart the app.',
    cta:   null,
    route: null,
  },
  PRIVATE_PROFILE: {
    title: 'Profile is Private',
    body:  'Set your Steam "Game details" privacy to Public, then retry.',
    cta:   null,
    route: null,
  },
  FETCH_ERROR: {
    title: 'Network Error',
    body:  'Could not reach the Steam API. Check your internet connection.',
    cta:   null,
    route: null,
  },
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
export default function Library({ selectedGame, onGameSelect }) {
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
      <h2 className="empty-title">Fetching your Steam library...</h2>
      <p className="empty-sub">Connecting to Steam Web API</p>
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
      <h2 className="library-error-title">{errorInfo?.title}</h2>
      <p className="library-error-body">
        {errorInfo?.body}
        {errorMsg && errorCode === 'FETCH_ERROR' && (
          <><br /><code style={{ fontSize: 11, opacity: 0.6 }}>{errorMsg}</code></>
        )}
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {errorInfo?.cta && errorInfo?.route && (
          <button className="hero-cta" onClick={() => navigate(errorInfo.route)}>
            {errorInfo.cta}
            <ChevronRight size={14} />
          </button>
        )}
        <button className="btn-secondary" onClick={() => fetchLibrary(true)}>
          <RefreshCw size={13} />
          Retry
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────

  const subtitle = loading
    ? 'Fetching your library from Steam…'
    : errorCode
    ? errorInfo?.title ?? 'Error'
    : `${count.toLocaleString()} owned game${count !== 1 ? 's' : ''}${totalPlaytimeHours ? ` · ${totalPlaytimeHours.toLocaleString()}h total playtime` : ''}`;

  return (
    <div className="page-container library-page animate-fade-in">

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Game Library</h1>
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
                placeholder="Name or AppID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search games"
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
                aria-label="Sort games"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Refresh */}
            <button
              className="btn-secondary"
              onClick={() => fetchLibrary(true)}
              title="Refresh library from Steam"
              aria-label="Refresh library"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        )}
      </div>

      {/* ── Stats Strip ───────────────────────────────────────────────────── */}
      {!loading && !errorCode && games.length > 0 && (
        <div className="library-stats-strip">
          <div className="lib-stat">
            <LibraryIcon size={13} color="var(--text-muted)" />
            <span><strong>{count.toLocaleString()}</strong> games owned</span>
          </div>
          <div className="lib-stat">
            <Clock size={13} color="var(--text-muted)" />
            <span><strong>{totalPlaytimeHours.toLocaleString()}h</strong> total playtime</span>
          </div>
          <div className="lib-stat">
            <Trophy size={13} color="var(--text-muted)" />
            <span>
              <strong>
                {games.filter(g => (g.playtimeMinutes ?? 0) > 0).length.toLocaleString()}
              </strong>{' '}
              played
            </span>
          </div>
          {search && (
            <div className="lib-stat lib-stat-filter">
              <span>{displayedGames.length} matching</span>
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
          <div className="library-grid" role="list" aria-label="Game library">
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
            <h2 className="empty-title">{search ? 'No games match your search' : 'No Games Found'}</h2>
            <p className="empty-sub">{search ? 'Try a different name or AppID.' : 'Please ensure Steam is running and your library is populated.'}</p>
          </div>
        )
      )}

    </div>
  );
}
