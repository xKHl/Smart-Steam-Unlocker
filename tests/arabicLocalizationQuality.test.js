const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = (relPath) => fs.readFileSync(path.join(root, relPath), 'utf8');
const loadTranslations = () => import(path.join(root, 'src/i18n/translations.mjs')).then((module) => module.translations);

function flatten(object, prefix = '', output = {}) {
  for (const [key, value] of Object.entries(object)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, fullKey, output);
    else output[fullKey] = value;
  }
  return output;
}

const placeholders = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');

test('Arabic catalog covers every English key with matching placeholders', async () => {
  const translations = await loadTranslations();
  const en = flatten(translations.en);
  const ar = flatten(translations.ar);
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(placeholders(ar[key]), placeholders(en[key]), `placeholder mismatch for ${key}`);
  }
});

test('every translation key referenced by the renderer exists in both locales', async () => {
  const translations = await loadTranslations();
  const resolve = (catalog, key) => key.split('.').reduce((value, segment) => value && value[segment], catalog);
  const files = [];
  const walk = (dir) => fs.readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (/\.(jsx|mjs)$/.test(full)) files.push(full);
  });
  walk(path.join(root, 'src'));
  const pattern = /['"`]((?:app|nav|common|mode|achievements|scheduler|integrity|trading|settings|status|dashboard|library|sidebar|errors)\.[\w.]+)['"`]/g;
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(pattern)) {
      assert.equal(typeof resolve(translations.en, match[1]), 'string', `${match[1]} missing in en (${path.basename(file)})`);
      assert.equal(typeof resolve(translations.ar, match[1]), 'string', `${match[1]} missing in ar (${path.basename(file)})`);
    }
  }
});

test('previously hardcoded English UI copy is routed through the catalog', () => {
  const gameCard = source('src/components/GameCard.jsx');
  assert.doesNotMatch(gameCard, /<span>Browse Achievements<\/span>/);
  assert.doesNotMatch(gameCard, /`\$\{playtime\} played`/);

  const sidebar = source('src/components/Sidebar.jsx');
  assert.doesNotMatch(sidebar, />Creator · Smart Steam Unlocker</);

  const achievements = source('src/pages/Achievements.jsx');
  assert.doesNotMatch(achievements, /title="Clear Queue"/);
  assert.doesNotMatch(achievements, /setLoadError\('Could not load/);

  const panel = source('src/components/HumanizedSchedulePanel.jsx');
  assert.match(panel, /localizeVerificationPresentation\(/);
  assert.doesNotMatch(panel, /\$\{t\('scheduler\.pace'\)\}/);
});

test('every Trading Card filter has its own label instead of falling back to All', async () => {
  const translations = await loadTranslations();
  const { TRADING_CARD_FILTERS } = await import(path.join(root, 'src/lib/tradingCardProjection.mjs'));
  const page = source('src/pages/TradingCards.jsx');
  const labels = new Set();
  for (const filter of TRADING_CARD_FILTERS) {
    const match = page.match(new RegExp(`'?${filter}'?: '(trading\\.[\\w]+)'`));
    assert.ok(match, `no label key for filter ${filter}`);
    const [, key] = match;
    labels.add(translations.ar.trading[key.split('.')[1]]);
  }
  assert.equal(labels.size, TRADING_CARD_FILTERS.length);
});

test('Arabic errors are localized and English raw messages are not shown in Arabic', async () => {
  const translations = await loadTranslations();
  const { localizeError, formatNumber } = await import(path.join(root, 'src/i18n/errors.mjs'));
  const t = (locale) => (key) => key.split('.').reduce((value, segment) => value && value[segment], translations[locale]) ?? key;

  assert.equal(localizeError(t('ar'), 'ar', { errorCode: 'STEAM_NOT_CONNECTED', error: 'raw' }, 'common.failed'), translations.ar.errors.STEAM_NOT_CONNECTED);
  assert.equal(localizeError(t('en'), 'en', { error: 'Raw English detail' }, 'common.failed'), 'Raw English detail');
  assert.equal(localizeError(t('ar'), 'ar', { error: 'Raw English detail' }, 'common.failed'), translations.ar.common.failed);
  assert.equal(localizeError(t('ar'), 'ar', { errorCode: 'UNKNOWN_CODE', error: 'x' }, 'common.failed'), `${translations.ar.common.failed} (UNKNOWN_CODE)`);
  assert.equal(formatNumber(1234, 'ar'), '1,234');
});
