const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';

const { pseudonymFor, ReportingPrivacyError } = require('../src/reporting-privacy');

const KEY = Buffer.alloc(32, 0x11);
const OTHER_KEY = Buffer.alloc(32, 0x22);
const ACTIVITY_A = '11111111-1111-4111-8111-111111111111';
const ACTIVITY_B = '22222222-2222-4222-8222-222222222222';
const STUDENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('pseudonym is deterministic and uses the expected display format', () => {
  const first = pseudonymFor(KEY, ACTIVITY_A, STUDENT_A);
  const second = pseudonymFor(KEY, ACTIVITY_A, STUDENT_A);
  assert.equal(first, second);
  assert.match(first, /^Participant [0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(first.includes(STUDENT_A), false);
});

test('activity scope, participant identity, and secret each affect the pseudonym', () => {
  const baseline = pseudonymFor(KEY, ACTIVITY_A, STUDENT_A);
  assert.notEqual(pseudonymFor(KEY, ACTIVITY_B, STUDENT_A), baseline);
  assert.notEqual(pseudonymFor(KEY, ACTIVITY_A, STUDENT_B), baseline);
  assert.notEqual(pseudonymFor(OTHER_KEY, ACTIVITY_A, STUDENT_A), baseline);
});

test('malformed or missing identifiers are rejected safely', () => {
  for (const [activity, student] of [
    ['not-a-uuid', STUDENT_A],
    [ACTIVITY_A, 'not-a-uuid'],
    [undefined, STUDENT_A],
    [ACTIVITY_A, null],
  ]) {
    assert.throws(
      () => pseudonymFor(KEY, activity, student),
      (error) => error instanceof ReportingPrivacyError && error.code === 'PSEUDONYM_INPUT_INVALID',
    );
  }
  assert.throws(() => pseudonymFor(null, ACTIVITY_A, STUDENT_A), TypeError);
});
