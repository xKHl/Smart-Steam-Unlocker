import React, { useState, useEffect } from 'react';
import { Circle } from 'lucide-react';

/**
 * StatusBar — Slim bottom bar showing live Steam state and app metadata.
 *
 * Displays:
 *  • Left  — Coloured dot + Steam connection message (or player name)
 *  • Right — App version + live clock (HH:MM)
 */
export default function StatusBar({ steamStatus, version }) {
  const [time, setTime] = useState(new Date());

  // Tick the clock every minute
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const connected = steamStatus.connected;
  const dotColor  = connected ? '#4ade80' : '#f87171';
  const textClass = connected ? 'text-green-400' : 'text-red-400';
  const statusMsg = connected
    ? `Steam Connected${steamStatus.playerName ? ` · ${steamStatus.playerName}` : ''}`
    : 'Steam Disconnected — Open Steam and restart';

  return (
    <footer className="status-bar" role="status" aria-live="polite">
      {/* ── Left: Steam Status ────────────────────────────────────────────── */}
      <div className="status-left">
        <Circle size={7} fill={dotColor} color={dotColor} aria-hidden="true" />
        <span className={textClass} style={{ fontSize: '11px' }}>
          {statusMsg}
        </span>
      </div>

      {/* ── Right: Version + Time ─────────────────────────────────────────── */}
      <div className="status-right">
        {version && <span>v{version}</span>}
        {version && <span className="status-divider">·</span>}
        <span>
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </footer>
  );
}
