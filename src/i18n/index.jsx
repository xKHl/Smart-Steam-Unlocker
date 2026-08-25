import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translations } from './translations.mjs';

const I18nContext = createContext(null);

export const SUPPORTED_LOCALES = Object.freeze({
  en: { code: 'en', label: 'English', direction: 'ltr' },
  ar: { code: 'ar', label: 'العربية', direction: 'rtl' },
});

function resolvePath(catalog, key) {
  return key.split('.').reduce((value, segment) => (value && typeof value === 'object' ? value[segment] : undefined), catalog);
}

function interpolate(value, variables) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (_match, name) => String(variables[name] ?? `{${name}}`));
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    window.steamAPI?.app?.getLocale?.()
      .then((stored) => {
        if (active && SUPPORTED_LOCALES[stored]) setLocaleState(stored);
      })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  const setLocale = useCallback(async (nextLocale) => {
    const normalized = SUPPORTED_LOCALES[nextLocale] ? nextLocale : 'en';
    // Render immediately; persistence failure retains a usable in-session choice.
    setLocaleState(normalized);
    try {
      await window.steamAPI?.app?.setLocale?.(normalized);
    } catch {
      // The English dictionary remains the deterministic fallback after any IPC issue.
    }
  }, []);

  const direction = SUPPORTED_LOCALES[locale]?.direction || 'ltr';
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    document.documentElement.dataset.locale = locale;
    document.body.dir = direction;
  }, [direction, locale]);

  const t = useCallback((key, variables = {}) => {
    const localized = resolvePath(translations[locale], key);
    const fallback = resolvePath(translations.en, key);
    const resolved = localized ?? fallback ?? key;
    return interpolate(resolved, variables);
  }, [locale]);

  const value = useMemo(() => ({ locale, direction, ready, setLocale, t, locales: SUPPORTED_LOCALES }), [direction, locale, ready, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider.');
  return value;
}
