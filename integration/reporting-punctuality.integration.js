const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');

assert.match(process.env.TEST_DATABASE_NAME || '', /^attendance_log_test_[a-z0-9_]+$/);
assert.match(process.env.TEST_RESTORE_DATABASE_NAME || '', /^attendance_log_test_[a-z0-9_]+$/);
assert.match(process.env.DATABASE_URL || '', new RegExp(`/${process.env.TEST_DATABASE_NAME}$`));

const { recordAuditEvent } = require('../src/audit');
const { pool } = require('../src/db/client');
const { calculatePunctuality } = require('../src/punctuality');
const { getSessionSummaries, getStudentReport } = require('../src/reporting-data');
const { getParticipantRetentionDetail } = require('../src/data-retention');
const { buildParticipantDataWorkbook, loadParticipantDataExport } = require('../src/participant-data-export');
const {
  ANONYMIZED_TARGET_LABEL,
  StudentAnonymizationError,
  anonymizeStudent,
  getStudentAnonymizationPreview,
} = require('../src/student-anonymization');

test.after(async () => pool.end());

const STUDENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let studentSequence = 0;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function databaseUrlFor(databaseName) {
  assert.match(databaseName, /^attendance_log_test_[a-z0-9_]+$|^postgres$/);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  return databaseUrl.toString();
}

function postgresEnvironment(databaseName) {
  const databaseUrl = new URL(databaseUrlFor(databaseName));
  return {
    ...process.env,
    PGHOST: databaseUrl.hostname,
    PGPORT: databaseUrl.port || '5432',
    PGUSER: decodeURIComponent(databaseUrl.username),
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGDATABASE: databaseName,
    PGSSLMODE: process.env.DATABASE_SSL === 'true' ? 'verify-full' : 'disable',
  };
}

function runPostgresCommand(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: path.resolve(__dirname, '..'),
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.error, undefined, `${command} starts successfully`);
  assert.equal(result.status, 0, `${command} succeeds: ${(result.stderr || '').trim()}`);
}

async function findValuesAcrossPublicTables(client, values) {
  const tables = await client.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`,
  );
  const patterns = values.map((value) => `%${String(value)}%`);
  const matches = [];
  for (const { tablename } of tables.rows) {
    assert.match(tablename, /^[a-z][a-z0-9_]*$/);
    const found = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM "${tablename}" candidate
         WHERE row_to_json(candidate)::text ILIKE ANY($1::text[])
       ) AS found`,
      [patterns],
    );
    if (found.rows[0].found) matches.push(tablename);
  }
  return matches;
}

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

async function createAnonymizationFixture(client, suffix, overrides = {}) {
  const course = await client.query(
    'INSERT INTO classes (name) VALUES ($1) RETURNING id',
    [`Anonymization activity ${suffix}`],
  );
  const student = await client.query(
    `INSERT INTO students
       (email, first_name, last_name, student_code, active, created_at, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, public_id, qr_token`,
    [overrides.email || `erasure-${suffix}@example.invalid`,
      overrides.firstName || `ErasureFirst${suffix}`,
      overrides.lastName || `ErasureLast${suffix}`,
      overrides.studentCode || nextStudentCode(),
      overrides.active ?? false,
      overrides.createdAt || '2020-01-01T00:00:00Z',
      overrides.lastActivityAt === undefined ? '2020-01-02T00:00:00Z' : overrides.lastActivityAt],
  );
  if (overrides.membership !== false) {
    await client.query(
      'INSERT INTO student_classes (student_id, class_id, active) VALUES ($1, $2, $3)',
      [student.rows[0].id, course.rows[0].id, overrides.membershipActive ?? false],
    );
  }
  return { classId: course.rows[0].id, ...student.rows[0] };
}

async function expectAnonymizationError(publicId, code) {
  await assert.rejects(
    anonymizeStudent(publicId, { transactionPool: pool, now: new Date('2026-09-12T12:00:00Z') }),
    (error) => error instanceof StudentAnonymizationError && error.code === code,
  );
}

