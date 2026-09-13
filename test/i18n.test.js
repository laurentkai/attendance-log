const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  TRANSLATIONS,
  isSupportedLanguage,
  languageFromAcceptLanguage,
  normalizeLanguageOverride,
  resolveClassLanguage,
  resolveClassReportLanguage,
  resolveGlobalReportLanguage,
  resolveParticipantCommunicationLanguage,
  resolveParticipantLanguage,
  resolveParticipantReportLanguage,
  resolveSessionLanguage,
  resolveSessionReportLanguage,
  resolveSessionSummaryLanguage,
  resolveUiLanguage,
  t,
  translateFromCatalogs,
} = require('../src/i18n');

test('supported language constants accept only en/fr with English as default', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['en', 'fr']);
  assert.equal(DEFAULT_LANGUAGE, 'en');
  assert.equal(isSupportedLanguage('en'), true);
  assert.equal(isSupportedLanguage('FR'), true);
  assert.equal(isSupportedLanguage('de'), false);
  assert.equal(normalizeLanguageOverride(''), null);
  assert.equal(normalizeLanguageOverride('fr'), 'fr');
  assert.equal(normalizeLanguageOverride('fr-BE'), undefined);
});

test('Accept-Language respects base tags, ordering, q-values, and English fallback', () => {
  assert.equal(languageFromAcceptLanguage('fr-BE,fr;q=0.9,en;q=0.8'), 'fr');
  assert.equal(languageFromAcceptLanguage('en-GB,en;q=0.9,fr;q=0.8'), 'en');
  assert.equal(languageFromAcceptLanguage('de-DE,de;q=0.9'), 'en');
  assert.equal(languageFromAcceptLanguage('fr;q=0.5,en;q=0.9'), 'en');
  assert.equal(languageFromAcceptLanguage('fr;q=0,en;q=0.2'), 'en');
});

test('saved UI preference wins and browser language is used only while automatic', () => {
  assert.equal(resolveUiLanguage('en', 'fr-BE,fr;q=0.9'), 'en');
  assert.equal(resolveUiLanguage('fr', 'en-US,en;q=0.9'), 'fr');
  assert.equal(resolveUiLanguage(null, 'fr-BE,fr;q=0.9'), 'fr');
  assert.equal(resolveUiLanguage(null, 'de-DE'), 'en');
});

test('business language inheritance uses only explicit relevant overrides', () => {
  assert.equal(resolveClassLanguage({ defaultLanguage: 'fr' }), 'fr');
  assert.equal(resolveClassLanguage({ classLanguage: 'en', defaultLanguage: 'fr' }), 'en');
  assert.equal(resolveSessionLanguage({ sessionLanguage: null, classLanguage: 'fr', defaultLanguage: 'en' }), 'fr');
  assert.equal(resolveSessionLanguage({ sessionLanguage: 'en', classLanguage: 'fr', defaultLanguage: 'fr' }), 'en');
  assert.equal(resolveParticipantLanguage({ participantLanguage: 'fr', sessionLanguage: 'en', classLanguage: 'en', defaultLanguage: 'en' }), 'fr');
  assert.equal(resolveParticipantLanguage({ participantLanguage: null, sessionLanguage: null, classLanguage: null, defaultLanguage: 'en' }), 'en');
});

test('report and communication helpers share the canonical precedence', () => {
  assert.equal(resolveClassReportLanguage({ classLanguage: 'fr', defaultLanguage: 'en' }), 'fr');
  assert.equal(resolveGlobalReportLanguage({ defaultLanguage: 'fr' }), 'fr');
  assert.equal(resolveSessionReportLanguage({ sessionLanguage: null, classLanguage: 'fr', defaultLanguage: 'en' }), 'fr');
  assert.equal(resolveParticipantReportLanguage({ participantLanguage: 'en', sessionLanguage: 'fr', defaultLanguage: 'fr' }), 'en');
  assert.equal(resolveSessionSummaryLanguage({ sessionLanguage: 'en', classLanguage: 'fr', defaultLanguage: 'fr' }), 'en');
  assert.equal(resolveParticipantCommunicationLanguage({ participantLanguage: null, defaultLanguage: 'fr' }), 'fr');
});

