import React, { useState } from 'react';
import { Gamepad2, Trophy, Clock } from 'lucide-react';

function formatPlaytime(minutes) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes}m`;
  return `${parseInt((minutes / 60).toFixed(0)).toLocaleString()}h`;
}

/**
 * GameCard — A single game tile in the Library grid.
 *
 * • Displays the Steam CDN header image (460×215) with shimmer loading
 * • Falls back to a generic icon if the CDN image is missing
 * • Hover overlay shows "Browse Achievements" CTA
 * • Shows playtime badge and explicitly selected-game indicator
 *
 * Uses a native <button> element to guarantee reliable click handling in
 * Electron's Chromium renderer across all window and focus states.
 */
export default function GameCard({ game, onClick, isSelected }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError,  setImgError]  = useState(false);

  const playtime = formatPlaytime(game.playtimeMinutes);

  return (
    <button
      type="button"
      className={`game-card${isSelected ? ' game-card-selected' : ''}`}
      onClick={onClick}
      id={`game-card-${game.appId}`}
      aria-label={`Browse achievements for ${game.name}`}
      aria-pressed={isSelected}
    >
      {/* ── Image ───────────────────────────────────────────────────────── */}
      <div className="game-card-image-wrap">

        {/* Shimmer skeleton while image fetches */}
        {!imgLoaded && !imgError && <div className="game-card-skeleton" aria-hidden="true" />}

        {!imgError ? (
          <img
            src={game.headerImage}
            alt={game.name}
            className="game-card-image"
            style={{ opacity: imgLoaded ? 1 : 0 }}
            onLoad={() => setImgLoaded(true)}
            onError={() => { setImgError(true); setImgLoaded(true); }}
            draggable={false}
          />
        ) : (
          <div className="game-card-fallback" aria-hidden="true">
            <Gamepad2 size={30} color="#334155" />
          </div>
        )}

        {/* Hover CTA overlay */}
        <div className="game-card-overlay" aria-hidden="true">
          <div className="game-card-overlay-btn">
            <Trophy size={14} />
            <span>Browse Achievements</span>
          </div>
        </div>

        {/* Playtime badge — top-left */}
        {playtime && (
          <div className="game-card-playtime" aria-label={`${playtime} played`}>
            <Clock size={10} />
            {playtime}
          </div>
        )}

        {/* Selected-game badge — top-right */}
        {isSelected && (
          <div className="game-card-selected-badge" aria-label="Selected game">
            Selected
          </div>
        )}
      </div>

      {/* ── Info ────────────────────────────────────────────────────────── */}
      <div className="game-card-info">
        <p className="game-card-name" title={game.name}>{game.name}</p>
        <p className="game-card-appid">AppID {game.appId}</p>
      </div>
    </button>
  );
}
