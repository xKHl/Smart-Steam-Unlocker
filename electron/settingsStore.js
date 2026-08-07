/**
 * SettingsStore — Lightweight JSON persistence for app state.
 *
 * Stores data at: %APPDATA%\smart-steam-unlocker\app-settings.json
 * Used to persist the selected game across the app.relaunch() cycle
 * that happens when the user switches games.
 */

const { app } = require('electron');
const fs   = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json');

// ─────────────────────────────────────────────────────────────────────────────

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    // console.error('[SettingsStore] Write error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} key
 * @param {*} [defaultValue]
 */
function get(key, defaultValue = null) {
  return readAll()[key] ?? defaultValue;
}

/**
 * @param {string} key
 * @param {*} value
 */
function set(key, value) {
  const data = readAll();
  data[key] = value;
  writeAll(data);
}

/**
 * @param {string} key
 */
function del(key) {
  const data = readAll();
  delete data[key];
  writeAll(data);
}

module.exports = { get, set, delete: del };
