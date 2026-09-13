const test = require('node:test');
const assert = require('node:assert/strict');

const { calculatePunctuality, formatPunctualityLabel } = require('../src/punctuality');

const START = '2026-09-11T18:00:00.000Z';

function at(minutes) {
  return new Date(new Date(START).getTime() + (minutes * 60000));
}

test('punctuality is unavailable without a start or arrival time', () => {
  assert.equal(calculatePunctuality({ status: 'present', checkedInAt: at(0), scheduledStartAt: null, toleranceMinutes: 5 }).available, false);
  assert.equal(calculatePunctuality({ status: 'present', checkedInAt: null, scheduledStartAt: START, toleranceMinutes: 5 }).available, false);
  assert.equal(calculatePunctuality({ status: 'absent', checkedInAt: at(0), scheduledStartAt: START, toleranceMinutes: 5 }).available, false);
});

test('early and exactly-on-start arrivals preserve signed delay semantics', () => {
  const early = calculatePunctuality({ status: 'present', checkedInAt: at(-7), scheduledStartAt: START, toleranceMinutes: 5 });
  const exact = calculatePunctuality({ status: 'present', checkedInAt: at(0), scheduledStartAt: START, toleranceMinutes: 5 });
  assert.deepEqual({ delay: early.delayMinutes, status: early.status }, { delay: -7, status: 'on_time' });
  assert.deepEqual({ delay: exact.delayMinutes, status: exact.status }, { delay: 0, status: 'on_time' });
});

test('each tolerance includes its boundary and rejects the first minute beyond it', () => {
  for (const toleranceMinutes of [5, 10, 15]) {
    const boundary = calculatePunctuality({ status: 'present', checkedInAt: at(toleranceMinutes), scheduledStartAt: START, toleranceMinutes });
    const late = calculatePunctuality({ status: 'present', checkedInAt: at(toleranceMinutes + 1), scheduledStartAt: START, toleranceMinutes });
    assert.deepEqual({ delay: boundary.delayMinutes, status: boundary.status, label: formatPunctualityLabel(boundary, 'en') }, {
      delay: toleranceMinutes, status: 'on_time', label: 'On time',
    });
    assert.deepEqual({ delay: late.delayMinutes, status: late.status, label: formatPunctualityLabel(late, 'en') }, {
      delay: toleranceMinutes + 1, status: 'late', label: `+${toleranceMinutes + 1} min`,
    });
  }
});
