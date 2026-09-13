// Opt-in backend measurement. Uses and cleans only its own synthetic class in
// the exact disposable redesign fixture; never run against application data.
const assert = require('node:assert/strict');
assert.equal(process.env.TEST_DATABASE_NAME, 'attendance_log_test_redesign_20260913');
assert.ok(process.env.DATABASE_URL?.endsWith(`/${process.env.TEST_DATABASE_NAME}`));
process.env.APP_ENCRYPTION_KEY = '';
process.env.APP_ENCRYPTION_KEY_FILE = '/tmp/redesign-encryption.key';
const { pool, withTransaction } = require('../src/db/client');
const { getGlobalReport } = require('../src/reporting-data');
const { createReportingPrivacyContext } = require('../src/reporting-privacy');
const { initializeSecrets } = require('../src/secrets');

(async () => {
  await initializeSecrets();
  for (const sessionCount of [154, 770]) {
    let course;
    try {
      course = await withTransaction(pool, async (client) => {
        const result = (await client.query("INSERT INTO classes (name) VALUES ('Synthetic performance fixture') RETURNING id, public_id")).rows[0];
        await client.query(`INSERT INTO course_sessions (class_id, title, instructor, date, start_time, state, started_at, closed_at)
          SELECT $1, 'Synthetic performance ' || n, 'Synthetic instructor', CURRENT_DATE - n, '19:00', 'closed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM generate_series(1, $2::integer) n`, [result.id, sessionCount]);
        await client.query(`INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
          SELECT cs.id, s.id, CASE WHEN s.id % 5 = 0 THEN 'absent' ELSE 'present' END,
            CASE WHEN s.id % 5 <> 0 THEN (cs.date + TIME '19:03') AT TIME ZONE 'Europe/Brussels' END
          FROM course_sessions cs CROSS JOIN (SELECT id FROM students ORDER BY id LIMIT 65) s WHERE cs.class_id = $1`, [result.id]);
        return result;
      });
      for (const pii of [true, false]) {
        const context = await createReportingPrivacyContext(pii, 'en');
        const samples = [];
        let opportunities;
        for (let i = 0; i < 4; i += 1) {
          const start = performance.now();
          const report = await getGlobalReport({ classId: course.public_id }, context);
          samples.push(performance.now() - start);
          opportunities = report.summary.opportunities;
          assert.equal(opportunities, sessionCount * 65);
        }
        console.log(JSON.stringify({ sessions: sessionCount, opportunities, pii, coldMs: samples[0], warmMs: samples.slice(1), heapMb: Math.round(process.memoryUsage().heapUsed / 1048576) }));
      }
    } finally {
      if (course) await withTransaction(pool, async (client) => {
        await client.query('DELETE FROM attendance_records WHERE session_id IN (SELECT id FROM course_sessions WHERE class_id = $1)', [course.id]);
        await client.query('DELETE FROM course_sessions WHERE class_id = $1', [course.id]);
        await client.query('DELETE FROM classes WHERE id = $1 AND public_id = $2', [course.id, course.public_id]);
      });
    }
  }
})().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
