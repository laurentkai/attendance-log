const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test';
const { renderPage, renderActionMenu, renderCollectionTools, renderSettingsLayout, renderMessagePage, renderSettingsOverview, renderDateMarker, renderAttendanceProgress, renderMetricStrip } = require('../src/ui');
const { requestContextMiddleware } = require('../src/request-context');

function renderFor(role, originalUrl, language = 'en') {
  let html;
  requestContextMiddleware({ path: '/', originalUrl, uiLanguage: language, currentUser: { role, name: '<Demo & operator>' } }, {}, () => {
    html = renderPage('Test', '<h1>Test</h1>');
  });
  return html;
}

test('nested routes resolve active navigation on the server without client JavaScript', () => {
  const html = renderFor('administrator', '/students/00000000-0000-4000-8000-000000000001/edit');
  assert.match(html, /data-section="students" aria-current="page"/);
  assert.doesNotMatch(html, /data-section="home" aria-current/);
  assert.match(html, /data-bs-toggle="offcanvas"/);
  assert.match(html, /&lt;Demo &amp; operator&gt;/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test('navigation preserves the fixed role boundaries in EN and FR', () => {
  for (const language of ['en', 'fr']) {
    const operator = renderFor('attendance_operator', '/sessions', language);
    assert.match(operator, /data-section="sessions" aria-current="page"/);
    assert.doesNotMatch(operator, /data-section="(?:students|classes|reporting|settings)"/);
    const manager = renderFor('manager', '/reporting', language);
    assert.match(manager, /data-section="reporting" aria-current="page"/);
    assert.doesNotMatch(manager, /data-section="settings"/);
    const admin = renderFor('administrator', '/settings/privacy', language);
    assert.match(admin, /data-section="settings" aria-current="page"/);
  }
});

test('quick attendance remains outside both navigation and shared footer', () => {
  const html = renderPage('Quick', '<h1>Quick</h1>', { navigation: false, pageClass: 'page--quick-attendance' });
  assert.doesNotMatch(html, /class="app-footer"|id="primary-navigation"|class="navbar /);
});

test('shared menu and collection controls escape names and have accessible labels', () => {
  const menu = renderActionMenu('<Alex "Sailor">', '<a class="dropdown-item" href="/students">Open</a>');
  assert.match(menu, /aria-label="&lt;Alex &quot;Sailor&quot;&gt;"/);
  assert.match(menu, /type="button" data-bs-toggle="dropdown"/);
  const tools = renderCollectionTools({ language: 'fr', id: 'roster', placeholder: '<Nom>', count: 65 });
  assert.match(tools, /for="roster-search"/);
  assert.match(tools, /aria-controls="roster"/);
  assert.match(tools, /&lt;Nom&gt;/);
  assert.match(tools, /65 résultats/);
});

test('all eleven settings destinations share grouped navigation and a mobile chooser', () => {
  let html;
  requestContextMiddleware({ uiLanguage: 'fr' }, {}, () => {
    html = renderSettingsLayout({ activeSection: 'privacy', title: 'Confidentialité', content: '<p>Content</p>' });
  });
  assert.equal((html.match(/data-settings-group/g) || []).length, 3);
  assert.equal((html.match(/href="\/settings\//g) || []).length, 11);
  assert.match(html, /href="\/settings\/privacy" aria-current="page"/);
  assert.match(html, /data-settings-search/);
  assert.match(html, /aria-controls="settings-navigation-panel"/);
});

test('error-page recovery actions use the current UI language when not passed explicitly', () => {
  let html;
  requestContextMiddleware({ uiLanguage: 'fr' }, {}, () => {
    html = renderMessagePage('Erreur', 'Réessayez plus tard.', 503).html;
  });
  assert.match(html, />Réessayer<\/a>/);
  assert.doesNotMatch(html, />Try again<\/a>/);
  const denied = renderMessagePage('Denied', 'No access', 403, 'en').html;
  assert.doesNotMatch(denied, />Try again<\/a>/);
  assert.match(denied, /class="error-code" aria-hidden="true">403/);
  assert.match(denied, /href="\/">Home<\/a>/);
});

test('date markers preserve calendar dates and expose the complete localized date', () => {
  const html = renderDateMarker('2026-09-13');
  assert.match(html, /datetime="2026-09-13"/);
  assert.match(html, /class="visually-hidden">13 septembre 2026/);
  assert.match(html, /aria-hidden="true">13<\/span>/);
  assert.equal(renderDateMarker('bad'), '');
});

test('shared progress has bounded finite values and translated accessible counts', () => {
  assert.match(renderAttendanceProgress(4, 65, 'en'), /value="4" max="65"/);
  assert.match(renderAttendanceProgress(4, 65, 'fr'), /aria-label="4 \/ 65 présents"/);
  assert.match(renderAttendanceProgress(0, 0, 'en'), /value="0" max="1"/);
  assert.match(renderAttendanceProgress(9, 4, 'en'), /value="4" max="4"/);
  assert.match(renderAttendanceProgress(Infinity, NaN, 'en'), /value="0" max="1"/);
});

test('Settings overview reuses the same eleven destinations without loading configuration or secrets', () => {
  for (const language of ['en', 'fr']) {
    let html;
    requestContextMiddleware({ uiLanguage: language }, {}, () => { html = renderSettingsOverview(language); });
    assert.equal((html.match(/class="settings-directory-link"/g) || []).length, 11);
    assert.match(html, /href="\/settings" aria-current="page"/);
    assert.doesNotMatch(html, /<form|type="password"|recovery-key-output/);
    assert.match(renderFor('administrator', '/settings', language), /href="\/settings" data-section="settings" aria-current="page"/);
  }
});

test('Reporting and Privacy share semantic, escaped metric-strip markup', () => {
  const html = renderMetricStrip([['<Learners & crew>', 7], ['Rate', '80,0 %']], 'Totals', 'policy-summary');
  assert.match(html, /<dl class="report-summary policy-summary" aria-label="Totals">/);
  assert.match(html, /<dt>&lt;Learners &amp; crew&gt;<\/dt><dd>7<\/dd>/);
  assert.match(html, /<dt>Rate<\/dt><dd>80,0 %<\/dd>/);
});