async function waitForProcessLock(client, processId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await client.query(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
      [processId],
    );
    if (state.rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`PostgreSQL process ${processId} did not wait on the participant lock`);
}

test('eligible participant anonymization is atomic, redacts PII, invalidates QR, and preserves history', async () => {
  const client = await pool.connect();
  const former = {
    firstName: 'ErasureUniqueFirst9',
    lastName: 'ErasureUniqueLast9',
    email: 'erasure-unique-9@example.invalid',
    studentCode: 'ZZZZZZZ',
  };
  try {
    await client.query('UPDATE data_retention_configuration SET inactive_student_retention_months = 12 WHERE id = 1');
    const fixture = await createAnonymizationFixture(client, 'success', former);
    const session = await client.query(
      `INSERT INTO course_sessions
         (class_id, date, title, instructor, state, started_at, closed_at, start_time)
       VALUES ($1, DATE '2020-01-02', 'Historical session', 'Test', 'closed', NOW(), NOW(), '20:00')
       RETURNING id`,
      [fixture.classId],
    );
    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
       VALUES ($1, $2, 'present', '2020-01-02T19:04:00Z')`,
      [session.rows[0].id, fixture.id],
    );
    await client.query(
      `INSERT INTO admin_audit_log
         (actor_name, actor_role, action, category, target_type, target_public_id,
          target_label, result, summary, before_data, after_data, metadata)
       VALUES ('Synthetic administrator', 'administrator', 'attendance.manual.update',
               'attendance', 'student', $1, $2, 'success', $3, $4, $5, $6)`,
      [fixture.public_id,
        `${former.firstName} ${former.lastName}`,
        `Presence changed for ${former.firstName} ${former.lastName} ${former.email} ${former.studentCode}`,
        { name: `${former.firstName} ${former.lastName}`, email: former.email, student_code: former.studentCode, status: 'absent', checked_in_at: null },
        { name: `${former.firstName} ${former.lastName}`, email: former.email, student_code: former.studentCode, status: 'present', checked_in_at: '2020-01-02T19:04:00.000Z' },
        { source: 'manual', reason: `Correction for ${former.email}` }],
    );

    const preview = await getStudentAnonymizationPreview(fixture.public_id, { client, now: new Date('2026-09-12T12:00:00Z') });
    assert.equal(preview.participant.eligible, true);
    assert.deepEqual(preview.counts, { memberships: 1, attendanceRecords: 1, auditRows: 1 });
    const result = await anonymizeStudent(fixture.public_id, {
      transactionPool: pool,
      now: new Date('2026-09-12T12:00:00Z'),
    });
    assert.deepEqual(result.counts, preview.counts);

    const anonymized = await client.query(
      `SELECT first_name, last_name, email, student_code, qr_token, active, anonymized_at
       FROM students WHERE id = $1`,
      [fixture.id],
    );
    const row = anonymized.rows[0];
    assert.equal(row.first_name, 'Participant');
    assert.equal(row.last_name, 'anonymisé');
    assert.match(row.email, /^anonymized-[0-9a-f-]{36}@attendance-log\.invalid$/);
    assert.match(row.student_code, /^[A-HJ-NP-Z2-9]{7}$/);
    assert.notEqual(row.student_code, former.studentCode);
    assert.notEqual(row.qr_token, fixture.qr_token);
    assert.equal(row.active, false);
    assert.equal(row.anonymized_at.toISOString(), '2026-09-12T12:00:00.000Z');
    await assert.rejects(
      client.query('UPDATE students SET active = TRUE WHERE id = $1', [fixture.id]),
      (error) => error.code === '23514' && error.constraint === 'students_anonymized_inactive',
    );

    const ordinaryWorkflowVisibility = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM students WHERE id = $1 AND active = TRUE) AS active_directory,
         EXISTS (SELECT 1 FROM students WHERE id = $1 AND anonymized_at IS NULL) AS qr_or_edit,
         EXISTS (SELECT 1 FROM students WHERE id = $1 AND active = TRUE AND anonymized_at IS NULL) AS picker`,
      [fixture.id],
    );
    assert.deepEqual(ordinaryWorkflowVisibility.rows[0], {
      active_directory: false, qr_or_edit: false, picker: false,
    });
    const membershipReactivation = await client.query(
      `UPDATE student_classes sc
       SET active = TRUE
       FROM students s
       WHERE sc.student_id = s.id AND s.id = $1
         AND s.active = TRUE AND s.anonymized_at IS NULL
       RETURNING sc.student_id`,
      [fixture.id],
    );
    assert.equal(membershipReactivation.rowCount, 0);

    const retained = await client.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM student_classes WHERE student_id = $1) AS memberships,
         (SELECT COUNT(*)::integer FROM attendance_records WHERE student_id = $1) AS attendance`,
      [fixture.id],
    );
    assert.deepEqual(retained.rows[0], { memberships: 1, attendance: 1 });

    const audit = await client.query(
      `SELECT actor_name, action, category, target_label, result, summary,
              before_data, after_data, metadata
       FROM admin_audit_log
       WHERE target_type = 'student' AND target_public_id = $1
       ORDER BY id`,
      [fixture.public_id],
    );
    assert.equal(audit.rowCount, 2);
    assert.equal(audit.rows[0].actor_name, 'Synthetic administrator');
    assert.equal(audit.rows[0].action, 'attendance.manual.update');
    assert.equal(audit.rows[0].target_label, ANONYMIZED_TARGET_LABEL);
    assert.deepEqual(audit.rows[0].before_data, { status: 'absent', checked_in_at: null });
    assert.deepEqual(audit.rows[0].after_data, { status: 'present', checked_in_at: '2020-01-02T19:04:00.000Z' });
    assert.deepEqual(audit.rows[0].metadata, { source: 'manual', reason: 'Correction for [donnée anonymisée]' });
    assert.equal(audit.rows[1].action, 'privacy.student.anonymize');
    assert.equal(audit.rows[1].target_label, ANONYMIZED_TARGET_LABEL);
    assert.deepEqual(audit.rows[1].metadata.counts, {
      audit_rows_redacted: 1, memberships_retained: 1, attendance_records_retained: 1,
    });

    const oldQr = await client.query('SELECT 1 FROM students WHERE qr_token = $1 AND anonymized_at IS NULL', [fixture.qr_token]);
    assert.equal(oldQr.rowCount, 0);
    const historicalReport = await getStudentReport(fixture.public_id);
    assert.equal(historicalReport.student.first_name, 'Participant');
    assert.equal(historicalReport.student.last_name, 'anonymisé');
    assert.equal(historicalReport.student.email, null);
    assert.equal(historicalReport.student.student_code, '—');
    assert.equal(historicalReport.details.length, 1);
    assert.equal(historicalReport.details[0].email, null);
    assert.equal(historicalReport.details[0].student_code, '—');
    const exportData = await loadParticipantDataExport(fixture.public_id, client);
    const exportText = JSON.stringify(exportData);
    const formerValues = [...Object.values(former), String(fixture.qr_token)];
    for (const value of formerValues) assert.equal(exportText.toLocaleLowerCase().includes(value.toLocaleLowerCase()), false);
    assert.equal(exportText.includes(row.email), false);
    assert.equal(exportText.includes(row.student_code), false);
    assert.equal(exportData.identity.firstName, 'Supprimé lors de l’anonymisation');
    assert.equal(exportData.identity.lastName, 'Supprimé lors de l’anonymisation');
    assert.equal(exportData.identity.email, 'Supprimé lors de l’anonymisation');
    assert.equal(exportData.identity.participantCode, 'Remplacé lors de l’anonymisation');
    assert.equal(exportData.identity.anonymizedAt.toISOString(), '2026-09-12T12:00:00.000Z');
    const workbook = buildParticipantDataWorkbook(exportData);
    const workbookText = workbook.worksheets
      .flatMap((sheet) => sheet.getSheetValues())
      .flat(Infinity)
      .filter((value) => value !== null && value !== undefined)
      .join(' ');
    for (const value of formerValues) assert.equal(workbookText.toLocaleLowerCase().includes(value.toLocaleLowerCase()), false);
    assert.match(workbookText, /Participant anonymisé/);
    assert.deepEqual(await findValuesAcrossPublicTables(client, formerValues), []);
  } finally {
    client.release();
  }
});

test('two independent connections serialize concurrent anonymization of the same participant', async () => {
  const setupClient = await pool.connect();
  const observer = await pool.connect();
  let firstOutcomePromise;
  let secondOutcomePromise;
  const releaseFirst = deferred();
  try {
    await setupClient.query('UPDATE data_retention_configuration SET inactive_student_retention_months = 12 WHERE id = 1');
    const fixture = await createAnonymizationFixture(setupClient, 'concurrent');
    const session = await setupClient.query(
      `INSERT INTO course_sessions (class_id, date, title, instructor, state, started_at, closed_at)
       VALUES ($1, DATE '2020-01-02', 'Concurrent history', 'Test', 'closed', NOW(), NOW())
       RETURNING id`,
      [fixture.classId],
    );
    await setupClient.query(
      `INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
       VALUES ($1, $2, 'present', '2020-01-02T19:00:00Z')`,
      [session.rows[0].id, fixture.id],
    );
    await setupClient.query(
      `INSERT INTO admin_audit_log
         (action, category, target_type, target_public_id, target_label, result, summary, before_data)
       VALUES ('student.update', 'student', 'student', $1, 'Concurrent Person', 'success',
               'Concurrent participant updated.', '{"active":true,"name":"Concurrent Person"}')`,
      [fixture.public_id],
    );

    const firstClient = await pool.connect();
    const secondClient = await pool.connect();
    assert.notEqual(firstClient.processID, secondClient.processID);
    const firstReachedAudit = deferred();
    const wrapOutcome = (promise) => promise.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', error }),
    );
    firstOutcomePromise = wrapOutcome(anonymizeStudent(fixture.public_id, {
      transactionPool: { connect: async () => firstClient },
      now: new Date('2026-09-12T12:00:00Z'),
      auditRecorder: async (event) => {
        await recordAuditEvent(event);
        firstReachedAudit.resolve();
        await releaseFirst.promise;
      },
    }));
    await Promise.race([
      firstReachedAudit.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('First anonymization did not reach the transaction barrier')), 2000)),
    ]);

    secondOutcomePromise = wrapOutcome(anonymizeStudent(fixture.public_id, {
      transactionPool: { connect: async () => secondClient },
      now: new Date('2026-09-12T12:00:01Z'),
    }));
    await waitForProcessLock(observer, secondClient.processID);
    releaseFirst.resolve();
    const outcomes = await Promise.all([firstOutcomePromise, secondOutcomePromise]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    assert.ok(rejected?.error instanceof StudentAnonymizationError);
    assert.equal(rejected.error.code, 'STUDENT_ALREADY_ANONYMIZED');

    const finalState = await setupClient.query(
      `SELECT s.first_name, s.last_name, s.active, s.anonymized_at,
              (SELECT COUNT(*)::integer FROM student_classes WHERE student_id = s.id) AS memberships,
              (SELECT COUNT(*)::integer FROM attendance_records WHERE student_id = s.id) AS attendance,
              (SELECT COUNT(*)::integer FROM admin_audit_log
               WHERE target_public_id = s.public_id AND action = 'privacy.student.anonymize'
                 AND result = 'success') AS anonymization_events
       FROM students s WHERE s.id = $1`,
      [fixture.id],
    );
    assert.equal(finalState.rows[0].first_name, 'Participant');
    assert.equal(finalState.rows[0].last_name, 'anonymisé');
    assert.equal(finalState.rows[0].active, false);
    assert.ok(finalState.rows[0].anonymized_at);
    assert.equal(finalState.rows[0].memberships, 1);
    assert.equal(finalState.rows[0].attendance, 1);
    assert.equal(finalState.rows[0].anonymization_events, 1);
    const redacted = await setupClient.query(
      `SELECT target_label, before_data FROM admin_audit_log
       WHERE target_public_id = $1 AND action = 'student.update'`,
      [fixture.public_id],
    );
    assert.deepEqual(redacted.rows, [{ target_label: ANONYMIZED_TARGET_LABEL, before_data: { active: true } }]);
  } finally {
    releaseFirst.resolve();
    await Promise.allSettled([firstOutcomePromise, secondOutcomePromise].filter(Boolean));
    observer.release();
    setupClient.release();
  }
});

test('anonymized participant survives a real custom-format backup and isolated restore', async () => {
  const sourceClient = await pool.connect();
  const restoreDatabaseName = process.env.TEST_RESTORE_DATABASE_NAME;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-log-anonymized-restore-'));
  const dumpPath = path.join(temporaryDirectory, 'database.dump');
  let administrationClient;
  let restoreClient;
  const former = {
    firstName: 'RestoreErasureFirst8',
    lastName: 'RestoreErasureLast8',
    email: 'restore-erasure-8@example.invalid',
    studentCode: 'YYYYYYY',
  };
  try {
    await sourceClient.query('UPDATE data_retention_configuration SET inactive_student_retention_months = 12 WHERE id = 1');
    const fixture = await createAnonymizationFixture(sourceClient, 'restore', former);
    const session = await sourceClient.query(
      `INSERT INTO course_sessions
         (class_id, date, title, instructor, state, started_at, closed_at, start_time)
       VALUES ($1, DATE '2020-01-02', 'Restore history', 'Test', 'closed', NOW(), NOW(), '20:00')
       RETURNING id`,
      [fixture.classId],
    );
    await sourceClient.query(
      `INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
       VALUES ($1, $2, 'present', '2020-01-02T19:04:00Z')`,
      [session.rows[0].id, fixture.id],
    );
    await sourceClient.query(
      `INSERT INTO admin_audit_log
         (actor_name, actor_role, action, category, target_type, target_public_id,
          target_label, result, summary, before_data, after_data, metadata)
       VALUES ('Synthetic administrator', 'administrator', 'student.update', 'student',
               'student', $1, $2, 'success', $3, $4, $5, $6)`,
      [fixture.public_id,
        `${former.firstName} ${former.lastName}`,
        `Updated ${former.firstName} ${former.lastName} ${former.email} ${former.studentCode}`,
        { first_name: former.firstName, last_name: former.lastName, email: former.email, student_code: former.studentCode, active: true },
        { first_name: former.firstName, last_name: former.lastName, email: former.email, student_code: former.studentCode, active: false },
        { changed_fields: ['first_name', 'last_name', 'email', 'student_code', 'active'] }],
    );
    await anonymizeStudent(fixture.public_id, {
      transactionPool: pool,
      now: new Date('2026-09-12T12:00:00Z'),
    });

    runPostgresCommand('pg_dump', [
      '--format=custom', '--no-owner', '--no-privileges',
      '--exclude-table-data=public.user_sessions',
      '--exclude-table-data=public.admin_otp_challenges',
      '--exclude-table-data=public.admin_break_glass_attempts',
      `--file=${dumpPath}`,
    ], postgresEnvironment(process.env.TEST_DATABASE_NAME));

    administrationClient = new Client({ connectionString: databaseUrlFor('postgres') });
    await administrationClient.connect();
    await administrationClient.query(`DROP DATABASE IF EXISTS "${restoreDatabaseName}" WITH (FORCE)`);
    await administrationClient.query(`CREATE DATABASE "${restoreDatabaseName}"`);
    runPostgresCommand('pg_restore', [
      '--exit-on-error', '--no-owner', '--no-privileges',
      `--dbname=${restoreDatabaseName}`,
      dumpPath,
    ], postgresEnvironment(restoreDatabaseName));
    runPostgresCommand(process.execPath, ['src/db/migrate.js'], {
      ...process.env,
      APP_TIMEZONE: 'Europe/Brussels',
      DATABASE_URL: databaseUrlFor(restoreDatabaseName),
    });

    restoreClient = new Client({ connectionString: databaseUrlFor(restoreDatabaseName) });
    await restoreClient.connect();
    const restored = await restoreClient.query(
      `SELECT id, public_id, first_name, last_name, email, student_code, qr_token,
              active, anonymized_at
       FROM students WHERE public_id = $1`,
      [fixture.public_id],
    );
    assert.equal(restored.rowCount, 1);
    const restoredStudent = restored.rows[0];
    assert.equal(restoredStudent.first_name, 'Participant');
    assert.equal(restoredStudent.last_name, 'anonymisé');
    assert.equal(restoredStudent.active, false);
    assert.equal(restoredStudent.anonymized_at.toISOString(), '2026-09-12T12:00:00.000Z');
    assert.notEqual(restoredStudent.email, former.email);
    assert.notEqual(restoredStudent.student_code, former.studentCode);
    assert.notEqual(restoredStudent.qr_token, fixture.qr_token);

    const restoredHistory = await restoreClient.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM student_classes WHERE student_id = $1) AS memberships,
         (SELECT COUNT(*)::integer FROM attendance_records WHERE student_id = $1) AS attendance,
         (SELECT COUNT(*)::integer FROM admin_audit_log
          WHERE target_public_id = $2 AND action = 'privacy.student.anonymize'
            AND result = 'success') AS anonymization_events`,
      [restoredStudent.id, fixture.public_id],
    );
    assert.deepEqual(restoredHistory.rows[0], {
      memberships: 1,
      attendance: 1,
      anonymization_events: 1,
    });
    const oldQr = await restoreClient.query(
      'SELECT 1 FROM students WHERE qr_token = $1 AND anonymized_at IS NULL',
      [fixture.qr_token],
    );
    assert.equal(oldQr.rowCount, 0);
    const operationalVisibility = await restoreClient.query(
      `SELECT EXISTS (
         SELECT 1 FROM students
         WHERE id = $1 AND active = TRUE AND anonymized_at IS NULL
       ) AS visible`,
      [restoredStudent.id],
    );
    assert.equal(operationalVisibility.rows[0].visible, false);

    const restoredAudit = await restoreClient.query(
      `SELECT target_label, summary, before_data, after_data, metadata
       FROM admin_audit_log
       WHERE target_public_id = $1 AND action = 'student.update'`,
      [fixture.public_id],
    );
    assert.equal(restoredAudit.rowCount, 1);
    assert.equal(restoredAudit.rows[0].target_label, ANONYMIZED_TARGET_LABEL);
    assert.deepEqual(restoredAudit.rows[0].before_data, { active: true });
    assert.deepEqual(restoredAudit.rows[0].after_data, { active: false });
    assert.deepEqual(restoredAudit.rows[0].metadata, {
      changed_fields: ['email', 'active'],
    });

    const restoredExport = await loadParticipantDataExport(fixture.public_id, restoreClient);
    assert.equal(restoredExport.identity.email, 'Supprimé lors de l’anonymisation');
    assert.equal(restoredExport.identity.participantCode, 'Remplacé lors de l’anonymisation');
    const formerValues = [...Object.values(former), String(fixture.qr_token)];
    assert.deepEqual(await findValuesAcrossPublicTables(restoreClient, formerValues), []);
    const migrations = await restoreClient.query(
      "SELECT COUNT(*)::integer AS count FROM schema_migrations WHERE name = '024_student_anonymization.sql'",
    );
    assert.equal(migrations.rows[0].count, 1);
  } finally {
    if (restoreClient) await restoreClient.end();
    if (administrationClient) {
      await administrationClient.query(`DROP DATABASE IF EXISTS "${restoreDatabaseName}" WITH (FORCE)`);
      await administrationClient.end();
    }
    sourceClient.release();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('forced audit failure rolls back identity, QR, and historical audit redaction', async () => {
  const client = await pool.connect();
  try {
    await client.query('UPDATE data_retention_configuration SET inactive_student_retention_months = 12 WHERE id = 1');
    const fixture = await createAnonymizationFixture(client, 'rollback');
    await client.query(
      `INSERT INTO admin_audit_log
         (action, category, target_type, target_public_id, target_label, result, summary, before_data)
       VALUES ('student.update', 'student', 'student', $1, 'Rollback Person', 'success',
               'Rollback identity retained on failure.', '{"name":"Rollback Person"}')`,
      [fixture.public_id],
    );
    const beforeStudent = await client.query('SELECT * FROM students WHERE id = $1', [fixture.id]);
    const beforeAudit = await client.query('SELECT target_label, summary, before_data FROM admin_audit_log WHERE target_public_id = $1 ORDER BY id', [fixture.public_id]);

    await assert.rejects(
      anonymizeStudent(fixture.public_id, {
        transactionPool: pool,
        now: new Date('2026-09-12T12:00:00Z'),
        auditRecorder: async () => { throw Object.assign(new Error('forced'), { code: 'AUDIT_FORCED_FAILURE' }); },
      }),
      (error) => error.code === 'AUDIT_FORCED_FAILURE',
    );
    const afterStudent = await client.query('SELECT * FROM students WHERE id = $1', [fixture.id]);
    const afterAudit = await client.query('SELECT target_label, summary, before_data FROM admin_audit_log WHERE target_public_id = $1 ORDER BY id', [fixture.public_id]);
    assert.deepEqual(afterStudent.rows, beforeStudent.rows);
    assert.deepEqual(afterAudit.rows, beforeAudit.rows);
  } finally {
    client.release();
  }
});

test('transaction-time eligibility rejects active, active-membership, recent, disabled, stale-preview, and anonymized states', async () => {
  const client = await pool.connect();
  try {
    await expectAnonymizationError('00000000-0000-4000-8000-000000000099', 'STUDENT_NOT_FOUND');
    await client.query('UPDATE data_retention_configuration SET inactive_student_retention_months = 12 WHERE id = 1');
    const active = await createAnonymizationFixture(client, 'active', { active: true, membership: false });
    await expectAnonymizationError(active.public_id, 'STUDENT_NOT_ELIGIBLE');
    const membership = await createAnonymizationFixture(client, 'membership', { membershipActive: true });
    await expectAnonymizationError(membership.public_id, 'STUDENT_NOT_ELIGIBLE');
    const recent = await createAnonymizationFixture(client, 'recent', { membership: false, lastActivityAt: '2026-09-01T00:00:00Z' });
    await expectAnonymizationError(recent.public_id, 'STUDENT_NOT_ELIGIBLE');

    const disabled = await createAnonymizationFixture(client, 'disabled', { membership: false });
    await client.query('UPDATE data_retention_configuration SET inactive_student_retention_months = NULL WHERE id = 1');
    await expectAnonymizationError(disabled.public_id, 'STUDENT_NOT_ELIGIBLE');

    await client.query('UPDATE data_retention_configuration SET inactive_student_retention_months = 12 WHERE id = 1');
    const stale = await createAnonymizationFixture(client, 'stale', { membership: false });
    const preview = await getStudentAnonymizationPreview(stale.public_id, { client, now: new Date('2026-09-12T12:00:00Z') });
    assert.equal(preview.participant.eligible, true);
    await client.query('UPDATE students SET active = TRUE WHERE id = $1', [stale.id]);
    await expectAnonymizationError(stale.public_id, 'STUDENT_NOT_ELIGIBLE');
    const unchanged = await client.query('SELECT anonymized_at FROM students WHERE id = $1', [stale.id]);
    assert.equal(unchanged.rows[0].anonymized_at, null);

    const once = await createAnonymizationFixture(client, 'once', { membership: false });
    await anonymizeStudent(once.public_id, { transactionPool: pool, now: new Date('2026-09-12T12:00:00Z') });
    await expectAnonymizationError(once.public_id, 'STUDENT_ALREADY_ANONYMIZED');
  } finally {
    client.release();
  }
});
