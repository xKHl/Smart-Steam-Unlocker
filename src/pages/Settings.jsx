import React, { useState, useEffect } from 'react';
import {
  Key, Eye, EyeOff, Save, Check, Loader2,
  AlertCircle, ExternalLink, ShieldCheck, RefreshCw,
} from 'lucide-react';

// Human-readable explanations for error codes from the main process
const ERROR_MESSAGES = {
  NO_API_KEY:          'No API key saved yet.',
  INVALID_API_KEY:     'Steam rejected the key (401/403). Double-check it on steamcommunity.com/dev/apikey.',
  PRIVATE_PROFILE:     'Your Steam profile is set to Private. Change "Game details" to Public in Steam privacy settings.',
  NO_GAMES_RETURNED:   'Steam returned an empty library. Verify the API key and profile visibility.',
  STEAM_NOT_CONNECTED: 'Steam is not connected. Open Steam and restart the app.',
  FETCH_ERROR:         'Network error contacting the Steam API. Check your internet connection.',
};

/**
 * Settings — Configure Steam Web API key.
 *
 * The key is stored locally in Electron's userData directory via settingsStore.
 * It is never transmitted anywhere except the official Steam API endpoint.
 */
export default function Settings() {
  const [apiKey,     setApiKey]     = useState('');
  const [savedKey,   setSavedKey]   = useState('');
  const [showKey,    setShowKey]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, msg }

  // Load persisted key on mount
  useEffect(() => {
    window.steamAPI?.settings.get('steamApiKey').then((k) => {
      if (k) { setApiKey(k); setSavedKey(k); }
    });
  }, []);

  const isDirty = apiKey.trim() !== savedKey;

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    await window.steamAPI?.settings.set('steamApiKey', apiKey.trim());
    setSavedKey(apiKey.trim());
    setSaved(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.steamAPI?.steam.getOwnedGames({ forceRefresh: true });
      if (result?.success) {
        setTestResult({ ok: true, msg: `✓ Connected! Found ${result.count.toLocaleString()} owned games.` });
      } else {
        const msg = ERROR_MESSAGES[result?.errorCode] ?? result?.detail ?? 'Unknown error.';
        setTestResult({ ok: false, msg });
      }
    } catch (err) {
      setTestResult({ ok: false, msg: err.message });
    }
    setTesting(false);
  };

  return (
    <div className="page-container animate-fade-in">

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Configure your Steam Web API key to unlock the full game library.</p>
        </div>
      </div>

      {/* ── API Key Card ─────────────────────────────────────────────────── */}
      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-icon-wrap">
            <Key size={18} color="#a78bfa" />
          </div>
          <div>
            <h2 className="settings-section-title">Steam Web API Key</h2>
            <p className="settings-section-sub">
              Required to fetch your complete owned game library (all games, not just installed).
            </p>
          </div>
        </div>

        {/* Input row */}
        <div className="api-key-row">
          <div className="api-key-wrap">
            <input
              id="input-api-key"
              type={showKey ? 'text' : 'password'}
              className="api-key-input"
              placeholder="Paste your 32-character API key here…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-label="Steam Web API key"
            />
            <button
              className="api-key-toggle"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? 'Hide key' : 'Show key'}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              type="button"
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="settings-actions">
          <button
            id="btn-save-api-key"
            className="hero-cta"
            onClick={handleSave}
            disabled={!isDirty || saving || !apiKey.trim()}
            type="button"
          >
            {saving ? (
              <Loader2 size={14} className="spin" />
            ) : saved ? (
              <Check size={14} />
            ) : (
              <Save size={14} />
            )}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Key'}
          </button>

          <button
            id="btn-test-connection"
            className="btn-secondary"
            onClick={handleTest}
            disabled={!savedKey || testing}
            type="button"
          >
            {testing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`test-result-banner ${testResult.ok ? 'test-ok' : 'test-err'}`} role="status">
            {testResult.ok
              ? <ShieldCheck size={15} color="#4ade80" />
              : <AlertCircle  size={15} color="#f87171" />}
            <span>{testResult.msg}</span>
          </div>
        )}
      </div>

      {/* ── How to get a key ─────────────────────────────────────────────── */}
      <div className="settings-card">
        <h2 className="settings-section-title" style={{ marginBottom: 16 }}>
          How to get a Steam Web API Key
        </h2>

        <ol className="settings-steps">
          <li>
            <span className="step-num">1</span>
            <span>
              Go to{' '}
              <a
                href="https://steamcommunity.com/dev/apikey"
                target="_blank"
                rel="noreferrer"
                className="settings-link"
              >
                steamcommunity.com/dev/apikey
                <ExternalLink size={11} style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle' }} />
              </a>{' '}
              while logged in to Steam.
            </span>
          </li>
          <li>
            <span className="step-num">2</span>
            <span>
              Enter any domain name (e.g. <code className="inline-code">localhost</code>) and click{' '}
              <strong>Register</strong>.
            </span>
          </li>
          <li>
            <span className="step-num">3</span>
            <span>Copy the 32-character key and paste it in the field above.</span>
          </li>
          <li>
            <span className="step-num">4</span>
            <span>
              Ensure your Steam profile's <strong>"Game details"</strong> privacy setting is set to{' '}
              <strong>Public</strong> (or at least Friends-only if testing).
            </span>
          </li>
        </ol>

        <div className="settings-privacy-note">
          <ShieldCheck size={14} color="#4ade80" style={{ flexShrink: 0 }} />
          <p>
            Your API key is stored <strong>locally only</strong> in Electron's userData directory.
            It is never sent to any server other than the official Steam API.
          </p>
        </div>
      </div>

    </div>
  );
}
