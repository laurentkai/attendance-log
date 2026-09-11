const { pool } = require('./db/client');
const { getApplicationTimezone } = require('./application-time');
const { calculatePunctuality, summarizePunctuality } = require('./punctuality');

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
    ...summarizePunctuality(rows),
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
    `SELECT c.id, c.public_id, c.name,
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
    `SELECT cs.id, cs.public_id, cs.class_id, c.public_id AS class_public_id, cs.date, cs.title, cs.instructor,
            cs.start_time,
            COALESCE(cs.punctuality_tolerance_override_minutes,
                     c.punctuality_tolerance_minutes) AS effective_tolerance_minutes,
            c.name AS class_name,
            COUNT(ar.student_id)::integer AS opportunities,
            COUNT(ar.student_id) FILTER (WHERE ar.status = 'present')::integer AS present,
            COUNT(ar.student_id) FILTER (WHERE ar.status = 'absent')::integer AS absent,
            COUNT(ar.student_id) FILTER (
              WHERE ar.status = 'present' AND cs.start_time IS NOT NULL
                AND ar.checked_in_at IS NOT NULL
                AND FLOOR(EXTRACT(EPOCH FROM (
                  ar.checked_in_at - ((cs.date + cs.start_time) AT TIME ZONE $4)
                )) / 60) <= COALESCE(cs.punctuality_tolerance_override_minutes,
                                      c.punctuality_tolerance_minutes)
            )::integer AS on_time,
            COUNT(ar.student_id) FILTER (
              WHERE ar.status = 'present' AND cs.start_time IS NOT NULL
                AND ar.checked_in_at IS NOT NULL
                AND FLOOR(EXTRACT(EPOCH FROM (
                  ar.checked_in_at - ((cs.date + cs.start_time) AT TIME ZONE $4)
                )) / 60) > COALESCE(cs.punctuality_tolerance_override_minutes,
                                     c.punctuality_tolerance_minutes)
            )::integer AS late
     FROM course_sessions cs
     INNER JOIN classes c ON c.id = cs.class_id
     LEFT JOIN attendance_records ar ON ar.session_id = cs.id
     WHERE cs.state = 'closed'
       AND ($1::uuid IS NULL OR c.public_id = $1)
       AND ($2::date IS NULL OR cs.date >= $2)
       AND ($3::date IS NULL OR cs.date <= $3)
     GROUP BY cs.id, c.id
     ORDER BY cs.date DESC, LOWER(cs.title), cs.id DESC`,
    [classId, dateFrom, dateTo, getApplicationTimezone()],
  );

  return result.rows.map((row) => {
    const opportunities = Number(row.opportunities);
    const present = Number(row.present);
    const onTime = Number(row.on_time);
    const late = Number(row.late);
    return {
      ...row,
      opportunities,
      present,
      absent: Number(row.absent),
      attendanceRate: calculateRate(present, opportunities),
      punctualityApplicable: Boolean(row.start_time),
      punctualityKnown: onTime + late,
      onTime,
      late,
      punctualityRate: calculateRate(onTime, onTime + late),
    };
  });
}

function identifiedPrivacyContext() {
  return { canViewPii: true };
}

async function getStudentSummaries(privacyContext = identifiedPrivacyContext()) {
  if (!privacyContext.canViewPii) {
    const result = await pool.query(
      `SELECT c.public_id AS class_public_id, c.name AS class_name,
              s.public_id AS pseudonym_source_public_id,
              COUNT(DISTINCT cs.id)::integer AS closed_session_count,
              COUNT(*)::integer AS opportunities,
              COUNT(*) FILTER (WHERE ar.status = 'present')::integer AS present,
              COUNT(*) FILTER (WHERE ar.status = 'absent')::integer AS absent
       FROM attendance_records ar
       INNER JOIN course_sessions cs ON cs.id = ar.session_id AND cs.state = 'closed'
       INNER JOIN classes c ON c.id = cs.class_id
       INNER JOIN students s ON s.id = ar.student_id
       GROUP BY c.id, c.public_id, c.name, s.id, s.public_id
       ORDER BY LOWER(c.name), c.id, s.id`,
    );

    return result.rows.map((row) => normalizeSummary({
      participant_label: privacyContext.pseudonymize(
        row.class_public_id,
        row.pseudonym_source_public_id,
      ),
      class_name: row.class_name,
      closed_session_count: row.closed_session_count,
      opportunities: row.opportunities,
      present: row.present,
      absent: row.absent,
    }));
  }

  const result = await pool.query(
    `SELECT s.id, s.public_id, s.first_name, s.last_name, s.student_code, s.active,
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
  dateFrom = null, dateTo = null } = {}, privacyContext = identifiedPrivacyContext()) {
  const identityColumns = privacyContext.canViewPii
    ? 's.id AS student_id, s.public_id AS student_public_id, s.first_name, s.last_name, s.email, s.student_code,'
    : 's.public_id AS pseudonym_source_public_id,';
  const identityOrder = privacyContext.canViewPii
    ? 'LOWER(s.last_name), LOWER(s.first_name), s.id'
    : 's.id';
  const result = await pool.query(
    `SELECT cs.id AS session_id, cs.public_id AS session_public_id, cs.date, cs.title, cs.instructor,
            c.id AS class_id, c.public_id AS class_public_id, c.name AS class_name,
            ${identityColumns}
            ar.status, ar.checked_in_at, cs.start_time,
            COALESCE(cs.punctuality_tolerance_override_minutes,
                     c.punctuality_tolerance_minutes) AS effective_tolerance_minutes,
            CASE WHEN cs.start_time IS NULL THEN NULL
                 ELSE (cs.date + cs.start_time) AT TIME ZONE $6 END AS scheduled_start_at
     FROM course_sessions cs
     INNER JOIN classes c ON c.id = cs.class_id
     INNER JOIN attendance_records ar ON ar.session_id = cs.id
     INNER JOIN students s ON s.id = ar.student_id
     WHERE cs.state = 'closed'
       AND ($1::uuid IS NULL OR c.public_id = $1)
       AND ($2::uuid IS NULL OR s.public_id = $2)
       AND ($3::uuid IS NULL OR cs.public_id = $3)
       AND ($4::date IS NULL OR cs.date >= $4)
       AND ($5::date IS NULL OR cs.date <= $5)
     ORDER BY cs.date, LOWER(c.name), LOWER(cs.title), ${identityOrder}`,
    [classId, studentId, sessionId, dateFrom, dateTo, getApplicationTimezone()],
  );

  return result.rows.map((row) => {
    const punctuality = calculatePunctuality({
      status: row.status,
      checkedInAt: row.checked_in_at,
      scheduledStartAt: row.scheduled_start_at,
      toleranceMinutes: row.effective_tolerance_minutes,
    });
    if (privacyContext.canViewPii) return { ...row, punctuality };
    return {
      session_id: row.session_id,
      session_public_id: row.session_public_id,
      date: row.date,
      title: row.title,
      instructor: row.instructor,
      class_id: row.class_id,
      class_public_id: row.class_public_id,
      class_name: row.class_name,
      participant_label: privacyContext.pseudonymize(
        row.class_public_id,
        row.pseudonym_source_public_id,
      ),
      status: row.status,
      checked_in_at: row.checked_in_at,
      start_time: row.start_time,
      effective_tolerance_minutes: row.effective_tolerance_minutes,
      scheduled_start_at: row.scheduled_start_at,
      punctuality,
    };
  });
}

