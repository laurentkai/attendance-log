const crypto = require('node:crypto');
const { pool } = require('./db/client');
const { isValidPublicId } = require('./public-id');
const { getCurrentRequest, getCurrentUser } = require('./request-context');

const RESULTS = new Set(['success', 'denied', 'failed']);
const DATA_FIELDS = new Set([
  'active', 'date', 'description', 'email', 'enabled', 'frequency', 'instructor', 'name', 'notes', 'role',
  'state', 'status', 'title', 'weekly_day', 'execution_time', 'retention_days',
  'smtp_host', 'smtp_port', 'security_mode', 'smtp_username', 'sender_email',
  'sender_name', 'reply_to', 'provider', 's3_bucket', 's3_region', 's3_endpoint',
  's3_prefix', 'azure_account_name', 'azure_container_name',
  'student_singular', 'student_plural', 'class_singular', 'class_plural',
  'session_singular', 'session_plural', 'attendance_singular', 'attendance_plural',
  'instructor_singular', 'instructor_plural', 'membership_singular', 'membership_plural', 'username',
  'checked_in_at', 'start_time', 'punctuality_tolerance_minutes',
  'punctuality_tolerance_override_minutes',
  'summary_attach_xlsx', 'summary_attach_xlsx_override',
  'summary_admin_recipient_count', 'summary_external_recipient_count',
  'view_pii',
]);
const CHANGED_FIELD_NAMES = new Set([...DATA_FIELDS, 'password']);
const METADATA_FIELDS = new Set([
  'source', 'provider', 'backup_type', 'filename', 'size', 'fingerprint_match',
  'safety_backup', 'created', 'matched_existing', 'newly_assigned', 'skipped',
  'counts', 'membership_active', 'logo_change', 'reason', 'error_code',
  'changed_fields', 'destination', 'schedule_enabled', 'format', 'credential_change',
  'session_public_id',
  'recipient_count', 'attachment_included',
  'profile_reference',
]);

function boundedText(value, maximum, { required = false, strict = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw Object.assign(new Error('Required audit field is missing'), { code: 'AUDIT_INVALID_EVENT' });
    return null;
  }
  const text = String(value).trim();
  if (!text || (strict && text.length > maximum)) {
    throw Object.assign(new Error('Audit field is invalid'), { code: 'AUDIT_INVALID_EVENT' });
  }
  return text.slice(0, maximum);
}

function safeScalar(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 500);
  if (value === null) return null;
  return undefined;
}

function sanitizeObject(value, allowlist) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowlist.has(key)) continue;
    if (key === 'counts' && item && typeof item === 'object' && !Array.isArray(item)) {
      const counts = {};
      for (const [countKey, countValue] of Object.entries(item).slice(0, 20)) {
        if (/^[a-z][a-z0-9_]{0,39}$/i.test(countKey) && Number.isSafeInteger(countValue) && countValue >= 0) counts[countKey] = countValue;
      }
      sanitized[key] = counts;
      continue;
    }
    if (key === 'changed_fields' && Array.isArray(item)) {
      sanitized[key] = item.filter((entry) => CHANGED_FIELD_NAMES.has(entry)).slice(0, 30);
      continue;
    }
    const scalar = safeScalar(item);
    if (scalar !== undefined) sanitized[key] = scalar;
  }
  return Object.keys(sanitized).length ? sanitized : null;
}

function fingerprint(kind, value) {
  if (!value) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(`audit:${kind}:`).update(String(value)).digest('hex');
}

function requestFingerprints(request) {
  if (!request) return { ipHash: null, userAgentHash: null };
  return {
    ipHash: fingerprint('ip', request.ip || request.socket?.remoteAddress),
    userAgentHash: fingerprint('user-agent', request.get?.('user-agent')),
  };
}

async function recordAuditEvent({
  client = pool,
  actor = getCurrentUser(),
  request = getCurrentRequest(),
  action,
  category,
  targetType = null,
  targetPublicId = null,
  targetLabel = null,
  result = 'success',
  summary,
  beforeData = null,
  afterData = null,
  metadata = null,
}) {
  if (!RESULTS.has(result)) throw Object.assign(new Error('Audit result is invalid'), { code: 'AUDIT_INVALID_EVENT' });
  if (targetPublicId && !isValidPublicId(targetPublicId)) throw Object.assign(new Error('Audit target is invalid'), { code: 'AUDIT_INVALID_EVENT' });
  const fingerprints = requestFingerprints(request);
  const values = [
    actor?.id || null,
    boundedText(actor?.name, 120),
    boundedText(actor?.role, 32),
    boundedText(action, 80, { required: true, strict: true }),
    boundedText(category, 40, { required: true, strict: true }),
    boundedText(targetType, 40),
    targetPublicId || null,
    boundedText(targetLabel, 240),
    result,
    boundedText(summary, 500, { required: true, strict: true }),
    sanitizeObject(beforeData, DATA_FIELDS),
    sanitizeObject(afterData, DATA_FIELDS),
    sanitizeObject(metadata, METADATA_FIELDS),
    fingerprints.ipHash,
    fingerprints.userAgentHash,
  ];
  const inserted = await client.query(
    `INSERT INTO admin_audit_log
       (actor_admin_user_id, actor_name, actor_role, action, category,
        target_type, target_public_id, target_label, result, summary,
        before_data, after_data, metadata, ip_hash, user_agent_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING public_id, occurred_at`,
    values,
  );
  return inserted.rows[0];
}

async function recordAuditEventSafely(event) {
  try {
    return await recordAuditEvent(event);
  } catch (error) {
    console.error('Unable to record audit event:', error.code || 'AUDIT_INSERT_FAILED');
    return null;
  }
}

module.exports = {
  DATA_FIELDS,
  METADATA_FIELDS,
  recordAuditEvent,
  recordAuditEventSafely,
  sanitizeObject,
};
