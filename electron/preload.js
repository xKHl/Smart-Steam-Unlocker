const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload Script — Context Bridge
 *
 * Exposes a typed, sandboxed window.steamAPI to the React renderer.
 */
contextBridge.exposeInMainWorld('steamAPI', {

  // ─── Window Controls ───────────────────────────────────────────────────────
  window: {
    minimize:         () => ipcRenderer.send('window:minimize'),
    maximize:         () => ipcRenderer.send('window:maximize'),
    close:            () => ipcRenderer.send('window:close'),
    isMaximized:      () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (cb) => ipcRenderer.on('window:maximize-changed', (_e, v) => cb(v)),
  },

  // ─── Steam API ─────────────────────────────────────────────────────────────
  steam: {
    getStatus: () =>
      ipcRenderer.invoke('steam:get-status'),

    reconnect: () =>
      ipcRenderer.invoke('steam:reconnect'),

    /**
     * Full owned library via Steam Web API.
     * Requires a Steam API key saved in settings.
     * @param {{ forceRefresh?: boolean }} opts
     */
    getOwnedGames: (opts = {}) =>
      ipcRenderer.invoke('steam:get-owned-games', opts),

    switchGame: (appId, name, headerImage) =>
      ipcRenderer.invoke('steam:switch-game', { appId, name, headerImage }),

    getAchievements: (appId) =>
      ipcRenderer.invoke('steam:get-achievements', appId),

    getGlobalAchievementPercentages: (appId) =>
      ipcRenderer.invoke('steam:get-global-achievement-percentages', appId),

    unlockAchievement: (appId, achievementId) =>
      ipcRenderer.invoke('steam:unlock-achievement', { appId, achievementId }),

    onAchievementUnlocked: (cb) => {
      const listener = (_e, achievementId) => cb(achievementId);
      ipcRenderer.on('steam:achievement-unlocked', listener);
      return () => ipcRenderer.removeListener('steam:achievement-unlocked', listener);
    },
  },

  // ─── Humanized Scheduler ─────────────────────────────────────────────────
  humanized: {
    getStatus: () => ipcRenderer.invoke('humanized:get-status'),
    orderAchievements: (achievements, orderMode, appId) => ipcRenderer.invoke('humanized:order-achievements', { achievements, orderMode, ...(appId !== undefined ? { appId } : {}) }),
    create: (payload) => ipcRenderer.invoke('humanized:create', payload),
    replace: (payload) => ipcRenderer.invoke('humanized:replace', payload),
    start: () => ipcRenderer.invoke('humanized:start'),
    pause: () => ipcRenderer.invoke('humanized:pause'),
    recheckNow: () => ipcRenderer.invoke('humanized:recheck-now'),
    clear: () => ipcRenderer.invoke('humanized:clear'),
    onUpdate: (cb) => {
      const listener = (_e, status) => cb(status);
      ipcRenderer.on('humanized:update', listener);
      return () => ipcRenderer.removeListener('humanized:update', listener);
    },
  },

  // ─── Trading Cards ─────────────────────────────────────────────────────────
  tradingCards: {
    getLibrary: (opts = {}) => ipcRenderer.invoke('trading-cards:get-library', opts),
    getStatus: () => ipcRenderer.invoke('trading-cards:get-status'),
    start: (appId) => ipcRenderer.invoke('trading-cards:start', appId),
    pause: () => ipcRenderer.invoke('trading-cards:pause'),
    resume: () => ipcRenderer.invoke('trading-cards:resume'),
    stop: () => ipcRenderer.invoke('trading-cards:stop'),
    onUpdate: (cb) => {
      const listener = (_e, status) => cb(status);
      ipcRenderer.on('trading-cards:update', listener);
      return () => ipcRenderer.removeListener('trading-cards:update', listener);
    },
  },

  // ─── Timer Service ─────────────────────────────────────────────────────────
  timer: {
    startQueue: (achievements, base, variance, fixedMins) =>
      ipcRenderer.invoke('timer:start-queue', { achievements, base, variance, fixedMins }),
    stopQueue:  () => ipcRenderer.invoke('timer:stop-queue'),
    clearQueue: () => ipcRenderer.invoke('timer:clear-queue'),
    getStatus:  () => ipcRenderer.invoke('timer:get-status'),
    onUpdate:   (cb) => {
      const listener = (_e, status) => cb(status);
      ipcRenderer.on('timer:update', listener);
      return () => ipcRenderer.removeListener('timer:update', listener);
    },
  },

  // ─── Credentials ───────────────────────────────────────────────────────────
  // Status is intentionally non-sensitive. No preload method can retrieve the
  // stored plaintext Steam Web API key after it has been saved.
  credentials: {
    getStatus: () => ipcRenderer.invoke('credentials:get-status'),
    saveSteamApiKey: (value) => ipcRenderer.invoke('credentials:save-steam-api-key', value),
    clearSteamApiKey: () => ipcRenderer.invoke('credentials:clear-steam-api-key'),
  },

  // ─── App ───────────────────────────────────────────────────────────────────
  app: {
    getVersion:     () => ipcRenderer.invoke('app:get-version'),
    getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
    getDiagnosticsStatus: () => ipcRenderer.invoke('app:get-diagnostics-status'),
    traceInteraction: (payload) => ipcRenderer.invoke('app:trace-interaction', payload),
    openExternal:   (url) => ipcRenderer.invoke('app:open-external', url),
    onInitialState: (cb) => {
      const listener = (_e, state) => cb(state);
      ipcRenderer.once('app:initial-state', listener);
      return () => ipcRenderer.removeListener('app:initial-state', listener);
    },
  },
});
