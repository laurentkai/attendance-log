const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';

const { DATA_FIELDS, sanitizeObject } = require('../src/audit');

test('audit sanitizer preserves safe scalar types and null', () => {
  assert.deepEqual(sanitizeObject({
    active: true,
    enabled: false,
    smtp_port: 587,
    notes: null,
  }, DATA_FIELDS), {
    active: true,
    enabled: false,
    smtp_port: 587,
    notes: null,
  });
});

test('audit sanitizer handles invalid numbers and bounds strings', () => {
  const result = sanitizeObject({
    smtp_port: Number.NaN,
    notes: 'x'.repeat(700),
  }, DATA_FIELDS);
  assert.equal(result.smtp_port, null);
  assert.equal(result.notes.length, 500);
});

test('audit sanitizer removes non-allowlisted values', () => {
  const result = sanitizeObject({ active: true, password_hash: 'never-store-this' }, DATA_FIELDS);
  assert.deepEqual(result, { active: true });
  assert.equal(Object.hasOwn(result, 'password_hash'), false);
});
