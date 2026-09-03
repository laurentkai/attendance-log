const { pool } = require('./db/client');

function calculateRate(present, total) {
  return total > 0 ? present / total : null;
}

function summarizeRows(rows) {
  const present = rows.filter((row) => row.status === 'present').length;
  const absent = rows.filter((row) => row.status === 'absent').length;

  return {
    opportunities: rows.length,
    present,
    absent,
    attendanceRate: calculateRate(present, rows.length),
  };
}

function normalizeSummary(row) {
  const opportunities = Number(row.opportunities);
  const present = Number(row.present);

  return {
    ...row,
    closedSessionCount: Number(row.closed_session_count),
    opportunities,
    present,
    absent: Number(row.absent),
    attendanceRate: calculateRate(present, opportunities),
  };
}

async function getCourseSummaries() {
  const result = await pool.query(
    `SELECT c.id, c.name,
            COUNT(DISTINCT cs.id)::integer AS closed_session_count,
            COUNT(ar.student_id)::integer AS opportunities,
            COUNT(ar.student_id) FILTER (WHERE ar.status = 'present')::integer AS present,
            COUNT(ar.student_id) FILTER (WHERE ar.status = 'absent')::integer AS absent
     FROM classes c
     LEFT JOIN course_sessions cs ON cs.class_id = c.id AND cs.state = 'closed'
     LEFT JOIN attendance_records ar ON ar.session_id = cs.id
     GROUP BY c.id, c.name
     ORDER BY LOWER(c.name), c.id`,
  );

  return result.rows.map(normalizeSummary);
}

async function getSessionSummaries({ classId = null, dateFrom = null, dateTo = null } = {}) {
  const result = await pool.query(
    `SELECT cs.id, cs.class_id, cs.date, cs.title, cs.instructor,
            c.name AS class_name,
            COUNT(ar.student_id)::integer AS opportunities,
            COUNT(ar.student_id) FILTER (WHERE ar.status = 'present')::integer AS present,
            COUNT(ar.student_id) FILTER (WHERE ar.status = 'absent')::integer AS absent
     FROM course_sessions cs
     INNER JOIN classes c ON c.id = cs.class_id
     LEFT JOIN attendance_records ar ON ar.session_id = cs.id
     WHERE cs.state = 'closed'
       AND ($1::bigint IS NULL OR cs.class_id = $1)
       AND ($2::date IS NULL OR cs.date >= $2)
       AND ($3::date IS NULL OR cs.date <= $3)
     GROUP BY cs.id, c.name
     ORDER BY cs.date DESC, LOWER(cs.title), cs.id DESC`,
    [classId, dateFrom, dateTo],
  );

  return result.rows.map((row) => {
    const opportunities = Number(row.opportunities);
    const present = Number(row.present);
    return {
      ...row,
      opportunities,
      present,
      absent: Number(row.absent),
      attendanceRate: calculateRate(present, opportunities),
    };
  });
}

