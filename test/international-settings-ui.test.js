const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgres://unit-test:unit-test@127.0.0.1:1/unit-test';

const fs = require('node:fs');
const path = require('node:path');
const { renderInternationalSettingsPage } = require('../src/international-settings-router');
const {
  normalizeInternationalSettings,
  validateInternationalSettings,
} = require('../src/international-settings');
const { normalizeReturnTarget, parseUiLanguage } = require('../src/language-preferences');
const { t } = require('../src/i18n');
const { renderUiLanguageField } = require('../src/admin-user-settings');
const { renderLanguageOptions, renderLanguageSelector } = require('../src/ui');

function requestFor(language) {
  return {
    uiLanguage: language,
    currentUser: { id: '1', public_id: '00000000-0000-4000-8000-000000000001', ui_language: language },
    internationalization: {
      defaultLanguage: 'en',
      locale: 'fr-BE',
      timezone: 'Europe/Brussels',
    },
  };
}

test('international settings surface renders its system wording in English', () => {
  const html = renderInternationalSettingsPage(requestFor('en'));
  assert.match(html, /<html lang="en">/);
  assert.match(html, />Language and region</);
  assert.match(html, />Default language</);
  assert.match(html, />Locale</);
  assert.match(html, />Timezone</);
  assert.match(html, />Save</);
  assert.match(html, /name="return_to" type="hidden" value="\/settings\/internationalization"/);
});

test('international settings surface renders its system wording in French', () => {
  const html = renderInternationalSettingsPage(requestFor('fr'));
  assert.match(html, /<html lang="fr">/);
  assert.match(html, />Langue et région</);
  assert.match(html, />Langue par défaut</);
  assert.match(html, />Paramètres régionaux</);
  assert.match(html, />Fuseau horaire</);
  assert.match(html, />Enregistrer</);
});

