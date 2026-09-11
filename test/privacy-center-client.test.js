const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const clientSource = fs.readFileSync(path.join(__dirname, '../public/js/privacy-center.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../src/privacy-settings.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createClientHarness(fetchImplementation) {
  const attributes = new Map([['aria-disabled', 'true'], ['tabindex', '-1']]);
  const exportLink = {
    classList: {
      values: new Set(['disabled']),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
    },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === 'href') delete this.href;
    },
  };
  const fields = ['name', 'email'].map((privacyField) => ({
    dataset: { privacyField },
    textContent: '—',
  }));
  const drawerElement = {
    querySelector(selector) { return selector === '[data-privacy-export]' ? exportLink : null; },
    querySelectorAll() { return fields; },
    setAttribute() {},
    removeAttribute() {},
  };
  let clickHandler;
  const context = {
    bootstrap: { Offcanvas: { getOrCreateInstance: () => ({ show() {} }) } },
    document: {
      getElementById: () => drawerElement,
      addEventListener: (_name, handler) => { clickHandler = handler; },
    },
    fetch: fetchImplementation,
  };
  vm.runInNewContext(clientSource, context);
  return {
    attributes,
    exportLink,
    open(url) {
      clickHandler({
        preventDefault() {},
        target: { closest: () => ({ dataset: { retentionDetailUrl: url } }) },
      });
    },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('participant export link is non-focusable before participant detail is available', () => {
  const markup = serverSource.match(/<a class="btn btn-primary disabled"[^>]*data-privacy-export[^>]*>/)?.[0];
  assert.ok(markup);
  assert.doesNotMatch(markup, /\shref=/);
  assert.match(markup, /aria-disabled="true"/);
  assert.match(markup, /tabindex="-1"/);
});

test('participant export link enables only for the current successful detail request', async () => {
  const first = deferred();
  let call = 0;
  const harness = createClientHarness(() => {
    call += 1;
    if (call === 1) return first.promise;
    return Promise.resolve({
      ok: true,
      json: async () => ({ fields: { name: 'Second' }, exportUrl: '/safe/second.xlsx' }),
    });
  });

  harness.open('/detail/first');
  assert.equal(harness.exportLink.href, undefined);
  assert.equal(harness.attributes.get('aria-disabled'), 'true');
  assert.equal(harness.attributes.get('tabindex'), '-1');

  harness.open('/detail/second');
  await settle();
  assert.equal(harness.exportLink.href, '/safe/second.xlsx');
  assert.equal(harness.attributes.has('aria-disabled'), false);
  assert.equal(harness.attributes.has('tabindex'), false);
  assert.equal(harness.exportLink.classList.values.has('disabled'), false);

  first.resolve({
    ok: true,
    json: async () => ({ fields: { name: 'First' }, exportUrl: '/stale/first.xlsx' }),
  });
  await settle();
  assert.equal(harness.exportLink.href, '/safe/second.xlsx');
});

test('participant export link remains disabled after a failed detail request', async () => {
  const harness = createClientHarness(async () => ({ ok: false }));
  harness.exportLink.href = '/previous/export.xlsx';
  harness.open('/detail/unavailable');
  await settle();
  assert.equal(harness.exportLink.href, undefined);
  assert.equal(harness.attributes.get('aria-disabled'), 'true');
  assert.equal(harness.attributes.get('tabindex'), '-1');
  assert.equal(harness.exportLink.classList.values.has('disabled'), true);
});
