const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const databaseName = `attendance_log_test_${process.pid}_${randomBytes(5).toString('hex')}`;
const restoreDatabaseName = `${databaseName}_restore`;
if (!/^attendance_log_test_[a-z0-9_]+$/.test(databaseName)) throw new Error('Unsafe integration database name');
if (!/^attendance_log_test_[a-z0-9_]+$/.test(restoreDatabaseName)) throw new Error('Unsafe restore integration database name');

function run(args, { capture = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout}` : '';
    throw new Error(`Command failed: docker ${args.join(' ')}${detail}`);
  }
  return result.stdout;
}

let databaseCreated = false;
try {
  run(['compose', 'exec', '-T', '-e', `TEST_DATABASE_NAME=${databaseName}`, 'postgres', 'sh', '-c',
    'test "$TEST_DATABASE_NAME" != "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$TEST_DATABASE_NAME"']);
  databaseCreated = true;
  run([
    'compose', 'run', '--rm', '--no-deps',
    '-e', `TEST_DATABASE_NAME=${databaseName}`,
    '-e', `TEST_RESTORE_DATABASE_NAME=${restoreDatabaseName}`,
    '-e', 'APP_TIMEZONE=Europe/Brussels',
    '-v', `${path.join(repositoryRoot, 'src')}:/app/src:ro`,
    '-v', `${path.join(repositoryRoot, 'integration')}:/app/integration:ro`,
    'app', 'sh', '-c',
    'export DATABASE_URL="${DATABASE_URL%/*}/$TEST_DATABASE_NAME"; npm run migrate && npm run migrate && node --test integration/reporting-punctuality.integration.js',
  ]);
} finally {
  if (databaseCreated) {
    for (const cleanupName of [restoreDatabaseName, databaseName]) {
      run(['compose', 'exec', '-T', '-e', `TEST_DATABASE_NAME=${cleanupName}`, 'postgres', 'sh', '-c',
        'dropdb -U "$POSTGRES_USER" --if-exists --force "$TEST_DATABASE_NAME"']);
      const remaining = run(['compose', 'exec', '-T', '-e', `TEST_DATABASE_NAME=${cleanupName}`, 'postgres', 'sh', '-c',
        'psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = \'$TEST_DATABASE_NAME\'"'], { capture: true });
      if (remaining.trim()) throw new Error(`Integration database cleanup failed: ${cleanupName}`);
    }
  }
}