test('participant without an explicit class context does not infer one', () => {
  assert.equal(resolveParticipantCommunicationLanguage({ participantLanguage: null, defaultLanguage: 'en' }), 'en');
  assert.equal(resolveParticipantCommunicationLanguage({ participantLanguage: 'fr', defaultLanguage: 'en' }), 'fr');
});

test('translation catalogs include the representative canonical key set', () => {
  assert.deepEqual(Object.keys(TRANSLATIONS.fr).sort(), Object.keys(TRANSLATIONS.en).sort());
  assert.equal(t('en', 'action.save'), 'Save');
  assert.equal(t('fr', 'action.save'), 'Enregistrer');
});

test('every major user-facing area has distinct English and French resources', () => {
  const representativeKeys = [
    'shell.home', 'auth.login.title', 'dashboard.title', 'students.directory.description_active',
    'import.title', 'classes.list.description', 'sessions.list.empty', 'attendance.quick.title',
    'reporting.overview', 'report.sheet.summary', 'summary.email.subject', 'qr.print.title',
    'print.design.title', 'settings.navigation', 'mail.title', 'security.title', 'branding.title',
    'terminology.title', 'audit.title', 'backup.title', 'restore.title', 'maintenance.title',
    'privacy.settings.description', 'pwa.offline.heading', 'error.not_found.title',
  ];
  let distinctTranslations = 0;
  for (const key of representativeKeys) {
    assert.equal(typeof TRANSLATIONS.en[key], 'string', key);
    assert.equal(typeof TRANSLATIONS.fr[key], 'string', key);
    if (TRANSLATIONS.en[key] !== TRANSLATIONS.fr[key]) distinctTranslations += 1;
  }
  assert.ok(distinctTranslations >= 20);
});

test('catalog source defines every canonical key exactly once per language', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', `${language}.js`), 'utf8');
    for (const key of Object.keys(TRANSLATIONS[language])) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.equal((source.match(new RegExp(`^[ \\t]*['"]${escaped}['"]\\s*:`, 'gm')) || []).length, 1, `${language}:${key}`);
    }
  }
});

test('shipping English and French translations use identical placeholders', () => {
  const placeholders = (message) => [...message.matchAll(/\{([a-z][a-z0-9_]*)\}/gi)]
    .map((match) => match[1])
    .sort();
  for (const key of Object.keys(TRANSLATIONS.en)) {
    assert.deepEqual(placeholders(TRANSLATIONS.fr[key]), placeholders(TRANSLATIONS.en[key]), key);
  }
});

test('translation falls back to English and rejects a missing canonical key', () => {
  const catalogs = { en: { greeting: 'Hello {name}' }, fr: {} };
  assert.equal(translateFromCatalogs(catalogs, 'fr', 'greeting', { name: 'Sailor' }), 'Hello Sailor');
  assert.throws(
    () => translateFromCatalogs({ en: {}, fr: { missing: 'Absent' } }, 'fr', 'missing'),
    (error) => error.code === 'I18N_MISSING_CANONICAL_KEY',
  );
});

test('translation interpolation is plain text and requires named parameters', () => {
  const catalogs = { en: { greeting: 'Hello {name}' }, fr: { greeting: 'Bonjour {name}' } };
  assert.equal(translateFromCatalogs(catalogs, 'fr', 'greeting', { name: '<Marin>' }), 'Bonjour <Marin>');
  assert.throws(
    () => translateFromCatalogs(catalogs, 'en', 'greeting'),
    (error) => error.code === 'I18N_MISSING_PARAMETER',
  );
});
