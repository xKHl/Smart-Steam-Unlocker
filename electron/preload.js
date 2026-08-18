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
      ipcRenderer.removeAllListeners('steam:achievement-unlocked');
      ipcRenderer.on('steam:achievement-unlocked', (_e, achievementId) => cb(achievementId));
    },
  },

  // ─── Humanized Scheduler (mock execution adapter) ─────────────────────────
  humanized: {
    getStatus: () => ipcRenderer.invoke('humanized:get-status'),
    orderAchievements: (achievements, orderMode) => ipcRenderer.invoke('humanized:order-achievements', { achievements, orderMode }),
    create: (payload) => ipcRenderer.invoke('humanized:create', payload),
    replace: (payload) => ipcRenderer.invoke('humanized:replace', payload),
    start: () => ipcRenderer.invoke('humanized:start'),
    pause: () => ipcRenderer.invoke('humanized:pause'),
    clear: () => ipcRenderer.invoke('humanized:clear'),
    onUpdate: (cb) => {
      ipcRenderer.removeAllListeners('humanized:update');
      ipcRenderer.on('humanized:update', (_e, status) => cb(status));
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
      // Remove any previous listener to avoid duplicates if re-rendered
      ipcRenderer.removeAllListeners('timer:update');
      ipcRenderer.on('timer:update', (_e, status) => cb(status));
    },
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get:    (key)        => ipcRenderer.invoke('settings:get',    key),
    set:    (key, value) => ipcRenderer.invoke('settings:set',    key, value),
    delete: (key)        => ipcRenderer.invoke('settings:delete', key),
  },

  // ─── App ───────────────────────────────────────────────────────────────────
  app: {
    getVersion:     () => ipcRenderer.invoke('app:get-version'),
    onInitialState: (cb) => ipcRenderer.once('app:initial-state', (_e, s) => cb(s)),
  },
});
