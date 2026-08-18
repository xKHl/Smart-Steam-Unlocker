/**
 * SettingsStore — lightweight JSON persistence for app state.
 *
 * Writes are atomic within the user-data directory: a complete temporary file is
 * flushed, closed, and renamed over the target. Failures are deliberately
 * propagated so services never assume durable state when persistence failed.
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json');

function readAll() {
  try {
    const contents = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Settings file must contain a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`Unable to read settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeAll(data) {
  const directory = path.dirname(SETTINGS_PATH);
  const temporaryPath = path.join(directory, `.app-settings.${process.pid}.${Date.now()}.tmp`);
  let descriptor = null;

  try {
    fs.mkdirSync(directory, { recursive: true });
    descriptor = fs.openSync(temporaryPath, 'w', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, SETTINGS_PATH);
    return true;
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* Preserve the original write failure. */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch { /* Temp file may not exist. */ }
    throw new Error(`Unable to persist settings atomically: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
  return writeAll(data);
}

/**
 * @param {string} key
 */
function del(key) {
  const data = readAll();
  delete data[key];
  return writeAll(data);
}

module.exports = { get, set, delete: del, readAll, writeAll };
