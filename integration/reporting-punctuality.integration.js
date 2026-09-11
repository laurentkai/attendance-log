const test = require('node:test');
const assert = require('node:assert/strict');

assert.match(process.env.TEST_DATABASE_NAME || '', /^attendance_log_test_[a-z0-9_]+$/);
assert.match(process.env.DATABASE_URL || '', new RegExp(`/${process.env.TEST_DATABASE_NAME}$`));

const { pool } = require('../src/db/client');
const { calculatePunctuality } = require('../src/punctuality');
const { getSessionSummaries } = require('../src/reporting-data');
const { getParticipantRetentionDetail } = require('../src/data-retention');
const { buildParticipantDataWorkbook, loadParticipantDataExport } = require('../src/participant-data-export');

test.after(async () => pool.end());

const STUDENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let studentSequence = 0;

function nextStudentCode() {
  let value = studentSequence;
  studentSequence += 1;
  let code = '';
  for (let index = 0; index < 7; index += 1) {
    code = STUDENT_CODE_ALPHABET[value % STUDENT_CODE_ALPHABET.length] + code;
    value = Math.floor(value / STUDENT_CODE_ALPHABET.length);
  }
  return code;
}

async function createSession(client, classId, title, tolerance, rows, { startTime = '20:00' } = {}) {
  const session = await client.query(
    `INSERT INTO course_sessions
       (class_id, date, title, instructor, state, started_at, closed_at, start_time,
        punctuality_tolerance_override_minutes)
     VALUES ($1, DATE '2026-01-15', $2, 'Test', 'closed', NOW(), NOW(), $3, $4)
     RETURNING id`,
    [classId, title, startTime, tolerance],
  );
  for (let index = 0; index < rows.length; index += 1) {
    const student = await client.query(
      `INSERT INTO students (email, first_name, last_name, student_code)
       VALUES ($1, 'Test', $2, $3) RETURNING id`,
      [`punctuality-${title}-${index}@example.invalid`, `${title}-${index}`, nextStudentCode()],
    );
    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
       VALUES ($1, $2, $3, $4)`,
      [session.rows[0].id, student.rows[0].id, rows[index].status, rows[index].checkedInAt],
    );
  }
}

test('SQL session punctuality aggregates match fixed JS boundary semantics', async () => {
  const client = await pool.connect();
  try {
    const course = await client.query(
      `INSERT INTO classes (name, punctuality_tolerance_minutes)
       VALUES ('Punctuality integration', 5) RETURNING id`,
    );
    const classId = course.rows[0].id;
    const fixtures = [
      { title: 'Tolerance 5', tolerance: 5, rows: [
        { status: 'present', checkedInAt: '2026-01-15T18:55:00Z' },
        { status: 'present', checkedInAt: '2026-01-15T19:00:00Z' },
        { status: 'present', checkedInAt: '2026-01-15T19:05:00Z' },
        { status: 'present', checkedInAt: '2026-01-15T19:05:59Z' },
        { status: 'present', checkedInAt: '2026-01-15T19:06:00Z' },
        { status: 'absent', checkedInAt: null },
        { status: 'present', checkedInAt: null },
      ] },
      { title: 'Tolerance 10', tolerance: 10, rows: [
        { status: 'present', checkedInAt: '2026-01-15T19:10:00Z' },
        { status: 'present', checkedInAt: '2026-01-15T19:11:00Z' },
      ] },
      { title: 'Tolerance 15', tolerance: 15, rows: [
        { status: 'present', checkedInAt: '2026-01-15T19:15:00Z' },
        { status: 'present', checkedInAt: '2026-01-15T19:16:00Z' },
      ] },
      { title: 'No start', tolerance: null, startTime: null, rows: [
        { status: 'present', checkedInAt: '2026-01-15T19:00:00Z' },
      ] },
      { title: 'Zero eligible', tolerance: 5, rows: [] },
    ];
    for (const fixture of fixtures) {
      await createSession(client, classId, fixture.title, fixture.tolerance, fixture.rows, { startTime: fixture.startTime === undefined ? '20:00' : fixture.startTime });
    }

    const summaries = await getSessionSummaries();
    for (const fixture of fixtures) {
      const summary = summaries.find((row) => row.title === fixture.title);
      assert.ok(summary, `${fixture.title} summary exists`);
      const outcomes = fixture.rows.map((row) => calculatePunctuality({
        status: row.status,
        checkedInAt: row.checkedInAt,
        scheduledStartAt: fixture.startTime === null ? null : '2026-01-15T19:00:00Z',
        toleranceMinutes: fixture.tolerance ?? 5,
      })).filter((outcome) => outcome.available);
      const onTime = outcomes.filter((outcome) => outcome.status === 'on_time').length;
      const late = outcomes.filter((outcome) => outcome.status === 'late').length;
      assert.equal(summary.onTime, onTime, `${fixture.title}: on-time count`);
      assert.equal(summary.late, late, `${fixture.title}: late count`);
      assert.equal(summary.punctualityKnown, outcomes.length, `${fixture.title}: denominator`);
      assert.equal(summary.punctualityRate, outcomes.length ? onTime / outcomes.length : null, `${fixture.title}: rate`);
    }

    const participantResult = await client.query(
      `SELECT id, public_id FROM students
       WHERE email = 'punctuality-Tolerance 5-0@example.invalid'`,
    );
    const participant = participantResult.rows[0];
    await client.query(
      'INSERT INTO student_classes (student_id, class_id, active) VALUES ($1, $2, FALSE)',
      [participant.id, classId],
    );
    await client.query(
      `INSERT INTO admin_audit_log
         (action, category, target_type, target_public_id, result, summary, before_data, after_data)
       VALUES ('student.update', 'student', 'student', $1, 'success',
               'Participant modifié.', '{"active":true}', '{"active":false}')`,
      [participant.public_id],
    );
    const retentionDetail = await getParticipantRetentionDetail(participant.public_id, { client });
    assert.equal(retentionDetail.participant.public_id, participant.public_id);
    const exportData = await loadParticipantDataExport(participant.public_id, client);
    assert.equal(exportData.identity.publicId, participant.public_id);
    assert.equal(exportData.memberships.length, 1);
    assert.equal(exportData.attendance.length, 1);
    assert.equal(exportData.audit.length, 1);
    assert.equal(Object.hasOwn(exportData.identity, 'id'), false);
    const workbook = buildParticipantDataWorkbook(exportData);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Identité', 'Activités', 'Présences', 'Audit']);
  } finally {
    client.release();
  }
});

test('attendance foreign keys cannot leave orphan participant, session, or activity data', async () => {
  const client = await pool.connect();
  try {
    const course = await client.query(
      "INSERT INTO classes (name) VALUES ('Attendance FK integration') RETURNING id",
    );
    const classId = course.rows[0].id;
    const student = await client.query(
      `INSERT INTO students (email, first_name, last_name, student_code)
       VALUES ('attendance-fk@example.invalid', 'FK', 'Participant', $1) RETURNING id`,
      [nextStudentCode()],
    );
    const studentId = student.rows[0].id;
    const session = await client.query(
      `INSERT INTO course_sessions (class_id, date, title, instructor)
       VALUES ($1, DATE '2026-01-15', 'FK session', 'Test') RETURNING id`,
      [classId],
    );
    const sessionId = session.rows[0].id;
    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, status)
       VALUES ($1, $2, 'present')`,
      [sessionId, studentId],
    );

    await assert.rejects(
      client.query('DELETE FROM students WHERE id = $1', [studentId]),
      (error) => error.code === '23503',
    );
    await assert.rejects(
      client.query('DELETE FROM classes WHERE id = $1', [classId]),
      (error) => error.code === '23503',
    );
    const beforeSessionDelete = await client.query(
      'SELECT COUNT(*)::integer AS count FROM attendance_records WHERE session_id = $1',
      [sessionId],
    );
    assert.equal(beforeSessionDelete.rows[0].count, 1);

    await client.query('DELETE FROM course_sessions WHERE id = $1', [sessionId]);
    const afterSessionDelete = await client.query(
      'SELECT COUNT(*)::integer AS count FROM attendance_records WHERE session_id = $1',
      [sessionId],
    );
    assert.equal(afterSessionDelete.rows[0].count, 0);
    await client.query('DELETE FROM students WHERE id = $1', [studentId]);
    await client.query('DELETE FROM classes WHERE id = $1', [classId]);
  } finally {
    client.release();
  }
});
