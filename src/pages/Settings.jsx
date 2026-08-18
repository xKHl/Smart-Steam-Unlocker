import React, { useEffect, useState } from 'react';
import {
  Key, Eye, EyeOff, Save, Check, Loader2,
  AlertCircle, ExternalLink, ShieldCheck, RefreshCw, Trash2,
} from 'lucide-react';

const ERROR_MESSAGES = {
  NO_API_KEY: 'No API key is stored yet.',
  CREDENTIAL_MIGRATION_REQUIRED: 'Your previous key needs secure storage migration. Configure secure storage, then save a replacement key.',
  CREDENTIAL_STORAGE_UNAVAILABLE: 'Secure credential storage is unavailable on this system. Configure your operating system credential store, then try again.',
  INVALID_API_KEY: 'Steam rejected the configured key. Replace it in Settings.',
  PRIVATE_PROFILE: 'Steam returned no library data. Check that game details are public.',
  STEAM_NOT_CONNECTED: 'Steam is not connected. Open Steam and restart the app.',
  FETCH_ERROR: 'Network error contacting the Steam API. Check your internet connection.',
};

/**
 * Credential settings never read a stored API key into renderer state. The entry
 * box exists only long enough for the user to submit a replacement to the main
 * process, which persists it through Electron secure storage.
 */
export default function Settings() {
  const [apiKeyEntry, setApiKeyEntry] = useState('');
  const [credentialStatus, setCredentialStatus] = useState({ hasKey: false, storage: 'unknown', migrationPending: false, maskedLastFour: null });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const refreshCredentialStatus = async () => {
    const status = await window.steamAPI?.credentials.getStatus();
    if (status) setCredentialStatus(status);
    return status;
  };

  useEffect(() => {
    refreshCredentialStatus().catch(() => {
      setCredentialStatus({ hasKey: false, storage: 'unavailable', migrationPending: false, maskedLastFour: null, errorCode: 'CREDENTIAL_STORAGE_UNAVAILABLE' });
    });
  }, []);

  const handleSave = async () => {
    if (!apiKeyEntry.trim()) return;
    setSaving(true);
    setTestResult(null);
    try {
      const status = await window.steamAPI?.credentials.saveSteamApiKey(apiKeyEntry.trim());
      if (status) setCredentialStatus(status);
      // Do not retain a persisted credential in renderer state after save.
      setApiKeyEntry('');
      setShowKey(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setTestResult({ ok: false, msg: error instanceof Error ? error.message : 'The key could not be stored securely.' });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    setTestResult(null);
    try {
      const status = await window.steamAPI?.credentials.clearSteamApiKey();
      if (status) setCredentialStatus(status);
      setApiKeyEntry('');
    } catch (error) {
      setTestResult({ ok: false, msg: error instanceof Error ? error.message : 'The stored key could not be cleared.' });
    } finally {
      setClearing(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.steamAPI?.steam.getOwnedGames({ forceRefresh: true });
      if (result?.success) {
        setTestResult({ ok: true, msg: `Connected. Steam returned ${result.count.toLocaleString()} owned games.` });
      } else {
        const msg = ERROR_MESSAGES[result?.errorCode] ?? result?.detail ?? 'Steam connection could not be verified.';
        setTestResult({ ok: false, msg });
      }
    } catch (error) {
      setTestResult({ ok: false, msg: error instanceof Error ? error.message : 'Steam connection could not be verified.' });
    } finally {
      setTesting(false);
    }
  };

  const secureStorageUnavailable = credentialStatus.storage === 'unavailable';

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Configure a Steam Web API key to unlock the full game library.</p>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-icon-wrap"><Key size={18} color="#a78bfa" /></div>
          <div>
            <h2 className="settings-section-title">Steam Web API Key</h2>
            <p className="settings-section-sub">Stored in operating-system-backed encrypted storage. The app never displays a saved key.</p>
          </div>
        </div>

        {credentialStatus.hasKey && (
          <div className="settings-privacy-note" role="status">
            <ShieldCheck size={14} color="#4ade80" style={{ flexShrink: 0 }} />
            <p><strong>Secure key configured</strong>{credentialStatus.maskedLastFour ? ` (${credentialStatus.maskedLastFour})` : ''}. Enter a new value below only to replace it.</p>
          </div>
        )}
        {(credentialStatus.migrationPending || secureStorageUnavailable) && (
          <div className="test-result-banner test-err" role="alert">
            <AlertCircle size={15} color="#f87171" />
            <span>{credentialStatus.migrationPending ? 'A legacy plaintext key was preserved but cannot be migrated until secure storage is available. Save a replacement key after configuring secure storage.' : 'Secure credential storage is unavailable. The app will not save or use a plaintext API key.'}</span>
          </div>
        )}

        <div className="api-key-row">
          <div className="api-key-wrap">
            <input
              id="input-api-key"
              type={showKey ? 'text' : 'password'}
              className="api-key-input"
              placeholder="Paste a replacement 32-character API key…"
              value={apiKeyEntry}
              onChange={(event) => setApiKeyEntry(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-label="Replacement Steam Web API key"
            />
            <button className="api-key-toggle" onClick={() => setShowKey((value) => !value)} title={showKey ? 'Hide entered key' : 'Show entered key'} aria-label={showKey ? 'Hide entered API key' : 'Show entered API key'} type="button">
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="settings-actions">
          <button id="btn-save-api-key" className="hero-cta" onClick={handleSave} disabled={!apiKeyEntry.trim() || saving || secureStorageUnavailable} type="button">
            {saving ? <Loader2 size={14} className="spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? 'Saved securely' : saving ? 'Saving…' : credentialStatus.hasKey ? 'Replace key' : 'Save key'}
          </button>
          <button id="btn-test-connection" className="btn-secondary" onClick={handleTest} disabled={!credentialStatus.hasKey || testing} type="button">
            {testing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          {credentialStatus.hasKey && (
            <button className="btn-danger" onClick={handleClear} disabled={clearing} type="button">
              {clearing ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              {clearing ? 'Clearing…' : 'Clear key'}
            </button>
          )}
        </div>

        {testResult && (
          <div className={`test-result-banner ${testResult.ok ? 'test-ok' : 'test-err'}`} role="status">
            {testResult.ok ? <ShieldCheck size={15} color="#4ade80" /> : <AlertCircle size={15} color="#f87171" />}
            <span>{testResult.msg}</span>
          </div>
        )}
      </div>

      <div className="settings-card">
        <h2 className="settings-section-title" style={{ marginBottom: 16 }}>How to get a Steam Web API Key</h2>
        <ol className="settings-steps">
          <li><span className="step-num">1</span><span>Go to <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer" className="settings-link">steamcommunity.com/dev/apikey <ExternalLink size={11} style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle' }} /></a> while logged in to Steam.</span></li>
          <li><span className="step-num">2</span><span>Enter any domain name (for example <code className="inline-code">localhost</code>) and register the key.</span></li>
          <li><span className="step-num">3</span><span>Paste the key above. It is submitted once to the main process and is not returned to this page.</span></li>
          <li><span className="step-num">4</span><span>Ensure the Steam profile’s <strong>Game details</strong> privacy setting permits the read operations you need.</span></li>
        </ol>
        <div className="settings-privacy-note">
          <ShieldCheck size={14} color="#4ade80" style={{ flexShrink: 0 }} />
          <p>The app uses secure operating-system storage when available. A previously exposed key should be revoked and replaced; saving a new key does not revoke the old one.</p>
        </div>
      </div>
    </div>
  );
}
