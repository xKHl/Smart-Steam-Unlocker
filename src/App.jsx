import React, { useState, useEffect, useCallback } from 'react';
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
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

  const [steamStatus,  setSteamStatus]  = useState({ connected: false, playerName: null, steamId: null });
  const [selectedGame, setSelectedGame] = useState(null);
  const [isSwitching,  setIsSwitching]  = useState(false);
  const [appVersion,   setAppVersion]   = useState('');

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
    window.steamAPI?.app.onInitialState((state) => {
      if (state?.selectedGame) {
        setSelectedGame(state.selectedGame);
        navigate('/achievements', { replace: true });
      }
    });
  }, [navigate]);

  // ── Game Selection Handler ───────────────────────────────────────────────
  const handleGameSelect = useCallback(async (game) => {
    setSelectedGame(game);
    setIsSwitching(true);
    try {
      await window.steamAPI?.steam.switchGame(game.appId, game.name, game.headerImage);
      // Context swapped, navigate directly
      setIsSwitching(false);
      navigate('/achievements');
    } catch (err) {
      console.error('[App] switchGame failed:', err);
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