async function getStudentSummaries() {
  const result = await pool.query(
    `SELECT s.id, s.first_name, s.last_name, s.student_code, s.active,
            COUNT(DISTINCT cs.id)::integer AS closed_session_count,
            COUNT(*)::integer AS opportunities,
            COUNT(*) FILTER (WHERE ar.status = 'present')::integer AS present,
            COUNT(*) FILTER (WHERE ar.status = 'absent')::integer AS absent
     FROM attendance_records ar
     INNER JOIN course_sessions cs ON cs.id = ar.session_id AND cs.state = 'closed'
     INNER JOIN students s ON s.id = ar.student_id
     GROUP BY s.id, s.first_name, s.last_name, s.student_code, s.active
     ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
  );

  return result.rows.map(normalizeSummary);
}

async function getAttendanceDetails({ classId = null, studentId = null, sessionId = null,
  dateFrom = null, dateTo = null } = {}) {
  const result = await pool.query(
    `SELECT cs.id AS session_id, cs.date, cs.title, cs.instructor,
            c.id AS class_id, c.name AS class_name,
            s.id AS student_id, s.first_name, s.last_name, s.email, s.student_code,
            ar.status
     FROM course_sessions cs
     INNER JOIN classes c ON c.id = cs.class_id
     INNER JOIN attendance_records ar ON ar.session_id = cs.id
     INNER JOIN students s ON s.id = ar.student_id
     WHERE cs.state = 'closed'
       AND ($1::bigint IS NULL OR cs.class_id = $1)
       AND ($2::bigint IS NULL OR ar.student_id = $2)
       AND ($3::bigint IS NULL OR cs.id = $3)
       AND ($4::date IS NULL OR cs.date >= $4)
       AND ($5::date IS NULL OR cs.date <= $5)
     ORDER BY cs.date, LOWER(c.name), LOWER(cs.title),
              LOWER(s.last_name), LOWER(s.first_name), s.id`,
    [classId, studentId, sessionId, dateFrom, dateTo],
  );

  return result.rows;
}

function aggregateStudents(rows) {
  const students = new Map();

  rows.forEach((row) => {
    const key = String(row.student_id);
    if (!students.has(key)) {
      students.set(key, {
        id: row.student_id,
        first_name: row.first_name,
        last_name: row.last_name,
        student_code: row.student_code,
        sessionIds: new Set(),
        present: 0,
        absent: 0,
      });
    }
    const student = students.get(key);
    student.sessionIds.add(String(row.session_id));
    if (row.status === 'present') student.present += 1;
    if (row.status === 'absent') student.absent += 1;
  });

  return [...students.values()].map((student) => ({
    ...student,
    closedSessionCount: student.sessionIds.size,
    opportunities: student.present + student.absent,
    attendanceRate: calculateRate(student.present, student.present + student.absent),
  })).sort((first, second) => (
    first.last_name.localeCompare(second.last_name, 'fr', { sensitivity: 'base' })
      || first.first_name.localeCompare(second.first_name, 'fr', { sensitivity: 'base' })
  ));
}

async function getCourseReport(classId) {
  const [classResult, sessions, details] = await Promise.all([
    pool.query('SELECT id, name, description FROM classes WHERE id = $1', [classId]),
    getSessionSummaries({ classId }),
    getAttendanceDetails({ classId }),
  ]);

  if (classResult.rowCount === 0) return null;

  return {
    course: classResult.rows[0],
    summary: {
      closedSessionCount: sessions.length,
      ...summarizeRows(details),
    },
    sessions,
    students: aggregateStudents(details),
    details,
  };
}

async function getSessionReport(sessionId) {
  const sessionResult = await pool.query(
    `SELECT cs.id, cs.class_id, cs.date, cs.title, cs.instructor, cs.state,
            c.name AS class_name
     FROM course_sessions cs
     INNER JOIN classes c ON c.id = cs.class_id
     WHERE cs.id = $1`,
    [sessionId],
  );
  if (sessionResult.rowCount === 0) return null;

  const session = sessionResult.rows[0];
  const details = session.state === 'closed'
    ? await getAttendanceDetails({ sessionId })
    : [];

  return { session, summary: summarizeRows(details), details };
}

async function getStudentReport(studentId) {
  const studentResult = await pool.query(
    `SELECT id, first_name, last_name, email, student_code, active
     FROM students
     WHERE id = $1`,
    [studentId],
  );
  if (studentResult.rowCount === 0) return null;

  const details = await getAttendanceDetails({ studentId });
  return {
    student: studentResult.rows[0],
    summary: {
      closedSessionCount: new Set(details.map((row) => String(row.session_id))).size,
      ...summarizeRows(details),
    },
    details,
  };
}

async function getGlobalReport(filters = {}) {
  const [details, sessions] = await Promise.all([
    getAttendanceDetails(filters),
    getSessionSummaries(filters),
  ]);
  return {
    filters,
    summary: {
      closedSessionCount: sessions.length,
      ...summarizeRows(details),
    },
    details,
  };
}

async function getClassesForFilters() {
  const result = await pool.query(
    'SELECT id, name FROM classes ORDER BY LOWER(name), id',
  );
  return result.rows;
}

module.exports = {
  calculateRate,
  getClassesForFilters,
  getCourseReport,
  getCourseSummaries,
  getGlobalReport,
  getSessionReport,
  getSessionSummaries,
  getStudentReport,
  getStudentSummaries,
};
