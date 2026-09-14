const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const signature = require('cookie-signature');
const { Client } = require('pg');

assert.match(process.env.TEST_DATABASE_NAME || '', /^attendance_log_test_[a-z0-9_]+$/);
assert.match(process.env.TEST_RESTORE_DATABASE_NAME || '', /^attendance_log_test_[a-z0-9_]+$/);
assert.match(process.env.TEST_UPGRADE_DATABASE_NAME || '', /^attendance_log_test_[a-z0-9_]+$/);
assert.match(process.env.DATABASE_URL || '', new RegExp(`/${process.env.TEST_DATABASE_NAME}$`));

const { recordAuditEvent } = require('../src/audit');
const { app } = require('../src/server');
const { pool } = require('../src/db/client');
const { calculatePunctuality } = require('../src/punctuality');
const {
  resolveClassLanguage,
  resolveParticipantLanguage,
  resolveSessionLanguage,
} = require('../src/i18n');
const { getSessionSummaries, getStudentReport } = require('../src/reporting-data');
const { getParticipantRetentionDetail } = require('../src/data-retention');
const { resetOperationalData } = require('../src/operational-reset');
const { resetTerminology } = require('../src/terminology');
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

async function applyHistoricalMigrations(client, throughName) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const migrationDirectory = path.join(__dirname, '..', 'src', 'db', 'migrations');
  const files = fs.readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.sql') && name <= throughName)
    .sort();
  for (const file of files) {
    await client.query('BEGIN');
    try {
      await client.query(fs.readFileSync(path.join(migrationDirectory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

test('fresh install seeds complete independent English and French terminology', async () => {
  const result = await pool.query(
    `SELECT language, student_singular, student_plural, class_singular, class_plural,
            session_singular, session_plural, attendance_singular, attendance_plural,
            instructor_singular, instructor_plural, membership_singular, membership_plural
     FROM application_terminology ORDER BY language`,
  );
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.rows.map((row) => row.language), ['en', 'fr']);
  assert.equal(result.rows[0].student_singular, 'Student');
  assert.equal(result.rows[0].class_plural, 'Classes');
  assert.equal(result.rows[1].student_singular, 'Participant');
  assert.equal(result.rows[1].class_plural, 'Activités');
  for (const row of result.rows) {
    for (const [field, value] of Object.entries(row)) {
      if (field !== 'language') assert.ok(value, `${row.language}.${field}`);
    }
  }
  await assert.rejects(
    pool.query(
      `INSERT INTO application_terminology
         (language, student_singular, student_plural, class_singular, class_plural,
          session_singular, session_plural, attendance_singular, attendance_plural,
          instructor_singular, instructor_plural, membership_singular, membership_plural)
       VALUES ('de', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X')`,
    ),
    (error) => error.code === '23514',
  );
});

test('international settings persist and real rows resolve explicit language inheritance', async () => {
  const client = await pool.connect();
  try {
    const initial = await client.query(
      'SELECT default_language, locale, timezone FROM international_settings WHERE id = 1',
    );
    assert.deepEqual(initial.rows[0], {
      default_language: 'en',
      locale: 'fr-BE',
      timezone: 'Europe/Brussels',
    });
    await client.query(
      `UPDATE international_settings
       SET default_language = 'en', locale = 'en-US', timezone = 'America/New_York'
       WHERE id = 1`,
    );
    const course = await client.query(
      "INSERT INTO classes (name, language) VALUES ('I18N integration', 'fr') RETURNING id, language",
    );
    const session = await client.query(
      `INSERT INTO course_sessions (class_id, date, title, instructor, language)
       VALUES ($1, DATE '2026-09-11', 'Language inheritance', 'Test', NULL)
       RETURNING id, language`,
      [course.rows[0].id],
    );
    const student = await client.query(
      `INSERT INTO students (email, first_name, last_name, student_code, language)
       VALUES ('i18n-persistence@example.invalid', 'I18N', 'Student', $1, 'en')
       RETURNING id, language`,
      [nextStudentCode()],
    );
    const user = await client.query(
      `INSERT INTO admin_users (name, email, password_hash, role, active, account_type, ui_language)
       VALUES ('I18N user', 'i18n-user@example.invalid', NULL, 'manager', TRUE, 'otp', 'fr')
       RETURNING id, ui_language`,
    );
    assert.equal(user.rows[0].ui_language, 'fr');
    assert.equal(resolveClassLanguage({ classLanguage: course.rows[0].language, defaultLanguage: 'en' }), 'fr');
    assert.equal(resolveSessionLanguage({ sessionLanguage: session.rows[0].language, classLanguage: course.rows[0].language, defaultLanguage: 'en' }), 'fr');
    assert.equal(resolveParticipantLanguage({ participantLanguage: student.rows[0].language, sessionLanguage: session.rows[0].language, classLanguage: course.rows[0].language, defaultLanguage: 'en' }), 'en');
    await assert.rejects(
      client.query("UPDATE international_settings SET default_language = 'de' WHERE id = 1"),
      (error) => error.code === '23514',
    );
    await assert.rejects(client.query("UPDATE classes SET language = 'de' WHERE id = $1", [course.rows[0].id]), (error) => error.code === '23514');
    await assert.rejects(client.query("UPDATE course_sessions SET language = 'de' WHERE id = $1", [session.rows[0].id]), (error) => error.code === '23514');
    await assert.rejects(client.query("UPDATE students SET language = 'de' WHERE id = $1", [student.rows[0].id]), (error) => error.code === '23514');
    await assert.rejects(client.query("UPDATE admin_users SET ui_language = 'de' WHERE id = $1", [user.rows[0].id]), (error) => error.code === '23514');
    const preserved = await client.query(
      'SELECT default_language, locale, timezone FROM international_settings WHERE id = 1',
    );
    assert.deepEqual(preserved.rows[0], {
      default_language: 'en', locale: 'en-US', timezone: 'America/New_York',
    });
    await client.query(
      `UPDATE international_settings
       SET default_language = 'en', locale = 'fr-BE', timezone = 'Europe/Brussels'
       WHERE id = 1`,
    );
  } finally {
    await client.query("DELETE FROM admin_users WHERE email = 'i18n-user@example.invalid'").catch(() => {});
    await client.query("DELETE FROM students WHERE email = 'i18n-persistence@example.invalid'").catch(() => {});
    await client.query("DELETE FROM classes WHERE name = 'I18N integration'").catch(() => {});
    await client.query(
      `UPDATE international_settings
       SET default_language = 'en', locale = 'fr-BE', timezone = 'Europe/Brussels'
       WHERE id = 1`,
    ).catch(() => {});
    client.release();
  }
});

test('authenticated Dashboard renders empty and populated states in EN and FR', async (context) => {
  const client = await pool.connect();
  const sid = `dashboard-${randomUUID()}`;
  let userId;
  let classId;
  let studentId;
  let server;
  try {
    const existingOpenSessions = await client.query("SELECT COUNT(*)::integer AS count FROM course_sessions WHERE state = 'open'");
    assert.equal(existingOpenSessions.rows[0].count, 0, 'dashboard fixture starts without unrelated open sessions');
    await client.query("UPDATE international_settings SET locale = 'en-GB', timezone = 'Europe/Brussels' WHERE id = 1");
    await client.query("UPDATE application_terminology SET student_plural = 'Learners', class_plural = 'Courses', session_plural = 'Meetings' WHERE language = 'en'");
    await client.query("UPDATE application_terminology SET student_plural = 'Navigateurs', class_plural = 'Formations', session_plural = 'Ateliers' WHERE language = 'fr'");
    const user = await client.query(
      `INSERT INTO admin_users (name, email, password_hash, role, active, account_type, ui_language)
       VALUES ('Dashboard test administrator', 'dashboard-test@example.invalid', NULL, 'administrator', TRUE, 'otp', 'en')
       RETURNING id, session_version`,
    );
    userId = user.rows[0].id;
    await client.query(
      `INSERT INTO user_sessions (sid, sess, expire)
       VALUES ($1, $2::json, $3)`,
      [sid, JSON.stringify({
        cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000).toISOString(), httpOnly: true, path: '/', sameSite: 'lax' },
        adminUserId: String(userId), role: 'administrator',
        sessionVersion: String(user.rows[0].session_version), authenticatedAt: Date.now(),
      }), new Date(Date.now() + 3600000)],
    );
    const course = await client.query("INSERT INTO classes (name) VALUES ('Cours de navigation') RETURNING id");
    classId = course.rows[0].id;
    await client.query(
      `INSERT INTO course_sessions (class_id, date, title, instructor, state, started_at, closed_at)
       VALUES ($1, DATE '2026-09-10', 'Closed business session', 'Morgan', 'closed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [classId],
    );

    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    const port = server.address().port;
    const cookie = `attendance_log_session=${encodeURIComponent(`s:${signature.sign(sid, process.env.SESSION_SECRET)}`)}`;
    const authenticatedGet = async (path, acceptLanguage) => fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Accept: 'text/html', 'Accept-Language': acceptLanguage, Cookie: cookie, Connection: 'close' },
      redirect: 'manual',
    });
    const terminologyBody = new URLSearchParams({
      en_student_singular: 'Learner', en_student_plural: 'Learners',
      en_class_singular: 'Course', en_class_plural: 'Courses',
      en_session_singular: 'Meeting', en_session_plural: 'Meetings',
      en_attendance_singular: 'Attendance', en_attendance_plural: 'Attendance',
      en_instructor_singular: 'Instructor', en_instructor_plural: 'Instructors',
      en_membership_singular: 'Registration', en_membership_plural: 'Registrations',
      fr_student_singular: 'Navigateur', fr_student_plural: 'Navigateurs',
      fr_class_singular: 'Formation', fr_class_plural: 'Formations',
      fr_session_singular: 'Atelier', fr_session_plural: 'Ateliers',
      fr_attendance_singular: 'Pointage', fr_attendance_plural: 'Pointages',
      fr_instructor_singular: 'Moniteur', fr_instructor_plural: 'Moniteurs',
      fr_membership_singular: 'Affectation', fr_membership_plural: 'Affectations',
    });
    const savedTerminology = await fetch(`http://127.0.0.1:${port}/settings/terminology`, {
      method: 'POST',
      headers: {
        Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie, Connection: 'close',
      },
      body: terminologyBody,
      redirect: 'manual',
    });
    assert.equal(savedTerminology.status, 303);
    assert.equal(savedTerminology.headers.get('location'), '/settings/terminology?notice=saved');
    const storedTerminology = await client.query(
      'SELECT language, student_singular, class_singular FROM application_terminology ORDER BY language',
    );
    assert.deepEqual(storedTerminology.rows, [
      { language: 'en', student_singular: 'Learner', class_singular: 'Course' },
      { language: 'fr', student_singular: 'Navigateur', class_singular: 'Formation' },
    ]);
    const terminologyAudits = await client.query(
      "SELECT before_data->>'language' AS language FROM admin_audit_log WHERE action = 'terminology.update' ORDER BY language",
    );
    assert.deepEqual(terminologyAudits.rows, [{ language: 'en' }, { language: 'fr' }]);
    const dashboard = (acceptLanguage) => authenticatedGet('/', acceptLanguage);

    const emptyEnglishResponse = await dashboard('fr-BE,fr;q=0.9');
    const emptyEnglish = await emptyEnglishResponse.text();
    assert.equal(emptyEnglishResponse.status, 200);
    assert.match(emptyEnglish, /<html lang="en">/);
    assert.match(emptyEnglish, /<h1>Home<\/h1>/);
    assert.match(emptyEnglish, />Learners<\/a>/);
    assert.match(emptyEnglish, />Courses<\/a>/);
    assert.match(emptyEnglish, />Meetings<\/a>/);
    assert.doesNotMatch(emptyEnglish, />Navigateurs<\/a>|>Formations<\/a>|>Ateliers<\/a>/);
    assert.match(emptyEnglish, /Nothing is open right now/);
    assert.doesNotMatch(emptyEnglish, /<h1>Dashboard unavailable<\/h1>|Closed business session/);

    const student = await client.query(
      `INSERT INTO students (email, first_name, last_name, student_code, active)
       VALUES ('dashboard-student@example.invalid', 'Paul', 'BALDEWYNS', 'DASHB23', TRUE)
       RETURNING id`,
    );
    studentId = student.rows[0].id;
    await client.query('INSERT INTO student_classes (student_id, class_id, active) VALUES ($1, $2, TRUE)', [studentId, classId]);
    const openSession = await client.query(
      `INSERT INTO course_sessions (class_id, date, title, instructor, state, started_at)
       VALUES ($1, DATE '2026-09-11', 'Cours de navigation 2026', 'Morgan', 'open', CURRENT_TIMESTAMP)
       RETURNING id, public_id`,
      [classId],
    );
    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
       VALUES ($1, $2, 'present', TIMESTAMPTZ '2026-09-11 18:55:00+00')`,
      [openSession.rows[0].id, studentId],
    );

    const populatedEnglishResponse = await dashboard('fr-BE,fr;q=0.9');
    const populatedEnglish = await populatedEnglishResponse.text();
    assert.equal(populatedEnglishResponse.status, 200);
    assert.match(populatedEnglish, /<html lang="en">/);
    assert.match(populatedEnglish, /Cours de navigation 2026/);
    assert.match(populatedEnglish, /11 September 2026/);
    assert.match(populatedEnglish, /1 \/ 1 present/);
    assert.match(populatedEnglish, /Status: open/);
    assert.doesNotMatch(populatedEnglish, /<h1>(?:Tableau de bord|Accueil)<\/h1>|Accès rapides|État : ouvert|Closed business session/);
    for (const path of ['/students', '/classes', '/sessions', `/sessions/${openSession.rows[0].public_id}`, '/reporting', '/settings/terminology']) {
      const routeResponse = await authenticatedGet(path, 'fr-BE,fr;q=0.9');
      const routeHtml = await routeResponse.text();
      assert.equal(routeResponse.status, 200, `English smoke ${path}`);
      assert.match(routeHtml, /<html lang="en">/, path);
      assert.match(routeHtml, /data-term-class="Course"/, path);
      assert.doesNotMatch(routeHtml, /undefined|\[object Object\]/i, path);
      assert.match(routeHtml, />Learners<\/a>/, path);
      assert.match(routeHtml, />Courses<\/a>/, path);
      assert.match(routeHtml, />Meetings<\/a>/, path);
    }

    await client.query("UPDATE admin_users SET ui_language = 'fr' WHERE id = $1", [userId]);

    const populatedFrenchResponse = await dashboard('en-GB,en;q=0.9');
    const populatedFrench = await populatedFrenchResponse.text();
    assert.equal(populatedFrenchResponse.status, 200);
    assert.match(populatedFrench, /<html lang="fr">/);
    assert.match(populatedFrench, /<h1>Accueil<\/h1>/);
    assert.match(populatedFrench, />Navigateurs<\/a>/);
    assert.match(populatedFrench, />Formations<\/a>/);
    assert.match(populatedFrench, />Ateliers<\/a>/);
    assert.doesNotMatch(populatedFrench, />Learners<\/a>|>Courses<\/a>|>Meetings<\/a>/);
    assert.match(populatedFrench, /Cours de navigation 2026/);
    assert.match(populatedFrench, /11 September 2026/);
    assert.match(populatedFrench, /1 \/ 1 présents/);
    assert.match(populatedFrench, /État : ouvert/);
    assert.doesNotMatch(populatedFrench, /<h1>Tableau de bord indisponible<\/h1>|<h1>(?:Dashboard|Home)<\/h1>|Quick access|Status: open|Closed business session/);
    for (const path of ['/students', '/classes', '/sessions', `/sessions/${openSession.rows[0].public_id}`, '/reporting', '/settings/terminology']) {
      const routeResponse = await authenticatedGet(path, 'en-GB,en;q=0.9');
      const routeHtml = await routeResponse.text();
      assert.equal(routeResponse.status, 200, `French smoke ${path}`);
      assert.match(routeHtml, /<html lang="fr">/, path);
      assert.match(routeHtml, /data-term-class="Formation"/, path);
      assert.doesNotMatch(routeHtml, /undefined|\[object Object\]/i, path);
      assert.match(routeHtml, />Navigateurs<\/a>/, path);
      assert.match(routeHtml, />Formations<\/a>/, path);
      assert.match(routeHtml, />Ateliers<\/a>/, path);
    }

    await context.test('session views filter lifecycle and paginate without changing report inclusion', async () => {
      await client.query(`INSERT INTO course_sessions (class_id, date, title, instructor)
        SELECT $1, DATE '2030-01-01' + n, 'Pagination ' || n, 'Synthetic trainer'
        FROM generate_series(1, 51) AS n`, [classId]);
      const open = await (await authenticatedGet('/sessions?state=open', 'fr')).text();
      assert.match(open, /Cours de navigation 2026/);
      assert.doesNotMatch(open, /Closed business session|Pagination 1/);
      const closed = await (await authenticatedGet('/sessions?state=closed', 'fr')).text();
      assert.match(closed, /Closed business session/);
      assert.doesNotMatch(closed, /Cours de navigation 2026|Pagination 1/);
      const first = await (await authenticatedGet('/sessions?q=Pagination&state=scheduled&sort=oldest', 'fr')).text();
      assert.equal((first.match(/<article class="list-group-item/g) || []).length, 50);
      assert.match(first, /Pagination 1<\/a>/);
      assert.doesNotMatch(first, /Pagination 51<\/a>/);
      const second = await (await authenticatedGet('/sessions?q=Pagination&state=scheduled&sort=oldest&page=2', 'fr')).text();
      assert.equal((second.match(/<article class="list-group-item/g) || []).length, 1);
      assert.match(second, /Pagination 51<\/a>/);
      const stale = await authenticatedGet('/sessions?q=Pagination&state=scheduled&page=999999', 'fr');
      assert.equal(stale.status, 303);
      assert.match(stale.headers.get('location'), /^\/sessions\?q=Pagination&state=scheduled&sort=oldest$/);
      const preview = await (await authenticatedGet('/reporting', 'fr')).text();
      assert.match(preview, /lang="en" data-report-preview/);
      assert.match(preview, /<dd>1<\/dd>/);
      assert.doesNotMatch(preview, /Pagination 1|Cours de navigation 2026/);
    });
    await context.test('report preview validates filters and preserves the exact export selection', async () => {
      const response = await authenticatedGet('/reporting?date_from=2099-01-01&date_to=2099-02-01', 'fr');
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /href="\/reporting\/export\?date_from=2099-01-01&amp;date_to=2099-02-01"/);
      assert.match(html, /<dd>0<\/dd>/);
      for (const query of ['date_from=2026-02-30', 'date_from=2026-09-02&date_to=2026-09-01', 'class_id=malformed']) {
        assert.equal((await authenticatedGet(`/reporting?${query}`, 'fr')).status, 400);
      }
      assert.equal((await authenticatedGet('/reporting?class_id=00000000-0000-4000-8000-000000000000', 'fr')).status, 404);
    });

    const resetTerminologyResponse = await fetch(`http://127.0.0.1:${port}/settings/terminology/reset`, {
      method: 'POST',
      headers: { Accept: 'text/html', Cookie: cookie, Connection: 'close' },
      redirect: 'manual',
    });
    assert.equal(resetTerminologyResponse.status, 303);
    assert.equal(resetTerminologyResponse.headers.get('location'), '/settings/terminology?notice=reset');
    const resetRows = await client.query(
      'SELECT language, student_singular, class_singular FROM application_terminology ORDER BY language',
    );
    assert.deepEqual(resetRows.rows, [
      { language: 'en', student_singular: 'Student', class_singular: 'Class' },
      { language: 'fr', student_singular: 'Participant', class_singular: 'Activité' },
    ]);
    const resetAudits = await client.query(
      "SELECT before_data->>'language' AS language FROM admin_audit_log WHERE action = 'terminology.reset' ORDER BY language",
    );
    assert.deepEqual(resetAudits.rows, [{ language: 'en' }, { language: 'fr' }]);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await client.query('DELETE FROM user_sessions WHERE sid = $1', [sid]);
    if (classId) {
      await client.query('DELETE FROM attendance_records WHERE session_id IN (SELECT id FROM course_sessions WHERE class_id = $1)', [classId]);
      await client.query('DELETE FROM course_sessions WHERE class_id = $1', [classId]);
      await client.query('DELETE FROM classes WHERE id = $1', [classId]);
    }
    if (studentId) await client.query('DELETE FROM students WHERE id = $1', [studentId]);
    if (userId) await client.query('DELETE FROM admin_users WHERE id = $1', [userId]);
    await client.query("UPDATE international_settings SET locale = 'fr-BE', timezone = 'Europe/Brussels' WHERE id = 1");
    await resetTerminology('en', client);
    await resetTerminology('fr', client);
    client.release();
  }
});

