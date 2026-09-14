// Opt-in browser regression scenarios against the isolated redesign fixture.
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
const ExcelJS = require('exceljs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3001';
const stamp = Date.now();

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: 'attendance_log_session', value: `s:${signature.sign('redesign-admin', 'synthetic-redesign-session-secret-20260913')}`, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const go = async (url) => { assert.equal((await page.goto(origin + url)).status(), 200); await page.evaluate(() => window.AttendanceLogI18n.ready); };
    const submit = async (form = 'main form.app-form') => {
      await Promise.all([page.waitForNavigation(), page.locator(`${form} button[type="submit"]`).first().click()]);
    };
    await go('/classes/new');
    await page.locator('#name').fill(`Workflow course ${stamp}`);
    await page.locator('#description').fill('Synthetic coastal training <not markup>');
    assert.equal(await page.locator('details').getAttribute('open'), null);
    await submit();
    const classPath = await page.locator('.compact-title a').filter({ hasText: `Workflow course ${stamp}` }).getAttribute('href');
    assert.match(classPath, /^\/classes\/[a-f0-9-]{36}$/);
    const classId = classPath.split('/').pop();
    async function addStudent(firstName) {
      await go('/students/new');
      await page.locator('#first_name').fill(firstName);
      await page.locator('#last_name').fill(`Workflow ${stamp}`);
      await page.locator('#email').fill(`${firstName.toLowerCase()}.${stamp}@example.invalid`);
      await page.locator(`input[name="class_ids"][value="${classId}"]`).check();
      await submit();
      await page.locator('[data-list-search]').fill(`${firstName} Workflow ${stamp}`);
      return (await page.locator('.compact-title a:visible').getAttribute('href')).replace(/\/edit$/, '');
    }
    const studentBase = await addStudent('First');
    await go(`${studentBase}/edit`);
    await page.locator('#first_name').fill('First edited');
    await submit();
    await go('/sessions/new');
    await page.locator('#class_id').selectOption(classId);
    await page.locator('#date').fill('2026-09-13');
    await page.locator('#title').fill(`Workflow register ${stamp}`);
    await page.locator('#instructor').fill('Synthetic trainer');
    await page.locator('#start-time').fill('19:00');
    await page.locator('details summary').click();
    await page.locator('#language').selectOption('fr');
    await page.locator('#session-punctuality-tolerance').selectOption('10');
    await submit();
    const sessionPath = new URL(page.url()).pathname;
    assert.match(sessionPath, /^\/sessions\/[a-f0-9-]{36}$/);
    await Promise.all([page.waitForNavigation(), page.locator('[data-session-open] button').click()]);
    assert.equal(await page.locator('[data-total-count]').textContent(), '1');
    await page.locator('[data-quick-attendance-link]').click();
    await page.locator('[data-quick-search]').fill('First edited');
    await page.locator('[data-quick-present-form]:visible button').click();
    await page.waitForFunction(() => document.querySelector('[data-present-count]').textContent === '1');
    await page.locator('[data-quick-close]').click();
    await page.locator('.context-actions .row-menu-toggle').click();
    page.once('dialog', (dialog) => dialog.accept());
    await Promise.all([page.waitForNavigation(), page.locator('[data-session-close] button').click()]);
    assert.equal(await page.locator('[data-session-state]').getAttribute('class').then((v) => v.includes('status-closed')), true);
    assert.equal((await context.request.post(origin + sessionPath + '/attendance/' + studentBase.split('/').pop(), { form: { status: 'present' } })).status(), 409);
    const before = await (await context.request.get(origin + sessionPath + '/status')).json();
    await addStudent('Later');
    await go(sessionPath);
    await Promise.all([page.waitForNavigation(), page.locator('[data-session-open] button').click()]);
    const reopened = await (await context.request.get(origin + sessionPath + '/status')).json();
    assert.equal(reopened.total, 1);
    assert.deepEqual(reopened.roster.map((row) => row.studentId), before.roster.map((row) => row.studentId));
    assert.equal(reopened.present, 1);
    await page.locator('[data-attendance-time-edit]').click();
    await page.locator('#arrival-time').fill('19:04');
    await Promise.all([page.waitForNavigation(), page.locator('[data-arrival-time-form] button[type="submit"]').click()]);
    assert.match(await page.locator('[data-attendance-arrival]').textContent(), /19:04/);
    await page.locator('.context-actions .row-menu-toggle').click();
    page.once('dialog', (dialog) => dialog.accept());
    await Promise.all([page.waitForNavigation(), page.locator('[data-session-close] button').click()]);
    assert.equal((await (await context.request.get(origin + sessionPath + '/status')).json()).total, 1);
    console.log('PASS create/edit course, participant and session; open, manual attendance, close, historical reopen, arrival correction, reclose');

    // Import matches by e-mail and retains QR identity; no real SMTP is invoked.
    const qrBefore = await (await context.request.get(origin + studentBase + '/qr.png')).body();
    await go('/students/import');
    await page.locator('#class_id').selectOption(classId);
    await page.locator('#csv_file').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(`first_name,last_name,email\nFirst edited,Workflow ${stamp},first.${stamp}@example.invalid\n`) });
    await submit('form.import-form');
    assert.equal(await page.locator('.import-summary').count(), 1);
    const qrAfter = await (await context.request.get(origin + studentBase + '/qr.png')).body();
    assert.deepEqual(qrBefore, qrAfter);
    console.log('PASS contextual CSV re-import preserves QR identity');

    await go(`/reporting?class_id=${classId}`);
    assert.equal(await page.locator('[data-report-preview] dd').first().textContent(), '1');
    const exportHref = await page.locator('.form-actions .btn-primary').getAttribute('href');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await context.request.get(origin + exportHref)).body());
    const workbookText = JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()));
    assert.match(workbookText, /First edited/);
    assert.doesNotMatch(workbookText, /Later Workflow/);
    const sessionWorkbook = new ExcelJS.Workbook();
    await sessionWorkbook.xlsx.load(await (await context.request.get(origin + '/reporting/sessions/' + sessionPath.split('/').pop() + '/export')).body());
    assert.match(JSON.stringify(sessionWorkbook.worksheets.map((sheet) => sheet.getSheetValues())), /Présent|Présence/);
    console.log('PASS preview/export historical roster parity and French session business output');

    const offlineContext = await browser.newContext();
    const offlinePage = await offlineContext.newPage();
    await offlinePage.goto(origin + '/health');
    await offlinePage.evaluate(async () => { await caches.open('attendance-log-shell-v15'); await caches.open('attendance-log-shell-v16'); await caches.open('unrelated-test-cache'); });
    await offlinePage.goto(origin + '/login');
    await offlinePage.evaluate(() => navigator.serviceWorker.ready);
    await offlinePage.waitForFunction(async () => !(await caches.keys()).includes('attendance-log-shell-v15'));
    const keys = await offlinePage.evaluate(() => caches.keys());
    assert.ok(keys.includes('attendance-log-shell-v17'));
    assert.ok(!keys.includes('attendance-log-shell-v16'));
    assert.ok(keys.includes('unrelated-test-cache'));
    const cached = await offlinePage.evaluate(async () => (await (await caches.open('attendance-log-shell-v17')).keys()).map((request) => new URL(request.url).pathname));
    assert.ok(cached.includes('/css/styles.css'));
    assert.ok(cached.includes('/fonts/plex/IBMPlexSans-SemiBold.woff2'));
    assert.ok(cached.every((url) => !/^\/(students|sessions|settings|reporting|login|preferences)(\/|$)/.test(url)));
    await offlineContext.setOffline(true);
    await offlinePage.goto(origin + '/sessions');
    assert.match(await offlinePage.locator('body').textContent(), /offline|hors ligne/i);
    const writeResult = await offlinePage.evaluate(async () => { try { await fetch('/sessions/test', { method: 'POST', body: 'status=present' }); return 'unexpected'; } catch { return 'network-required'; } });
    assert.equal(writeResult, 'network-required');
    console.log('PASS service-worker version cleanup, foreign-cache preservation, static-only cache and online-required writes');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
