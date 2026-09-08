const TOLERANCE_VALUES = Object.freeze([5, 10, 15]);

function isValidTolerance(value) {
  return TOLERANCE_VALUES.includes(Number(value));
}

function calculatePunctuality({ status, checkedInAt, scheduledStartAt, toleranceMinutes }) {
  if (status !== 'present' || !checkedInAt || !scheduledStartAt || !isValidTolerance(toleranceMinutes)) {
    return {
      available: false,
      delayMinutes: null,
      status: null,
      label: '—',
    };
  }

  const checkedIn = checkedInAt instanceof Date ? checkedInAt : new Date(checkedInAt);
  const scheduledStart = scheduledStartAt instanceof Date ? scheduledStartAt : new Date(scheduledStartAt);
  if (Number.isNaN(checkedIn.getTime()) || Number.isNaN(scheduledStart.getTime())) {
    return { available: false, delayMinutes: null, status: null, label: '—' };
  }

  const delayMinutes = Math.floor((checkedIn.getTime() - scheduledStart.getTime()) / 60000);
  const late = delayMinutes > Number(toleranceMinutes);
  return {
    available: true,
    delayMinutes,
    status: late ? 'late' : 'on_time',
    label: late ? `+${delayMinutes} min` : 'À l’heure',
  };
}

function summarizePunctuality(rows) {
  const applicable = rows.filter((row) => row.start_time).length > 0;
  const known = rows.filter((row) => row.punctuality?.available);
  const onTime = known.filter((row) => row.punctuality.status === 'on_time').length;
  const late = known.filter((row) => row.punctuality.status === 'late').length;
  return {
    punctualityApplicable: applicable,
    punctualityKnown: known.length,
    onTime,
    late,
    punctualityRate: known.length > 0 ? onTime / known.length : null,
  };
}

module.exports = {
  TOLERANCE_VALUES,
  calculatePunctuality,
  isValidTolerance,
  summarizePunctuality,
};
