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
let recoveryNotice = null;

function quarantineCorruptSettings(error) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantinePath = path.join(path.dirname(SETTINGS_PATH), `app-settings.corrupt.${timestamp}.json`);
  try {
    fs.renameSync(SETTINGS_PATH, quarantinePath);
    recoveryNotice = {
      code: 'SETTINGS_CORRUPT_QUARANTINED',
      message: 'Saved application state was corrupt and has been preserved in a quarantine file. Start a new schedule after reviewing the recovery notice.',
      quarantineFile: path.basename(quarantinePath),
    };
  } catch (quarantineError) {
    recoveryNotice = {
      code: 'SETTINGS_CORRUPT_UNREADABLE',
      message: 'Saved application state is corrupt and could not be quarantined automatically. Do not delete it before collecting diagnostics.',
      quarantineFile: null,
      detail: quarantineError instanceof Error ? quarantineError.message : String(quarantineError),
    };
  }
  return {};
}

function readAll() {
  let contents;
  try {
    contents = fs.readFileSync(SETTINGS_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`Unable to read settings: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Settings file must contain a JSON object.');
    }
    return parsed;
  } catch (error) {
    return quarantineCorruptSettings(error);
  }
}

function getRecoveryNotice() {
  return recoveryNotice ? { ...recoveryNotice } : null;
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

module.exports = { get, set, delete: del, getRecoveryNotice, readAll, writeAll };
