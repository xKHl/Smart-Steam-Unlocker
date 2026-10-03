import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { localizeError } from '../i18n/errors.mjs';

const STATUS_COPY = {
  remaining: { labelKey: 'trading.dropsAvailable', detailKey: 'trading.dropsRemainingDetail', tone: 'good' },
  exhausted: { labelKey: 'trading.dropsExhausted', detailKey: 'trading.exhaustedDetail', tone: 'muted' },
  'cards-unknown-drops': { labelKey: 'trading.hasCards', detailKey: 'trading.dropsUnknownDetail', tone: 'good' },
  unavailable: { labelKey: 'trading.statusUnavailable', detailKey: 'trading.unavailableDetail', tone: 'muted' },
  'not-applicable': { labelKey: 'trading.noCards', detailKey: 'trading.noCardsDetail', tone: 'muted' },
};

function formatDuration(totalMs, t) {
  const totalSeconds = Math.max(0, Math.floor((Number(totalMs) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return t('scheduler.durationHoursMinutes', { hours: String(hours).padStart(2, '0'), minutes: String(minutes).padStart(2, '0') });
  return t('scheduler.durationMinutesSeconds', { minutes: String(minutes).padStart(2, '0'), seconds: String(seconds).padStart(2, '0') });
}

function cardState(game) {
  if (game?.eligibility === 'no-cards') return STATUS_COPY['not-applicable'];
  if (game?.dropStatus === 'remaining') return STATUS_COPY.remaining;
  if (game?.dropStatus === 'exhausted') return STATUS_COPY.exhausted;
  if (game?.eligibility === 'with-cards') return STATUS_COPY['cards-unknown-drops'];
  return STATUS_COPY.unavailable;
}

const TRADING_FILTER_KEYS = {
  All: 'trading.filterAll',
  'With Cards': 'trading.filterWithCards',
  'Without Cards': 'trading.filterWithoutCards',
  'Drops Remaining': 'trading.filterDropsRemaining',
  'Drops Exhausted': 'trading.filterDropsExhausted',
  'Currently Monitoring': 'trading.filterMonitoring',
};

function monitorCopy(monitor, t) {
  if (!monitor || monitor.state === 'inactive') return null;
  if (monitor.state === 'paused') return { title: t('trading.monitoringPaused'), detail: t('trading.pausedDetail'), tone: 'muted' };
  if (monitor.state === 'completed') return { title: t('trading.dropsExhausted'), detail: t('trading.completedDetail'), tone: 'good' };
  return { title: t('trading.launchMonitoring'), detail: t('trading.launchMonitoringDetail'), tone: 'active' };
}

function SummaryCard({ label, value, unit = '', tone = 'default' }) {
  return (
    <div className={`trading-summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}{unit && <em>{unit}</em>}</strong>
    </div>
  );
}

// Arabic counted nouns: 3–10 take the plural, everything else the singular.
function countedUnit(t, locale, count, singularKey, pluralKey) {
  if (locale === 'ar') return t(count >= 3 && count <= 10 ? pluralKey : singularKey);
  return t(count === 1 ? singularKey : pluralKey);
}

export default function TradingCards() {
  const { locale, t } = useI18n();
  const [library, setLibrary] = useState({ success: null, games: [], summary: null, errorCode: null, cardDataAvailable: false });
  const [monitor, setMonitor] = useState({ state: 'inactive', monitorDurationMs: 0 });
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [recentAppIds, setRecentAppIds] = useState([]);
  const [filter, setFilter] = useState('All');
  const [sort, setSort] = useState(TRADING_CARD_SORTS.RECENT);
  const viewChosenByUser = useRef(false);
  const chooseFilter = (value) => { viewChosenByUser.current = true; setFilter(value); };
  const chooseSort = (value) => { viewChosenByUser.current = true; setSort(value); };
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [communityBusy, setCommunityBusy] = useState(false);
  const [idle, setIdle] = useState({ state: 'inactive', games: [], finished: [], totalRemainingDrops: 0 });
  const [idleBusy, setIdleBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [, setClock] = useState(0);

  const load = useCallback(async ({ forceRefresh = false } = {}) => {
    setLoading(true);
    try {
      const result = await window.steamAPI?.tradingCards.getLibrary({ forceRefresh });
      setLibrary(result || { success: false, games: [], summary: null, errorCode: 'UNAVAILABLE', cardDataAvailable: false });
      const current = await window.steamAPI?.tradingCards.getStatus();
      if (current) setMonitor(current);
      if (result?.games?.length) {
        const withDrops = result.games
          .filter((game) => game.dropStatus === 'remaining')
          .sort((left, right) => (right.remainingDrops || 0) - (left.remainingDrops || 0));
        setSelectedAppId((current) => current ?? (withDrops[0] || result.games[0]).appId);
        // With real drop counts, open on the games that still have cards to
        // collect, most drops first, unless the user already picked a view.
        if (!viewChosenByUser.current && withDrops.length) {
          setFilter('Drops Remaining');
          setSort(TRADING_CARD_SORTS.DROPS);
        }
      }
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
    window.steamAPI?.tradingCards.idleStatus?.().then((status) => { if (status) setIdle(status); }).catch(() => {});
    const unsubscribe = window.steamAPI?.tradingCards.onIdleUpdate?.((status) => {
      setIdle(status);
      if (status?.state === 'completed') load({ forceRefresh: true });
    });
    return () => unsubscribe?.();
  }, [load]);

  useEffect(() => {
    if (idle.state !== 'running') return undefined;
    const interval = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [idle.state]);

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
      setNotice({ tone: 'error', text: localizeError(t, locale, error, 'trading.couldNotComplete') });
    } finally {
      setActionBusy(false);
    }
  };

  const communitySignIn = async () => {
    setCommunityBusy(true);
    setNotice(null);
    try {
      await window.steamAPI?.tradingCards.communitySignIn();
      await load({ forceRefresh: true });
    } catch (error) {
      setNotice({ tone: 'error', text: localizeError(t, locale, error, 'trading.couldNotComplete') });
    } finally {
      setCommunityBusy(false);
    }
  };

  const communitySignOut = async () => {
    setCommunityBusy(true);
    try {
      await window.steamAPI?.tradingCards.communitySignOut();
      await load({ forceRefresh: true });
    } finally {
      setCommunityBusy(false);
    }
  };

  const idleCandidates = (library.games || [])
    .filter((game) => game.dropStatus === 'remaining' && game.remainingDrops > 0)
    .sort((left, right) => right.remainingDrops - left.remainingDrops);
  const summaryCounts = library.summary || {};
  const filterCounts = {
    All: library.games?.length ?? 0,
    'With Cards': summaryCounts.withCards,
    'Without Cards': summaryCounts.withoutCards,
    ...(library.cardDataAvailable ? { 'Drops Remaining': summaryCounts.dropsRemaining, 'Drops Exhausted': summaryCounts.dropsExhausted } : {}),
  };
  const idleCandidateDrops = idleCandidates.reduce((sum, game) => sum + game.remainingDrops, 0);

  const runIdle = async (action) => {
    setIdleBusy(true);
    setNotice(null);
    try {
      const status = await action();
      if (status?.errorCode) setNotice({ tone: 'error', text: localizeError(t, locale, status, 'trading.couldNotComplete') });
      if (status) setIdle(status);
    } catch (error) {
      setNotice({ tone: 'error', text: localizeError(t, locale, error, 'trading.couldNotComplete') });
    } finally {
      setIdleBusy(false);
    }
  };
  const startIdle = () => runIdle(() => window.steamAPI?.tradingCards.idleStart());
  const stopIdle = () => runIdle(async () => {
    const status = await window.steamAPI?.tradingCards.idleStop();
    await load({ forceRefresh: true });
    return status;
  });
  const stopIdleGame = (appId) => runIdle(() => window.steamAPI?.tradingCards.idleStop(appId));
  const refreshIdle = () => runIdle(() => window.steamAPI?.tradingCards.idleRefresh());

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
        <SummaryCard
          label={t('trading.summaryGamesLeft')}
          value={library.cardDataAvailable ? summary.dropsRemaining : '—'}
          unit={library.cardDataAvailable ? countedUnit(t, locale, summary.dropsRemaining, 'trading.unitGame', 'trading.unitGames') : ''}
          tone="purple"
        />
        <SummaryCard
          label={t('trading.summaryCardsLeft')}
          value={library.cardDataAvailable ? summary.totalRemainingDrops : '—'}
          unit={library.cardDataAvailable ? countedUnit(t, locale, summary.totalRemainingDrops, 'trading.unitCard', 'trading.unitCards') : ''}
          tone="green"
        />
      </div>

      {library.success && library.community?.connected && (
        <section className={`trading-idle-panel ${idle.state}`} aria-label={t('trading.idleTitle')}>
          {idle.state === 'running' ? (
            <>
              <div className="trading-idle-head">
                <div>
                  <p className="trading-monitor-kicker">{t('trading.idleTitle')}</p>
                  <strong>{t('trading.idleRunning', { games: idle.games.length, drops: idle.totalRemainingDrops })}</strong>
                  <span>{t('trading.idleElapsed', { duration: formatDuration(idle.startedAt ? Date.now() - idle.startedAt : 0, t) })}</span>
                </div>
                <div className="trading-idle-actions">
                  <button type="button" className="btn-secondary" disabled={idleBusy} onClick={refreshIdle}>{t('trading.idleRefresh')}</button>
                  <button type="button" className="btn-danger" disabled={idleBusy} onClick={stopIdle}><Square size={14} /> {t('trading.idleStop')}</button>
                </div>
              </div>
              <ul className="trading-idle-list">
                {idle.games.map((game) => (
                  <li key={game.appId}>
                    <span className={`trading-idle-dot ${game.running ? 'on' : 'off'}`} aria-hidden="true" />
                    <strong>{game.name}</strong>
                    <small className={game.error ? 'is-error' : ''}>{game.error ? t('trading.idleGameError') : t('trading.dropsRemainingDetail', { count: game.remainingDrops })}</small>
                    <button type="button" className="trading-idle-game-stop" disabled={idleBusy} onClick={() => stopIdleGame(game.appId)} aria-label={t('trading.idleStopGame', { game: game.name })}><Square size={12} /></button>
                  </li>
                ))}
              </ul>
              <small className="trading-idle-note">{t('trading.idleNote')}</small>
            </>
          ) : (
            <div className="trading-idle-head">
              <div>
                <p className="trading-monitor-kicker">{t('trading.idleTitle')}</p>
                <strong>{idle.state === 'completed' ? t('trading.idleCompleted') : idleCandidates.length ? t('trading.idleReady', { games: idleCandidates.length, drops: idleCandidateDrops }) : t('trading.idleNothing')}</strong>
                <span>{t('trading.idleExplain')}</span>
                {idle.state !== 'completed' && idleCandidates.length > 0 && (
                  <ul className="trading-idle-preview">
                    {idleCandidates.map((game) => (
                      <li key={game.appId}><strong>{game.name}</strong><b>{game.remainingDrops}</b></li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className="btn-primary" disabled={idleBusy || !idleCandidates.length || monitor.state === 'monitoring' || monitor.state === 'paused'} onClick={startIdle}><Play size={15} /> {t('trading.idleStart')}</button>
            </div>
          )}
        </section>
      )}

      {activeMonitorCopy && (
        <div className={`trading-monitor-banner ${activeMonitorCopy.tone}`} role="status">
          <div>
            <p className="trading-monitor-kicker">{t('trading.currentMonitor')}</p>
            <strong>{activeMonitorCopy.title}</strong>
            <span>{t('trading.currentGame', { game: monitor.gameName })} · {t('trading.monitorSession', { duration: formatDuration(monitor.monitorDurationMs, t) })}</span>
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
                  <button key={entry} type="button" className={filter === entry ? 'active' : ''} onClick={() => chooseFilter(entry)}>{t(TRADING_FILTER_KEYS[entry] || 'trading.filterAll')}{filterCounts[entry] !== undefined && <span className="trading-filter-count">{filterCounts[entry]}</span>}</button>
                ))}
              </div>
              <select value={sort} onChange={(event) => chooseSort(event.target.value)} aria-label={t('trading.sort')}>
                <option value="recent">{t('trading.recentlySelected')}</option>
                <option value="drops">{t('trading.dropsRemaining')}</option>
                <option value="alphabetical">{t('trading.alphabetical')}</option>
              </select>
            </div>

            {library.success && (
              library.community?.connected ? (
                <div className="trading-community-panel connected" role="status">
                  <span><strong>{t('trading.communityConnected')}</strong> {t('trading.communityConnectedDetail')}</span>
                  <button type="button" className="btn-secondary" disabled={communityBusy} onClick={communitySignOut}>{t('trading.communitySignOut')}</button>
                </div>
              ) : (
                <div className="trading-community-panel" role="status">
                  <span>
                    <strong>{t('trading.communityTitle')}</strong>{' '}
                    {library.community?.errorCode === 'COMMUNITY_ACCOUNT_MISMATCH' ? t('trading.communityMismatch') : t('trading.communityExplain')}
                  </span>
                  <button type="button" className="btn-primary" disabled={communityBusy} onClick={communitySignIn}>{communityBusy ? t('common.loading') : t('trading.communitySignIn')}</button>
                </div>
              )
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
                      {game.dropStatus === 'remaining' && Number.isInteger(game.remainingDrops) && (
                        <b className="trading-drops-count" aria-label={t('trading.dropsRemainingDetail', { count: game.remainingDrops })}>{game.remainingDrops}<i>{t('trading.cardsShort')}</i></b>
                      )}
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
              const canLaunch = selectedGame.eligibility === 'with-cards' && selectedGame.dropStatus !== 'exhausted';
              const canStart = canLaunch && !selectedIsMonitored && monitor.state === 'inactive';
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
                      <strong>{formatDuration(monitor.monitorDurationMs, t)}</strong>
                      <small>{t('trading.runningUnconfirmed')}</small>
                    </div>
                  )}

                  <div className="trading-action-stack">
                    {canStart && <button className="btn-primary" type="button" disabled={actionBusy} onClick={startMonitor}><Play size={15} /> {t('trading.requestLaunch')}</button>}
                    {selectedIsMonitored && ['monitoring', 'paused'].includes(monitor.state) && <button className="btn-secondary" type="button" disabled={actionBusy} onClick={pauseOrResume}>{monitor.state === 'paused' ? <Play size={15} /> : <Pause size={15} />} {monitor.state === 'paused' ? t('trading.resumeMonitoring') : t('trading.pauseMonitoring')}</button>}
                    {selectedIsMonitored && monitor.state !== 'inactive' && <button className="btn-danger" type="button" disabled={actionBusy} onClick={stopMonitor}><Square size={15} /> {t('trading.stopMonitoring')}</button>}
                    {!canStart && !selectedIsMonitored && canLaunch && monitor.state !== 'inactive' && <div className="trading-limit-note">{t('trading.oneMonitor')}</div>}
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
