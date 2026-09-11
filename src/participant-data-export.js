const ExcelJS = require('exceljs');
const { getApplicationTimezone } = require('./application-time');
const { pool } = require('./db/client');
const { formatDateForInput } = require('./date-format');
const { isValidPublicId } = require('./public-id');
const { calculatePunctuality } = require('./punctuality');
const { getTerm } = require('./terminology');

const PARTICIPANT_AUDIT_FIELDS = Object.freeze([
  'active', 'checked_in_at', 'email', 'first_name', 'last_name', 'name',
  'status', 'student_code',
]);
const ATTENDANCE_STATUS_LABELS = Object.freeze({ present: 'Présent', absent: 'Absent', pending: 'En attente' });

function exportInstant(value) {
  if (!value) return '';
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.valueOf()) ? '' : instant.toISOString();
}

const MAX_WORKSHEET_NAME_LENGTH = 31;
const FIXED_WORKSHEET_NAMES = Object.freeze(['Identité', 'Audit']);

function sanitizeWorksheetName(value, fallback) {
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
  return sanitize(value) || sanitize(fallback) || 'Feuille';
}

function createWorksheetNameAllocator(reservedNames = []) {
  const used = new Set(reservedNames.map((name) => name.toLocaleLowerCase('fr')));
  return (value, fallback) => {
    const base = sanitizeWorksheetName(value, fallback);
    let candidate = base;
    let suffixNumber = 2;
    while (used.has(candidate.toLocaleLowerCase('fr'))) {
      const suffix = ` (${suffixNumber})`;
      const stem = base.slice(0, MAX_WORKSHEET_NAME_LENGTH - suffix.length).trimEnd();
      candidate = `${stem}${suffix}`;
      suffixNumber += 1;
    }
    used.add(candidate.toLocaleLowerCase('fr'));
    return candidate;
  };
}

function createParticipantWorksheetNames({ classPlural, attendancePlural } = {}) {
  const allocate = createWorksheetNameAllocator(FIXED_WORKSHEET_NAMES);
  return {
    identity: FIXED_WORKSHEET_NAMES[0],
    memberships: allocate(classPlural, 'Activités'),
    attendance: allocate(attendancePlural, 'Présences'),
    audit: FIXED_WORKSHEET_NAMES[1],
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

function describeChanges(before, after) {
  const left = selectAuditFields(before) || {};
  const right = selectAuditFields(after) || {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .map((field) => `${field}: ${left[field] ?? '—'} → ${right[field] ?? '—'}`)
    .join('; ');
}

async function loadParticipantDataExport(publicId, client = pool) {
  if (!isValidPublicId(publicId)) return null;
  const identityResult = await client.query(
    `SELECT id, public_id, first_name, last_name, email, student_code, active,
            created_at, last_activity_at
     FROM students
     WHERE public_id = $1`,
    [publicId],
  );
  if (identityResult.rowCount === 0) return null;
  const row = identityResult.rows[0];
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
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      participantCode: row.student_code,
      active: row.active,
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
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
      changes: describeChanges(event.before_data, event.after_data),
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

function buildParticipantDataWorkbook(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Attendance Log';
  workbook.subject = 'Export des données personnelles';
  const worksheetNames = createParticipantWorksheetNames({
    classPlural: getTerm('class', 'plural'),
    attendancePlural: getTerm('attendance', 'plural'),
  });

  const identity = workbook.addWorksheet(worksheetNames.identity);
  configureSheet(identity, [{ header: 'Champ', key: 'field', width: 28 }, { header: 'Valeur', key: 'value', width: 45 }]);
  addRows(identity, [
    { field: 'Prénom', value: data.identity.firstName },
    { field: 'Nom', value: data.identity.lastName },
    { field: 'E-mail', value: data.identity.email },
    { field: 'Code participant', value: data.identity.participantCode },
    { field: 'Actif', value: data.identity.active ? 'Oui' : 'Non' },
    { field: 'Identifiant public', value: data.identity.publicId },
    { field: 'Créé le', value: exportInstant(data.identity.createdAt) },
    { field: 'Dernière activité', value: exportInstant(data.identity.lastActivityAt) || 'Inconnue' },
  ]);

  const memberships = workbook.addWorksheet(worksheetNames.memberships);
  configureSheet(memberships, [
    { header: getTerm('class'), key: 'activity', width: 38 },
    { header: 'Inscription active', key: 'active', width: 20 },
    { header: 'Inscrit le', key: 'createdAt', width: 24 },
  ]);
  addRows(memberships, data.memberships.map((row) => ({ activity: row.activityName, active: row.active ? 'Oui' : 'Non', createdAt: exportInstant(row.createdAt) })));

  const attendance = workbook.addWorksheet(worksheetNames.attendance);
  configureSheet(attendance, [
    { header: getTerm('class'), key: 'activity', width: 32 },
    { header: getTerm('session'), key: 'session', width: 32 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Heure de début', key: 'start', width: 17 },
    { header: 'Statut', key: 'status', width: 14 },
    { header: 'Arrivée', key: 'arrival', width: 24 },
    { header: 'Écart (min)', key: 'delay', width: 13 },
    { header: 'Ponctualité', key: 'punctuality', width: 16 },
    { header: 'Mis à jour le', key: 'updatedAt', width: 24 },
  ]);
  addRows(attendance, data.attendance.map((row) => ({
    activity: row.activityName,
    session: row.sessionName,
    date: formatDateForInput(row.sessionDate),
    start: row.sessionStartTime || '',
    status: ATTENDANCE_STATUS_LABELS[row.status] || row.status,
    arrival: exportInstant(row.checkedInAt),
    delay: row.punctuality.delayMinutes,
    punctuality: row.punctuality.available ? row.punctuality.label : 'Non disponible',
    updatedAt: exportInstant(row.updatedAt),
  })));

  const audit = workbook.addWorksheet(worksheetNames.audit);
  configureSheet(audit, [
    { header: 'Date', key: 'occurredAt', width: 24 },
    { header: 'Utilisateur', key: 'actor', width: 26 },
    { header: 'Catégorie', key: 'category', width: 18 },
    { header: 'Action', key: 'action', width: 30 },
    { header: 'Résultat', key: 'result', width: 14 },
    { header: 'Résumé', key: 'summary', width: 55 },
    { header: 'Modifications', key: 'changes', width: 55 },
  ]);
  addRows(audit, data.audit.map((row) => ({ occurredAt: exportInstant(row.occurredAt), actor: row.actorName || 'Système', category: row.category, action: row.action, result: row.result, summary: row.summary, changes: row.changes })));
  return workbook;
}

module.exports = {
  buildParticipantDataWorkbook,
  createParticipantWorksheetNames,
  loadParticipantDataExport,
  selectAuditFields,
};
