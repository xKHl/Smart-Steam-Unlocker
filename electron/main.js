const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc/handlers');
const { initSteam, shutdown } = require('./steamManager');
const settingsStore = require('./settingsStore');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;

// ─────────────────────────────────────────────────────────────────────────────
// Window Factory
// ─────────────────────────────────────────────────────────────────────────────

async function createWindow() {
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

      // Required: allows preload.js to use require('electron')
      sandbox: false,
    },

    // Don't flash a blank window — show only when content is ready
    show: false,
  });

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
  // ① Wire up all IPC channels before creating any window
  registerIpcHandlers();

  // Initialize the timer service to restore any persisted queue
  const timerService = require('./timerService');
  timerService.init();

  // ③ Open the main window
  await createWindow();

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
