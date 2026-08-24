import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import {
  analyzeAchievementIntegrity,
  formatIntegrityDate,
  formatIntegrityDuration,
  INTEGRITY_TIERS,
} from '../lib/achievementIntegrity.mjs';
import { useI18n } from '../i18n';

const TIER_ICON = {
  [INTEGRITY_TIERS.NORMAL]: CheckCircle2,
  [INTEGRITY_TIERS.UNUSUAL]: Eye,
  [INTEGRITY_TIERS.HIGH]: TriangleAlert,
  [INTEGRITY_TIERS.EXTREME]: TriangleAlert,
};

function formatPlaytime(minutes, t) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return t('integrity.notReported');
  if (value < 60) return t('integrity.minutes', { count: value });
  return t('integrity.hoursMinutes', { hours: Math.floor(value / 60), minutes: value % 60 });
}

function IntegrityMetric({ label, value, detail }) {
  return (
    <div className="integrity-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function signalPresentation(signal, t) {
  if (signal.id === 'timing-burst') {
    const duration = formatIntegrityDuration(signal.evidence.windowSeconds);
    return { title: t('integrity.signalTimingTitle'), summary: t('integrity.signalTimingSummary', { count: signal.evidence.achievementCount, duration }), duration };
  }
  if (signal.id === 'playtime-achievement-ratio') {
    return { title: t('integrity.signalPlaytimeTitle'), summary: t('integrity.signalPlaytimeSummary', { unlocked: signal.evidence.unlocked, minutes: signal.evidence.playtimeMinutes }) };
  }
  if (signal.id === 'progression-order') {
    return { title: t('integrity.signalProgressionTitle'), summary: t('integrity.signalProgressionSummary', { inverted: signal.evidence.invertedTransitions, transitions: signal.evidence.transitionCount }) };
  }
  return { title: signal.title, summary: signal.summary };
}

function limitationPresentation(limitation, analysis, t) {
  if (limitation.startsWith('Steam did not return achievement definitions')) return t('integrity.limitNoDefinitions');
  if (limitation.startsWith('Steam reported unlocked achievements but did not provide')) return t('integrity.limitNoTimestamps');
  if (limitation.includes('lack a Steam-reported timestamp')) return t('integrity.limitMissingTimestamps', { count: Math.max(0, analysis.summary.unlockedAchievements - analysis.summary.timestampedUnlocks) });
  if (limitation.startsWith('Library playtime was not available')) return t('integrity.limitNoPlaytime');
  if (limitation.startsWith('There are too few timestamped unlocks')) return t('integrity.limitFewTimestamps');
  return limitation;
}

function SignalCard({ signal, t }) {
  const presentation = signalPresentation(signal, t);
  return (
    <article className={`integrity-signal integrity-signal-${signal.severity}`}>
      <div className="integrity-signal-heading">
        <span>{presentation.title}</span>
        <b>+{signal.points}</b>
      </div>
      <p>{presentation.summary}</p>
      {presentation.duration && <small><Timer size={13} /> {t('integrity.observedWindow', { time: presentation.duration })}</small>}
    </article>
  );
}

export default function AchievementIntegrity({ selectedGame }) {
  const { locale, t } = useI18n();
  const [library, setLibrary] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [scannedGame, setScannedGame] = useState(null);

  const loadLibrary = useCallback(async ({ forceRefresh = false } = {}) => {
    setLibraryLoading(true);
    setLibraryError('');
    try {
      const result = await window.steamAPI?.steam.getOwnedGames({ forceRefresh });
      if (!result?.success) {
        throw new Error(result?.detail || result?.errorCode || 'Steam could not provide the owned-games library.');
      }
      const games = Array.isArray(result.games) ? result.games : [];
      setLibrary(games);
      setSelectedAppId((current) => {
        if (current && games.some((game) => Number(game.appId) === Number(current))) return current;
        if (selectedGame?.appId && games.some((game) => Number(game.appId) === Number(selectedGame.appId))) return selectedGame.appId;
        return games[0]?.appId ?? null;
      });
    } catch (error) {
      setLibrary([]);
      setSelectedAppId(null);
      setLibraryError(error?.message || 'Steam library data is unavailable.');
    } finally {
      setLibraryLoading(false);
    }
  }, [selectedGame?.appId]);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  const visibleGames = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const source = query
      ? library.filter((game) => String(game.name || '').toLocaleLowerCase().includes(query))
      : library;
    return [...source].sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  }, [library, search]);

  const game = useMemo(
    () => library.find((entry) => Number(entry.appId) === Number(selectedAppId)) || null,
    [library, selectedAppId],
  );

  const scan = async () => {
    if (!game || scanning) return;
    setScanning(true);
    setScanError('');
    try {
      // Both calls are remote Steam reads. The resulting analysis is performed
      // entirely in this renderer and is never sent to a tracker or third party.
      const [achievementResult, percentageResult] = await Promise.all([
        window.steamAPI?.steam.getAchievementIntegrityData(game.appId),
        window.steamAPI?.steam.getGlobalAchievementPercentages(game.appId),
      ]);
      if (!achievementResult?.success) {
        throw new Error(achievementResult?.error || achievementResult?.errorCode || 'Steam did not return achievement data for this game.');
      }
      const percentageMap = Object.fromEntries(
        (percentageResult?.success && Array.isArray(percentageResult.percentages) ? percentageResult.percentages : [])
          .map((entry) => [entry.name, entry.percent]),
      );
      const achievements = (achievementResult.achievements || []).map((achievement) => (
        percentageMap[achievement.id] === undefined
          ? achievement
          : { ...achievement, globalPercent: percentageMap[achievement.id] }
      ));
      setAnalysis(analyzeAchievementIntegrity({ achievements, game }));
      setScannedGame(game);
    } catch (error) {
      setAnalysis(null);
      setScannedGame(null);
      setScanError(error?.message || 'The Integrity scan could not read Steam achievement evidence.');
    } finally {
      setScanning(false);
    }
  };

  const tierIcon = analysis ? TIER_ICON[analysis.tier] : ShieldCheck;
  const TierIcon = tierIcon;

  return (
    <section className="integrity-page">
      <header className="integrity-page-header">
        <div>
          <p className="eyebrow">{t('integrity.eyebrow')}</p>
          <h1>{t('integrity.title')}</h1>
          <p>{t('integrity.intro')}</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => loadLibrary({ forceRefresh: true })} disabled={libraryLoading}>
          <RefreshCw size={15} className={libraryLoading ? 'spin' : ''} /> {t('integrity.refreshLibrary')}
        </button>
      </header>

      <div className="integrity-privacy-note" role="note">
        <ShieldCheck size={17} />
        <span><strong>{t('integrity.privacyTitle')}</strong> {t('integrity.privacyDetail')}</span>
      </div>

      <ol className="integrity-steps" aria-label={t('integrity.workflow')}>
        <li className="active"><span>1</span><div><strong>{t('integrity.scan')}</strong><small>{t('integrity.scanHelp')}</small></div></li>
        <li className={analysis ? 'active' : ''}><span>2</span><div><strong>{t('integrity.analyze')}</strong><small>{t('integrity.analyzeHelp')}</small></div></li>
        <li className={analysis ? 'active' : ''}><span>3</span><div><strong>{t('integrity.explain')}</strong><small>{t('integrity.explainHelp')}</small></div></li>
      </ol>

      {libraryError && (
        <div className="integrity-empty-state error" role="alert">
          <AlertCircle size={24} /><div><h2>{t('integrity.libraryUnavailable')}</h2><p>{libraryError}</p></div>
        </div>
      )}

      {!libraryError && (
        <div className="integrity-workspace">
          <aside className="integrity-library-pane" aria-label={t('integrity.selectGame')}>
            <div className="integrity-pane-heading">
              <div><p className="eyebrow">1 · {t('integrity.selectStep')}</p><h2>{t('integrity.library')}</h2></div>
              <span>{t('integrity.games', { count: library.length })}</span>
            </div>
            <label className="integrity-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('integrity.search')} aria-label={t('integrity.search')} />
            </label>
            <div className="integrity-game-list" aria-live="polite">
              {libraryLoading && <div className="integrity-list-loading"><Loader2 size={20} className="spin" /> {t('integrity.loading')}</div>}
              {!libraryLoading && visibleGames.map((entry) => (
                <button
                  key={entry.appId}
                  type="button"
                  className={`integrity-game-option ${Number(entry.appId) === Number(selectedAppId) ? 'selected' : ''}`}
                  onClick={() => { setSelectedAppId(entry.appId); setAnalysis(null); setScanError(''); }}
                >
                  {entry.headerImage && <img src={entry.headerImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                  <span><strong title={entry.name}>{entry.name}</strong><small>{t('integrity.reportedPlaytime', { time: formatPlaytime(entry.playtimeMinutes, t) })}</small></span>
                  <ChevronRight size={15} className="directional-chevron" />
                </button>
              ))}
              {!libraryLoading && !visibleGames.length && <div className="integrity-list-loading">{t('integrity.noMatching')}</div>}
            </div>
          </aside>

          <div className="integrity-analysis-pane">
            {!game ? (
              <div className="integrity-empty-state"><Database size={25} /><div><h2>{t('integrity.selectStep')}</h2><p>{t('integrity.startScan')}</p></div></div>
            ) : (
              <>
                <div className="integrity-selected-game">
                  {game.headerImage && <img src={game.headerImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                  <div><p className="eyebrow">{t('integrity.selectedForScan')}</p><h2>{game.name}</h2><span className="technical-value">{t('integrity.appId', { id: game.appId })}</span><span> · {t('integrity.reportedPlaytime', { time: formatPlaytime(game.playtimeMinutes, t) })}</span></div>
                  <button type="button" className="btn-primary" onClick={scan} disabled={scanning}>
                    {scanning ? <Loader2 size={15} className="spin" /> : <Activity size={15} />} {scanning ? t('integrity.scanning') : `${t('integrity.scan')} & ${t('integrity.analyze')}`}
                  </button>
                </div>

                {scanError && <div className="integrity-empty-state error" role="alert"><AlertCircle size={22} /><div><h2>{t('integrity.scanCouldNotComplete')}</h2><p>{scanError}</p></div></div>}

                {!analysis && !scanError && (
                  <div className="integrity-explain-empty">
                    <FileText size={28} />
                    <h2>{t('integrity.readyToScan')}</h2>
                    <p>{t('integrity.scanUses')}</p>
                    <small>{t('integrity.descriptiveOnly')}</small>
                  </div>
                )}

                {analysis && (
                  <div className="integrity-result" aria-live="polite">
                    <div className={`integrity-tier-card ${analysis.tier}`}>
                      <TierIcon size={28} />
                      <div><p className="eyebrow">2 · {t('integrity.localResult')}</p><h2>{t({ [INTEGRITY_TIERS.NORMAL]: 'integrity.normal', [INTEGRITY_TIERS.UNUSUAL]: 'integrity.unusual', [INTEGRITY_TIERS.HIGH]: 'integrity.highAnomaly', [INTEGRITY_TIERS.EXTREME]: 'integrity.extremeAnomaly' }[analysis.tier] || 'integrity.normal')}</h2><p>{t({ [INTEGRITY_TIERS.NORMAL]: 'integrity.tierNormalDescription', [INTEGRITY_TIERS.UNUSUAL]: 'integrity.tierUnusualDescription', [INTEGRITY_TIERS.HIGH]: 'integrity.tierHighDescription', [INTEGRITY_TIERS.EXTREME]: 'integrity.tierExtremeDescription' }[analysis.tier] || 'integrity.tierNormalDescription')}</p></div>
                      <div className="integrity-score"><span>{t('integrity.score')}</span><strong>{analysis.score}<small>/100</small></strong></div>
                    </div>

                    <div className="integrity-metric-grid">
                      <IntegrityMetric label={t('integrity.unlocked')} value={`${analysis.summary.unlockedAchievements}/${analysis.summary.totalAchievements}`} detail={t('integrity.steamReportedStatus')} />
                      <IntegrityMetric label={t('integrity.timedEvidence')} value={analysis.summary.timestampedUnlocks} detail={t('integrity.timestampsAvailable')} />
                      <IntegrityMetric label={t('integrity.libraryPlaytime')} value={formatPlaytime(analysis.summary.playtimeMinutes, t)} detail={t('integrity.ownedGamesData')} />
                      <IntegrityMetric label={t('integrity.signals')} value={analysis.signals.length} detail={analysis.signals.length ? t('integrity.observedPatterns') : t('integrity.noneMaterial')} />
                    </div>

                    <section className="integrity-section" aria-labelledby="integrity-signals-title">
                      <div className="integrity-section-heading"><div><p className="eyebrow">3 · {t('integrity.explain')}</p><h3 id="integrity-signals-title">{t('integrity.observedSignals')}</h3></div><span>{t('integrity.runsOnDevice')}</span></div>
                      {analysis.signals.length ? <div className="integrity-signal-grid">{analysis.signals.map((signal) => <SignalCard key={signal.id} signal={signal} t={t} />)}</div> : <div className="integrity-no-signals"><CheckCircle2 size={18} /> {t('integrity.noMaterialSignal')}</div>}
                    </section>

                    <section className="integrity-section" aria-labelledby="integrity-timeline-title">
                      <div className="integrity-section-heading"><div><p className="eyebrow">{t('integrity.steamEvidence')}</p><h3 id="integrity-timeline-title">{t('integrity.unlockTimeline')}</h3></div><span>{t('integrity.timestampedUnlocks', { count: analysis.timeline.length })}</span></div>
                      {analysis.timeline.length ? <ol className="integrity-timeline">{analysis.timeline.map((entry) => <li key={`${entry.id}-${entry.unlockTime}`}><time>{formatIntegrityDate(entry.unlockTime, locale === 'ar' ? 'ar-SA' : 'en-US')}</time><span className="integrity-timeline-dot" /><div><strong>{entry.name}</strong><small className="technical-value">{entry.id}{entry.globalPercent !== null ? ` · ${t('integrity.global', { percent: entry.globalPercent })}` : ''}{entry.hidden ? ` · ${t('integrity.hidden')}` : ''}</small></div></li>)}</ol> : <div className="integrity-no-signals"><Clock3 size={18} /> {t('integrity.noTimestamp')}</div>}
                    </section>

                    {analysis.limitations.length > 0 && <section className="integrity-limitations"><InfoIcon /><div><strong>{t('integrity.evidenceLimits')}</strong><ul>{analysis.limitations.map((limitation) => <li key={limitation}>{limitationPresentation(limitation, analysis, t)}</li>)}</ul></div></section>}
                    <p className="integrity-scan-footer">{t('integrity.scanFooter', { game: scannedGame?.name || '' })}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function InfoIcon() {
  return <Eye size={18} aria-hidden="true" />;
}
