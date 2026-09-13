const ExcelJS = require('exceljs');
const {
  auditActionLabel,
  auditCategoryLabel,
  auditChanges,
  auditResultLabel,
  auditSummaryLabel,
} = require('./audit-presentation');
const { getApplicationTimezone } = require('./application-time');
const { pool } = require('./db/client');
const { formatDateForInput } = require('./date-format');
const { isValidPublicId } = require('./public-id');
const { calculatePunctuality } = require('./punctuality');
const { getTerm } = require('./terminology');
const { DEFAULT_LANGUAGE, t } = require('./i18n');

const PARTICIPANT_AUDIT_FIELDS = Object.freeze([
  'active', 'anonymized_at', 'checked_in_at', 'email', 'first_name', 'last_name', 'name',
  'language', 'status', 'student_code',
]);

function exportInstant(value) {
  if (!value) return '';
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.valueOf()) ? '' : instant.toISOString();
}

const MAX_WORKSHEET_NAME_LENGTH = 31;
function sanitizeWorksheetName(value, fallback = 'Sheet') {
  const sanitize = (candidate) => String(candidate || '')
    .replace(/[\u0000-\u001f\u007f\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, MAX_WORKSHEET_NAME_LENGTH)
    .trimEnd()
    .replace(/'+$/g, '')
    .trimEnd();
  return sanitize(value) || sanitize(fallback) || 'Sheet';
}

function createWorksheetNameAllocator(reservedNames = []) {
  const used = new Set(reservedNames.map((name) => name.toLocaleLowerCase('en')));
  return (value, fallback) => {
    const base = sanitizeWorksheetName(value, fallback);
    let candidate = base;
    let suffixNumber = 2;
    while (used.has(candidate.toLocaleLowerCase('en'))) {
      const suffix = ` (${suffixNumber})`;
      const stem = base.slice(0, MAX_WORKSHEET_NAME_LENGTH - suffix.length).trimEnd();
      candidate = `${stem}${suffix}`;
      suffixNumber += 1;
    }
    used.add(candidate.toLocaleLowerCase('en'));
    return candidate;
  };
}

function createParticipantWorksheetNames({ classPlural, attendancePlural, language = DEFAULT_LANGUAGE } = {}) {
  const identityName = t(language, 'privacy.export.sheet.identity');
  const auditName = t(language, 'privacy.export.sheet.audit');
  const allocate = createWorksheetNameAllocator([identityName, auditName]);
  return {
    identity: identityName,
    memberships: allocate(classPlural, t(language, 'privacy.export.sheet.fallback')),
    attendance: allocate(attendancePlural, t(language, 'privacy.export.sheet.attendance', { attendance: attendancePlural })),
    audit: auditName,
  };
}

function safeCell(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function selectAuditFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const selected = {};
  for (const field of PARTICIPANT_AUDIT_FIELDS) {
    if (Object.hasOwn(value, field)) selected[field] = value[field];
  }
  return Object.keys(selected).length ? selected : null;
}

async function loadParticipantDataExport(publicId, client = pool) {
  if (!isValidPublicId(publicId)) return null;
  const identityResult = await client.query(
    `SELECT id, public_id, first_name, last_name, email, student_code, active, language,
            created_at, last_activity_at, anonymized_at
     FROM students
     WHERE public_id = $1`,
    [publicId],
  );
  if (identityResult.rowCount === 0) return null;
  const row = identityResult.rows[0];
  const anonymized = Boolean(row.anonymized_at);
  const membershipsResult = await client.query(
      `SELECT c.name AS activity_name, sc.active, sc.created_at
       FROM student_classes sc
       INNER JOIN classes c ON c.id = sc.class_id
       WHERE sc.student_id = $1
       ORDER BY LOWER(c.name), sc.created_at`,
      [row.id],
    );
  const attendanceResult = await client.query(
      `SELECT c.name AS activity_name, cs.title AS session_name, cs.date, cs.start_time,
              ar.status, ar.checked_in_at, ar.updated_at,
              COALESCE(cs.punctuality_tolerance_override_minutes,
                       c.punctuality_tolerance_minutes) AS effective_tolerance_minutes,
              CASE WHEN cs.start_time IS NULL THEN NULL
                   ELSE (cs.date + cs.start_time) AT TIME ZONE $2 END AS scheduled_start_at
       FROM attendance_records ar
       INNER JOIN course_sessions cs ON cs.id = ar.session_id
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE ar.student_id = $1
       ORDER BY cs.date, LOWER(c.name), LOWER(cs.title)`,
      [row.id, getApplicationTimezone()],
    );
  const auditResult = await client.query(
      `SELECT occurred_at, actor_name, action, category, result, summary,
              before_data, after_data
       FROM admin_audit_log
       WHERE target_type = 'student' AND target_public_id = $1
       ORDER BY occurred_at, id`,
      [publicId],
    );

  return {
    identity: {
      publicId: row.public_id,
      firstName: anonymized ? null : row.first_name,
      lastName: anonymized ? null : row.last_name,
      email: anonymized ? null : row.email,
      participantCode: anonymized ? null : row.student_code,
      language: anonymized ? null : row.language,
      active: row.active,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      anonymizedAt: row.anonymized_at,
      anonymized,
    },
    memberships: membershipsResult.rows.map((membership) => ({
      activityName: membership.activity_name,
      active: membership.active,
      createdAt: membership.created_at,
    })),
    attendance: attendanceResult.rows.map((attendance) => ({
      activityName: attendance.activity_name,
      sessionName: attendance.session_name,
      sessionDate: attendance.date,
      sessionStartTime: attendance.start_time,
      status: attendance.status,
      checkedInAt: attendance.checked_in_at,
      updatedAt: attendance.updated_at,
      punctuality: calculatePunctuality({
        status: attendance.status,
        checkedInAt: attendance.checked_in_at,
        scheduledStartAt: attendance.scheduled_start_at,
        toleranceMinutes: attendance.effective_tolerance_minutes,
      }),
    })),
    audit: auditResult.rows.map((event) => ({
      occurredAt: event.occurred_at,
      actorName: event.actor_name,
      action: event.action,
      category: event.category,
      result: event.result,
      summary: event.summary,
      beforeData: selectAuditFields(event.before_data),
      afterData: selectAuditFields(event.after_data),
    })),
  };
}

function configureSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(columns.length).letter}1` };
}

function addRows(sheet, rows) {
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)])));
  }
}

function buildParticipantDataWorkbook(data, { language = DEFAULT_LANGUAGE, terminology } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Attendance Log';
  workbook.subject = t(language, 'privacy.export.subject');
  const worksheetNames = createParticipantWorksheetNames({
    classPlural: getTerm(language, 'class', 'plural', terminology),
    attendancePlural: getTerm(language, 'attendance', 'plural', terminology),
    language,
  });

  const identity = workbook.addWorksheet(worksheetNames.identity);
  configureSheet(identity, [{ header: t(language, 'privacy.export.column.field'), key: 'field', width: 28 }, { header: t(language, 'privacy.export.column.value'), key: 'value', width: 45 }]);
  const anonymized = Boolean(data.identity.anonymizedAt);
  addRows(identity, [
    { field: t(language, 'privacy.export.field.first_name'), value: anonymized ? t(language, 'privacy.export.value.identity_removed') : data.identity.firstName },
    { field: t(language, 'privacy.export.field.last_name'), value: anonymized ? t(language, 'privacy.export.value.identity_removed') : data.identity.lastName },
    { field: t(language, 'privacy.export.field.email'), value: anonymized ? t(language, 'privacy.export.value.identity_removed') : data.identity.email },
    { field: t(language, 'privacy.export.field.participant_code', { student: getTerm(language, 'student', 'singular', terminology) }), value: anonymized ? t(language, 'privacy.export.value.code_replaced') : data.identity.participantCode },
    { field: t(language, 'privacy.export.field.communication_language'), value: data.identity.language ? t(language, `language.${data.identity.language}`) : t(language, 'privacy.export.value.inherit') },
    anonymized
      ? { field: t(language, 'privacy.export.field.status'), value: t(language, 'status.anonymized') }
      : { field: t(language, 'privacy.export.field.active'), value: t(language, data.identity.active ? 'common.yes' : 'common.no') },
    { field: t(language, 'privacy.export.field.public_id'), value: data.identity.publicId },
    { field: t(language, 'privacy.export.field.created_at'), value: exportInstant(data.identity.createdAt) },
    { field: t(language, 'privacy.export.field.last_activity'), value: exportInstant(data.identity.lastActivityAt) || t(language, 'common.unknown') },
    { field: t(language, 'privacy.export.field.anonymized_at'), value: exportInstant(data.identity.anonymizedAt) },
  ]);

  const memberships = workbook.addWorksheet(worksheetNames.memberships);
  configureSheet(memberships, [
    { header: getTerm(language, 'class', 'singular', terminology), key: 'activity', width: 38 },
    { header: t(language, 'privacy.export.column.membership_active', { membership: getTerm(language, 'membership', 'singular', terminology) }), key: 'active', width: 20 },
    { header: t(language, 'privacy.export.column.registered_at'), key: 'createdAt', width: 24 },
  ]);
  addRows(memberships, data.memberships.map((row) => ({ activity: row.activityName, active: t(language, row.active ? 'common.yes' : 'common.no'), createdAt: exportInstant(row.createdAt) })));

  const attendance = workbook.addWorksheet(worksheetNames.attendance);
  configureSheet(attendance, [
    { header: getTerm(language, 'class', 'singular', terminology), key: 'activity', width: 32 },
    { header: getTerm(language, 'session', 'singular', terminology), key: 'session', width: 32 },
    { header: t(language, 'report.column.date'), key: 'date', width: 15 },
    { header: t(language, 'report.column.start_time'), key: 'start', width: 17 },
    { header: t(language, 'report.column.status'), key: 'status', width: 14 },
    { header: t(language, 'privacy.export.column.arrival'), key: 'arrival', width: 24 },
    { header: t(language, 'report.column.delay_minutes'), key: 'delay', width: 13 },
    { header: t(language, 'report.column.punctuality'), key: 'punctuality', width: 16 },
    { header: t(language, 'privacy.export.column.updated_at'), key: 'updatedAt', width: 24 },
  ]);
  addRows(attendance, data.attendance.map((row) => ({
    activity: row.activityName,
    session: row.sessionName,
    date: formatDateForInput(row.sessionDate),
    start: row.sessionStartTime || '',
    status: ['present', 'absent', 'pending'].includes(row.status) ? t(language, `status.${row.status}`) : row.status,
    arrival: exportInstant(row.checkedInAt),
    delay: row.punctuality.delayMinutes,
    punctuality: row.punctuality.available ? t(language, `status.${row.punctuality.status}`) : t(language, 'privacy.export.value.not_available'),
    updatedAt: exportInstant(row.updatedAt),
  })));

  const audit = workbook.addWorksheet(worksheetNames.audit);
  configureSheet(audit, [
    { header: t(language, 'report.column.date'), key: 'occurredAt', width: 24 },
    { header: t(language, 'privacy.export.column.user'), key: 'actor', width: 26 },
    { header: t(language, 'privacy.export.column.category'), key: 'category', width: 18 },
    { header: t(language, 'privacy.export.column.action'), key: 'action', width: 30 },
    { header: t(language, 'privacy.export.column.result'), key: 'result', width: 14 },
    { header: t(language, 'privacy.export.column.summary'), key: 'summary', width: 55 },
    { header: t(language, 'privacy.export.column.changes'), key: 'changes', width: 55 },
  ]);
  addRows(audit, data.audit.map((row) => {
    const presentationRow = {
      action: row.action,
      summary: row.summary,
      before_data: row.beforeData,
      after_data: row.afterData,
    };
    return {
      occurredAt: exportInstant(row.occurredAt),
      actor: row.actorName || t(language, 'privacy.export.value.system'),
      category: auditCategoryLabel(row.category, language, terminology),
      action: auditActionLabel(row.action, language, terminology),
      result: auditResultLabel(row.result, language),
      summary: auditSummaryLabel(presentationRow, language, terminology),
      changes: auditChanges(presentationRow, language, terminology)
        .map((change) => `${change.label}: ${change.before} → ${change.after}`).join('; '),
    };
  }));
  return workbook;
}

module.exports = {
  buildParticipantDataWorkbook,
  createParticipantWorksheetNames,
  loadParticipantDataExport,
  selectAuditFields,
};
