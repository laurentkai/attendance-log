// Run only against integration/redesign-fixture.js on loopback port 3001.
// PLAYWRIGHT_MODULE points to an isolated Playwright install; no app dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const signature = require('cookie-signature');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3001';
const screenshots = process.env.REDESIGN_SCREENSHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-redesign-'));
const errors = [];

async function contextFor(browser, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-GB' });
  await context.addCookies([{ name: 'attendance_log_session', value: `s:${signature.sign(`redesign-${role}`, 'synthetic-redesign-session-secret-20260913')}`, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  return context;
}

async function go(page, url) {
  const response = await page.goto(origin + url);
  assert.equal(response.status(), 200, url);
  await page.evaluate(() => window.AttendanceLogI18n.ready);
  assert.ok(!(await page.locator('body').textContent()).includes('[object Object]'), url);
}

async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, available: document.documentElement.clientWidth }));
  assert.ok(size.actual <= size.available + 1, `${label}: horizontal overflow ${JSON.stringify(size)}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const admin = await contextFor(browser, 'admin');
    const page = await admin.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await go(page, '/');
    assert.equal(await page.locator('[data-live-session-card]').count(), 1);
    const sessionId = await page.locator('[data-live-session-card]').getAttribute('data-session-id');
    const sessionPath = `/sessions/${sessionId}`;
    await go(page, '/classes');
    const classPath = await page.locator('.compact-title a').filter({ hasText: 'Coastal navigation' }).getAttribute('href');
    await go(page, '/students');
    const studentPath = await page.locator('.compact-title a').filter({ hasText: 'Alex Mariner' }).getAttribute('href');
    const studentBase = studentPath.replace(/\/edit$/, '');
    assert.equal(await page.locator('[data-list-row]:visible').count(), 50);
    await page.locator('.collection-pagination button').last().click();
    assert.equal(await page.locator('[data-list-row]:visible').count(), 15);
    await page.locator('[data-list-search]').fill('Mariner');
    assert.equal(await page.locator('[data-list-row]:visible').count(), 1);
    await page.locator('[data-list-search]').fill('no-match-at-all');
    assert.equal(await page.locator('[data-list-no-results]').isVisible(), true);
    await page.locator('[data-list-no-results] button').click();
    assert.equal(await page.locator('[data-list-search]').inputValue(), '');
    assert.equal(await page.locator('[data-list-search]').evaluate((el) => el === document.activeElement), true);
    await page.locator('[data-list-search]').fill('');
    await page.locator('[data-list-sort]').selectOption('name');
    assert.match(await page.locator('[data-list-row]:visible').first().textContent(), /Alex/);
    await page.locator('.row-menu-toggle:visible').first().click();
    assert.equal(await page.locator('.dropdown-menu.show').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.row-menu-toggle:visible').first().evaluate((el) => el === document.activeElement), true);
    console.log('PASS collection search, no-results, sort, pagination and menu focus');

    const routes = ['/', '/sessions', '/sessions?state=scheduled&sort=oldest', '/classes', classPath, '/students', '/students/new', '/students/import', '/students/qr-print', '/sessions/new', sessionPath, studentPath, `${studentBase}/qr`, '/reporting', '/reporting/courses', '/reporting/students', '/reporting/sessions', '/settings/internationalization', '/settings/users', '/settings/audit', '/settings/privacy', '/settings/backups', '/settings/security', '/settings/email', '/settings/branding', '/settings/print-design', '/settings/terminology', '/settings/maintenance', '/privacy'];
    for (const route of routes) {
      await go(page, route);
      await noOverflow(page, `desktop ${route}`);
      if (!route.startsWith('/privacy')) {
        const expectedSection = route === '/' ? 'home' : route.split('/')[1].split('?')[0];
        assert.equal(await page.locator(`[data-section="${expectedSection}"][aria-current="page"]`).count(), 1, route);
      }
    }
    await go(page, '/settings');
    assert.equal(await page.locator('.settings-directory-link').count(), 11);
    for (const [name, route] of [['dashboard', '/'], ['students', '/students'], ['classes', '/classes'], ['sessions', '/sessions'], ['reporting', '/reporting'], ['settings', '/settings'], ['language-region', '/settings/internationalization'], ['privacy-center', '/settings/privacy'], ['register', sessionPath]]) {
      await go(page, route);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(screenshots, `${name}-desktop.png`) });
    }
    console.log(`PASS desktop route sweep (${routes.length} routes)`);

    const mobileRoutes = ['/', '/sessions', '/classes', classPath, '/students', '/students/new', '/students/import', '/students/qr-print', '/sessions/new', sessionPath, `${sessionPath}/quick-attendance`, studentPath, '/reporting', '/reporting/courses', '/reporting/students', '/settings/internationalization', '/settings/users', '/settings/privacy', '/settings/backups', '/settings/audit', '/settings/print-design'];
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of mobileRoutes) { await go(page, route); await noOverflow(page, `${width}px ${route}`); }
      await go(page, '/');
      await page.locator('[data-bs-toggle="offcanvas"][data-bs-target="#primary-navigation"]').click();
      await page.locator('#primary-navigation.show').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('#primary-navigation.show').waitFor({ state: 'hidden' });
      await page.locator('[data-bs-toggle="offcanvas"][data-bs-target="#primary-navigation"]').evaluate((el) => { if (el !== document.activeElement) throw Error('Drawer did not restore focus'); });
      await go(page, '/settings/internationalization');
      await page.locator('.settings-mobile-toggle').click();
      await page.locator('[data-settings-search]').fill('backup');
      assert.equal(await page.locator('.settings-navigation a:visible').count(), 1);
      await page.locator('[data-settings-search]').fill('no-match');
      assert.equal(await page.locator('[data-settings-empty]').isVisible(), true);
      console.log(`PASS ${width}px route sweep, drawer focus and settings search`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [name, route] of [['dashboard', '/'], ['students', '/students'], ['sessions', '/sessions'], ['register', sessionPath], ['quick-attendance', `${sessionPath}/quick-attendance`], ['settings', '/settings']]) {
      await go(page, route); await page.evaluate(() => document.fonts.ready); await noOverflow(page, `390px ${route}`); await page.screenshot({ path: path.join(screenshots, `${name}-390.png`) });
    }

    await go(page, sessionPath);
    await page.locator('[data-attendance-filter="present"]').click();
    assert.equal(await page.locator('[data-student-id]:visible').count(), 4);
    await page.locator('[data-attendance-filter="pending"]').click();
    assert.equal(await page.locator('[data-student-id]:visible').count(), 61);
    // Reduced available height approximates a virtual keyboard; it is not a
    // physical-device keyboard test.
    await page.setViewportSize({ width: 390, height: 420 });
    await go(page, `${sessionPath}/quick-attendance`);
    await noOverflow(page, 'Quick Attendance with reduced viewport height');
    assert.ok((await page.locator('[data-quick-search]').boundingBox()).y < 180);
    assert.equal(await page.locator('.app-header, .app-footer').count(), 0);
    const countBefore = Number(await page.locator('[data-present-count]').textContent());
    await page.locator('[data-quick-search]').fill('Alex Mariner');
    const topBefore = await page.locator('[data-quick-search]').boundingBox();
    await page.locator('[data-quick-present-form]:visible button').click();
    await page.waitForFunction((before) => Number(document.querySelector('[data-present-count]').textContent) === before + 1, countBefore);
    assert.equal(await page.locator('[data-attendance-progress]').evaluate((el) => el.value), countBefore + 1);
    assert.equal(await page.locator('[data-quick-search]').inputValue(), '');
    assert.equal(await page.locator('[data-quick-search]').evaluate((el) => el === document.activeElement), true);
    assert.equal((await page.locator('[data-quick-search]').boundingBox()).y, topBefore.y);
    await page.locator('[data-quick-undo]').click();
    await page.waitForFunction((before) => Number(document.querySelector('[data-present-count]').textContent) === before, countBefore);
    assert.equal(await page.locator('[data-attendance-progress]').evaluate((el) => el.value), countBefore);
    await page.locator('[data-quick-mode="qr"]').click();
    assert.equal(await page.locator('[data-quick-mode-panel="manual"]').isVisible(), false);
    assert.equal(await page.locator('[data-quick-mode-panel="qr"]').isVisible(), true);
    await page.locator('[data-quick-mode="manual"]').click();
    assert.equal(await page.locator('[data-quick-mode-panel="qr"]').isVisible(), false);
    console.log('PASS attendance filters, manual entry, refocus, stable layout, Undo and mode exclusivity');

    // Decode the app-generated synthetic QR with the shipped scanner, then use
    // the same authoritative QR endpoint. Physical camera feedback is separate.
    const payload = await page.evaluate(async (studentBase) => {
      const { default: QrScanner } = await import('/vendor/qr-scanner/qr-scanner.min.js');
      const result = await QrScanner.scanImage(`${studentBase}/qr.png`, { returnDetailedScanResult: true });
      return result.data;
    }, studentBase);
    const qrResponse = await admin.request.post(`${origin}${sessionPath}/quick-attendance/qr`, { form: { payload }, headers: { Accept: 'application/json' } });
    assert.equal(qrResponse.status(), 200);
    const qrResult = await qrResponse.json();
    const duplicate = await admin.request.post(`${origin}${sessionPath}/quick-attendance/qr`, { form: { payload }, headers: { Accept: 'application/json' } });
    assert.equal(duplicate.status(), 200);
    const status = await (await admin.request.get(`${origin}${sessionPath}/status`)).json();
    assert.equal(status.present, countBefore + 1);
    const unknown = await admin.request.post(`${origin}${sessionPath}/quick-attendance/qr`, { form: { payload: 'invalid-qr' }, headers: { Accept: 'application/json' } });
    assert.equal(unknown.status(), 404);
    const undoQr = await admin.request.post(`${origin}${sessionPath}/quick-attendance/${qrResult.studentId}/undo`, { form: { previous_status: qrResult.previousStatus, expected_version: qrResult.version }, headers: { Accept: 'application/json' } });
    assert.equal(undoQr.status(), 200);
    console.log('PASS generated QR decoding, QR entry, duplicate idempotency and unknown QR');

    const manager = await contextFor(browser, 'private');
    const privatePage = await manager.newPage();
    await go(privatePage, '/reporting');
    assert.equal(await privatePage.locator('html').getAttribute('lang'), 'fr');
    assert.equal(await privatePage.locator('[data-report-preview]').getAttribute('lang'), 'en');
    for (const route of ['/reporting/students', `/reporting/courses/${classPath.split('/').pop()}`]) {
      const response = await manager.request.get(origin + route);
      assert.equal(response.status(), 200);
      assert.doesNotMatch(await response.text(), /Mariner|Sailor|demo\.\d+@example\.invalid/);
    }
    assert.equal((await manager.request.get(origin + '/settings/users')).status(), 403);
    assert.equal((await manager.request.get(origin + '/settings')).status(), 403);
    const operator = await contextFor(browser, 'operator');
    for (const route of ['/students', '/classes', '/settings/backups', '/reporting']) assert.equal((await operator.request.get(origin + route)).status(), 403);
    assert.equal((await operator.request.post(`${origin}${sessionPath}/close`)).status(), 403);
    console.log('PASS EN/FR context, Reporting PII minimization and role boundaries');

    await go(page, '/reporting?date_from=2099-01-01&date_to=2099-01-02');
    assert.equal(await page.locator('[data-report-preview] dd').first().textContent(), '0');
    assert.match(await page.locator('.form-actions a.btn-primary').getAttribute('href'), /date_from=2099-01-01.*date_to=2099-01-02/);
    assert.equal((await admin.request.get(origin + '/reporting?date_from=2026-02-30')).status(), 400);
    assert.equal((await admin.request.get(origin + '/reporting?class_id=bad')).status(), 400);
    console.log('PASS report preview filters, export selection parity and invalid inputs');
    await go(page, '/reporting/sessions');
    assert.equal(await page.locator('.report-direct-actions').count(), 2);
    assert.equal(await page.locator('.report-direct-actions a:visible').count(), 4);
    await go(privatePage, '/reporting');
    assert.equal(await privatePage.locator('.privacy-mode').isVisible(), true);
    await privatePage.evaluate(() => document.fonts.ready);
    await privatePage.screenshot({ path: path.join(screenshots, 'reporting-private-fr-desktop.png') });
    await admin.request.post(origin + '/preferences/ui-language', { form: { ui_language: 'fr', return_to: '/' } });
    try {
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const route of ['/', '/students', '/sessions', sessionPath, `${sessionPath}/quick-attendance`, '/reporting/sessions', '/settings', '/settings/terminology']) {
          await go(page, route); await noOverflow(page, `French ${width}px ${route}`);
          assert.equal(await page.locator('html').getAttribute('lang'), 'fr');
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      for (const [name, route] of [['home-fr', '/'], ['settings-fr', '/settings'], ['quick-fr', `${sessionPath}/quick-attendance`]]) {
        await go(page, route); await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(screenshots, `${name}-390.png`) });
      }
    } finally {
      await admin.request.post(origin + '/preferences/ui-language', { form: { ui_language: 'en', return_to: '/' } });
    }
    console.log('PASS second-pass Settings overview, direct report actions, French responsive sweep and synthetic screenshots');
    assert.deepEqual(errors, []);
    console.log(`Screenshots: ${screenshots}`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
