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
import { useI18n } from '../i18n';

const STATUS_COPY = {
  remaining: { labelKey: 'trading.dropsAvailable', detailKey: 'trading.dropsRemainingDetail', tone: 'good' },
  exhausted: { labelKey: 'trading.dropsExhausted', detailKey: 'trading.exhaustedDetail', tone: 'muted' },
  unavailable: { labelKey: 'trading.statusUnavailable', detailKey: 'trading.unavailableDetail', tone: 'muted' },
  'not-applicable': { labelKey: 'trading.noCards', detailKey: 'trading.noCardsDetail', tone: 'muted' },
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

function monitorCopy(monitor, t) {
  if (!monitor || monitor.state === 'inactive') return null;
  if (monitor.state === 'paused') return { title: t('trading.monitoringPaused'), detail: t('trading.pausedDetail'), tone: 'muted' };
  if (monitor.state === 'completed') return { title: t('trading.dropsExhausted'), detail: t('trading.completedDetail'), tone: 'good' };
  return { title: t('trading.launchMonitoring'), detail: t('trading.launchMonitoringDetail'), tone: 'active' };
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
  const { t } = useI18n();
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
  const activeMonitorCopy = monitorCopy(monitor, t);
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
      setNotice({ tone: 'error', text: error?.message || t('trading.couldNotComplete') });
    } finally {
      setActionBusy(false);
    }
  };

  const startMonitor = () => runAction(async () => {
    const result = await window.steamAPI?.tradingCards.start(selectedGame.appId);
    setNotice({ tone: 'info', text: t('trading.launchRequestedNotice') });
    return result;
  });

  const pauseOrResume = () => runAction(async () => (
    monitor.state === 'paused'
      ? window.steamAPI?.tradingCards.resume()
      : window.steamAPI?.tradingCards.pause()
  ));

  const stopMonitor = () => runAction(async () => {
    const result = await window.steamAPI?.tradingCards.stop();
    setNotice({ tone: 'info', text: t('trading.monitoringStopped') });
    return result;
  });

  const summary = library.summary || { withCards: 0, withoutCards: 0, dropsRemaining: 0, dropsExhausted: 0, unavailable: 0 };

  return (
    <section className="trading-page">
      <header className="trading-page-header">
        <div>
          <p className="eyebrow">{t('trading.eyebrow')}</p>
          <h1>{t('trading.title')}</h1>
          <p>{t('trading.intro')}</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => load({ forceRefresh: true })} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> {t('trading.refreshData')}
        </button>
      </header>

      <div className="trading-summary-grid" aria-label={t('trading.summary')}>
        <SummaryCard label={t('trading.gamesWithCards')} value={summary.withCards} tone="purple" />
        <SummaryCard label={t('trading.gamesWithoutCards')} value={summary.withoutCards} />
        <SummaryCard label={t('trading.dropsRemaining')} value={summary.dropsRemaining} tone="green" />
        <SummaryCard label={t('trading.dropsExhausted')} value={summary.dropsExhausted} />
      </div>

      {activeMonitorCopy && (
        <div className={`trading-monitor-banner ${activeMonitorCopy.tone}`} role="status">
          <div>
            <p className="trading-monitor-kicker">{t('trading.currentMonitor')}</p>
            <strong>{activeMonitorCopy.title}</strong>
            <span>{t('trading.currentGame', { game: monitor.gameName })} · {t('trading.monitorSession', { duration: formatDuration(monitor.monitorDurationMs) })}</span>
            <small>{activeMonitorCopy.detail}</small>
          </div>
          {monitor.dropStatus === 'remaining' && <b>{t('trading.dropsRemainingDetail', { count: monitor.remainingDrops })}</b>}
        </div>
      )}

      {notice && <div className={`trading-notice ${notice.tone}`} role="status">{notice.text}</div>}

      {!library.success && !loading ? (
        <div className="trading-empty-state">
          <AlertCircle size={24} />
          <div>
            <h2>{t('trading.dataUnavailable')}</h2>
            <p>{library.errorCode === 'NO_API_KEY' ? t('trading.apiKeyHelp') : t('trading.connectionHelp')}</p>
          </div>
        </div>
      ) : (
        <div className="trading-workspace">
          <div className="trading-library-pane">
            <div className="trading-toolbar">
              <label className="trading-search">
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('trading.search')} aria-label={t('trading.search')} />
              </label>
              <div className="trading-filter-group" role="group" aria-label={t('trading.filters')}>
                {TRADING_CARD_FILTERS.map((entry) => (
                  <button key={entry} type="button" className={filter === entry ? 'active' : ''} onClick={() => setFilter(entry)}>{t({ All: 'trading.all', Eligible: 'trading.eligible', Unavailable: 'trading.unavailable' }[entry] || 'trading.all')}</button>
                ))}
              </div>
              <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label={t('trading.sort')}>
                <option value="recent">{t('trading.recentlySelected')}</option>
                <option value="drops">{t('trading.dropsRemaining')}</option>
                <option value="alphabetical">{t('trading.alphabetical')}</option>
              </select>
            </div>

            {!library.cardDataAvailable && library.success && (
              <p className="trading-data-caveat">{t('trading.dataCaveat')}</p>
            )}

            <div className="trading-game-grid" aria-live="polite">
              {loading ? <div className="trading-grid-loading"><Loader2 className="spin" size={22} /> {t('trading.loading')}</div> : visibleGames.map((game) => {
                const state = cardState(game);
                const monitored = Number(game.appId) === Number(monitor.appId) && monitor.state !== 'inactive';
                return (
                  <button type="button" key={game.appId} className={`trading-game-card ${selectedGame?.appId === game.appId ? 'selected' : ''}`} onClick={() => selectGame(game)}>
                    <img src={game.headerImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                    <div className="trading-game-copy">
                      <strong title={game.name}>{game.name}</strong>
                      <span className={`trading-status-pill ${state.tone}`}>{t(state.labelKey)}</span>
                      <small>{t(state.detailKey, { count: game.remainingDrops })}</small>
                      {monitored && <em>{t('trading.currentlyMonitoring')}</em>}
                    </div>
                  </button>
                );
              })}
              {!loading && !visibleGames.length && <div className="trading-grid-loading">{t('trading.noMatching')}</div>}
            </div>
          </div>

          <aside className="trading-details-pane" aria-live="polite">
            {!selectedGame ? (
              <div className="trading-details-empty"><CreditCard size={24} /><p>{t('trading.selectGame')}</p></div>
            ) : (() => {
              const state = cardState(selectedGame);
              const canStart = selectedGame.eligibility === 'with-cards' && selectedGame.dropStatus === 'remaining' && !selectedIsMonitored && monitor.state === 'inactive';
              return (
                <>
                  <img className="trading-details-image" src={selectedGame.headerImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                  <p className="eyebrow">{t('trading.selectedGame')}</p>
                  <h2>{selectedGame.name}</h2>
                  <p className={`trading-details-status ${state.tone}`}>{t(state.labelKey)}</p>
                  <p className="trading-details-description">{t(state.detailKey, { count: selectedGame.remainingDrops })}</p>

                  {selectedGame.eligibility === 'no-cards' && <div className="trading-limit-note">{t('trading.noCardsDetail')}</div>}
                  {selectedGame.eligibility === 'unavailable' && <div className="trading-limit-note">{t('trading.metadataUnavailable')}</div>}
                  {selectedGame.dropStatus === 'exhausted' && <div className="trading-limit-note">{t('trading.exhaustedNote')}</div>}

                  {selectedIsMonitored && (
                    <div className="trading-session-detail">
                      <span><Clock3 size={15} /> {t('trading.monitorSessionLabel')}</span>
                      <strong>{formatDuration(monitor.monitorDurationMs)}</strong>
                      <small>{t('trading.runningUnconfirmed')}</small>
                    </div>
                  )}

                  <div className="trading-action-stack">
                    {canStart && <button className="btn-primary" type="button" disabled={actionBusy} onClick={startMonitor}><Play size={15} /> {t('trading.requestLaunch')}</button>}
                    {selectedIsMonitored && ['monitoring', 'paused'].includes(monitor.state) && <button className="btn-secondary" type="button" disabled={actionBusy} onClick={pauseOrResume}>{monitor.state === 'paused' ? <Play size={15} /> : <Pause size={15} />} {monitor.state === 'paused' ? t('trading.resumeMonitoring') : t('trading.pauseMonitoring')}</button>}
                    {selectedIsMonitored && monitor.state !== 'inactive' && <button className="btn-danger" type="button" disabled={actionBusy} onClick={stopMonitor}><Square size={15} /> {t('trading.stopMonitoring')}</button>}
                    {!canStart && !selectedIsMonitored && selectedGame.dropStatus === 'remaining' && monitor.state !== 'inactive' && <div className="trading-limit-note">{t('trading.oneMonitor')}</div>}
                  </div>

                  <div className="trading-truth-note"><ExternalLink size={14} /> {t('trading.truthNote')}</div>
                </>
              );
            })()}
          </aside>
        </div>
      )}
    </section>
  );
}
