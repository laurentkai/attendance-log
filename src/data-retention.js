const { pool } = require('./db/client');
const { isValidPublicId } = require('./public-id');

const RETENTION_MONTH_OPTIONS = Object.freeze([12, 24, 36, 60]);
const ELIGIBILITY_FILTERS = new Set(['all', 'eligible', 'ineligible']);
const DEFAULT_PAGE_SIZE = 25;

function normalizeRetentionMonths(value) {
  if (value === null || value === undefined || value === '' || value === 'never') return null;
  const months = Number(value);
  return RETENTION_MONTH_OPTIONS.includes(months) ? months : undefined;
}

function subtractCalendarMonths(value, months) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0,
    result.getUTCHours(),
    result.getUTCMinutes(),
    result.getUTCSeconds(),
    result.getUTCMilliseconds(),
  )).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function completeCalendarMonthsBetween(earlierValue, laterValue) {
  const earlier = new Date(earlierValue);
  const later = new Date(laterValue);
  if (Number.isNaN(earlier.valueOf()) || Number.isNaN(later.valueOf()) || later < earlier) return 0;
  let months = (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12
    + later.getUTCMonth() - earlier.getUTCMonth();
  const anniversary = new Date(earlier);
  anniversary.setUTCMonth(anniversary.getUTCMonth() + months);
  if (anniversary > later) months -= 1;
  return Math.max(0, months);
}

function evaluateRetentionEligibility(participant, retentionMonths, now = new Date()) {
  const referenceDate = participant.last_activity_at || participant.created_at || null;
  const activeMemberships = Number(participant.active_memberships || 0);
  const normalizedNow = new Date(now);
  const normalizedReference = referenceDate ? new Date(referenceDate) : null;
  const threshold = retentionMonths === null
    ? null
    : subtractCalendarMonths(normalizedNow, retentionMonths);
  const reasons = [];

  if (participant.anonymized_at) reasons.push('already_anonymized');
  if (retentionMonths === null) reasons.push('policy_disabled');
  if (participant.active) reasons.push('active_participant');
  if (activeMemberships > 0) reasons.push('active_membership');
  if (!normalizedReference || Number.isNaN(normalizedReference.valueOf())) {
    reasons.push('insufficient_date');
  } else if (threshold && normalizedReference > threshold) {
    reasons.push('recent_activity');
  }

  const eligible = reasons.length === 0;
  return {
    ...participant,
    active_memberships: activeMemberships,
    eligible,
    reference_date: normalizedReference,
    inactivity_days: normalizedReference
      ? Math.max(0, Math.floor((normalizedNow - normalizedReference) / 86400000))
      : null,
    inactivity_months: normalizedReference
      ? completeCalendarMonthsBetween(normalizedReference, normalizedNow)
      : null,
    reasons: eligible ? ['eligible'] : reasons,
  };
}

async function loadRetentionConfiguration(client = pool, { forUpdate = false } = {}) {
  const result = await client.query(
    `SELECT inactive_student_retention_months, updated_at
     FROM data_retention_configuration
     WHERE id = 1${forUpdate ? ' FOR UPDATE' : ''}`,
  );
  if (result.rowCount === 0) throw Object.assign(new Error('Retention configuration is missing'), { code: 'RETENTION_CONFIGURATION_MISSING' });
  return {
    retentionMonths: result.rows[0].inactive_student_retention_months === null
      ? null
      : Number(result.rows[0].inactive_student_retention_months),
    updatedAt: result.rows[0].updated_at,
  };
}

async function saveRetentionConfiguration(client, retentionMonths) {
  const normalized = normalizeRetentionMonths(retentionMonths);
  if (normalized === undefined) throw Object.assign(new Error('Retention policy is invalid'), { code: 'RETENTION_POLICY_INVALID' });
  const result = await client.query(
    `UPDATE data_retention_configuration
     SET inactive_student_retention_months = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1
     RETURNING inactive_student_retention_months, updated_at`,
    [normalized],
  );
  return {
    retentionMonths: result.rows[0].inactive_student_retention_months === null
      ? null
      : Number(result.rows[0].inactive_student_retention_months),
    updatedAt: result.rows[0].updated_at,
  };
}

async function loadParticipantRetentionRows(client = pool) {
  const result = await client.query(
    `SELECT s.public_id, s.first_name, s.last_name, s.email, s.student_code,
            s.active, s.created_at, s.last_activity_at, s.anonymized_at,
            COUNT(sc.class_id) FILTER (WHERE sc.active = TRUE)::integer AS active_memberships
     FROM students s
     LEFT JOIN student_classes sc ON sc.student_id = s.id
     GROUP BY s.id
     ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
  );
  return result.rows;
}

async function getRetentionEligibilityPreview({
  filter = 'all',
  search = '',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  now = new Date(),
  client = pool,
} = {}) {
  const normalizedFilter = ELIGIBILITY_FILTERS.has(filter) ? filter : 'all';
  const normalizedSearch = typeof search === 'string' ? search.trim().slice(0, 100) : '';
  const normalizedPage = Math.max(1, Math.min(100000, Number.parseInt(page, 10) || 1));
  const normalizedPageSize = Math.max(1, Math.min(100, Number.parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE));
  const [configuration, rawParticipants] = await Promise.all([
    loadRetentionConfiguration(client),
    loadParticipantRetentionRows(client),
  ]);
  const participants = rawParticipants.map((participant) => evaluateRetentionEligibility(
    participant,
    configuration.retentionMonths,
    now,
  ));
  const summary = {
    total: participants.length,
    inactive: participants.filter((participant) => !participant.active).length,
    eligible: participants.filter((participant) => participant.eligible).length,
    blockedByActiveMembership: participants.filter((participant) => !participant.active && participant.active_memberships > 0).length,
    blockedByRecentActivity: participants.filter((participant) => !participant.active
      && participant.active_memberships === 0
      && configuration.retentionMonths !== null
      && participant.reference_date
      && !participant.eligible
      && participant.reasons.includes('recent_activity')).length,
    blockedByInsufficientDate: participants.filter((participant) => !participant.active
      && participant.active_memberships === 0
      && configuration.retentionMonths !== null
      && participant.reasons.includes('insufficient_date')).length,
    blockedByDisabledPolicy: configuration.retentionMonths === null
      ? participants.filter((participant) => !participant.active).length
      : 0,
  };
  const searchNeedle = normalizedSearch.toLocaleLowerCase();
  const filtered = participants.filter((participant) => {
    if (normalizedFilter === 'eligible' && !participant.eligible) return false;
    if (normalizedFilter === 'ineligible' && participant.eligible) return false;
    if (!searchNeedle) return true;
    return `${participant.first_name} ${participant.last_name} ${participant.email} ${participant.student_code}`
      .toLocaleLowerCase()
      .includes(searchNeedle);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / normalizedPageSize));
  const currentPage = Math.min(normalizedPage, totalPages);
  const offset = (currentPage - 1) * normalizedPageSize;
  return {
    configuration,
    summary,
    participants: filtered.slice(offset, offset + normalizedPageSize),
    filter: normalizedFilter,
    search: normalizedSearch,
    page: currentPage,
    pageSize: normalizedPageSize,
    totalFiltered: filtered.length,
    totalPages,
  };
}

async function loadParticipantRetentionSubject(publicId, { client = pool, forUpdate = false } = {}) {
  if (!isValidPublicId(publicId)) return null;
  if (!forUpdate) {
    const result = await client.query(
      `SELECT s.public_id, s.first_name, s.last_name, s.email, s.student_code,
              s.active, s.created_at, s.last_activity_at, s.anonymized_at,
              COUNT(sc.class_id) FILTER (WHERE sc.active = TRUE)::integer AS active_memberships
       FROM students s
       LEFT JOIN student_classes sc ON sc.student_id = s.id
       WHERE s.public_id = $1
       GROUP BY s.id`,
      [publicId],
    );
    return result.rows[0] || null;
  }

  const result = await client.query(
    `SELECT id, public_id, first_name, last_name, email, student_code,
            active, created_at, last_activity_at, anonymized_at
     FROM students
     WHERE public_id = $1
     FOR UPDATE`,
    [publicId],
  );
  if (result.rowCount === 0) return null;
  const memberships = await client.query(
    `SELECT class_id, active
     FROM student_classes
     WHERE student_id = $1
     ORDER BY class_id
     FOR UPDATE`,
    [result.rows[0].id],
  );
  return {
    ...result.rows[0],
    active_memberships: memberships.rows.filter((membership) => membership.active).length,
  };
}

async function getParticipantRetentionDetail(publicId, {
  now = new Date(), client = pool, forUpdate = false,
} = {}) {
  const participant = await loadParticipantRetentionSubject(publicId, { client, forUpdate });
  if (!participant) return null;
  const configuration = await loadRetentionConfiguration(client, { forUpdate });
  return {
    configuration,
    participant: evaluateRetentionEligibility(participant, configuration.retentionMonths, now),
  };
}

module.exports = {
  ELIGIBILITY_FILTERS,
  RETENTION_MONTH_OPTIONS,
  evaluateRetentionEligibility,
  getParticipantRetentionDetail,
  getRetentionEligibilityPreview,
  loadParticipantRetentionSubject,
  loadRetentionConfiguration,
  normalizeRetentionMonths,
  saveRetentionConfiguration,
  subtractCalendarMonths,
};
