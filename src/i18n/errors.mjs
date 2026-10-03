/**
 * Turns a main-process error result into text for the active locale.
 *
 * Known error codes map to `errors.<CODE>` catalog entries. Raw main-process
 * messages are English-only, so they are shown verbatim in English and replaced
 * by a localized fallback (with the technical code appended) in other locales.
 */
export function localizeError(t, locale, source, fallbackKey) {
  if (source?.localizedMessage) return source.localizedMessage;
  const code = (source && typeof source === 'object' && (source.errorCode || source.code)) || null;
  if (code) {
    const key = `errors.${code}`;
    const mapped = t(key);
    if (mapped !== key) return mapped;
  }

  const message = typeof source === 'string'
    ? source
    : source?.error || source?.detail || source?.message || '';
  if (locale === 'en' && message) return message;

  const fallback = t(fallbackKey);
  return code ? `${fallback} (${code})` : fallback;
}

/** Error carrying a main-process error code through a throw/catch boundary. */
export function codedError(source, localizedMessage) {
  const error = new Error(source?.error || source?.detail || localizedMessage);
  error.errorCode = source?.errorCode || source?.code || null;
  if (!error.errorCode && !source?.error && !source?.detail) error.localizedMessage = localizedMessage;
  return error;
}

/** Number formatting shared by every page: Western digits in both locales so
 * counts match App IDs, Steam IDs and other technical values on screen. */
export function formatNumber(value, locale) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? '');
  return numeric.toLocaleString(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US');
}
