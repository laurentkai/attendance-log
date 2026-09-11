const crypto = require('node:crypto');
const { recordAuditEvent, sanitizeChangedFieldNames } = require('./audit');
const { getParticipantRetentionDetail } = require('./data-retention');
const { pool, withTransaction } = require('./db/client');
const { isValidPublicId } = require('./public-id');
const { generateStudentCode } = require('./student-data');

const ANONYMIZED_FIRST_NAME = 'Participant';
const ANONYMIZED_LAST_NAME = 'anonymisé';
const ANONYMIZED_TARGET_LABEL = 'Participant anonymisé';
const RETAINED_AUDIT_DATA_FIELDS = new Set([
  'active', 'checked_in_at', 'date', 'state', 'status',
]);
const RETAINED_AUDIT_METADATA_FIELDS = new Set([
  'changed_fields', 'counts', 'error_code', 'membership_active', 'reason',
  'session_public_id', 'source',
]);
const RETRYABLE_IDENTITY_CONSTRAINTS = new Set([
  'students_email_case_insensitive_unique',
  'students_qr_token_unique',
  'students_student_code_key',
]);

class StudentAnonymizationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'StudentAnonymizationError';
    this.code = code;
    Object.assign(this, details);
  }
}

function createAnonymizedIdentity({ randomUuid = crypto.randomUUID, generateCode = generateStudentCode } = {}) {
  const reference = randomUuid();
  return {
    firstName: ANONYMIZED_FIRST_NAME,
    lastName: ANONYMIZED_LAST_NAME,
    email: `anonymized-${reference}@attendance-log.invalid`,
    studentCode: generateCode(),
    qrToken: randomUuid(),
  };
}

function redactParticipantAuditData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const redacted = Object.fromEntries(
    Object.entries(value).filter(([key]) => RETAINED_AUDIT_DATA_FIELDS.has(key)),
  );
  return Object.keys(redacted).length ? redacted : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactIdentifyingText(value, identity) {
  const source = typeof value === 'string' ? value : '';
  const identifyingValues = [
    `${identity.first_name || ''} ${identity.last_name || ''}`.trim(),
    identity.email,
    identity.student_code,
    identity.first_name,
    identity.last_name,
  ].filter(Boolean).sort((left, right) => right.length - left.length);
  const pattern = identifyingValues.length
    ? new RegExp(identifyingValues.map((value) => escapeRegExp(String(value))).join('|'), 'giu')
    : null;
  return pattern ? source.replace(pattern, '[donnée anonymisée]') : source;
}

function redactParticipantAuditSummary(summary, identity) {
  const redacted = redactIdentifyingText(summary, identity);
  return redacted || 'Événement concernant un participant anonymisé.';
}

function redactParticipantAuditMetadata(value, identity) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    if (!RETAINED_AUDIT_METADATA_FIELDS.has(key)) continue;
    if (key === 'counts' && item && typeof item === 'object' && !Array.isArray(item)) {
      redacted[key] = Object.fromEntries(
        Object.entries(item).filter(([, count]) => Number.isSafeInteger(count) && count >= 0),
      );
    } else if (key === 'changed_fields' && Array.isArray(item)) {
      redacted[key] = sanitizeChangedFieldNames(item)
        .filter((field) => redactIdentifyingText(field, identity) === field);
    } else if (typeof item === 'string') {
      redacted[key] = redactIdentifyingText(item, identity);
    } else if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || item === null) {
      redacted[key] = item;
    }
  }
  return Object.keys(redacted).length ? redacted : null;
}

