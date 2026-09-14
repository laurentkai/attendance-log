// Opt-in synthetic browser fixture. Never start against an application database.
const assert = require('node:assert/strict');
assert.equal(process.env.TEST_DATABASE_NAME, 'attendance_log_test_redesign_20260913');
assert.ok(process.env.DATABASE_URL?.endsWith(`/${process.env.TEST_DATABASE_NAME}`));
process.env.SESSION_SECRET = 'synthetic-redesign-session-secret-20260913';
process.env.APP_ENCRYPTION_KEY = '';
process.env.APP_ENCRYPTION_KEY_FILE = '/tmp/redesign-encryption.key';
process.env.APP_INSTANCE_ID_FILE = '/tmp/redesign-instance-id';
const { pool, withTransaction } = require('../src/db/client');
const { insertStudent } = require('../src/student-data');
const { initializeSecrets } = require('../src/secrets');
const { initializeInstanceIdentity } = require('../src/instance');
const { app } = require('../src/server');

async function start() {
  await initializeSecrets();
  await initializeInstanceIdentity();
  await withTransaction(pool, async (client) => {
    const count = (await client.query('SELECT COUNT(*)::integer AS count FROM admin_users')).rows[0].count;
    if (count !== 0) { assert.equal(count, 3); return; }
    for (const [key, role, pii, language] of [
      ['admin', 'administrator', true, 'en'], ['private', 'manager', false, 'fr'],
      ['operator', 'attendance_operator', false, 'en'],
    ]) {
      const user = (await client.query(`INSERT INTO admin_users (name, email, role, active, account_type, view_pii, ui_language)
        VALUES ($1, $2, $3, TRUE, 'otp', $4, $5) RETURNING id, session_version`,
      [`Demo ${key}`, `${key}@example.invalid`, role, pii, language])).rows[0];
      await client.query('INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2::json, $3)', [
        `redesign-${key}`, JSON.stringify({ cookie: { originalMaxAge: 86400000, httpOnly: true, path: '/', sameSite: 'lax' },
          adminUserId: String(user.id), sessionVersion: String(user.session_version), authenticatedAt: Date.now() }),
        new Date(Date.now() + 86400000),
      ]);
    }
    const courses = [];
    for (const [name, description] of [
      ['Coastal navigation', 'Chart work, tides and passage planning'],
      ['Navigation hauturière', 'Positionnement, météo et préparation de traversée'],
      ['Radio & safety <practice>', 'VHF procedures and safety exercises'],
    ]) courses.push((await client.query('INSERT INTO classes (name, description) VALUES ($1, $2) RETURNING id', [name, description])).rows[0]);
    const students = [];
    for (let i = 0; i < 65; i += 1) {
      const student = await insertStudent(client, {
        firstName: ['Alex', 'Camille', 'Morgan', 'Robin', 'Lou', 'Sam'][i % 6],
        lastName: i === 0 ? 'Mariner' : i === 1 ? 'De la Roche-Montgomery & Navigation' : `Sailor ${String(i).padStart(2, '0')}`,
        email: `demo.${i}@example.invalid`, language: null,
      });
      students.push(student);
      await client.query('INSERT INTO student_classes (student_id, class_id) VALUES ($1, $2)', [student.id, courses[0].id]);
    }
    // Fixture identities and e-mails are synthetic; code generation is shared.
    for (const [title, offset, state, courseIndex] of [
      ['Evening chart work', 0, 'open', 0], ['Tides and tidal streams', 1, 'scheduled', 0],
      ['Passage planning workshop', 4, 'scheduled', 0], ['Traversée de nuit', 2, 'scheduled', 1],
      ['VHF practical assessment', 3, 'scheduled', 2], ['Position fixing', -7, 'closed', 0],
      ['Navigation lights', -14, 'closed', 0],
    ]) {
      const session = (await client.query(`INSERT INTO course_sessions (class_id, date, title, instructor, start_time, state, started_at, closed_at)
        VALUES ($1, CURRENT_DATE + $2::integer, $3, 'Demo instructor', '19:00', $4,
          CASE WHEN $4 IN ('open', 'closed') THEN CURRENT_TIMESTAMP END,
          CASE WHEN $4 = 'closed' THEN CURRENT_TIMESTAMP END) RETURNING id`,
      [courses[courseIndex].id, offset, title, state])).rows[0];
      if (state === 'open' || state === 'closed') {
        for (let i = 0; i < students.length; i += 1) {
          const status = state === 'open' ? (i > 60 ? 'present' : 'pending') : (i % 5 ? 'present' : 'absent');
          await client.query(`INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
            VALUES ($1, $2, $3, CASE WHEN $3 = 'present' THEN CURRENT_TIMESTAMP END)`, [session.id, students[i].id, status]);
        }
      }
    }
  });
  app.listen(3000, '0.0.0.0', () => console.log('Synthetic redesign fixture ready'));
}
start().catch(async (error) => { console.error(error.code || error.message); await pool.end(); process.exitCode = 1; });
