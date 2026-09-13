const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';

const { TRANSLATIONS } = require('../src/i18n');
const { renderPage } = require('../src/ui');

const clientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8');

async function loadClient(language, browserLanguages) {
  const requests = [];
  const translatedNode = { dataset: { i18n: 'action.save' }, textContent: 'server text' };
  const document = {
    documentElement: { lang: language, dataset: {} },
    querySelectorAll: () => [translatedNode],
    title: 'Server title',
  };
  const window = {};
  vm.runInNewContext(clientSource, {
    document,
    window,
    navigator: { languages: browserLanguages, language: browserLanguages[0] },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => TRANSLATIONS[language] };
    },
  });
  await window.AttendanceLogI18n.ready;
  await new Promise((resolve) => setImmediate(resolve));
  return { requests, translatedNode, window };
}

test('rendered pages reference the cacheable language resource without embedding a catalog', () => {
  for (const language of ['en', 'fr']) {
    const html = renderPage('Test', '<p>Content</p>', { authenticated: false, navigation: false, language });
    const preloads = html.match(/<link rel="preload" href="\/i18n\/(?:en|fr)\.json" as="fetch" crossorigin="anonymous">/g) || [];
    assert.equal(preloads.length, 1, language);
    assert.match(preloads[0], new RegExp(`href="/i18n/${language}\\.json"`));
    assert.doesNotMatch(html, /crossorigin="use-credentials"/);
    assert.doesNotMatch(html, /attendance-log-i18n/);
    assert.doesNotMatch(html, /"action\.save"/);
  }
});

test('client translations load the document language, not a conflicting browser language', async () => {
  const french = await loadClient('fr', ['en-US', 'en']);
  assert.equal(french.requests.length, 1);
  assert.equal(french.requests[0].url, '/i18n/fr.json');
  assert.equal(french.requests[0].options.credentials, 'same-origin');
  assert.equal(french.window.AttendanceLogI18n.t('action.save'), 'Enregistrer');
  assert.equal(french.translatedNode.textContent, 'Enregistrer');

  const english = await loadClient('en', ['fr-BE', 'fr']);
  assert.equal(english.requests[0].url, '/i18n/en.json');
  assert.equal(english.window.AttendanceLogI18n.t('action.save'), 'Save');
  assert.equal(english.translatedNode.textContent, 'Save');
});

test('translation-dependent client scripts initialize only after the catalog is ready', () => {
  const clientFiles = [
    'audit-log.js',
    'classes.js',
    'live-attendance.js',
    'otp-resend.js',
    'print-design-editor.js',
    'privacy-center.js',
    'security.js',
    'student-qr-print.js',
  ];
  for (const file of clientFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8');
    assert.match(source, /^window\.AttendanceLogI18n\.ready\.then\(\(\) => \{/u, file);
  }
});