async function loadSafeCounts(client, publicId) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM student_classes
          WHERE student_id = (SELECT id FROM students WHERE public_id = $1)) AS memberships,
       (SELECT COUNT(*)::integer FROM attendance_records
          WHERE student_id = (SELECT id FROM students WHERE public_id = $1)) AS attendance_records,
       (SELECT COUNT(*)::integer FROM admin_audit_log
          WHERE target_type = 'student' AND target_public_id = $1) AS audit_rows`,
    [publicId],
  );
  return {
    memberships: Number(result.rows[0].memberships),
    attendanceRecords: Number(result.rows[0].attendance_records),
    auditRows: Number(result.rows[0].audit_rows),
  };
}

async function getStudentAnonymizationPreview(publicId, { client = pool, now = new Date() } = {}) {
  if (!isValidPublicId(publicId)) return null;
  const detail = await getParticipantRetentionDetail(publicId, { client, now });
  if (!detail) return null;
  return {
    ...detail,
    counts: await loadSafeCounts(client, publicId),
  };
}

async function replaceIdentity(client, participantId, anonymizedAt) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const replacement = createAnonymizedIdentity();
    await client.query('SAVEPOINT student_anonymization_identity');
    try {
      const result = await client.query(
        `UPDATE students
         SET first_name = $1, last_name = $2, email = $3, student_code = $4,
             qr_token = $5, active = FALSE, anonymized_at = $6
         WHERE id = $7 AND anonymized_at IS NULL
         RETURNING anonymized_at`,
        [replacement.firstName, replacement.lastName, replacement.email,
          replacement.studentCode, replacement.qrToken, anonymizedAt, participantId],
      );
      if (result.rowCount === 0) throw new StudentAnonymizationError('STUDENT_ALREADY_ANONYMIZED');
      await client.query('RELEASE SAVEPOINT student_anonymization_identity');
      return result.rows[0].anonymized_at;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT student_anonymization_identity');
      await client.query('RELEASE SAVEPOINT student_anonymization_identity');
      if (error.code === '23505' && RETRYABLE_IDENTITY_CONSTRAINTS.has(error.constraint)) continue;
      throw error;
    }
  }
  throw new StudentAnonymizationError('ANONYMIZED_IDENTITY_GENERATION_FAILED');
}

async function anonymizeStudent(publicId, {
  transactionPool = pool,
  now = new Date(),
  auditRecorder = recordAuditEvent,
} = {}) {
  if (!isValidPublicId(publicId)) throw new StudentAnonymizationError('STUDENT_NOT_FOUND');
  return withTransaction(transactionPool, async (client) => {
    const detail = await getParticipantRetentionDetail(publicId, { client, now, forUpdate: true });
    if (!detail) throw new StudentAnonymizationError('STUDENT_NOT_FOUND');
    const participant = detail.participant;
    if (participant.anonymized_at) throw new StudentAnonymizationError('STUDENT_ALREADY_ANONYMIZED');
    if (!participant.eligible) {
      throw new StudentAnonymizationError('STUDENT_NOT_ELIGIBLE', { reasons: participant.reasons });
    }

    await client.query(
      `SELECT session_id
       FROM attendance_records
       WHERE student_id = $1
       ORDER BY session_id
       FOR UPDATE`,
      [participant.id],
    );
    const counts = await loadSafeCounts(client, publicId);
    const auditRows = await client.query(
      `SELECT id, summary, before_data, after_data, metadata
       FROM admin_audit_log
       WHERE target_type = 'student' AND target_public_id = $1
       ORDER BY id
       FOR UPDATE`,
      [publicId],
    );

    const anonymizedAt = await replaceIdentity(client, participant.id, now);
    for (const event of auditRows.rows) {
      await client.query(
        `UPDATE admin_audit_log
         SET target_label = $1, summary = $2, before_data = $3, after_data = $4, metadata = $5
         WHERE id = $6`,
        [ANONYMIZED_TARGET_LABEL,
          redactParticipantAuditSummary(event.summary, participant),
          redactParticipantAuditData(event.before_data),
          redactParticipantAuditData(event.after_data),
          redactParticipantAuditMetadata(event.metadata, participant),
          event.id],
      );
    }

    await auditRecorder({
      client,
      category: 'privacy',
      action: 'privacy.student.anonymize',
      targetType: 'student',
      targetPublicId: publicId,
      targetLabel: ANONYMIZED_TARGET_LABEL,
      summary: 'Identité d’un participant anonymisée de façon irréversible.',
      afterData: { active: false, anonymized_at: anonymizedAt.toISOString() },
      metadata: {
        source: 'manual',
        retention_months: detail.configuration.retentionMonths,
        counts: {
          audit_rows_redacted: counts.auditRows,
          memberships_retained: counts.memberships,
          attendance_records_retained: counts.attendanceRecords,
        },
      },
    });

    return { publicId, anonymizedAt, counts };
  });
}

module.exports = {
  ANONYMIZED_FIRST_NAME,
  ANONYMIZED_LAST_NAME,
  ANONYMIZED_TARGET_LABEL,
  StudentAnonymizationError,
  anonymizeStudent,
  createAnonymizedIdentity,
  getStudentAnonymizationPreview,
  redactParticipantAuditData,
  redactParticipantAuditMetadata,
  redactParticipantAuditSummary,
};
