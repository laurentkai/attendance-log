require('dotenv').config({ quiet: true });

const { pool } = require('./db/client');
const { resetOperationalData } = require('./operational-reset');

function formatCounts(counts) {
  return [
    `Students: ${counts.students}`,
    `Classes: ${counts.classes}`,
    `Memberships: ${counts.memberships}`,
    `Course sessions: ${counts.courseSessions}`,
    `Attendance records: ${counts.attendanceRecords}`,
  ].join('\n');
}

async function main() {
  if (process.env.CONFIRM_RESET !== 'RESET') {
    console.error('Operational data was not deleted. On a live installation, use Configuration > Maintenance or stop the app service first. Create a current backup, then rerun with CONFIRM_RESET=RESET.');
    process.exitCode = 1;
    return;
  }

  const counts = await resetOperationalData();
  console.log('Operational data reset completed. Deleted row counts:');
  console.log(formatCounts(counts));
}

main()
  .catch((error) => {
    console.error('Operational data reset failed:', error.code || 'RESET_FAILED');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
