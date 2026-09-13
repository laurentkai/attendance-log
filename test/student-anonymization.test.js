const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';

const { evaluateRetentionEligibility } = require('../src/data-retention');
const {
  ANONYMIZED_FIRST_NAME,
  ANONYMIZED_LAST_NAME,
  StudentAnonymizationError,
  anonymizeStudent,
  createAnonymizedIdentity,
  getStudentAnonymizationPreview,
  redactParticipantAuditData,
  redactParticipantAuditMetadata,
  redactParticipantAuditSummary,
} = require('../src/student-anonymization');

test('anonymized identity uses non-identifying unique-format replacements', () => {
  const uuids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const identity = createAnonymizedIdentity({
    randomUuid: () => uuids.shift(),
    generateCode: () => 'ABCDEFG',
  });
  assert.deepEqual(identity, {
    firstName: ANONYMIZED_FIRST_NAME,
    lastName: ANONYMIZED_LAST_NAME,
    email: 'anonymized-11111111-1111-4111-8111-111111111111@attendance-log.invalid',
    studentCode: 'ABCDEFG',
    qrToken: '22222222-2222-4222-8222-222222222222',
  });
  assert.match(identity.email, /^anonymized-[0-9a-f-]{36}@attendance-log\.invalid$/);
  assert.match(identity.studentCode, /^[A-HJ-NP-Z2-9]{7}$/);
});

test('independent anonymized identities do not reuse e-mail, code, or QR replacements', () => {
  const firstUuids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const secondUuids = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
  const first = createAnonymizedIdentity({ randomUuid: () => firstUuids.shift(), generateCode: () => 'AAAAAAA' });
  const second = createAnonymizedIdentity({ randomUuid: () => secondUuids.shift(), generateCode: () => 'BBBBBBB' });
  assert.notEqual(first.email, second.email);
  assert.notEqual(first.studentCode, second.studentCode);
  assert.notEqual(first.qrToken, second.qrToken);
});

test('audit redaction removes identity while preserving approved historical facts', () => {
  assert.deepEqual(redactParticipantAuditData({
    first_name: 'UniqueFirst',
    last_name: 'UniqueLast',
    name: 'UniqueFirst UniqueLast',
    email: 'unique@example.invalid',
    student_code: 'ABCDEFG',
    status: 'present',
    checked_in_at: '2024-01-02T03:04:05.000Z',
    active: false,
    notes: 'not retained',
  }), {
    status: 'present',
    checked_in_at: '2024-01-02T03:04:05.000Z',
    active: false,
  });
  assert.equal(redactParticipantAuditData({ email: 'unique@example.invalid' }), null);
});

test('audit summary redaction removes every former identity literal', () => {
  const identity = {
    first_name: 'UniqueFirst', last_name: 'UniqueLast',
    email: 'unique@example.invalid', student_code: 'ABCDEFG',
  };
  const redacted = redactParticipantAuditSummary(
    'UniqueFirst UniqueLast unique@example.invalid ABCDEFG UniqueFirst UniqueLast',
    identity,
  );
  for (const value of Object.values(identity)) assert.doesNotMatch(redacted, new RegExp(value, 'i'));
  assert.match(redacted, /donnée anonymisée/);
});

test('audit metadata redaction preserves safe context without former identity', () => {
  const identity = {
    first_name: 'UniqueFirst', last_name: 'UniqueLast',
    email: 'unique@example.invalid', student_code: 'ABCDEFG',
  };
  assert.deepEqual(redactParticipantAuditMetadata({
    source: 'manual',
    reason: 'Correction demandée pour unique@example.invalid',
    changed_fields: ['email', 'status', 'UniqueFirst', 'unique@example.invalid', 'arbitrary free text'],
    counts: { attendance: 2 },
    filename: 'UniqueFirst.xlsx',
  }, identity), {
    source: 'manual',
    reason: 'Correction demandée pour [donnée anonymisée]',
    changed_fields: ['email', 'status'],
    counts: { attendance: 2 },
  });
});

test('the authoritative eligibility rule rejects an already-anonymized participant', () => {
  const result = evaluateRetentionEligibility({
    active: false,
    active_memberships: 0,
    created_at: '2020-01-01T00:00:00.000Z',
    last_activity_at: '2020-01-01T00:00:00.000Z',
    anonymized_at: '2026-01-01T00:00:00.000Z',
  }, 12, new Date('2026-09-12T00:00:00.000Z'));
  assert.equal(result.eligible, false);
  assert(result.reasons.includes('already_anonymized'));
});

test('malformed public identifiers fail safely before any database access', async () => {
  assert.equal(await getStudentAnonymizationPreview('123-not-a-uuid'), null);
  await assert.rejects(
    anonymizeStudent('123-not-a-uuid'),
    (error) => error instanceof StudentAnonymizationError && error.code === 'STUDENT_NOT_FOUND',
  );
});