test('translated settings values are escaped before HTML output', () => {
  const html = renderInternationalSettingsPage({
    ...requestFor('en'),
    internationalization: {
      defaultLanguage: 'en',
      locale: 'fr-BE',
      timezone: '<script>alert(1)</script>',
    },
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

function internationalSettingsSections(html) {
  return [...html.matchAll(/<section class="card card-body app-form"[\s\S]*?<\/section>/g)]
    .map((match) => match[0]).join('\n');
}

test('I18N-1 settings content contains no unintended opposite-language system text', () => {
  const english = internationalSettingsSections(renderInternationalSettingsPage(requestFor('en')));
  assert.doesNotMatch(english, /Langue et région|Langue par défaut|Paramètres régionaux|Fuseau horaire|Enregistrer|Français/);
  assert.match(english, />English</);
  assert.match(english, />French</);

  const french = internationalSettingsSections(renderInternationalSettingsPage(requestFor('fr')));
  assert.doesNotMatch(french, /Language and region|Default language|Timezone|Automatic \(browser\)|>Save<|>English<|>French</);
  assert.match(french, />Anglais</);
  assert.match(french, />Français</);
});

test('international settings success and error messages use the active UI language', () => {
  const englishNotice = renderInternationalSettingsPage(requestFor('en'), {
    notice: t('en', 'settings.international.saved'),
  });
  const frenchError = renderInternationalSettingsPage(requestFor('fr'), {
    error: t('fr', 'settings.international.error'),
  });
  assert.match(englishNotice, /Language and regional settings saved\./);
  assert.doesNotMatch(englishNotice, /paramètres de langue|enregistrés/);
  assert.match(frenchError, /Impossible d’enregistrer les paramètres de langue et de région\./);
  assert.doesNotMatch(frenchError, /Unable to save/);
});

test('international setting values are normalized and validated server-side', () => {
  const values = normalizeInternationalSettings({
    default_language: ' FR ', locale: 'fr-BE', timezone: ' Europe/Brussels ',
  });
  assert.deepEqual(values, {
    defaultLanguage: 'fr', locale: 'fr-BE', timezone: 'Europe/Brussels',
  });
  assert.equal(validateInternationalSettings(values), true);
  assert.equal(validateInternationalSettings({ ...values, defaultLanguage: 'de' }), false);
  assert.equal(validateInternationalSettings({ ...values, locale: 'de-DE' }), false);
  assert.equal(validateInternationalSettings({ ...values, timezone: 'Not/A_Timezone' }), false);
});

test('self-service UI language parser accepts only automatic, English, or French', () => {
  assert.equal(parseUiLanguage(''), null);
  assert.equal(parseUiLanguage('automatic'), null);
  assert.equal(parseUiLanguage('en'), 'en');
  assert.equal(parseUiLanguage('FR'), 'fr');
  assert.equal(parseUiLanguage('de'), undefined);
});

test('language changes return to the current safe application path and preserve queries', () => {
  assert.equal(normalizeReturnTarget('/'), '/');
  assert.equal(normalizeReturnTarget('/students'), '/students');
  assert.equal(normalizeReturnTarget('/settings/internationalization'), '/settings/internationalization');
  assert.equal(normalizeReturnTarget('/students?search=Jean&page=2'), '/students?search=Jean&page=2');
});

test('language return targets reject external, protocol-relative, malformed, and oversized values', () => {
  assert.equal(normalizeReturnTarget('https://example.com/steal'), '/');
  assert.equal(normalizeReturnTarget('//example.com/steal'), '/');
  assert.equal(normalizeReturnTarget('/\\example.com/steal'), '/');
  assert.equal(normalizeReturnTarget('javascript:alert(1)'), '/');
  assert.equal(normalizeReturnTarget(`/students?value=${'x'.repeat(2100)}`), '/');
  assert.equal(normalizeReturnTarget(undefined), '/');
});

test('language selector shows effective language, current preference, and escaped return path', () => {
  const automatic = renderLanguageSelector({
    uiLanguage: 'fr', currentUser: { ui_language: null }, originalUrl: '/students?search=A&B',
  });
  assert.match(automatic, />FR</);
  assert.match(automatic, /Automatique \(navigateur\)[\s\S]*?✓/);
  assert.match(automatic, /name="return_to" type="hidden" value="\/students\?search=A&amp;B"/);
  assert.equal((automatic.match(/✓/g) || []).length, 1);

  const english = renderLanguageSelector({
    uiLanguage: 'en', currentUser: { ui_language: 'en' }, originalUrl: '/settings/internationalization',
  });
  assert.match(english, />EN</);
  assert.match(english, />English<span aria-hidden="true">✓/);
  assert.match(english, /Automatic \(browser\)/);
  assert.match(english, /French/);
  assert.doesNotMatch(english, /Automatique|Français|Actuel/);
});

test('admin-user language field follows the viewing administrator language', () => {
  const english = renderUiLanguageField('en', 'en');
  assert.match(english, />Interface language</);
  assert.match(english, />Automatic \(browser\)</);
  assert.match(english, /<option value="en" selected>English — Current<\/option>/);
  assert.match(english, />French</);
  assert.doesNotMatch(english, /Langue de l’interface|Automatique|Anglais|Français|Actuel/);

  const french = renderUiLanguageField('fr', 'fr');
  assert.match(french, />Langue de l’interface</);
  assert.match(french, />Automatique \(navigateur\)</);
  assert.match(french, />Anglais</);
  assert.match(french, /<option value="fr" selected>Français — Actuel<\/option>/);
  assert.doesNotMatch(french, /Interface language|Automatic \(browser\)|>English<|>French<|Current/);
});

test('shared language options require an explicit rendering language', () => {
  assert.throws(
    () => renderLanguageOptions(null, { emptyLabel: 'Automatic (browser)' }),
    (error) => error.code === 'I18N_RENDER_LANGUAGE_REQUIRED',
  );
  assert.throws(
    () => renderLanguageOptions(null, { language: 'de', emptyLabel: 'Automatic (browser)' }),
    (error) => error.code === 'I18N_RENDER_LANGUAGE_REQUIRED',
  );
});

test('business-language controls use the viewer language and preserve nullable values', () => {
  const automatic = renderLanguageOptions(null, { language: 'fr', emptyLabel: 'Hériter' });
  assert.match(automatic, /<option value="" selected>Hériter<\/option>/);
  assert.match(automatic, /<option value="en">Anglais<\/option>/);
  assert.match(automatic, /<option value="fr">Français<\/option>/);

  const english = renderLanguageOptions('en', { language: 'fr', emptyLabel: 'Hériter' });
  const french = renderLanguageOptions('fr', { language: 'fr', emptyLabel: 'Hériter' });
  assert.match(english, /<option value="en" selected>Anglais<\/option>/);
  assert.match(french, /<option value="fr" selected>Français<\/option>/);

  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin-user-settings.js'), 'utf8');
  assert.doesNotMatch(adminSource, /emptyLabel:\s*['"]Automatique \(navigateur\)['"]/);
  assert.match(adminSource, /renderCreatePage\(\{\}, '', request\.uiLanguage\)/);
  assert.match(adminSource, /renderEditPage\(user, '', request\.uiLanguage\)/);

  for (const filename of ['classes.js', 'course-sessions.js', 'students.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', filename), 'utf8');
    assert.match(source, /renderLanguageOptions\([^\n]+\{ language, emptyLabel:/);
  }
});

test('international settings and self-language routes retain their authorization boundaries', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const preferenceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'language-preferences.js'), 'utf8');
  const authenticationIndex = serverSource.indexOf('app.use(requireAuthentication);');
  const preferenceIndex = serverSource.indexOf("app.use('/preferences', languagePreferencesRouter);");
  const settingsIndex = serverSource.indexOf("app.use('/settings/internationalization', requirePermission(permissions.manageSettings), internationalSettingsRouter);");
  assert.ok(authenticationIndex >= 0);
  assert.ok(preferenceIndex > authenticationIndex);
  assert.ok(settingsIndex > authenticationIndex);
  assert.match(serverSource, /\/settings\/internationalization', requirePermission\(permissions\.manageSettings\), internationalSettingsRouter/);
  assert.match(preferenceSource, /response\.redirect\(303, returnTarget\)/);
  assert.doesNotMatch(preferenceSource, /settings\/internationalization\?notice=ui_language/);
});
