import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Library, Trophy, Settings, Zap } from 'lucide-react';

const NAV_LINKS = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard',    id: 'nav-dashboard',    end: true  },
  { to: '/library',      icon: Library,         label: 'Library',      id: 'nav-library',      end: false },
  { to: '/achievements', icon: Trophy,          label: 'Achievements', id: 'nav-achievements', end: false },
  { to: '/settings',     icon: Settings,        label: 'Settings',     id: 'nav-settings',     end: false },
];

export default function Sidebar({ steamStatus, selectedGame }) {
  return (
    <aside className="sidebar">

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="sidebar-logo">
        <div className="logo-icon" aria-hidden="true">
          <Zap size={18} color="#fff" />
        </div>
        <div>
          <p className="logo-title">Smart Unlocker</p>
          <p className="logo-subtitle">v0.1.0 · Alpha</p>
        </div>
      </div>

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

      {/* ── Active Game ───────────────────────────────────────────────────── */}
      {selectedGame && (
        <div className="sidebar-active-game">
          <p className="nav-section-label" style={{ paddingBottom: 8 }}>Active Game</p>
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

      <div style={{ flex: 1 }} />

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