function aggregateStudents(rows, privacyContext = identifiedPrivacyContext()) {
  const students = new Map();

  rows.forEach((row) => {
    const key = privacyContext.canViewPii ? String(row.student_id) : row.participant_label;
    if (!students.has(key)) {
      const identity = privacyContext.canViewPii ? {
        id: row.student_id,
        public_id: row.student_public_id,
        first_name: row.first_name,
        last_name: row.last_name,
        student_code: row.student_code,
      } : {
        participant_label: row.participant_label,
      };
      students.set(key, {
        ...identity,
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
  })).sort((first, second) => {
    if (!privacyContext.canViewPii) {
      return first.participant_label.localeCompare(second.participant_label, 'fr');
    }
    return first.last_name.localeCompare(second.last_name, 'fr', { sensitivity: 'base' })
      || first.first_name.localeCompare(second.first_name, 'fr', { sensitivity: 'base' });
  });
}

async function getCourseReport(classId, privacyContext = identifiedPrivacyContext()) {
  const [classResult, sessions, details] = await Promise.all([
    pool.query('SELECT id, public_id, name, description FROM classes WHERE public_id = $1', [classId]),
    getSessionSummaries({ classId }),
    getAttendanceDetails({ classId }, privacyContext),
  ]);

  if (classResult.rowCount === 0) return null;

  return {
    course: classResult.rows[0],
    summary: {
      closedSessionCount: sessions.length,
      ...summarizeRows(details),
    },
    sessions,
    canViewPii: privacyContext.canViewPii,
    students: aggregateStudents(details, privacyContext),
    details,
  };
}

async function getSessionReport(sessionId, privacyContext = identifiedPrivacyContext()) {
  const sessionResult = await pool.query(
    `SELECT cs.id, cs.public_id, cs.class_id, c.public_id AS class_public_id, cs.date, cs.title,
            cs.instructor, cs.state, cs.start_time,
            COALESCE(cs.punctuality_tolerance_override_minutes,
                     c.punctuality_tolerance_minutes) AS effective_tolerance_minutes,
            CASE WHEN cs.start_time IS NULL THEN NULL
                 ELSE (cs.date + cs.start_time) AT TIME ZONE $2 END AS scheduled_start_at,
            c.name AS class_name
     FROM course_sessions cs
     INNER JOIN classes c ON c.id = cs.class_id
     WHERE cs.public_id = $1`,
    [sessionId, getApplicationTimezone()],
  );
  if (sessionResult.rowCount === 0) return null;

  const session = sessionResult.rows[0];
  const details = session.state === 'closed'
    ? await getAttendanceDetails({ sessionId }, privacyContext)
    : [];

  return {
    session,
    canViewPii: privacyContext.canViewPii,
    summary: {
      ...summarizeRows(details),
      punctualityApplicable: Boolean(session.start_time),
    },
    details,
  };
}

async function getStudentReport(studentId) {
  const studentResult = await pool.query(
    `SELECT id, public_id, first_name, last_name, email, student_code, active
     FROM students
     WHERE public_id = $1`,
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

async function getGlobalReport(filters = {}, privacyContext = identifiedPrivacyContext()) {
  const [details, sessions] = await Promise.all([
    getAttendanceDetails(filters, privacyContext),
    getSessionSummaries(filters),
  ]);
  return {
    filters,
    canViewPii: privacyContext.canViewPii,
    summary: {
      closedSessionCount: sessions.length,
      ...summarizeRows(details),
    },
    details,
  };
}

async function getClassesForFilters() {
  const result = await pool.query(
    'SELECT id, public_id, name FROM classes ORDER BY LOWER(name), id',
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
