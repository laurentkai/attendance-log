const ExcelJS = require('exceljs');
const { formatDateForInput } = require('./date-format');
const { getTerm } = require('./terminology');

const STATUS_LABELS = {
  present: 'Présent',
  absent: 'Absent',
  pending: 'En attente',
};

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

function addSummarySheet(workbook, title, summary, extraRows = []) {
  const sheet = workbook.addWorksheet('Synthèse');
  sheet.columns = [
    { header: 'Indicateur', key: 'label', width: 34 },
    { header: 'Valeur', key: 'value', width: 24 },
  ];
  const attendanceRateLabel = `Taux de ${getTerm('attendance').toLocaleLowerCase('fr')}`;
  const rows = [
    ['Rapport', title],
    ...extraRows,
    [`${getTerm('session', 'plural')} clôturées`, summary.closedSessionCount],
    [`Nombre de ${getTerm('attendance', 'plural').toLocaleLowerCase('fr')}`, summary.opportunities],
    ['Présents', summary.present],
    ['Absents', summary.absent],
    [attendanceRateLabel, summary.attendanceRate],
    ['Généré le', new Date()],
  ];
  rows.forEach(([label, value]) => sheet.addRow({ label, value }));
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(2).eachCell((cell) => {
    if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy hh:mm';
  });
  const rateRow = rows.findIndex(([label]) => label === attendanceRateLabel) + 2;
  sheet.getCell(rateRow, 2).numFmt = '0.0%';
  return sheet;
}

function addSessionRows(sheet, sessions) {
  sessions.forEach((session) => sheet.addRow({
    date: toExcelDate(session.date),
    title: session.title,
    instructor: session.instructor,
    expected: session.opportunities,
    present: session.present,
    absent: session.absent,
    rate: session.attendanceRate,
  }));
  sheet.getColumn('date').numFmt = 'dd/mm/yyyy';
  sheet.getColumn('rate').numFmt = '0.0%';
}

function addStudentRows(sheet, students) {
  students.forEach((student) => sheet.addRow({
    student: `${student.first_name} ${student.last_name}`,
    code: student.student_code,
    sessions: student.closedSessionCount,
    present: student.present,
    absent: student.absent,
    rate: student.attendanceRate,
  }));
  sheet.getColumn('rate').numFmt = '0.0%';
}

function addDetailRows(sheet, details, { includeStudent = true, includeCourse = true } = {}) {
  details.forEach((row) => {
    const values = {
      date: toExcelDate(row.date),
      course: row.class_name,
      session: row.title,
      instructor: row.instructor,
      student: `${row.first_name} ${row.last_name}`,
      code: row.student_code,
      email: row.email,
      status: STATUS_LABELS[row.status] || row.status,
    };
    if (!includeStudent) {
      delete values.student;
      delete values.code;
      delete values.email;
    }
    if (!includeCourse) delete values.course;
    sheet.addRow(values);
  });
  sheet.getColumn('date').numFmt = 'dd/mm/yyyy';
}

function buildCourseWorkbook(report) {
  const workbook = createWorkbook();
  addSummarySheet(workbook, `Rapport pour ${report.course.name}`, report.summary, [
    [getTerm('class'), report.course.name],
  ]);

  const sessionSheet = workbook.addWorksheet('Par séance');
  configureSheet(sessionSheet, [
    { header: 'Date', key: 'date', width: 14 },
    { header: getTerm('session'), key: 'title', width: 30 },
    { header: getTerm('instructor'), key: 'instructor', width: 24 },
    { header: `${getTerm('student', 'plural')} attendus`, key: 'expected', width: 18 },
    { header: 'Présents', key: 'present', width: 12 },
    { header: 'Absents', key: 'absent', width: 12 },
    { header: `Taux de ${getTerm('attendance').toLocaleLowerCase('fr')}`, key: 'rate', width: 19 },
  ]);
  addSessionRows(sessionSheet, report.sessions);

  const studentSheet = workbook.addWorksheet('Par élève');
  configureSheet(studentSheet, [
    { header: getTerm('student'), key: 'student', width: 28 },
    { header: 'Code d’identification', key: 'code', width: 20 },
    { header: `${getTerm('session', 'plural')} concernées`, key: 'sessions', width: 21 },
    { header: getTerm('attendance', 'plural'), key: 'present', width: 13 },
    { header: 'Absences', key: 'absent', width: 13 },
    { header: `Taux de ${getTerm('attendance').toLocaleLowerCase('fr')}`, key: 'rate', width: 19 },
  ]);
  addStudentRows(studentSheet, report.students);

  const detailSheet = workbook.addWorksheet('Détail');
  configureSheet(detailSheet, [
    { header: 'Date', key: 'date', width: 14 },
    { header: getTerm('class'), key: 'course', width: 24 },
    { header: getTerm('session'), key: 'session', width: 30 },
    { header: getTerm('student'), key: 'student', width: 28 },
    { header: 'Code d’identification', key: 'code', width: 20 },
    { header: 'E-mail', key: 'email', width: 34 },
    { header: 'Statut', key: 'status', width: 14 },
  ]);
  addDetailRows(detailSheet, report.details);
  return workbook;
}

function buildSessionWorkbook(report) {
  const workbook = createWorkbook();
  addSummarySheet(workbook, `Rapport pour ${report.session.title}`, {
    closedSessionCount: 1,
    ...report.summary,
  }, [
    [getTerm('class'), report.session.class_name],
    ['Date', toExcelDate(report.session.date)],
    [getTerm('instructor'), report.session.instructor],
  ]);

  const sheet = workbook.addWorksheet('Présences');
  configureSheet(sheet, [
    { header: getTerm('student'), key: 'student', width: 28 },
    { header: 'Code d’identification', key: 'code', width: 20 },
    { header: 'E-mail', key: 'email', width: 34 },
    { header: 'Statut', key: 'status', width: 14 },
  ]);
  report.details.forEach((row) => sheet.addRow({
    student: `${row.first_name} ${row.last_name}`,
    code: row.student_code,
    email: row.email,
    status: STATUS_LABELS[row.status] || row.status,
  }));
  return workbook;
}

function buildStudentWorkbook(report) {
  const workbook = createWorkbook();
  addSummarySheet(
    workbook,
    `Rapport pour ${report.student.first_name} ${report.student.last_name}`,
    report.summary,
    [['Code d’identification', report.student.student_code]],
  );

  const sheet = workbook.addWorksheet('Historique');
  configureSheet(sheet, [
    { header: 'Date', key: 'date', width: 14 },
    { header: getTerm('class'), key: 'course', width: 24 },
    { header: getTerm('session'), key: 'session', width: 30 },
    { header: getTerm('instructor'), key: 'instructor', width: 24 },
    { header: 'Statut', key: 'status', width: 14 },
  ]);
  addDetailRows(sheet, report.details, { includeStudent: false });
  return workbook;
}

function buildGlobalWorkbook(report) {
  const workbook = createWorkbook();
  addSummarySheet(workbook, `Export global des ${getTerm('attendance', 'plural').toLocaleLowerCase('fr')}`, report.summary);

  const sheet = workbook.addWorksheet('Présences');
  configureSheet(sheet, [
    { header: 'Date', key: 'date', width: 14 },
    { header: getTerm('class'), key: 'course', width: 24 },
    { header: getTerm('session'), key: 'session', width: 30 },
    { header: getTerm('student'), key: 'student', width: 28 },
    { header: 'Code d’identification', key: 'code', width: 20 },
    { header: 'E-mail', key: 'email', width: 34 },
    { header: 'Statut', key: 'status', width: 14 },
  ]);
  addDetailRows(sheet, report.details);
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
