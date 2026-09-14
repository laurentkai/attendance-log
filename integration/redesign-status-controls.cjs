// Opt-in layout regression against redesign-fixture.js on loopback only.
// Reuses the Astra synthetic sessions; never changes business records.
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3001';
const widths = [360, 390, 430, 768, 992, 1024, 1440];

// Measure actual text fragments, not screenshot pixels or a hardcoded chip height.
// Also catch text spilling out of a chip after a superficial nowrap-only fix.
async function inspect(page, selector) {
  return page.locator(selector).evaluateAll((elements) => elements.filter((el) => el.getClientRects().length).map((el) => {
    const box = el.getBoundingClientRect();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const fragments = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      fragments.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
    }
    const style = getComputedStyle(el);
    return {
      label: el.textContent.trim(),
      lines: new Set(fragments.map((rect) => Math.round(rect.top))).size,
      clipped: fragments.some((rect) => rect.left < box.left - 1 || rect.right > box.right + 1),
      exceedsParent: box.width > el.parentElement.getBoundingClientRect().width + 1,
      height: box.height,
      singleLineHeight: parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth),
    };
  }));
}

function assertCompact(items, context, checkHeight = false) {
  for (const item of items) {
    assert.ok(item.lines <= 1, `${context}: wrapped ${JSON.stringify(item)}`);
    assert.equal(item.clipped, false, `${context}: clipped ${item.label}`);
    if (checkHeight) {
      assert.ok(item.height <= item.singleLineHeight + 1, `${context}: oversized ${item.label}`);
      assert.equal(item.exceedsParent, false, `${context}: status exceeds its column: ${item.label}`);
    }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addCookies([{ name: 'attendance_log_session', value: `s:${signature.sign('redesign-admin', 'synthetic-redesign-session-secret-20260913')}`, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const go = async (path) => {
      assert.equal((await page.goto(origin + path)).status(), 200, path);
      await page.evaluate(async () => { await window.AttendanceLogI18n.ready; await document.fonts.ready; });
    };
    await go('/');
    const session = `/sessions/${await page.locator('[data-live-session-card]').first().getAttribute('data-session-id')}`;
    await go('/classes');
    const course = await page.locator('.compact-title a').filter({ hasText: 'Coastal navigation' }).getAttribute('href');
    const routes = ['/', '/students', '/classes', course, '/sessions', session, `${session}/quick-attendance`, '/reporting', '/reporting/sessions', '/reporting/students', '/settings', '/settings/privacy', '/settings/audit', '/settings/users', '/settings/email', '/settings/security', '/settings/backups'];
    let pages = 0;
    for (const language of ['en', 'fr']) {
      assert.ok((await context.request.post(origin + '/preferences/ui-language', { form: { ui_language: language, return_to: '/' } })).ok());
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        for (const route of routes) {
          await go(route);
          const label = `${language} ${width}px ${route}`;
          assert.equal(await page.locator('html').getAttribute('lang'), language);
          assertCompact(await inspect(page, '.status-badge'), label, true);
          assertCompact(await inspect(page, '.badge:not(.status-badge), .data-table-result-state, .attendance-punctuality-value'), label);
          // Exercise the other real labels used by this shared primitive in
          // their own screen, without creating provider or privacy state.
          const variants = {
            '/students': ['status.active', 'status.inactive', 'status.anonymized'],
            '/settings/email': ['mail.configured', 'mail.incomplete'],
            '/settings/security': ['security.encryption_active', 'security.key_check'],
            '/settings/backups': ['backup.automatic.active', 'backup.automatic.inactive', 'status.success', 'status.failed', 'restore.safety.generated'],
          }[route] || [];
          for (const key of variants) {
            await page.locator('.status-badge').first().evaluate((el, { key, student }) => {
              const t = window.AttendanceLogI18n.t;
              el.textContent = student ? t('students.qr.status', { status: t(key) }) : t(key);
            }, { key, student: route === '/students' });
            assertCompact(await inspect(page, '.status-badge'), `${label} ${key}`, true);
          }
          // Compact operational actions only; descriptions and longer contextual
          // commands/dropdown items intentionally retain their wrapping behavior.
          assertCompact(await inspect(page, '[data-attendance-form] button, .register-status-filter button, .quick-mode-switch button, .quick-undo, [data-quick-present-form] button, .report-direct-actions .btn, .row-menu-toggle, .view-switch > .nav-link'), label);
          const size = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, available: document.documentElement.clientWidth }));
          assert.ok(size.actual <= size.available + 1, `${label}: page overflow`);
          assert.doesNotMatch(await page.locator('body').innerText(), /\bundefined\b|\[object Object\]/, label);
          pages += 1;
        }
        await go(session);
        // Exercise each real attendance label in its genuine register wrapper.
        // Presentation-only replacements avoid altering eligibility/history.
        for (const status of ['pending', 'present', 'absent']) {
          await page.locator('[data-attendance-status]').first().evaluate((el, status) => {
            el.className = `badge status-badge status-${status}`;
            el.textContent = window.AttendanceLogI18n.t(`status.${status}`);
          }, status);
          assertCompact(await inspect(page, '[data-attendance-status]'), `${language} ${width}px ${status}`, true);
        }
        for (const status of ['on_time', 'late', 'unavailable']) {
          await page.locator('.attendance-punctuality-value:visible').first().evaluate((el, status) => {
            el.textContent = window.AttendanceLogI18n.t(`status.${status}`);
          }, status);
          assertCompact(await inspect(page, '.attendance-punctuality-value'), `${language} ${width}px ${status}`);
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${pages} EN/FR status/action route checks at ${widths.join('/')}px; single-line text, chip height, clipping and page overflow`);
  } finally {
    if (context) await context.request.post(origin + '/preferences/ui-language', { form: { ui_language: 'en', return_to: '/' } }).catch(() => {});
    await browser.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
