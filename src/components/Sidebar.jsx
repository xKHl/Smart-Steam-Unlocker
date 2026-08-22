import React from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, CreditCard, Github, Globe2, LayoutDashboard, Library, Trophy, Settings, Zap } from 'lucide-react';

const NAV_LINKS = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard',    id: 'nav-dashboard',    end: true  },
  { to: '/library',      icon: Library,         label: 'Library',      id: 'nav-library',      end: false },
  { to: '/achievements', icon: Trophy,          label: 'Achievements', id: 'nav-achievements', end: false },
  { to: '/trading-cards', icon: CreditCard,      label: 'Trading Cards', id: 'nav-trading-cards', end: false },
  { to: '/integrity',    icon: Activity,        label: 'Integrity',    id: 'nav-integrity',     end: false },
  { to: '/settings',     icon: Settings,        label: 'Settings',     id: 'nav-settings',     end: false },
];

export default function Sidebar({ steamStatus, selectedGame, version }) {
  const openExternal = (url) => {
    window.steamAPI?.app?.openExternal(url).catch(() => {});
  };

  return (
    <aside className="sidebar">

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="sidebar-logo">
        <div className="logo-icon" aria-hidden="true">
          <Zap size={18} color="#fff" />
        </div>
        <div>
          <p className="logo-title">Smart Steam Unlocker</p>
          <p className="logo-subtitle">v{version || '…'}</p>
        </div>
      </div>

      <div className="sidebar-navigation-region">
        {/* ── Navigation ───────────────────────────────────────────────────── */}
        <nav className="sidebar-nav" aria-label="Main navigation">
          <p className="nav-section-label">Navigation</p>
          {NAV_LINKS.map(({ to, icon: Icon, label, id, end }) => (
            <NavLink
              key={id}
              to={to}
              end={end}
              id={id}
              className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* ── Selected Game ───────────────────────────────────────────────── */}
        {selectedGame && (
          <div className="sidebar-active-game">
            <p className="nav-section-label" style={{ paddingBottom: 8 }}>Selected Game</p>
            <div className="active-game-card">
              <img
                src={selectedGame.headerImage}
                alt={selectedGame.name}
                className="active-game-image"
                onError={(e) => (e.target.style.display = 'none')}
              />
              <p className="active-game-name" title={selectedGame.name}>{selectedGame.name}</p>
              <p className="active-game-appid">AppID {selectedGame.appId}</p>
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-spacer" aria-hidden="true" />

      <div className="sidebar-credit" aria-label="Project ownership and author links">
        <div className="sidebar-credit-heading">
          <span className="sidebar-credit-monogram" aria-hidden="true">KA</span>
          <div>
            <p className="sidebar-credit-name">Khalid Alotaibi</p>
            <p className="sidebar-credit-role">Creator · Smart Steam Unlocker</p>
          </div>
        </div>
        <div className="sidebar-credit-links">
          <button type="button" onClick={() => openExternal('https://github.com/xKHl')} aria-label="Open Khalid Alotaibi's GitHub profile in your browser"><Github size={12} /> GitHub</button>
          <button type="button" onClick={() => openExternal('https://alotaibi.dev')} aria-label="Open Khalid Alotaibi website in your browser"><Globe2 size={12} /> Website</button>
        </div>
        <p className="sidebar-credit-copyright">© 2026 Khalid Alotaibi</p>
      </div>

      {/* ── Steam Status Footer ───────────────────────────────────────────── */}
      <div className="sidebar-footer">
        <div
          className={`steam-status-card ${steamStatus.connected ? 'connected' : 'disconnected'}`}
          role="status"
          aria-label={steamStatus.connected ? 'Steam connected' : 'Steam disconnected'}
        >
          <div className="steam-status-dot" />
          <div style={{ minWidth: 0 }}>
            <p className="steam-status-label">
              {steamStatus.connected ? 'Steam Connected' : 'Steam Offline'}
            </p>
            {steamStatus.playerName && (
              <p className="steam-username" title={steamStatus.playerName}>
                {steamStatus.playerName}
              </p>
            )}
          </div>
        </div>
      </div>

    </aside>
  );
}
