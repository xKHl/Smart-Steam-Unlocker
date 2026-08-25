import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Trophy } from 'lucide-react';
import { useI18n } from '../i18n';

/**
 * Header — Custom frameless titlebar.
 *
 * The outer element carries the `drag-region` class so the user can
 * drag the window around by clicking anywhere on the bar except the
 * interactive elements which carry `no-drag`.
 *
 * Window control events flow:
 *   onClick → window.steamAPI.window.* → ipcRenderer.send → ipcMain.on → BrowserWindow API
 */
export default function Header({ steamStatus }) {
  const { t } = useI18n();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Sync initial state
    window.steamAPI?.window.isMaximized().then(setIsMaximized).catch(() => {});

    // Reactively update when the OS maximize/restore state changes
    window.steamAPI?.window.onMaximizeChange((isMax) => {
      setIsMaximized(isMax);
    });
  }, []);

  const handleMinimize = () => window.steamAPI?.window.minimize();
  const handleMaximize = () => window.steamAPI?.window.maximize();
  const handleClose    = () => window.steamAPI?.window.close();

  return (
    <header className="titlebar drag-region">
      {/* ── Left: Branding + Player Badge ─────────────────────────────────── */}
      <div className="titlebar-left no-drag">
        <div className="app-logo" aria-hidden="true">
          <Trophy size={14} color="#fff" />
        </div>

        <span className="app-title">{t('app.name')}</span>

        {steamStatus.connected && steamStatus.playerName && (
          <span className="player-badge" title={t('app.steamId', { id: steamStatus.steamId ?? '—' })}>
            <span className="player-dot" />
            {steamStatus.playerName}
          </span>
        )}
      </div>

      {/* ── Center: Drag area spacer ──────────────────────────────────────── */}
      <div className="titlebar-center" />

      {/* ── Right: Window Controls ────────────────────────────────────────── */}
      <div className="window-controls no-drag" role="group" aria-label={t('app.windowControls')}>
        <button
          id="btn-window-minimize"
          className="wc-btn wc-minimize"
          onClick={handleMinimize}
          title={t('app.minimize')}
          aria-label={t('app.minimize')}
        >
          <Minus size={12} />
        </button>

        <button
          id="btn-window-maximize"
          className="wc-btn wc-maximize"
          onClick={handleMaximize}
          title={isMaximized ? t('app.restore') : t('app.maximize')}
          aria-label={isMaximized ? t('app.restore') : t('app.maximize')}
        >
          <Square size={11} />
        </button>

        <button
          id="btn-window-close"
          className="wc-btn wc-close"
          onClick={handleClose}
          title={t('app.close')}
          aria-label={t('app.close')}
        >
          <X size={12} />
        </button>
      </div>
    </header>
  );
}
