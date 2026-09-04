const { pool } = require('./db/client');
const {
  loadBackupConfiguration,
  runCloudBackup,
  withBackupOperationLock,
} = require('./backup');
const { enterMaintenance, exitMaintenance } = require('./maintenance');

const operationalTables = Object.freeze([
  ['attendanceRecords', 'attendance_records'],
  ['courseSessions', 'course_sessions'],
  ['memberships', 'student_classes'],
  ['students', 'students'],
  ['classes', 'classes'],
]);

class OperationalResetError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OperationalResetError';
    this.code = code;
  }
}

function totalOperationalRecords(counts) {
  return operationalTables.reduce((total, [key]) => total + Number(counts[key] || 0), 0);
}

async function getOperationalDataCounts(client = pool) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM students) AS students,
      (SELECT COUNT(*)::integer FROM classes) AS classes,
      (SELECT COUNT(*)::integer FROM student_classes) AS memberships,
      (SELECT COUNT(*)::integer FROM course_sessions) AS course_sessions,
      (SELECT COUNT(*)::integer FROM attendance_records) AS attendance_records
  `);
  const row = result.rows[0];
  return {
    students: Number(row.students),
    classes: Number(row.classes),
    memberships: Number(row.memberships),
    courseSessions: Number(row.course_sessions),
    attendanceRecords: Number(row.attendance_records),
  };
}

async function deleteOperationalData() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      LOCK TABLE attendance_records, course_sessions, student_classes, students, classes
      IN ACCESS EXCLUSIVE MODE
    `);
    const counts = {};
    for (const [key, table] of operationalTables) {
      const result = await client.query(`DELETE FROM ${table}`);
      counts[key] = result.rowCount;
    }
    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function resetOperationalData({ alreadyLocked = false } = {}) {
  const action = () => deleteOperationalData();
  return alreadyLocked ? action() : withBackupOperationLock(action);
}

async function resetOperationalDataWithSafety({ localSafetyCompleted = false } = {}) {
  return withBackupOperationLock(async () => {
    if (!enterMaintenance()) throw new OperationalResetError('RESET_IN_PROGRESS');
    try {
      const counts = await getOperationalDataCounts();
      if (totalOperationalRecords(counts) > 0 && !localSafetyCompleted) {
        try {
          const configuration = await loadBackupConfiguration();
          if (!configuration?.provider) throw new Error('not-configured');
          await runCloudBackup('manual_cloud', { alreadyLocked: true });
        } catch (error) {
          const resetError = new OperationalResetError('RESET_SAFETY_BACKUP_REQUIRED');
          resetError.causeCode = error.code || 'BACKUP_UNAVAILABLE';
          throw resetError;
        }
      }
      return await resetOperationalData({ alreadyLocked: true });
    } finally {
      exitMaintenance();
    }
  });
}

module.exports = {
  OperationalResetError,
  getOperationalDataCounts,
  resetOperationalData,
  resetOperationalDataWithSafety,
  totalOperationalRecords,
};
