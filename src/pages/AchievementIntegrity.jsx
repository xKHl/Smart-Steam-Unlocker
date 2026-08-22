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

const TIER_ICON = {
  [INTEGRITY_TIERS.NORMAL]: CheckCircle2,
  [INTEGRITY_TIERS.UNUSUAL]: Eye,
  [INTEGRITY_TIERS.HIGH]: TriangleAlert,
  [INTEGRITY_TIERS.EXTREME]: TriangleAlert,
};

function formatPlaytime(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return 'Not reported';
  if (value < 60) return `${value} min`;
  return `${Math.floor(value / 60)}h ${value % 60}m`;
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

function SignalCard({ signal }) {
  const window = signal.id === 'timing-burst'
    ? formatIntegrityDuration(signal.evidence.windowSeconds)
    : null;
  return (
    <article className={`integrity-signal integrity-signal-${signal.severity}`}>
      <div className="integrity-signal-heading">
        <span>{signal.title}</span>
        <b>+{signal.points}</b>
      </div>
      <p>{signal.summary}</p>
      {window && <small><Timer size={13} /> Observed window: {window}</small>}
    </article>
  );
}

export default function AchievementIntegrity({ selectedGame }) {
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
          <p className="eyebrow">READ-ONLY STEAM EVIDENCE</p>
          <h1>Achievement Integrity</h1>
          <p>Scan Steam-reported achievement data, analyze observed patterns locally, and inspect the evidence without tracker login, submissions, or account changes.</p>
        </div>
        <button className="btn-secondary" type="button" onClick={() => loadLibrary({ forceRefresh: true })} disabled={libraryLoading}>
          <RefreshCw size={15} className={libraryLoading ? 'spin' : ''} /> Refresh library
        </button>
      </header>

      <div className="integrity-privacy-note" role="note">
        <ShieldCheck size={17} />
        <span><strong>Local-first and privacy-first.</strong> This feature only reads your Steam Web API data. It does not unlock, modify, submit, or publish achievements.</span>
      </div>

      <ol className="integrity-steps" aria-label="Integrity analysis workflow">
        <li className="active"><span>1</span><div><strong>Scan</strong><small>Select a library game and fetch Steam evidence.</small></div></li>
        <li className={analysis ? 'active' : ''}><span>2</span><div><strong>Analyze</strong><small>Evaluate timing, playtime, and progression signals locally.</small></div></li>
        <li className={analysis ? 'active' : ''}><span>3</span><div><strong>Explain</strong><small>Review the score, signals, limitations, and timeline.</small></div></li>
      </ol>

      {libraryError && (
        <div className="integrity-empty-state error" role="alert">
          <AlertCircle size={24} /><div><h2>Library data is unavailable</h2><p>{libraryError}</p></div>
        </div>
      )}

      {!libraryError && (
        <div className="integrity-workspace">
          <aside className="integrity-library-pane" aria-label="Select a game for integrity analysis">
            <div className="integrity-pane-heading">
              <div><p className="eyebrow">1 · SELECT A GAME</p><h2>Library</h2></div>
              <span>{library.length} games</span>
            </div>
            <label className="integrity-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search library…" />
            </label>
            <div className="integrity-game-list" aria-live="polite">
              {libraryLoading && <div className="integrity-list-loading"><Loader2 size={20} className="spin" /> Loading Steam library…</div>}
              {!libraryLoading && visibleGames.map((entry) => (
                <button
                  key={entry.appId}
                  type="button"
                  className={`integrity-game-option ${Number(entry.appId) === Number(selectedAppId) ? 'selected' : ''}`}
                  onClick={() => { setSelectedAppId(entry.appId); setAnalysis(null); setScanError(''); }}
                >
                  {entry.headerImage && <img src={entry.headerImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                  <span><strong title={entry.name}>{entry.name}</strong><small>{formatPlaytime(entry.playtimeMinutes)} reported playtime</small></span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {!libraryLoading && !visibleGames.length && <div className="integrity-list-loading">No library games match this search.</div>}
            </div>
          </aside>

          <div className="integrity-analysis-pane">
            {!game ? (
              <div className="integrity-empty-state"><Database size={25} /><div><h2>Select a game</h2><p>Choose a game from the owned library to start a read-only Steam evidence scan.</p></div></div>
            ) : (
              <>
                <div className="integrity-selected-game">
                  {game.headerImage && <img src={game.headerImage} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                  <div><p className="eyebrow">SELECTED FOR SCAN</p><h2>{game.name}</h2><span>AppID {game.appId} · {formatPlaytime(game.playtimeMinutes)} reported library playtime</span></div>
                  <button type="button" className="btn-primary" onClick={scan} disabled={scanning}>
                    {scanning ? <Loader2 size={15} className="spin" /> : <Activity size={15} />} {scanning ? 'Scanning Steam evidence…' : 'Scan & Analyze'}
                  </button>
                </div>

                {scanError && <div className="integrity-empty-state error" role="alert"><AlertCircle size={22} /><div><h2>Scan could not complete</h2><p>{scanError}</p></div></div>}

                {!analysis && !scanError && (
                  <div className="integrity-explain-empty">
                    <FileText size={28} />
                    <h2>Ready to scan</h2>
                    <p>Scan uses the selected game's Steam achievement definitions, unlock states, Steam-provided unlock timestamps, and owned-library playtime where available.</p>
                    <small>Results are descriptive signals, not a determination of intent or legitimacy.</small>
                  </div>
                )}

                {analysis && (
                  <div className="integrity-result" aria-live="polite">
                    <div className={`integrity-tier-card ${analysis.tier}`}>
                      <TierIcon size={28} />
                      <div><p className="eyebrow">2 · LOCAL ANALYSIS RESULT</p><h2>{analysis.tierCopy.label}</h2><p>{analysis.tierCopy.description}</p></div>
                      <div className="integrity-score"><span>Signal score</span><strong>{analysis.score}<small>/100</small></strong></div>
                    </div>

                    <div className="integrity-metric-grid">
                      <IntegrityMetric label="Unlocked" value={`${analysis.summary.unlockedAchievements}/${analysis.summary.totalAchievements}`} detail="Steam-reported status" />
                      <IntegrityMetric label="Timed evidence" value={analysis.summary.timestampedUnlocks} detail="Steam timestamps available" />
                      <IntegrityMetric label="Library playtime" value={formatPlaytime(analysis.summary.playtimeMinutes)} detail="Owned-games data" />
                      <IntegrityMetric label="Signals" value={analysis.signals.length} detail={analysis.signals.length ? 'Observed patterns' : 'None material observed'} />
                    </div>

                    <section className="integrity-section" aria-labelledby="integrity-signals-title">
                      <div className="integrity-section-heading"><div><p className="eyebrow">3 · EXPLAIN</p><h3 id="integrity-signals-title">Observed signals</h3></div><span>Analysis runs on this device</span></div>
                      {analysis.signals.length ? <div className="integrity-signal-grid">{analysis.signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}</div> : <div className="integrity-no-signals"><CheckCircle2 size={18} /> No material anomaly signal was found in the evidence available to this scan.</div>}
                    </section>

                    <section className="integrity-section" aria-labelledby="integrity-timeline-title">
                      <div className="integrity-section-heading"><div><p className="eyebrow">STEAM-REPORTED EVIDENCE</p><h3 id="integrity-timeline-title">Unlock timeline</h3></div><span>{analysis.timeline.length} timestamped unlocks</span></div>
                      {analysis.timeline.length ? <ol className="integrity-timeline">{analysis.timeline.map((entry) => <li key={`${entry.id}-${entry.unlockTime}`}><time>{formatIntegrityDate(entry.unlockTime)}</time><span className="integrity-timeline-dot" /><div><strong>{entry.name}</strong><small>{entry.id}{entry.globalPercent !== null ? ` · ${entry.globalPercent}% global` : ''}{entry.hidden ? ' · Hidden' : ''}</small></div></li>)}</ol> : <div className="integrity-no-signals"><Clock3 size={18} /> Steam did not provide a usable unlock timestamp for this selected game.</div>}
                    </section>

                    {analysis.limitations.length > 0 && <section className="integrity-limitations"><InfoIcon /><div><strong>Evidence limits</strong><ul>{analysis.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div></section>}
                    <p className="integrity-scan-footer">Scanned locally for <strong>{scannedGame?.name}</strong>. No tracker account, score submission, or Steam write operation was used.</p>
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
