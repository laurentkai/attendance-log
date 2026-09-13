const ExcelJS = require('exceljs');
const { formatLocalTime, getSpreadsheetDateFormats, normalizeClockTime } = require('./application-time');
const { formatDateForInput } = require('./date-format');
const { getTerm } = require('./terminology');
const { DEFAULT_LANGUAGE, t } = require('./i18n');

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Attendance Log';
  workbook.created = new Date();
  workbook.modified = new Date();
  return workbook;
}

function toExcelDate(value) {
  const date = formatDateForInput(value);
  return date ? new Date(`${date}T00:00:00Z`) : null;
}

function configureSheet(sheet, columns) {
  sheet.columns = columns;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF075985' },
  };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(columns.length).letter}1` };
}

function term(language, terminology, concept, form = 'singular') {
  return getTerm(language, concept, form, terminology);
}

function addSummarySheet(workbook, title, summary, extraRows = [], language = DEFAULT_LANGUAGE, terminology) {
  const sheet = workbook.addWorksheet(t(language, 'report.sheet.summary'));
  sheet.columns = [
    { header: t(language, 'report.column.metric'), key: 'label', width: 34 },
    { header: t(language, 'report.column.value'), key: 'value', width: 24 },
  ];
  const attendanceRateLabel = t(language, 'report.column.attendance_rate', { attendance: term(language, terminology, 'attendance') });
  const punctualityRateLabel = t(language, 'report.column.punctuality_rate');
  const rows = [
    [t(language, 'report.column.report'), title],
    ...extraRows,
    [t(language, 'report.column.sessions_closed', { sessions: term(language, terminology, 'session', 'plural') }), summary.closedSessionCount],
    [t(language, 'report.column.attendance_count', { attendance: term(language, terminology, 'attendance', 'plural') }), summary.opportunities],
    [t(language, 'status.present'), summary.present],
    [t(language, 'status.absent'), summary.absent],
    [attendanceRateLabel, summary.attendanceRate],
    ...(summary.punctualityApplicable ? [
      [t(language, 'report.column.present_known_arrival'), summary.punctualityKnown],
      [t(language, 'status.on_time'), summary.onTime],
      [t(language, 'status.late'), summary.late],
      [punctualityRateLabel, summary.punctualityRate],
    ] : []),
    [t(language, 'report.value.generated_at'), new Date()],
  ];
  rows.forEach(([label, value]) => sheet.addRow({ label, value }));
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(2).eachCell((cell) => {
    if (cell.value instanceof Date) cell.numFmt = getSpreadsheetDateFormats().dateTime;
  });
  const rateRow = rows.findIndex(([label]) => label === attendanceRateLabel) + 2;
  sheet.getCell(rateRow, 2).numFmt = '0.0%';
  const punctualityRateRow = rows.findIndex(([label]) => label === punctualityRateLabel);
  if (punctualityRateRow >= 0) sheet.getCell(punctualityRateRow + 2, 2).numFmt = '0.0%';
  return sheet;
}

function addSessionRows(sheet, sessions) {
  sessions.forEach((session) => sheet.addRow({
    date: toExcelDate(session.date),
    title: session.title,
    instructor: session.instructor,
    startTime: normalizeClockTime(session.start_time || '') || null,
    expected: session.opportunities,
    present: session.present,
    absent: session.absent,
    rate: session.attendanceRate,
    onTime: session.punctualityApplicable ? session.onTime : null,
    late: session.punctualityApplicable ? session.late : null,
    punctualityRate: session.punctualityApplicable ? session.punctualityRate : null,
  }));
  sheet.getColumn('date').numFmt = getSpreadsheetDateFormats().date;
  sheet.getColumn('rate').numFmt = '0.0%';
  sheet.getColumn('punctualityRate').numFmt = '0.0%';
}

function participantLabel(row) {
  return row.participant_label || `${row.first_name} ${row.last_name}`;
}

function addStudentRows(sheet, students, { includeIdentity = true } = {}) {
  students.forEach((student) => sheet.addRow({
    student: participantLabel(student),
    ...(includeIdentity ? { code: student.student_code } : {}),
    sessions: student.closedSessionCount,
    present: student.present,
    absent: student.absent,
    rate: student.attendanceRate,
  }));
  sheet.getColumn('rate').numFmt = '0.0%';
}

function addDetailRows(sheet, details, {
  includeStudent = true,
  includeCourse = true,
  includeIdentity = true,
  language = DEFAULT_LANGUAGE,
} = {}) {
  details.forEach((row) => {
    const values = {
      date: toExcelDate(row.date),
      course: row.class_name,
      session: row.title,
      instructor: row.instructor,
      student: participantLabel(row),
      ...(includeIdentity ? { code: row.student_code, email: row.email } : {}),
      status: ['present', 'absent', 'pending'].includes(row.status) ? t(language, `status.${row.status}`) : row.status,
      startTime: normalizeClockTime(row.start_time || '') || null,
      arrivalTime: row.status === 'present' ? formatLocalTime(row.checked_in_at) || t(language, 'common.unknown') : null,
      delayMinutes: row.punctuality?.delayMinutes ?? null,
      punctuality: row.punctuality?.available
        ? t(language, `status.${row.punctuality.status}`)
        : null,
    };
    if (!includeStudent) {
      delete values.student;
      delete values.code;
      delete values.email;
    }
    if (!includeCourse) delete values.course;
    sheet.addRow(values);
  });
  sheet.getColumn('date').numFmt = getSpreadsheetDateFormats().date;
}

function buildCourseWorkbook(report, { language = DEFAULT_LANGUAGE, terminology } = {}) {
  const includeIdentity = report.canViewPii === true;
  const workbook = createWorkbook();
  addSummarySheet(workbook, t(language, 'report.title.for_subject', { subject: report.course.name }), report.summary, [
    [term(language, terminology, 'class'), report.course.name],
  ], language, terminology);

  const sessionSheet = workbook.addWorksheet(t(language, 'report.sheet.by_session', { session: term(language, terminology, 'session') }));
  configureSheet(sessionSheet, [
    { header: t(language, 'report.column.date'), key: 'date', width: 14 },
    { header: term(language, terminology, 'session'), key: 'title', width: 30 },
    { header: term(language, terminology, 'instructor'), key: 'instructor', width: 24 },
    { header: t(language, 'report.column.start_time'), key: 'startTime', width: 16 },
    { header: t(language, 'report.column.expected', { participants: term(language, terminology, 'student', 'plural') }), key: 'expected', width: 18 },
    { header: t(language, 'status.present'), key: 'present', width: 12 },
    { header: t(language, 'status.absent'), key: 'absent', width: 12 },
    { header: t(language, 'report.column.attendance_rate', { attendance: term(language, terminology, 'attendance') }), key: 'rate', width: 19 },
    { header: t(language, 'status.on_time'), key: 'onTime', width: 12 },
    { header: t(language, 'status.late'), key: 'late', width: 12 },
    { header: t(language, 'report.column.punctuality_rate'), key: 'punctualityRate', width: 20 },
  ]);
  addSessionRows(sessionSheet, report.sessions);

  const studentSheet = workbook.addWorksheet(t(language, 'report.sheet.by_participant', { student: term(language, terminology, 'student') }));
  configureSheet(studentSheet, [
    { header: term(language, terminology, 'student'), key: 'student', width: 28 },
    ...(includeIdentity ? [{ header: t(language, 'report.column.code'), key: 'code', width: 20 }] : []),
    { header: t(language, 'report.column.sessions_covered', { sessions: term(language, terminology, 'session', 'plural') }), key: 'sessions', width: 21 },
    { header: term(language, terminology, 'attendance', 'plural'), key: 'present', width: 13 },
    { header: t(language, 'status.absent'), key: 'absent', width: 13 },
    { header: t(language, 'report.column.attendance_rate', { attendance: term(language, terminology, 'attendance') }), key: 'rate', width: 19 },
  ]);
  addStudentRows(studentSheet, report.students, { includeIdentity });

  const detailSheet = workbook.addWorksheet(t(language, 'report.sheet.detail'));
  configureSheet(detailSheet, [
    { header: t(language, 'report.column.date'), key: 'date', width: 14 },
    { header: term(language, terminology, 'class'), key: 'course', width: 24 },
    { header: term(language, terminology, 'session'), key: 'session', width: 30 },
    { header: term(language, terminology, 'student'), key: 'student', width: 28 },
    ...(includeIdentity ? [
      { header: t(language, 'report.column.code'), key: 'code', width: 20 },
      { header: t(language, 'report.column.email'), key: 'email', width: 34 },
    ] : []),
    { header: t(language, 'report.column.status'), key: 'status', width: 14 },
    { header: t(language, 'report.column.start_time'), key: 'startTime', width: 16 },
    { header: t(language, 'report.column.arrival_time'), key: 'arrivalTime', width: 17 },
    { header: t(language, 'report.column.delay_minutes'), key: 'delayMinutes', width: 13 },
    { header: t(language, 'report.column.punctuality'), key: 'punctuality', width: 15 },
  ]);
  addDetailRows(detailSheet, report.details, { includeIdentity, language });
  return workbook;
}

function buildSessionWorkbook(report, { includeParticipantEmail = true, language = DEFAULT_LANGUAGE, terminology } = {}) {
  const includeIdentity = report.canViewPii === true;
  const workbook = createWorkbook();
  addSummarySheet(workbook, t(language, 'report.title.for_subject', { subject: report.session.title }), {
    closedSessionCount: 1,
    ...report.summary,
  }, [
    [term(language, terminology, 'class'), report.session.class_name],
    [t(language, 'report.column.date'), toExcelDate(report.session.date)],
    [term(language, terminology, 'instructor'), report.session.instructor],
    [t(language, 'report.column.start_time'), normalizeClockTime(report.session.start_time || '') || t(language, 'report.value.not_set')],
    [t(language, 'report.extra.punctuality_tolerance'), report.session.start_time
      ? t(language, 'report.value.tolerance_minutes', { minutes: report.session.effective_tolerance_minutes })
      : t(language, 'report.value.not_applicable')],
  ], language, terminology);

  const sheet = workbook.addWorksheet(t(language, 'report.sheet.attendance', { attendance: term(language, terminology, 'attendance', 'plural') }));
  configureSheet(sheet, [
    { header: term(language, terminology, 'student'), key: 'student', width: 28 },
    ...(includeIdentity ? [{ header: t(language, 'report.column.code'), key: 'code', width: 20 }] : []),
    ...(includeIdentity && includeParticipantEmail ? [{ header: t(language, 'report.column.email'), key: 'email', width: 34 }] : []),
    { header: t(language, 'report.column.status'), key: 'status', width: 14 },
    { header: t(language, 'report.column.arrival_time'), key: 'arrivalTime', width: 17 },
    { header: t(language, 'report.column.delay_minutes'), key: 'delayMinutes', width: 13 },
    { header: t(language, 'report.column.punctuality'), key: 'punctuality', width: 15 },
  ]);
  report.details.forEach((row) => sheet.addRow({
    student: participantLabel(row),
    ...(includeIdentity ? { code: row.student_code } : {}),
    ...(includeIdentity && includeParticipantEmail ? { email: row.email } : {}),
    status: ['present', 'absent', 'pending'].includes(row.status) ? t(language, `status.${row.status}`) : row.status,
    arrivalTime: row.status === 'present' ? formatLocalTime(row.checked_in_at) || t(language, 'common.unknown') : null,
    delayMinutes: row.punctuality?.delayMinutes ?? null,
    punctuality: row.punctuality?.available
      ? t(language, `status.${row.punctuality.status}`)
      : null,
  }));
  return workbook;
}

function buildStudentWorkbook(report, { language = DEFAULT_LANGUAGE, terminology } = {}) {
  const workbook = createWorkbook();
  addSummarySheet(
    workbook,
    t(language, 'report.title.for_subject', { subject: `${report.student.first_name} ${report.student.last_name}` }),
    report.summary,
    [[t(language, 'report.column.code'), report.student.student_code]],
    language,
    terminology,
  );

  const sheet = workbook.addWorksheet(t(language, 'report.sheet.history'));
  configureSheet(sheet, [
    { header: t(language, 'report.column.date'), key: 'date', width: 14 },
    { header: term(language, terminology, 'class'), key: 'course', width: 24 },
    { header: term(language, terminology, 'session'), key: 'session', width: 30 },
    { header: term(language, terminology, 'instructor'), key: 'instructor', width: 24 },
    { header: t(language, 'report.column.status'), key: 'status', width: 14 },
    { header: t(language, 'report.column.start_time'), key: 'startTime', width: 16 },
    { header: t(language, 'report.column.arrival_time'), key: 'arrivalTime', width: 17 },
    { header: t(language, 'report.column.delay_minutes'), key: 'delayMinutes', width: 13 },
    { header: t(language, 'report.column.punctuality'), key: 'punctuality', width: 15 },
  ]);
  addDetailRows(sheet, report.details, { includeStudent: false, language });
  return workbook;
}

function buildGlobalWorkbook(report, { language = DEFAULT_LANGUAGE, terminology } = {}) {
  const includeIdentity = report.canViewPii === true;
  const workbook = createWorkbook();
  addSummarySheet(workbook, t(language, 'report.title.global_attendance', { attendance: term(language, terminology, 'attendance', 'plural') }), report.summary, [], language, terminology);

  const sheet = workbook.addWorksheet(t(language, 'report.sheet.attendance', { attendance: term(language, terminology, 'attendance', 'plural') }));
  configureSheet(sheet, [
    { header: t(language, 'report.column.date'), key: 'date', width: 14 },
    { header: term(language, terminology, 'class'), key: 'course', width: 24 },
    { header: term(language, terminology, 'session'), key: 'session', width: 30 },
    { header: term(language, terminology, 'student'), key: 'student', width: 28 },
    ...(includeIdentity ? [
      { header: t(language, 'report.column.code'), key: 'code', width: 20 },
      { header: t(language, 'report.column.email'), key: 'email', width: 34 },
    ] : []),
    { header: t(language, 'report.column.status'), key: 'status', width: 14 },
    { header: t(language, 'report.column.start_time'), key: 'startTime', width: 16 },
    { header: t(language, 'report.column.arrival_time'), key: 'arrivalTime', width: 17 },
    { header: t(language, 'report.column.delay_minutes'), key: 'delayMinutes', width: 13 },
    { header: t(language, 'report.column.punctuality'), key: 'punctuality', width: 15 },
  ]);
  addDetailRows(sheet, report.details, { includeIdentity, language });
  return workbook;
}

function safeFilenamePart(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return normalized || fallback;
}

async function sendWorkbook(response, workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  response.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'X-Content-Type-Options': 'nosniff',
  });
  response.send(Buffer.from(buffer));
}

module.exports = {
  buildCourseWorkbook,
  buildGlobalWorkbook,
  buildSessionWorkbook,
  buildStudentWorkbook,
  safeFilenamePart,
  sendWorkbook,
};
