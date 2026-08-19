const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc/handlers');
const { initSteam, shutdown } = require('./steamManager');
const settingsStore = require('./settingsStore');
const runtimeDiagnostics = require('./runtimeDiagnostics');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (hasSingleInstanceLock) {
  runtimeDiagnostics.trace('main', 'single-instance-acquired');
  app.on('second-instance', () => {
    runtimeDiagnostics.trace('main', 'second-instance');
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
} else {
  runtimeDiagnostics.trace('main', 'single-instance-denied');
  // A primary process already owns the scheduler/operation leases.
  app.quit();
}

// ─────────────────────────────────────────────────────────────────────────────
// Window Factory
// ─────────────────────────────────────────────────────────────────────────────

async function createWindow() {
  runtimeDiagnostics.trace('main', 'window-create-start');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,

    // Frameless — we render our own titlebar in React (Header.jsx)
    frame: false,

    // Prevents white flash before renderer is ready
    backgroundColor: '#09090d',

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),

      // Security: isolate renderer from Node.js globals
      contextIsolation: true,
      nodeIntegration: false,

      // The preload uses only Electron's sandbox-compatible context bridge and
      // IPC APIs; renderer code never receives Node.js capabilities.
      sandbox: true,
    },

    // Don't flash a blank window — show only when content is ready
    show: false,
  });

  // Harden the packaged renderer without interfering with Vite's development
  // websocket/runtime. Inline styles remain necessary while the React UI still
  // uses scoped style props; scripts remain self-only in production.
  if (!isDev) {
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://media.steampowered.com https://cdn.akamai.steamstatic.com https://steamcdn-a.akamaihd.net",
      "connect-src 'self' https://api.steampowered.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [policy],
        },
      });
    });
  }

  mainWindow.webContents.on('did-finish-load', () => runtimeDiagnostics.trace('renderer', 'did-finish-load'));
  mainWindow.webContents.on('render-process-gone', (_event, details) => runtimeDiagnostics.trace('renderer', 'process-gone', details));
  mainWindow.webContents.on('unresponsive', () => runtimeDiagnostics.trace('renderer', 'unresponsive'));
  mainWindow.webContents.on('responsive', () => runtimeDiagnostics.trace('renderer', 'responsive'));

  // ── Load the renderer ────────────────────────────────────────────────────
  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
    // DevTools intentionally disabled — use npm run dev and open manually if needed
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // ── Show after paint + push persisted state ───────────────────────────────
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();

    // After a game-switch relaunch, restore the selected game for the renderer
    const selectedGame = settingsStore.get('selectedGame');
    if (selectedGame) {
      mainWindow.webContents.send('app:initial-state', { selectedGame });
    }
  });

  // Fallback: force show the window just in case ready-to-show didn't fire
  mainWindow.show();
  mainWindow.focus();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// App Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  runtimeDiagnostics.initialize();
  runtimeDiagnostics.trace('main', 'diagnostics-ready', runtimeDiagnostics.getStatus());

  // ① Wire up all IPC channels before creating any window
  registerIpcHandlers();

  // Initialize persisted services. Humanized verification jobs resume only
  // through their verifier-first recovery policy.
  const timerService = require('./timerService');
  const humanizedService = require('./humanizedService');
  timerService.init();
  await humanizedService.init();

  // ③ Open the main window
  await createWindow();
  runtimeDiagnostics.trace('main', 'startup-complete', runtimeDiagnostics.getStatus());

  // macOS: re-open window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Gracefully tear down the Steamworks client before quitting
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});
