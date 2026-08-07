import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, Gamepad2, Target, TrendingUp, ChevronRight, Sparkles, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';

/**
 * Placeholder stat cards — all values are dashes until Phase 2 connects
 * real game & achievement data from steamManager.getAchievements().
 */
const STAT_CARDS = [
  {
    id:    'stat-games',
    icon:  Gamepad2,
    label: 'Games Tracked',
    value: '—',
    sub:   'Connect Steam to start',
    color: 'purple',
  },
  {
    id:    'stat-unlocked',
    icon:  Trophy,
    label: 'Achievements Unlocked',
    value: '—',
    sub:   'No unlocks yet',
    color: 'blue',
  },
  {
    id:    'stat-rate',
    icon:  Target,
    label: 'Completion Rate',
    value: '—',
    sub:   'Across all games',
    color: 'indigo',
  },
  {
    id:    'stat-activity',
    icon:  TrendingUp,
    label: 'Last Activity',
    value: '—',
    sub:   'Never',
    color: 'violet',
  },
];

const STEPS = [
  {
    step:  '01',
    title: 'Open Steam',
    desc:  'Ensure the Steam client is running on this machine before launching Smart Steam Unlocker.',
  },
  {
    step:  '02',
    title: 'Browse Your Games',
    desc:  'Head to the Achievements page and select a game to view its achievement list.',
  },
  {
    step:  '03',
    title: 'Unlock with Smart Delay',
    desc:  'Select an achievement and use the Smart Delay Timer to unlock it with a human-like interval.',
  },
];

/**
 * Dashboard — Main landing page.
 *
 * Sections:
 *  • Hero card with greeting + CTA
 *  • Steam disconnected warning (conditional) with reconnect button
 *  • Stats overview grid (placeholder)
 *  • Getting-started guide
 */
export default function Dashboard({ steamStatus, onSteamReconnect }) {
  const navigate = useNavigate();
  const [isReconnecting, setIsReconnecting] = useState(false);

  const greeting = steamStatus.connected && steamStatus.playerName
    ? `Welcome back, ${steamStatus.playerName}`
    : 'Smart Steam Unlocker';

  const subline = steamStatus.connected
    ? 'Your Steam client is connected and ready to go.'
    : 'Connect to Steam to start managing your achievements.';

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await onSteamReconnect();
    } finally {
      setIsReconnecting(false);
    }
  };

  return (
    <div className="page-container animate-fade-in">

      {/* ── Hero Card ─────────────────────────────────────────────────────── */}
      <div className="hero-card">
        <div className="hero-glow" aria-hidden="true" />

        <div className="hero-content">
          <div className="hero-icon-wrap" aria-hidden="true">
            <Trophy size={30} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="hero-title">{greeting}</h1>
            <p className="hero-sub">{subline}</p>
          </div>
        </div>

        <button
          id="btn-browse-achievements"
          className="hero-cta"
          onClick={() => navigate('/achievements')}
          aria-label="Browse achievements"
        >
          Browse Achievements
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>

      {/* ── Steam Disconnected Warning ─────────────────────────────────────── */}
      {!steamStatus.connected && (
        <div className="alert-card" role="alert">
          <AlertCircle size={18} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <p className="alert-title">Steam is not connected</p>
            <p className="alert-sub">
              Make sure the Steam client is running on this machine, then click
              the button to establish the Steamworks connection.
            </p>
          </div>
          <button
            className="btn-secondary"
            onClick={handleReconnect}
            disabled={isReconnecting}
            style={{ marginLeft: 'auto', flexShrink: 0 }}
          >
            {isReconnecting ? (
              <><Loader2 size={13} className="animate-spin" /> Connecting…</>
            ) : (
              <><RefreshCw size={13} /> Connect to Steam</>
            )}
          </button>
        </div>
      )}

      {/* ── Stats Overview ────────────────────────────────────────────────── */}
      <section aria-labelledby="section-overview">
        <h2 id="section-overview" className="section-title">
          <Sparkles size={13} aria-hidden="true" />
          Overview
        </h2>

        <div className="stats-grid">
          {STAT_CARDS.map(({ id, icon: Icon, label, value, sub, color }) => (
            <div key={id} id={id} className="stat-card">
              <div className={`stat-icon stat-icon--${color}`} aria-hidden="true">
                <Icon size={19} />
              </div>
              <div>
                <p className="stat-value" aria-label={`${label}: ${value}`}>{value}</p>
                <p className="stat-label">{label}</p>
                <p className="stat-sub">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Getting Started ───────────────────────────────────────────────── */}
      <section aria-labelledby="section-getting-started">
        <h2 id="section-getting-started" className="section-title">
          Getting Started
        </h2>

        <div className="getting-started-card">
          {STEPS.map(({ step, title, desc }) => (
            <div key={step} className="step-item">
              <span className="step-number" aria-label={`Step ${step}`}>{step}</span>
              <div>
                <p className="step-title">{title}</p>
                <p className="step-desc">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
