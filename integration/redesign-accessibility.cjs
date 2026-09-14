// Uses temporary browser tooling, against synthetic loopback data only.
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const AxeBuilder = require(process.env.AXE_MODULE || '@axe-core/playwright').default;
const origin = 'http://127.0.0.1:3001';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'attendance_log_session', value: `s:${signature.sign('redesign-admin', 'synthetic-redesign-session-secret-20260913')}`, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    await page.goto(origin);
    const sessionId = await page.locator('[data-live-session-card]').first().getAttribute('data-session-id');
    const routes = ['/', '/students', '/classes', '/sessions', `/sessions/${sessionId}`, `/sessions/${sessionId}/quick-attendance`, '/students/new', '/sessions/new', '/reporting', '/reporting/sessions', '/settings', '/settings/internationalization', '/settings/terminology', '/settings/privacy', '/settings/backups', '/settings/security', '/settings/print-design'];
    const failures = [];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of routes) {
        assert.equal((await page.goto(origin + route)).status(), 200);
        await page.evaluate(async () => { await window.AttendanceLogI18n.ready; await document.fonts.ready; });
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        if (result.violations.length) failures.push({ route, width, violations: result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, count: violation.nodes.length, examples: violation.nodes.slice(0, 3).map((node) => ({ target: node.target, summary: node.failureSummary })) })) });
      }
    }
    console.log(JSON.stringify({ pages: routes.length * 2, failures }, null, 2));
    assert.equal(failures.length, 0, 'Accessibility violations must be resolved');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
