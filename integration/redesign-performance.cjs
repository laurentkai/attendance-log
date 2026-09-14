// Synthetic loopback fixture only. DOM expansion measures collection interaction,
// not database scaling. No writes are made to the application.
const assert = require('node:assert/strict');
const signature = require('cookie-signature');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3001';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: 'attendance_log_session', value: `s:${signature.sign('redesign-admin', 'synthetic-redesign-session-secret-20260913')}`, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    for (const count of [65, 1000, 5000]) {
      // Capture the genuine list HTML and initialize its actual interaction script
      // once, after expanding synthetic rows to the requested size.
      const response = await context.request.get(`${origin}/students`);
      assert.equal(response.status(), 200);
      await page.route('**/js/classes.js', (route) => route.fulfill({ body: '' }));
      await page.goto(`${origin}/students`);
      await page.evaluate(async (size) => {
        await window.AttendanceLogI18n.ready;
        const results = document.querySelector('[data-list-results]');
        const template = results.firstElementChild;
        const fragment = document.createDocumentFragment();
        for (let i = results.children.length; i < size; i += 1) {
          const row = template.cloneNode(true);
          row.dataset.search = `Synthetic sailor ${i}`;
          row.querySelector('.compact-title').textContent = `Synthetic sailor ${i}`;
          fragment.append(row);
        }
        results.append(fragment);
      }, count);
      await page.unroute('**/js/classes.js');
      await page.addScriptTag({ url: `${origin}/js/classes.js` });
      const measurements = await page.evaluate(async () => {
        const input = document.querySelector('[data-list-search]');
        const sort = document.querySelector('[data-list-sort]');
        const measure = (element, event) => {
          const start = performance.now();
          element.dispatchEvent(new Event(event, { bubbles: true }));
          return performance.now() - start;
        };
        sort.value = 'name';
        const sorting = measure(sort, 'change');
        const filtering = [];
        for (const text of ['s', 'sa', 'sai', 'sail', 'sailor', 'no match', '']) {
          input.value = text;
          filtering.push(measure(input, 'input'));
        }
        await new Promise(requestAnimationFrame);
        return { sortingMs: sorting, filterMaxMs: Math.max(...filtering), visible: document.querySelectorAll('[data-list-row]:not([hidden])').length };
      });
      assert.equal(measurements.visible, 50);
      console.log(JSON.stringify({ collectionRows: count, ...measurements }));
    }
    const samples = [];
    for (let i = 0; i < 12; i += 1) {
      const start = performance.now();
      const response = await context.request.get(`${origin}/reporting`);
      assert.equal(response.status(), 200);
      const html = await response.text();
      samples.push({ ms: performance.now() - start, bytes: Buffer.byteLength(html) });
    }
    const warm = samples.slice(2).map((sample) => sample.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ reporting: { coldMs: samples[0].ms, warmMedianMs: warm[5], warmMaxMs: warm.at(-1), htmlBytes: samples[0].bytes } }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
