const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';

const {
  privacyNoticeHandler,
  renderPrivacyNoticePage,
  router,
} = require('../src/privacy-notice');
const { hasPermission, permissions, roles } = require('../src/permissions');

test('public privacy route is a standalone unauthenticated GET', () => {
  const route = router.stack.find((layer) => layer.route?.path === '/privacy');
  assert.ok(route);
  assert.equal(route.route.methods.get, true);

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8');
  const publicRouterOffset = serverSource.search(/app\.use\(\s*privacyNoticeRouter\s*\)/);
  const sessionOffset = serverSource.search(/app\.use\(\s*session\s*\(/);
  const authenticationOffset = serverSource.search(/app\.use\(\s*requireAuthentication\s*\)/);
  assert.notEqual(publicRouterOffset, -1);
  assert.notEqual(sessionOffset, -1);
  assert.notEqual(authenticationOffset, -1);
  assert.ok(publicRouterOffset < sessionOffset, 'public privacy router must run before session middleware');
  assert.ok(publicRouterOffset < authenticationOffset, 'public privacy router must run before authentication');
  assert.match(serverSource, /app\.use\('\/settings\/privacy', requirePermission\(permissions\.manageSettings\), privacySettingsRouter\)/);
  assert.match(authSource, /href="\/privacy"[^>]*>\$\{escapeHtml\(t\(language, 'auth\.privacy'\)\)\}/);
  assert.match(uiSource, /href="\/privacy"[^>]*>\$\{escapeHtml\(t\(language, 'shell\.data_protection'\)\)\}/);
});

test('authenticated Privacy Center permission remains administrator-only', () => {
  assert.equal(hasPermission({ role: roles.administrator }, permissions.manageSettings), true);
  assert.equal(hasPermission({ role: roles.manager }, permissions.manageSettings), false);
  assert.equal(hasPermission({ role: roles.attendanceOperator }, permissions.manageSettings), false);
});

test('public privacy notice contains the required participant information without administration data', () => {
  const html = renderPrivacyNoticePage(require('../src/privacy-notice').buildPrivacyNotice('fr'));
  assert.match(html, /ASBL Nouveaux Horizons/);
  assert.match(html, /contact@nouveauxhorizons\.be/);
  assert.match(html, /12 mois/);
  assert.match(html, /article 6, paragraphe 1, point b\)/i);
  assert.match(html, /article 6, paragraphe 1, point f\)/i);
  assert.match(html, /accès à vos données/i);
  assert.match(html, /rectification/i);
  assert.match(html, /effacement/i);
  assert.match(html, /vous opposer/i);
  assert.match(html, /Autorité de protection des données/);
  assert.doesNotMatch(html, /admin_audit_log|SESSION_SECRET|HMAC|migration 0|\/settings\/privacy/i);
});

test('public privacy response is cacheable and contains no personalized data', () => {
  const headers = {};
  let body = '';
  privacyNoticeHandler({ get: () => 'fr-BE,fr;q=0.9' }, {
    set(name, value) { headers[name] = value; },
    send(value) { body = value; },
  });
  assert.equal(headers['Cache-Control'], 'public, max-age=300');
  assert.match(body, /Protection des données/);
  assert.doesNotMatch(body, /attendance_log_session|\/settings\/privacy|data-privacy-field/);
});

test('public privacy response follows Accept-Language with English fallback and no session state', () => {
  const render = (header) => {
    const headers = {};
    let body = '';
    privacyNoticeHandler({ get: () => header }, {
      set(name, value) { headers[name] = value; },
      send(value) { body = value; },
    });
    return { headers, body };
  };
  assert.match(render('en-GB,en;q=0.9').body, /<html lang="en">/);
  assert.match(render('fr-BE,fr;q=0.9').body, /<html lang="fr">/);
  assert.match(render('de-DE,de;q=0.9').body, /<html lang="en">/);
  assert.equal(Object.keys(render('fr').headers).some((name) => name.toLowerCase() === 'set-cookie'), false);
});
