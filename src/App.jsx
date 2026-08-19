import React, { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Header       from './components/Header';
import Sidebar      from './components/Sidebar';
import StatusBar    from './components/StatusBar';
import Dashboard    from './pages/Dashboard';
import Library      from './pages/Library';
import Achievements from './pages/Achievements';
import Settings     from './pages/Settings';

// ─────────────────────────────────────────────────────────────────────────────
// Switching Overlay — shown for ~700ms during app.relaunch() cycle
// ─────────────────────────────────────────────────────────────────────────────

function SwitchingOverlay({ game }) {
  return (
    <div className="switching-overlay" role="status" aria-live="assertive">
      <div className="switching-card">
        {game?.headerImage && (
          <img
            src={game.headerImage}
            alt={game.name}
            className="switching-game-image"
            onError={(e) => (e.target.style.display = 'none')}
          />
        )}
        <div className="switching-spinner" aria-hidden="true" />
        <p className="switching-title">Switching to {game?.name ?? 'selected game'}…</p>
        <p className="switching-sub">Restarting Steam context. This only takes a moment.</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AppContent — must live inside <Router> to access useNavigate
// ─────────────────────────────────────────────────────────────────────────────

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const diagnosticsEnabled = useRef(false);

  const [steamStatus,  setSteamStatus]  = useState({ connected: false, playerName: null, steamId: null });
  const [selectedGame, setSelectedGame] = useState(null);
  const [isSwitching,  setIsSwitching]  = useState(false);
  const [appVersion,   setAppVersion]   = useState('');

  // ── Opt-in interaction diagnostics ─────────────────────────────────────
  useEffect(() => {
    let active = true;
    window.steamAPI?.app.getDiagnosticsStatus().then((status) => {
      if (!active || !status?.enabled) return;
      diagnosticsEnabled.current = true;
      window.steamAPI?.app.traceInteraction({ eventType: 'renderer-ready', route: location.pathname, trusted: true }).catch(() => {});
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!diagnosticsEnabled.current) return;
    window.steamAPI?.app.traceInteraction({ eventType: 'route-change', route: location.pathname, trusted: true }).catch(() => {});
  }, [location.pathname]);

  useEffect(() => {
    const captureInteraction = (event) => {
      if (!diagnosticsEnabled.current) return;
      const target = event.target instanceof Element
        ? (event.target.closest('a,button,input,select,textarea,[role="button"]') || event.target)
        : null;
      window.steamAPI?.app.traceInteraction({
        eventType: event.type,
        route: location.pathname,
        targetId: target?.id || null,
        targetTag: target?.tagName || null,
        targetClass: typeof target?.className === 'string' ? target.className : null,
        trusted: event.isTrusted,
      }).catch(() => {});
    };
    document.addEventListener('pointerdown', captureInteraction, true);
    document.addEventListener('click', captureInteraction, true);
    return () => {
      document.removeEventListener('pointerdown', captureInteraction, true);
      document.removeEventListener('click', captureInteraction, true);
    };
  }, [location.pathname]);

  // ── Steam Status Polling ────────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    try {
      const status = await window.steamAPI?.steam.getStatus();
      if (status) setSteamStatus(status);
    } catch {
      setSteamStatus({ connected: false, playerName: null, steamId: null });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 15_000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  // ── App Version ──────────────────────────────────────────────────────────
  useEffect(() => {
    window.steamAPI?.app.getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // ── Restore State After Game-Switch Relaunch ────────────────────────────
  useEffect(() => {
    let active = true;
    const applyInitialState = (state) => {
      if (active && state?.selectedGame) {
        setSelectedGame(state.selectedGame);
        navigate('/achievements', { replace: true });
      }
    };
    window.steamAPI?.app.getInitialState().then(applyInitialState).catch(() => {});
    const unsubscribe = window.steamAPI?.app.onInitialState(applyInitialState);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [navigate]);

  // ── Game Selection Handler ───────────────────────────────────────────────
  const handleGameSelect = useCallback(async (game) => {
    setIsSwitching(true);
    try {
      const result = await window.steamAPI?.steam.switchGame(game.appId, game.name, game.headerImage);
      if (!result?.success) throw new Error('Steam could not prepare the selected game context.');
      setSelectedGame(game);
      navigate('/achievements');
    } catch (err) {
      console.error('[App] switchGame failed:', err);
      // Keep the authoritative previously selected game visible when the main
      // process rejects a conflicting schedule or runtime-context switch.
    } finally {
      setIsSwitching(false);
    }
  }, [navigate]);

  // ── Manual Reconnect Handler ────────────────────────────────────────────
  const handleSteamReconnect = useCallback(async () => {
    try {
      const status = await window.steamAPI?.steam.reconnect();
      if (status) setSteamStatus(status);
    } catch (err) {
      console.error('[App] Steam reconnect failed:', err);
    }
  }, []);

  return (
    <>
      {isSwitching && <SwitchingOverlay game={selectedGame} />}

      <div className="app-shell" style={{ opacity: isSwitching ? 0.4 : 1, transition: 'opacity 300ms' }}>
        <Header steamStatus={steamStatus} />

        <div className="app-body">
          <Sidebar steamStatus={steamStatus} selectedGame={selectedGame} version={appVersion} />

          <main className="main-content">
            <Routes>
              <Route path="/"             element={<Dashboard    steamStatus={steamStatus} selectedGame={selectedGame} onSteamReconnect={handleSteamReconnect} />} />
              <Route path="/library"      element={<Library      selectedGame={selectedGame} onGameSelect={handleGameSelect} />} />
              <Route path="/achievements" element={<Achievements selectedGame={selectedGame} onChangeGame={() => navigate('/library')} />} />
              <Route path="/settings"     element={<Settings />} />
            </Routes>
          </main>
        </div>

        <StatusBar steamStatus={steamStatus} version={appVersion} />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App — Root with Router wrapper
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
