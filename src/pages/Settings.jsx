import React, { useEffect, useState } from 'react';
import {
  Key, Eye, EyeOff, Save, Check, Loader2,
  AlertCircle, ExternalLink, Github, Globe2, ShieldCheck, RefreshCw, Trash2,
} from 'lucide-react';
import { useI18n } from '../i18n';

const ERROR_MESSAGES = {
  NO_API_KEY: 'settings.apiKeyNotStored',
  CREDENTIAL_MIGRATION_REQUIRED: 'settings.migrationRequired',
  CREDENTIAL_STORAGE_UNAVAILABLE: 'settings.storageUnavailable',
  INVALID_API_KEY: 'settings.invalidApiKey',
  PRIVATE_PROFILE: 'settings.privateProfile',
  STEAM_NOT_CONNECTED: 'settings.steamDisconnected',
  FETCH_ERROR: 'settings.networkError',
};

/**
 * Credential settings never read a stored API key into renderer state. The entry
 * box exists only long enough for the user to submit a replacement to the main
 * process, which persists it through Electron secure storage.
 */
export default function Settings() {
  const { locale, setLocale, t } = useI18n();
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
      setTestResult({ ok: false, msg: error instanceof Error ? error.message : t('settings.keyStoreFailed') });
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
      setTestResult({ ok: false, msg: error instanceof Error ? error.message : t('settings.keyClearFailed') });
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
        setTestResult({ ok: true, msg: t('settings.connectionVerified', { count: result.count.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US') }) });
      } else {
        const errorKey = ERROR_MESSAGES[result?.errorCode];
        setTestResult({ ok: false, msg: errorKey ? t(errorKey) : result?.detail ?? t('settings.connectionFailed') });
      }
    } catch (error) {
      setTestResult({ ok: false, msg: error instanceof Error ? error.message : t('settings.connectionFailed') });
    } finally {
      setTesting(false);
    }
  };

  const secureStorageUnavailable = credentialStatus.storage === 'unavailable';
  const openExternal = (url) => window.steamAPI?.app?.openExternal(url).catch(() => {});

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="page-sub">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="settings-card settings-language-card">
        <div className="settings-card-header">
          <div className="settings-icon-wrap"><Globe2 size={18} color="#a78bfa" /></div>
          <div>
            <h2 className="settings-section-title">{t('settings.languageTitle')}</h2>
            <p className="settings-section-sub">{t('settings.languageSub')}</p>
          </div>
        </div>
        <div className="settings-actions" role="group" aria-label={t('settings.languageTitle')}>
          <button type="button" className={`btn-secondary${locale === 'en' ? ' active-language-choice' : ''}`} onClick={() => setLocale('en')} aria-pressed={locale === 'en'}>{t('app.english')}</button>
          <button type="button" className={`btn-secondary${locale === 'ar' ? ' active-language-choice' : ''}`} onClick={() => setLocale('ar')} aria-pressed={locale === 'ar'}>{t('app.arabic')}</button>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <div className="settings-icon-wrap"><Key size={18} color="#a78bfa" /></div>
          <div>
            <h2 className="settings-section-title">{t('settings.apiKey')}</h2>
            <p className="settings-section-sub">{t('settings.secureStorage')}</p>
          </div>
        </div>

        {credentialStatus.hasKey && (
          <div className="settings-privacy-note" role="status">
            <ShieldCheck size={14} color="#4ade80" style={{ flexShrink: 0 }} />
            <p><strong>{t('settings.secureConfigured')}</strong>{credentialStatus.maskedLastFour ? ` (${credentialStatus.maskedLastFour})` : ''}. {t('settings.replaceKey')}</p>
          </div>
        )}
        {(credentialStatus.migrationPending || secureStorageUnavailable) && (
          <div className="test-result-banner test-err" role="alert">
            <AlertCircle size={15} color="#f87171" />
            <span>{credentialStatus.migrationPending ? t('settings.legacyMigration') : t('settings.storageUnavailable')}</span>
          </div>
        )}

        <div className="api-key-row">
          <div className="api-key-wrap">
            <input
              id="input-api-key"
              type={showKey ? 'text' : 'password'}
              className="api-key-input"
              placeholder={t('settings.replacementPlaceholder')}
              value={apiKeyEntry}
              onChange={(event) => setApiKeyEntry(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('settings.replacementAria')}
            />
            <button className="api-key-toggle" onClick={() => setShowKey((value) => !value)} title={showKey ? t('settings.hideKey') : t('settings.showKey')} aria-label={showKey ? t('settings.hideKey') : t('settings.showKey')} type="button">
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="settings-actions">
          <button id="btn-save-api-key" className="hero-cta" onClick={handleSave} disabled={!apiKeyEntry.trim() || saving || secureStorageUnavailable} type="button">
            {saving ? <Loader2 size={14} className="spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? t('settings.savedSecurely') : saving ? t('common.loading') : credentialStatus.hasKey ? t('settings.replaceKey') : t('settings.saveKey')}
          </button>
          <button id="btn-test-connection" className="btn-secondary" onClick={handleTest} disabled={!credentialStatus.hasKey || testing} type="button">
            {testing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            {testing ? t('common.loading') : t('settings.testConnection')}
          </button>
          {credentialStatus.hasKey && (
            <button className="btn-danger" onClick={handleClear} disabled={clearing} type="button">
              {clearing ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
              {clearing ? t('common.loading') : t('settings.clearKey')}
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
        <h2 className="settings-section-title" style={{ marginBottom: 16 }}>{t('settings.howTo')}</h2>
        <ol className="settings-steps">
          <li><span className="step-num">1</span><span>{t('settings.stepOne')} <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer" className="settings-link">steamcommunity.com/dev/apikey <ExternalLink size={11} style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle' }} /></a></span></li>
          <li><span className="step-num">2</span><span>{t('settings.stepTwo')}</span></li>
          <li><span className="step-num">3</span><span>{t('settings.stepThree')}</span></li>
          <li><span className="step-num">4</span><span>{t('settings.stepFour')}</span></li>
        </ol>
        <div className="settings-privacy-note">
          <ShieldCheck size={14} color="#4ade80" style={{ flexShrink: 0 }} />
          <p>{t('settings.secureAdvice')}</p>
        </div>
      </div>

      <section className="settings-card settings-about-card" aria-labelledby="settings-about-title">
        <div className="settings-card-header">
          <div className="settings-about-monogram" aria-hidden="true">KA</div>
          <div>
            <p className="settings-about-eyebrow">{t('settings.about')}</p>
            <h2 id="settings-about-title" className="settings-section-title">Smart Steam Unlocker</h2>
            <p className="settings-section-sub">{t('settings.creator')}</p>
          </div>
        </div>
            <p className="settings-about-description">{t('settings.description')}</p>
        <div className="settings-about-links" role="group" aria-label={t('settings.projectLinks')}>
          <button type="button" className="settings-about-link" onClick={() => openExternal('https://github.com/xKHl/Smart-Steam-Unlocker')}>
            <Github size={15} />
            <span><strong>{t('settings.repository')}</strong><small>github.com/xKHl/Smart-Steam-Unlocker</small></span>
            <ExternalLink size={13} aria-hidden="true" />
          </button>
          <button type="button" className="settings-about-link" onClick={() => openExternal('https://alotaibi.dev')}>
            <Globe2 size={15} />
            <span><strong>{t('settings.website')}</strong><small className="technical-value">alotaibi.dev</small></span>
            <ExternalLink size={13} aria-hidden="true" />
          </button>
        </div>
        <p className="settings-about-copyright">© 2026 Khalid Alotaibi</p>
      </section>
    </div>
  );
}
