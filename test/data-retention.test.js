const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';

const {
  evaluateRetentionEligibility,
  normalizeRetentionMonths,
  subtractCalendarMonths,
} = require('../src/data-retention');

const NOW = new Date('2026-09-11T12:00:00.000Z');

function participant(overrides = {}) {
  return {
    active: false,
    active_memberships: 0,
    created_at: '2020-01-01T00:00:00.000Z',
    last_activity_at: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('retention disabled never produces an eligible participant', () => {
  const result = evaluateRetentionEligibility(participant(), null, NOW);
  assert.equal(result.eligible, false);
  assert(result.reasons.includes('policy_disabled'));
});

test('active participants and active memberships block eligibility', () => {
  const active = evaluateRetentionEligibility(participant({ active: true }), 12, NOW);
  const membership = evaluateRetentionEligibility(participant({ active_memberships: 1 }), 12, NOW);
  assert.equal(active.eligible, false);
  assert(active.reasons.includes('active_participant'));
  assert.equal(membership.eligible, false);
  assert(membership.reasons.includes('active_membership'));
});

test('recent reference blocks and old reference permits eligibility', () => {
  const recent = evaluateRetentionEligibility(participant({ last_activity_at: '2026-08-01T00:00:00.000Z' }), 12, NOW);
  const old = evaluateRetentionEligibility(participant(), 12, NOW);
  assert.equal(recent.eligible, false);
  assert(recent.reasons.includes('recent_activity'));
  assert.equal(old.eligible, true);
  assert.deepEqual(old.reasons, ['eligible']);
});

test('exact threshold is eligible and one instant after it is not', () => {
  const exact = evaluateRetentionEligibility(participant({ last_activity_at: '2025-09-11T12:00:00.000Z' }), 12, NOW);
  const after = evaluateRetentionEligibility(participant({ last_activity_at: '2025-09-11T12:00:00.001Z' }), 12, NOW);
  assert.equal(exact.eligible, true);
  assert.equal(after.eligible, false);
});

test('last activity takes precedence over the creation fallback', () => {
  const result = evaluateRetentionEligibility(participant({
    created_at: '2020-01-01T00:00:00.000Z',
    last_activity_at: '2026-08-01T00:00:00.000Z',
  }), 12, NOW);
  assert.equal(result.reference_date.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(result.eligible, false);
});

test('creation date is used when last activity is absent', () => {
  const result = evaluateRetentionEligibility(participant({
    created_at: '2020-02-03T04:05:06.000Z',
    last_activity_at: null,
  }), 12, NOW);
  assert.equal(result.reference_date.toISOString(), '2020-02-03T04:05:06.000Z');
  assert.equal(result.eligible, true);
});

test('missing and invalid reference dates are blocked safely', () => {
  for (const createdAt of [null, 'not-a-date']) {
    const result = evaluateRetentionEligibility(participant({ created_at: createdAt, last_activity_at: null }), 12, NOW);
    assert.equal(result.eligible, false);
    assert(result.reasons.includes('insufficient_date'));
  }
});

test('all supported retention periods are normalized and evaluated', () => {
  for (const months of [12, 24, 36, 60]) {
    assert.equal(normalizeRetentionMonths(String(months)), months);
    assert.equal(evaluateRetentionEligibility(participant(), months, NOW).eligible, true);
  }
  assert.equal(normalizeRetentionMonths('never'), null);
  assert.equal(normalizeRetentionMonths('18'), undefined);
});

test('calendar-month subtraction handles month ends and leap years', () => {
  assert.equal(subtractCalendarMonths('2024-03-31T08:09:10.000Z', 1).toISOString(), '2024-02-29T08:09:10.000Z');
  assert.equal(subtractCalendarMonths('2023-03-31T08:09:10.000Z', 1).toISOString(), '2023-02-28T08:09:10.000Z');
  assert.equal(subtractCalendarMonths('2024-02-29T08:09:10.000Z', 12).toISOString(), '2023-02-28T08:09:10.000Z');
});

test('invalid threshold input is rejected without using the current clock', () => {
  assert.equal(subtractCalendarMonths('invalid', 12), null);
});