test('migration preserves French behavior and APP_TIMEZONE for an existing installation', async () => {
  const upgradeDatabaseName = process.env.TEST_UPGRADE_DATABASE_NAME;
  const administrationClient = new Client({ connectionString: databaseUrlFor('postgres') });
  let administrationConnected = false;
  let upgradeClient;
  try {
    await administrationClient.connect();
    administrationConnected = true;
    await administrationClient.query(`DROP DATABASE IF EXISTS "${upgradeDatabaseName}" WITH (FORCE)`);
    await administrationClient.query(`CREATE DATABASE "${upgradeDatabaseName}"`);
    upgradeClient = new Client({ connectionString: databaseUrlFor(upgradeDatabaseName) });
    await upgradeClient.connect();
    await applyHistoricalMigrations(upgradeClient, '024_student_anonymization.sql');
    const customizedFrench = {
      student_singular: 'Navigateur', student_plural: 'Navigateurs',
      class_singular: 'Formation', class_plural: 'Formations',
      session_singular: 'Atelier', session_plural: 'Ateliers',
      attendance_singular: 'Pointage', attendance_plural: 'Pointages',
      instructor_singular: 'Moniteur', instructor_plural: 'Moniteurs',
      membership_singular: 'Affectation', membership_plural: 'Affectations',
    };
    await upgradeClient.query(
      `UPDATE application_terminology SET
         student_singular = $1, student_plural = $2, class_singular = $3, class_plural = $4,
         session_singular = $5, session_plural = $6, attendance_singular = $7, attendance_plural = $8,
         instructor_singular = $9, instructor_plural = $10, membership_singular = $11, membership_plural = $12
       WHERE id = 1`,
      Object.values(customizedFrench),
    );
    await upgradeClient.end();
    upgradeClient = null;
    runPostgresCommand(process.execPath, ['src/db/migrate.js'], {
      ...process.env,
      APP_TIMEZONE: 'America/New_York',
      DATABASE_URL: databaseUrlFor(upgradeDatabaseName),
    });
    upgradeClient = new Client({ connectionString: databaseUrlFor(upgradeDatabaseName) });
    await upgradeClient.connect();
    const settings = await upgradeClient.query(
      'SELECT default_language, locale, timezone FROM international_settings WHERE id = 1',
    );
    assert.deepEqual(settings.rows[0], {
      default_language: 'fr', locale: 'fr-BE', timezone: 'America/New_York',
    });
    const columns = await upgradeClient.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('ui_language', 'language')
       ORDER BY table_name, column_name`,
    );
    assert.deepEqual(columns.rows.map((row) => `${row.table_name}.${row.column_name}`), [
      'admin_users.ui_language', 'application_terminology.language', 'classes.language',
      'course_sessions.language', 'students.language',
    ]);
    const terminology = await upgradeClient.query(
      `SELECT language, student_singular, student_plural, class_singular, class_plural,
              session_singular, session_plural, attendance_singular, attendance_plural,
              instructor_singular, instructor_plural, membership_singular, membership_plural
       FROM application_terminology ORDER BY language`,
    );
    assert.deepEqual(terminology.rows, [
      {
        language: 'en', student_singular: 'Student', student_plural: 'Students',
        class_singular: 'Class', class_plural: 'Classes', session_singular: 'Session',
        session_plural: 'Sessions', attendance_singular: 'Attendance', attendance_plural: 'Attendance',
        instructor_singular: 'Instructor', instructor_plural: 'Instructors',
        membership_singular: 'Registration', membership_plural: 'Registrations',
      },
      { language: 'fr', ...customizedFrench },
    ]);
    await upgradeClient.query("UPDATE application_terminology SET student_singular = 'Learner' WHERE language = 'en'");
    await upgradeClient.end();
    upgradeClient = null;
    runPostgresCommand(process.execPath, ['src/db/migrate.js'], {
      ...process.env,
      APP_TIMEZONE: 'America/New_York',
      DATABASE_URL: databaseUrlFor(upgradeDatabaseName),
    });
    upgradeClient = new Client({ connectionString: databaseUrlFor(upgradeDatabaseName) });
    await upgradeClient.connect();
    const repeated = await upgradeClient.query(
      "SELECT student_singular FROM application_terminology WHERE language = 'en'",
    );
    assert.equal(repeated.rows[0].student_singular, 'Learner');
  } finally {
    if (upgradeClient) await upgradeClient.end();
    if (administrationConnected) {
      await administrationClient.query(`DROP DATABASE IF EXISTS "${upgradeDatabaseName}" WITH (FORCE)`);
      await administrationClient.end();
    }
  }
});

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
    const workbook = buildParticipantDataWorkbook(exportData, { language: 'fr' });
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
      `SELECT first_name, last_name, email, student_code, qr_token, active, language, anonymized_at
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
    assert.equal(row.language, null);
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
    assert.equal(exportData.identity.firstName, null);
    assert.equal(exportData.identity.lastName, null);
    assert.equal(exportData.identity.email, null);
    assert.equal(exportData.identity.participantCode, null);
    assert.equal(exportData.identity.anonymizedAt.toISOString(), '2026-09-12T12:00:00.000Z');
    const workbook = buildParticipantDataWorkbook(exportData, { language: 'fr' });
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
    await sourceClient.query("UPDATE application_terminology SET student_singular = 'Learner archive' WHERE language = 'en'");
    await sourceClient.query("UPDATE application_terminology SET student_singular = 'Navigateur archive' WHERE language = 'fr'");
    const fixture = await createAnonymizationFixture(sourceClient, 'restore', former);
    const session = await sourceClient.query(
      `INSERT INTO course_sessions
         (class_id, date, title, instructor, state, started_at, closed_at, start_time, language)
       VALUES ($1, DATE '2020-01-02', 'Restore history', 'Test', 'closed', NOW(), NOW(), '20:00', 'en')
       RETURNING id`,
      [fixture.classId],
    );
    await sourceClient.query("UPDATE classes SET language = 'fr' WHERE id = $1", [fixture.classId]);
    await sourceClient.query(
      `INSERT INTO admin_users (name, email, password_hash, role, active, account_type, ui_language)
       VALUES ('Restore language user', 'restore-language@example.invalid', NULL, 'manager', TRUE, 'otp', 'fr')`,
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
    assert.equal(restoredExport.identity.email, null);
    assert.equal(restoredExport.identity.participantCode, null);
    const formerValues = [...Object.values(former), String(fixture.qr_token)];
    assert.deepEqual(await findValuesAcrossPublicTables(restoreClient, formerValues), []);
    const restoredInternationalSettings = await restoreClient.query(
      'SELECT default_language, locale, timezone FROM international_settings WHERE id = 1',
    );
    assert.deepEqual(restoredInternationalSettings.rows[0], {
      default_language: 'en', locale: 'fr-BE', timezone: 'Europe/Brussels',
    });
    const restoredTerminology = await restoreClient.query(
      'SELECT language, student_singular, class_singular FROM application_terminology ORDER BY language',
    );
    assert.deepEqual(restoredTerminology.rows, [
      { language: 'en', student_singular: 'Learner archive', class_singular: 'Class' },
      { language: 'fr', student_singular: 'Navigateur archive', class_singular: 'Activité' },
    ]);
    const restoredLanguageOverrides = await restoreClient.query(
      `SELECT
         (SELECT language FROM classes WHERE id = $1) AS class_language,
         (SELECT language FROM course_sessions WHERE id = $2) AS session_language,
         (SELECT ui_language FROM admin_users WHERE email = 'restore-language@example.invalid') AS ui_language`,
      [fixture.classId, session.rows[0].id],
    );
    assert.deepEqual(restoredLanguageOverrides.rows[0], {
      class_language: 'fr', session_language: 'en', ui_language: 'fr',
    });
    const migrations = await restoreClient.query(
      "SELECT COUNT(*)::integer AS count FROM schema_migrations WHERE name IN ('024_student_anonymization.sql', '025_internationalization_foundation.sql', '026_localized_application_terminology.sql')",
    );
    assert.equal(migrations.rows[0].count, 3);
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

test('operational reset removes language overrides with operational rows and preserves global/user settings', async () => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE international_settings
       SET default_language = 'fr', locale = 'fr-FR', timezone = 'Europe/Paris'
       WHERE id = 1`,
    );
    await client.query("UPDATE application_terminology SET student_plural = 'Crew' WHERE language = 'en'");
    const user = await client.query(
      `INSERT INTO admin_users (name, email, password_hash, role, active, account_type, ui_language)
       VALUES ('Reset language user', 'reset-language@example.invalid', NULL, 'manager', TRUE, 'otp', 'en')
       RETURNING id`,
    );
    const course = await client.query(
      "INSERT INTO classes (name, language) VALUES ('Reset language class', 'fr') RETURNING id",
    );
    const student = await client.query(
      `INSERT INTO students (email, first_name, last_name, student_code, language)
       VALUES ('reset-language-student@example.invalid', 'Reset', 'Student', $1, 'en')
       RETURNING id`,
      [nextStudentCode()],
    );
    await client.query(
      'INSERT INTO student_classes (student_id, class_id) VALUES ($1, $2)',
      [student.rows[0].id, course.rows[0].id],
    );
    await client.query(
      `INSERT INTO course_sessions (class_id, date, title, instructor, language)
       VALUES ($1, DATE '2026-09-12', 'Reset session', 'Test', 'en')`,
      [course.rows[0].id],
    );
    await resetOperationalData({ alreadyLocked: true });
    const counts = await client.query(`SELECT
      (SELECT COUNT(*)::integer FROM students) AS students,
      (SELECT COUNT(*)::integer FROM classes) AS classes,
      (SELECT COUNT(*)::integer FROM course_sessions) AS sessions`);
    assert.deepEqual(counts.rows[0], { students: 0, classes: 0, sessions: 0 });
    const settings = await client.query(
      'SELECT default_language, locale, timezone FROM international_settings WHERE id = 1',
    );
    assert.deepEqual(settings.rows[0], {
      default_language: 'fr', locale: 'fr-FR', timezone: 'Europe/Paris',
    });
    const preservedUser = await client.query(
      'SELECT ui_language FROM admin_users WHERE id = $1',
      [user.rows[0].id],
    );
    assert.equal(preservedUser.rows[0].ui_language, 'en');
    const preservedTerminology = await client.query(
      "SELECT student_plural FROM application_terminology WHERE language = 'en'",
    );
    assert.equal(preservedTerminology.rows[0].student_plural, 'Crew');
    await client.query('DELETE FROM admin_users WHERE id = $1', [user.rows[0].id]);
    await client.query(
      `UPDATE international_settings
       SET default_language = 'en', locale = 'fr-BE', timezone = 'Europe/Brussels'
       WHERE id = 1`,
    );
    await client.query("UPDATE application_terminology SET student_plural = 'Students' WHERE language = 'en'");
  } finally {
    client.release();
  }
});
