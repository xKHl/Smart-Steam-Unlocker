import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  CreditCard,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Square,
} from 'lucide-react';
import {
  buildRecentAppIds,
  projectTradingCardLibrary,
  TRADING_CARD_FILTERS,
  TRADING_CARD_SORTS,
} from '../lib/tradingCardProjection.mjs';

const STATUS_COPY = {
  remaining: { label: 'Drops available', detail: (count) => `${count} ${count === 1 ? 'drop' : 'drops'} remaining`, tone: 'good' },
  exhausted: { label: 'Drops exhausted', detail: () => 'Steam reports no remaining card drops', tone: 'muted' },
  unavailable: { label: 'Card status unavailable', detail: () => 'Steam has not provided account drop data', tone: 'muted' },
  'not-applicable': { label: 'No Trading Cards', detail: () => 'This game does not have Steam Trading Cards.', tone: 'muted' },
};

function formatDuration(totalMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(totalMs) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

function cardState(game) {
  if (game?.eligibility === 'no-cards') return STATUS_COPY['not-applicable'];
  if (game?.dropStatus === 'remaining') return STATUS_COPY.remaining;
  if (game?.dropStatus === 'exhausted') return STATUS_COPY.exhausted;
  return STATUS_COPY.unavailable;
}

function monitorCopy(monitor) {
  if (!monitor || monitor.state === 'inactive') return null;
  if (monitor.state === 'paused') return { title: 'Monitoring paused', detail: 'Steam launch monitoring is paused. The app is not controlling the game process.', tone: 'muted' };
  if (monitor.state === 'completed') return { title: 'Drops exhausted', detail: 'Steam explicitly reported no remaining drops. Monitoring ended; the Steam game was not closed.', tone: 'good' };
  return {
    title: 'Launch requested · Monitoring',
    detail: 'Steam received a launch request. Game running has not been confirmed by this integration.',
    tone: 'active',
  };
}

function SummaryCard({ label, value, tone = 'default' }) {
  return (
    <div className={`trading-summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function TradingCards() {
  const [library, setLibrary] = useState({ success: null, games: [], summary: null, errorCode: null, cardDataAvailable: false });
  const [monitor, setMonitor] = useState({ state: 'inactive', monitorDurationMs: 0 });
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [recentAppIds, setRecentAppIds] = useState([]);
  const [filter, setFilter] = useState('All');
  const [sort, setSort] = useState(TRADING_CARD_SORTS.RECENT);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [, setClock] = useState(0);

  const load = useCallback(async ({ forceRefresh = false } = {}) => {
    setLoading(true);
    try {
      const result = await window.steamAPI?.tradingCards.getLibrary({ forceRefresh });
      setLibrary(result || { success: false, games: [], summary: null, errorCode: 'UNAVAILABLE', cardDataAvailable: false });
      const current = await window.steamAPI?.tradingCards.getStatus();
      if (current) setMonitor(current);
      if (result?.games?.length) setSelectedAppId((current) => current ?? result.games[0].appId);
    } catch {
      setLibrary({ success: false, games: [], summary: null, errorCode: 'UNAVAILABLE', cardDataAvailable: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsubscribe = window.steamAPI?.tradingCards.onUpdate((nextMonitor) => {
      setMonitor(nextMonitor);
      if (nextMonitor?.state === 'completed') load({ forceRefresh: true });
    });
    return () => unsubscribe?.();
  }, [load]);

  useEffect(() => {
    if (monitor.state !== 'monitoring') return undefined;
    const interval = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [monitor.state]);

  const visibleGames = useMemo(() => projectTradingCardLibrary({
    games: library.games,
    filter,
    search,
    sort,
    recentAppIds,
    monitoredAppId: monitor.state !== 'inactive' ? monitor.appId : null,
  }), [library.games, filter, search, sort, recentAppIds, monitor.appId, monitor.state]);

  const selectedGame = useMemo(
    () => library.games.find((game) => Number(game.appId) === Number(selectedAppId)) || null,
    [library.games, selectedAppId],
  );
  const activeMonitorCopy = monitorCopy(monitor);
  const selectedIsMonitored = selectedGame && Number(selectedGame.appId) === Number(monitor.appId) && monitor.state !== 'inactive';

  const selectGame = (game) => {
    setSelectedAppId(game.appId);
    setRecentAppIds((previous) => buildRecentAppIds(game.appId, previous));
    setNotice(null);
  };

  const runAction = async (action) => {
    setActionBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (result) setMonitor(result);
      await load({ forceRefresh: true });
    } catch (error) {
      setNotice({ tone: 'error', text: error?.message || 'Steam could not complete that Trading Card action.' });
    } finally {
      setActionBusy(false);
    }
  };

  const startMonitor = () => runAction(async () => {
    const result = await window.steamAPI?.tradingCards.start(selectedGame.appId);
    setNotice({ tone: 'info', text: 'Steam launch requested. Monitoring will refresh account card data in the background; game running is not confirmed here.' });
    return result;
  });

  const pauseOrResume = () => runAction(async () => (
    monitor.state === 'paused'
      ? window.steamAPI?.tradingCards.resume()
      : window.steamAPI?.tradingCards.pause()
  ));

  const stopMonitor = () => runAction(async () => {
    const result = await window.steamAPI?.tradingCards.stop();
    setNotice({ tone: 'info', text: 'Monitoring stopped. Steam was not asked to close the game.' });
    return result;
  });

  const summary = library.summary || { withCards: 0, withoutCards: 0, dropsRemaining: 0, dropsExhausted: 0, unavailable: 0 };

  return (
    <section className="trading-page">
      <header className="trading-page-header">
        <div>
          <p className="eyebrow">STEAM COMMUNITY ITEMS</p>
          <h1>Trading Cards</h1>
          <p>Understand card eligibility across your library and monitor a real Steam launch request without inventing game, drop, or playtime state.</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => load({ forceRefresh: true })} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh data
        </button>
      </header>

      <div className="trading-summary-grid" aria-label="Trading Card library summary">
        <SummaryCard label="Games with Cards" value={summary.withCards} tone="purple" />
        <SummaryCard label="Games without Cards" value={summary.withoutCards} />
        <SummaryCard label="Drops remaining" value={summary.dropsRemaining} tone="green" />
        <SummaryCard label="Drops exhausted" value={summary.dropsExhausted} />
      </div>

      {activeMonitorCopy && (
        <div className={`trading-monitor-banner ${activeMonitorCopy.tone}`} role="status">
          <div>
            <p className="trading-monitor-kicker">CURRENT STEAM LAUNCH MONITOR</p>
            <strong>{activeMonitorCopy.title}</strong>
            <span>Current game: {monitor.gameName} · Monitor session: {formatDuration(monitor.monitorDurationMs)}</span>
            <small>{activeMonitorCopy.detail}</small>
          </div>
          {monitor.dropStatus === 'remaining' && <b>{monitor.remainingDrops} drops remaining</b>}
        </div>
      )}

      {notice && <div className={`trading-notice ${notice.tone}`} role="status">{notice.text}</div>}

      {!library.success && !loading ? (
        <div className="trading-empty-state">
          <AlertCircle size={24} />
          <div>
            <h2>Trading Card data is unavailable</h2>
            <p>{library.errorCode === 'NO_API_KEY' ? 'Add a Steam Web API key in Settings, then refresh this page.' : 'Connect Steam and make sure the account library is accessible, then refresh this page.'}</p>
          </div>
        </div>
      ) : (
        <div className="trading-workspace">
          <div className="trading-library-pane">
            <div className="trading-toolbar">
              <label className="trading-search">
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search games…" />
              </label>
              <div className="trading-filter-group" role="group" aria-label="Trading Card filters">
                {TRADING_CARD_FILTERS.map((entry) => (
                  <button key={entry} type="button" className={filter === entry ? 'active' : ''} onClick={() => setFilter(entry)}>{entry}</button>
                ))}
              </div>
              <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Trading Card sort order">
                <option value="recent">Recently selected</option>
                <option value="drops">Drops remaining</option>
                <option value="alphabetical">Alphabetical</option>
              </select>
            </div>

            {!library.cardDataAvailable && library.success && (
              <p className="trading-data-caveat">Account card-drop data is unavailable. Eligibility can still be shown only where Steam Store metadata explicitly provides it.</p>
            )}

            <div className="trading-game-grid" aria-live="polite">
              {loading ? <div className="trading-grid-loading"><Loader2 className="spin" size={22} /> Loading Trading Card library…</div> : visibleGames.map((game) => {
                const state = cardState(game);
                const monitored = Number(game.appId) === Number(monitor.appId) && monitor.state !== 'inactive';
                return (
                  <button type="button" key={game.appId} className={`trading-game-card ${selectedGame?.appId === game.appId ? 'selected' : ''}`} onClick={() => selectGame(game)}>
                    <img src={game.headerImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                    <div className="trading-game-copy">
                      <strong title={game.name}>{game.name}</strong>
                      <span className={`trading-status-pill ${state.tone}`}>{state.label}</span>
                      <small>{state.detail(game.remainingDrops)}</small>
                      {monitored && <em>Currently monitoring</em>}
                    </div>
                  </button>
                );
              })}
              {!loading && !visibleGames.length && <div className="trading-grid-loading">No games match this Trading Card view.</div>}
            </div>
          </div>

          <aside className="trading-details-pane" aria-live="polite">
            {!selectedGame ? (
              <div className="trading-details-empty"><CreditCard size={24} /><p>Select a game to inspect its Trading Card status.</p></div>
            ) : (() => {
              const state = cardState(selectedGame);
              const canStart = selectedGame.eligibility === 'with-cards' && selectedGame.dropStatus === 'remaining' && !selectedIsMonitored && monitor.state === 'inactive';
              return (
                <>
                  <img className="trading-details-image" src={selectedGame.headerImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  <p className="eyebrow">SELECTED GAME</p>
                  <h2>{selectedGame.name}</h2>
                  <p className={`trading-details-status ${state.tone}`}>{state.label}</p>
                  <p className="trading-details-description">{state.detail(selectedGame.remainingDrops)}</p>

                  {selectedGame.eligibility === 'no-cards' && <div className="trading-limit-note">This game does not have Steam Trading Cards.</div>}
                  {selectedGame.eligibility === 'unavailable' && <div className="trading-limit-note">Steam Store metadata did not confirm whether this game has Trading Cards. No launch monitor is available.</div>}
                  {selectedGame.dropStatus === 'exhausted' && <div className="trading-limit-note">Steam reported that this game has no remaining card drops.</div>}

                  {selectedIsMonitored && (
                    <div className="trading-session-detail">
                      <span><Clock3 size={15} /> Monitor session</span>
                      <strong>{formatDuration(monitor.monitorDurationMs)}</strong>
                      <small>Steam running: not confirmed by this integration</small>
                    </div>
                  )}

                  <div className="trading-action-stack">
                    {canStart && <button className="btn-primary" type="button" disabled={actionBusy} onClick={startMonitor}><Play size={15} /> Request Steam launch</button>}
                    {selectedIsMonitored && ['monitoring', 'paused'].includes(monitor.state) && <button className="btn-secondary" type="button" disabled={actionBusy} onClick={pauseOrResume}>{monitor.state === 'paused' ? <Play size={15} /> : <Pause size={15} />} {monitor.state === 'paused' ? 'Resume monitoring' : 'Pause monitoring'}</button>}
                    {selectedIsMonitored && monitor.state !== 'inactive' && <button className="btn-danger" type="button" disabled={actionBusy} onClick={stopMonitor}><Square size={15} /> Stop monitoring</button>}
                    {!canStart && !selectedIsMonitored && selectedGame.dropStatus === 'remaining' && monitor.state !== 'inactive' && <div className="trading-limit-note">Only one launch monitor can be active. Stop the current monitor before selecting another game.</div>}
                  </div>

                  <div className="trading-truth-note"><ExternalLink size={14} /> Request Steam launch opens the game through Steam. It does not guarantee a running game, a card drop, or an exact drop time.</div>
                </>
              );
            })()}
          </aside>
        </div>
      )}
    </section>
  );
}
