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
  const classList = (initial = []) => ({
    values: new Set(initial),
    add(value) { this.values.add(value); },
    remove(value) { this.values.delete(value); },
  });
  const exportLink = {
    classList: classList(['disabled']),
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === 'href') delete this.href;
    },
  };
  const anonymizeAttributes = new Map([['aria-disabled', 'true']]);
  const anonymizeButton = {
    classList: classList(['disabled']),
    dataset: {},
    disabled: true,
    hidden: false,
    setAttribute(name, value) { anonymizeAttributes.set(name, value); },
    removeAttribute(name) { anonymizeAttributes.delete(name); },
  };
  const anonymizationMessage = { textContent: '' };
  const anonymizationForm = {
    action: '',
    removeAttribute(name) { if (name === 'action') this.action = ''; },
  };
  const anonymizationCounts = ['memberships', 'attendanceRecords', 'auditRows'].map((name) => ({
    dataset: { privacyAnonymizationCount: name },
    textContent: '0',
  }));
  let modalShowCount = 0;
  const modalElement = {
    querySelector(selector) {
      return selector === '[data-privacy-anonymization-form]' ? anonymizationForm : null;
    },
    querySelectorAll() { return anonymizationCounts; },
  };
  const fields = ['name', 'email'].map((privacyField) => ({
    dataset: { privacyField },
    textContent: '—',
  }));
  const drawerElement = {
    querySelector(selector) {
      if (selector === '[data-privacy-export]') return exportLink;
      if (selector === '[data-privacy-anonymize]') return anonymizeButton;
      if (selector === '[data-privacy-anonymization-message]') return anonymizationMessage;
      return null;
    },
    querySelectorAll() { return fields; },
    setAttribute() {},
    removeAttribute() {},
  };
  let clickHandler;
  const context = {
    bootstrap: {
      Offcanvas: { getOrCreateInstance: () => ({ show() {} }) },
      Modal: { getOrCreateInstance: () => ({ show() { modalShowCount += 1; } }) },
    },
    document: {
      getElementById: (id) => {
        if (id === 'privacy-participant-detail') return drawerElement;
        if (id === 'privacy-anonymization-modal') return modalElement;
        return null;
      },
      addEventListener: (_name, handler) => { clickHandler = handler; },
    },
    fetch: fetchImplementation,
  };
  vm.runInNewContext(clientSource, context);
  return {
    attributes,
    anonymizationCounts,
    anonymizationForm,
    anonymizationMessage,
    anonymizeAttributes,
    anonymizeButton,
    exportLink,
    get modalShowCount() { return modalShowCount; },
    open(url) {
      clickHandler({
        preventDefault() {},
        target: { closest: (selector) => (selector === '[data-retention-detail-url]' ? { dataset: { retentionDetailUrl: url } } : null) },
      });
    },
    anonymize() {
      clickHandler({
        preventDefault() {},
        target: { closest: (selector) => (selector === '[data-privacy-anonymize]' ? anonymizeButton : null) },
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

test('eligible participant requires a current server preview before the confirmation modal opens', async () => {
  const harness = createClientHarness(async (url) => {
    if (url === '/detail/eligible') {
      return {
        ok: true,
        json: async () => ({
          fields: { name: 'Participant test' },
          exportUrl: '/safe/export.xlsx',
          anonymization: {
            eligible: true,
            previewUrl: '/preview/current',
            message: 'Actuellement éligible.',
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        actionUrl: '/settings/privacy/participants/00000000-0000-4000-8000-000000000001/anonymize',
        counts: { memberships: 2, attendanceRecords: 3, auditRows: 4 },
      }),
    };
  });

  harness.open('/detail/eligible');
  await settle();
  assert.equal(harness.anonymizeButton.disabled, false);
  assert.equal(harness.anonymizeButton.dataset.previewUrl, '/preview/current');
  assert.equal(harness.modalShowCount, 0);

  harness.anonymize();
  await settle();
  assert.equal(harness.modalShowCount, 1);
  assert.equal(harness.anonymizationForm.action, '/settings/privacy/participants/00000000-0000-4000-8000-000000000001/anonymize');
  assert.deepEqual(harness.anonymizationCounts.map((field) => field.textContent), ['2', '3', '4']);
});

test('a failed final eligibility check keeps anonymization unavailable', async () => {
  const harness = createClientHarness(async (url) => {
    if (url === '/detail/eligible') return {
      ok: true,
      json: async () => ({
        fields: {},
        anonymization: { eligible: true, previewUrl: '/preview/changed', message: 'Actuellement éligible.' },
      }),
    };
    return {
      ok: false,
      json: async () => ({ message: 'Le participant n’est plus éligible.' }),
    };
  });
  harness.open('/detail/eligible');
  await settle();
  harness.anonymize();
  await settle();
  assert.equal(harness.modalShowCount, 0);
  assert.equal(harness.anonymizeButton.disabled, true);
  assert.equal(harness.anonymizationForm.action, '');
  assert.match(harness.anonymizationMessage.textContent, /plus éligible/i);
});

test('changed eligibility blocks confirmation and stale preview responses cannot open the modal', async () => {
  const stalePreview = deferred();
  const harness = createClientHarness((url) => {
    if (url === '/detail/first') return Promise.resolve({
      ok: true,
      json: async () => ({
        fields: {},
        anonymization: { eligible: true, previewUrl: '/preview/stale', message: 'Actuellement éligible.' },
      }),
    });
    if (url === '/preview/stale') return stalePreview.promise;
    if (url === '/detail/second') return Promise.resolve({
      ok: true,
      json: async () => ({
        fields: {},
        anonymization: { eligible: false, message: 'Action indisponible : activité trop récente.' },
      }),
    });
    throw new Error(`Unexpected URL: ${url}`);
  });

  harness.open('/detail/first');
  await settle();
  harness.anonymize();
  harness.open('/detail/second');
  await settle();
  stalePreview.resolve({
    ok: true,
    json: async () => ({ actionUrl: '/stale/anonymize', counts: {} }),
  });
  await settle();

  assert.equal(harness.modalShowCount, 0);
  assert.equal(harness.anonymizeButton.disabled, true);
  assert.equal(harness.anonymizeButton.dataset.previewUrl, undefined);
  assert.equal(harness.anonymizationForm.action, '');
  assert.match(harness.anonymizationMessage.textContent, /activité trop récente/i);
});

test('already-anonymized participant has no destructive action', async () => {
  const harness = createClientHarness(async () => ({
    ok: true,
    json: async () => ({
      fields: {},
      anonymization: { alreadyAnonymized: true, eligible: false, message: 'Ce participant est déjà anonymisé.' },
    }),
  }));
  harness.open('/detail/anonymized');
  await settle();
  assert.equal(harness.anonymizeButton.hidden, true);
  assert.equal(harness.anonymizeButton.disabled, true);
});
