/**
 * Steam Web API credential storage.
 *
 * The credential is deliberately isolated from the general JSON settings store.
 * Renderer code can obtain status only; plaintext is available exclusively to
 * trusted main-process callers that need to contact the Steam Web API.
 */

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const settingsStore = require('./settingsStore');

const CREDENTIAL_FILE = 'steam-api-key.bin';
const LEGACY_SETTINGS_KEY = 'steamApiKey';
const STEAM_API_KEY_PATTERN = /^[a-f\d]{32}$/i;

class CredentialStoreError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'CredentialStoreError';
    this.code = code;
    this.cause = cause;
  }
}

function credentialPath() {
  return path.join(app.getPath('userData'), CREDENTIAL_FILE);
}

function selectedBackend() {
  try {
    return typeof safeStorage.getSelectedStorageBackend === 'function'
      ? safeStorage.getSelectedStorageBackend()
      : null;
  } catch {
    return null;
  }
}

function isSecureStorageAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    // Electron's Linux basic_text backend is intentionally not an OS-backed
    // secret store. Refuse it rather than silently persisting plaintext.
    return selectedBackend() !== 'basic_text';
  } catch {
    return false;
  }
}

function ensureSecureStorage() {
  if (!isSecureStorageAvailable()) {
    throw new CredentialStoreError(
      'CREDENTIAL_STORAGE_UNAVAILABLE',
      'Secure credential storage is unavailable on this system. Configure an OS credential store, then save the Steam Web API key again.'
    );
  }
}

function normalizeKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!STEAM_API_KEY_PATTERN.test(key)) {
    throw new CredentialStoreError('INVALID_API_KEY_FORMAT', 'Enter a valid Steam Web API key.');
  }
  return key;
}

function writeEncrypted(buffer) {
  const target = credentialPath();
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${CREDENTIAL_FILE}.${process.pid}.${Date.now()}.tmp`);
  let descriptor = null;

  try {
    fs.mkdirSync(directory, { recursive: true });
    descriptor = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(descriptor, buffer);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* Preserve the original error. */ }
    }
    try { fs.unlinkSync(temporary); } catch { /* The temporary file may not exist. */ }
    throw new CredentialStoreError('CREDENTIAL_WRITE_FAILED', 'Secure credential storage could not be updated.', error);
  }
}

function removeEncrypted() {
  try {
    fs.unlinkSync(credentialPath());
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new CredentialStoreError('CREDENTIAL_DELETE_FAILED', 'Secure credential storage could not be cleared.', error);
    }
  }
}

function readEncryptedKey() {
  let encrypted;
  try {
    encrypted = fs.readFileSync(credentialPath());
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new CredentialStoreError('CREDENTIAL_READ_FAILED', 'Secure credential storage could not be read.', error);
  }

  try {
    const key = safeStorage.decryptString(encrypted);
    return normalizeKey(key);
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error;
    throw new CredentialStoreError('CREDENTIAL_DECRYPT_FAILED', 'Stored Steam credential could not be decrypted. Clear it and save a replacement key.', error);
  }
}

/**
 * Attempts one-way migration from the former general settings store. The legacy
 * value is never exposed to renderer callers. When secure storage is absent we
 * preserve the legacy value as evidence/configuration and report explicit user
 * action instead of silently discarding it or continuing to use plaintext.
 */
function migrateLegacyCredential() {
  const legacy = settingsStore.get(LEGACY_SETTINGS_KEY);
  if (!legacy) return { migrated: false, legacyPending: false };
  if (!isSecureStorageAvailable()) return { migrated: false, legacyPending: true };

  try {
    const key = normalizeKey(legacy);
    writeEncrypted(safeStorage.encryptString(key));
    settingsStore.delete(LEGACY_SETTINGS_KEY);
    return { migrated: true, legacyPending: false };
  } catch (error) {
    if (error instanceof CredentialStoreError && error.code === 'INVALID_API_KEY_FORMAT') {
      return { migrated: false, legacyPending: true, migrationError: error.code };
    }
    throw error;
  }
}

function getStatus() {
  const migration = migrateLegacyCredential();
  const secureStorageAvailable = isSecureStorageAvailable();
  let key = null;
  let errorCode = migration.migrationError ?? null;

  if (secureStorageAvailable) {
    try {
      key = readEncryptedKey();
    } catch (error) {
      errorCode = error.code || 'CREDENTIAL_READ_FAILED';
    }
  }

  return {
    hasKey: Boolean(key),
    maskedLastFour: key ? `••••${key.slice(-4)}` : null,
    storage: secureStorageAvailable ? 'os-encrypted' : 'unavailable',
    migrationPending: Boolean(migration.legacyPending),
    errorCode,
  };
}

function saveApiKey(value) {
  ensureSecureStorage();
  const key = normalizeKey(value);
  try {
    writeEncrypted(safeStorage.encryptString(key));
    // A user-entered replacement supersedes any legacy plaintext copy.
    settingsStore.delete(LEGACY_SETTINGS_KEY);
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error;
    throw new CredentialStoreError('CREDENTIAL_WRITE_FAILED', 'Secure credential storage could not be updated.', error);
  }
  return getStatus();
}

function clearApiKey() {
  removeEncrypted();
  // Clear a still-pending legacy value only after an explicit user request.
  settingsStore.delete(LEGACY_SETTINGS_KEY);
  return getStatus();
}

/** Main-process-only accessor. Never expose this through preload or IPC. */
function getApiKey() {
  const migration = migrateLegacyCredential();
  if (migration.legacyPending) {
    throw new CredentialStoreError(
      'CREDENTIAL_MIGRATION_REQUIRED',
      'A legacy Steam credential requires secure storage migration. Configure secure storage and save the key again.'
    );
  }
  ensureSecureStorage();
  return readEncryptedKey();
}

module.exports = {
  CREDENTIAL_FILE,
  CredentialStoreError,
  clearApiKey,
  getApiKey,
  getStatus,
  isSecureStorageAvailable,
  migrateLegacyCredential,
  saveApiKey,
};
