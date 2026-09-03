const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { Client } = require('pg');
const unzipper = require('unzipper');
const { pool } = require('./db/client');
const {
  BackupError,
  calculateNextRunAt,
  createManualDownload,
  loadBackupConfiguration,
  pauseBackupScheduler,
  resumeBackupScheduler,
  runCloudBackup,
  storageConfiguration,
  withBackupOperationLock,
} = require('./backup');
const { createStorageBackend } = require('./backup-storage');
const { enterMaintenance, exitMaintenance } = require('./maintenance');
const { getInstanceId, isValidInstanceId } = require('./instance');
const { getKeyInfo } = require('./secrets');

const preparedRestores = new Map();
const restoreLifetimeMs = 30 * 60 * 1000;
const maximumManifestBytes = 64 * 1024;
const configuredUploadMb = Number.parseInt(process.env.BACKUP_RESTORE_MAX_MB || '512', 10);
const maximumArchiveContentBytes = (Number.isInteger(configuredUploadMb) && configuredUploadMb >= 1
  ? configuredUploadMb : 512) * 4 * 1024 * 1024;
const expectedEntries = new Set(['database.dump', 'manifest.json']);

class RestoreError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RestoreError';
    this.code = code;
  }
}

function databaseUrlFor(databaseName) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

function databaseName() {
  return decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ''));
}

function clientFor(database) {
  return new Client({
    connectionString: databaseUrlFor(database),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  });
}

function pgEnvironment(database) {
  const url = new URL(process.env.DATABASE_URL);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGSSLMODE: process.env.DATABASE_SSL === 'true' ? 'verify-full' : 'disable',
  };
}

async function runCommand(command, args, { database, errorCode, environment = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...pgEnvironment(database), ...environment },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let diagnostic = '';
    child.stderr.on('data', (chunk) => {
      if (diagnostic.length < 4096) diagnostic += chunk.toString('utf8');
    });
    child.on('error', () => reject(new RestoreError(`${errorCode}_UNAVAILABLE`)));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const error = new RestoreError(errorCode);
      error.safeDiagnostic = diagnostic.trim().slice(0, 500);
      return reject(error);
    });
  });
}

async function supportedMigrations() {
  const directory = path.join(__dirname, 'db', 'migrations');
  return (await fsp.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
}

function migrationSequence(name) {
  const match = /^(\d+)_/.exec(name || '');
  return match ? Number(match[1]) : 0;
}

function validateManifest(manifest, migrations) {
  if (!manifest || manifest.formatVersion !== 1) throw new RestoreError('BACKUP_VERSION_UNSUPPORTED');
  if (manifest.application?.id !== 'attendance-log') throw new RestoreError('BACKUP_INVALID');
  if (manifest.database?.engine !== 'PostgreSQL' || manifest.database?.dumpFormat !== 'custom') {
    throw new RestoreError('BACKUP_INVALID');
  }
  if (!Number.isFinite(Date.parse(manifest.generatedAt))) throw new RestoreError('BACKUP_INVALID');
  const latest = migrations.at(-1);
  if (migrationSequence(manifest.database.migration) > migrationSequence(latest)) {
    throw new RestoreError('BACKUP_SCHEMA_NEWER');
  }
  if (manifest.encryptionKeyFingerprint
      && !/^[A-F0-9]{4}(?:-[A-F0-9]{4})+$/.test(manifest.encryptionKeyFingerprint)) {
    throw new RestoreError('BACKUP_INVALID');
  }
  if (manifest.instanceId !== undefined && !isValidInstanceId(manifest.instanceId)) {
    throw new RestoreError('BACKUP_INVALID');
  }
}

async function validateDump(dumpPath) {
  await runCommand('pg_restore', ['--list', dumpPath], {
    database: databaseName(),
    errorCode: 'BACKUP_DUMP_INVALID',
  });
}

async function inspectArchive(zipPath, workspace) {
  let archive;
  try {
    archive = await unzipper.Open.file(zipPath);
  } catch (_error) {
    throw new RestoreError('BACKUP_ZIP_INVALID');
  }
  const names = archive.files.map((entry) => entry.path);
  if (names.length !== expectedEntries.size
      || new Set(names).size !== names.length
      || names.some((name) => !expectedEntries.has(name))) {
    throw new RestoreError('BACKUP_STRUCTURE_INVALID');
  }
  const manifestEntry = archive.files.find((entry) => entry.path === 'manifest.json');
  const dumpEntry = archive.files.find((entry) => entry.path === 'database.dump');
  if (!manifestEntry || !dumpEntry || manifestEntry.uncompressedSize > maximumManifestBytes
      || dumpEntry.uncompressedSize < 1
      || manifestEntry.uncompressedSize + dumpEntry.uncompressedSize > maximumArchiveContentBytes) {
    throw new RestoreError('BACKUP_STRUCTURE_INVALID');
  }
  let manifest;
  try {
    manifest = JSON.parse((await manifestEntry.buffer()).toString('utf8'));
  } catch (_error) {
    throw new RestoreError('BACKUP_MANIFEST_INVALID');
  }
  validateManifest(manifest, await supportedMigrations());
  const dumpPath = path.join(workspace, 'database.dump');
  try {
    let extractedBytes = 0;
    const sizeLimit = new Transform({
      transform(chunk, _encoding, callback) {
        extractedBytes += chunk.length;
        callback(extractedBytes > maximumArchiveContentBytes
          ? new RestoreError('BACKUP_STRUCTURE_INVALID') : null, chunk);
      },
    });
    await pipeline(dumpEntry.stream(), sizeLimit, fs.createWriteStream(dumpPath, { mode: 0o600 }));
    await validateDump(dumpPath);
  } catch (error) {
    if (error instanceof RestoreError) throw error;
    throw new RestoreError('BACKUP_DUMP_INVALID');
  }
  return { dumpPath, manifest };
}

async function isDatabasePopulated() {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM students)
      + (SELECT COUNT(*) FROM classes)
      + (SELECT COUNT(*) FROM course_sessions)
      + (SELECT COUNT(*) FROM attendance_records) AS records
  `);
  return Number(result.rows[0].records) > 0;
}

async function createPreparedRestore(zipPath, { source, filename, objectKey = null }) {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'attendance-log-restore-'));
  const storedZipPath = path.join(workspace, 'backup.zip');
  try {
    if (path.resolve(zipPath) !== path.resolve(storedZipPath)) {
      await fsp.copyFile(zipPath, storedZipPath);
      await fsp.rm(zipPath, { force: true });
    }
    const inspected = await inspectArchive(storedZipPath, workspace);
    const token = crypto.randomBytes(24).toString('base64url');
    const prepared = {
      token,
      workspace,
      zipPath: storedZipPath,
      ...inspected,
      source,
      filename: path.basename(filename || 'attendance-log-backup.zip'),
      objectKey,
      currentDatabasePopulated: await isDatabasePopulated(),
      instanceMatch: !inspected.manifest.instanceId
        || inspected.manifest.instanceId === getInstanceId(),
      fingerprintMatch: inspected.manifest.encryptionKeyFingerprint === getKeyInfo().fingerprint,
      safetyDownloaded: false,
      expiresAt: Date.now() + restoreLifetimeMs,
    };
    preparedRestores.set(token, prepared);
    const timer = setTimeout(() => cleanupPreparedRestore(token).catch(() => {}), restoreLifetimeMs);
    timer.unref();
    return prepared;
  } catch (error) {
    await fsp.rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

function getPreparedRestore(token) {
  const prepared = preparedRestores.get(token);
  if (!prepared || prepared.expiresAt < Date.now()) {
    if (prepared) cleanupPreparedRestore(token).catch(() => {});
    throw new RestoreError('RESTORE_PREPARATION_EXPIRED');
  }
  return prepared;
}

async function cleanupPreparedRestore(token) {
  const prepared = preparedRestores.get(token);
  preparedRestores.delete(token);
  if (prepared) await fsp.rm(prepared.workspace, { recursive: true, force: true });
}

async function cleanupStaleRestoreWorkspaces() {
  const entries = await fsp.readdir(os.tmpdir(), { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isDirectory()
      && (entry.name.startsWith('attendance-log-restore-')
        || entry.name.startsWith('attendance-log-cloud-restore-')))
    .map(async (entry) => {
      const target = path.join(os.tmpdir(), entry.name);
      await fsp.rm(target, { recursive: true, force: true });
    }));
}

async function listCloudBackups() {
  try {
    const configuration = await loadBackupConfiguration({ decrypt: true });
    const backend = createStorageBackend(storageConfiguration(configuration));
    const backups = await backend.listBackups();
    return {
      provider: configuration.provider,
      backups: backups.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified)),
    };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('BACKUP_FAILED');
  }
}

async function prepareCloudRestore(objectKey) {
  return withBackupOperationLock(async () => {
    const configuration = await loadBackupConfiguration({ decrypt: true });
    const backend = createStorageBackend(storageConfiguration(configuration));
    const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'attendance-log-cloud-restore-'));
    const downloadPath = path.join(temporaryDirectory, 'download.zip');
    try {
      await backend.downloadBackup(objectKey, downloadPath);
      const prepared = await createPreparedRestore(downloadPath, {
        source: configuration.provider,
        filename: path.basename(objectKey),
        objectKey,
      });
      await fsp.rm(temporaryDirectory, { recursive: true, force: true });
      return prepared;
    } catch (error) {
      await fsp.rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
  });
}

async function markSafetyDownloaded(token) {
  getPreparedRestore(token).safetyDownloaded = true;
}

async function createStagingDatabase(name) {
  const admin = clientFor('postgres');
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(name) {
  const admin = clientFor('postgres');
  await admin.connect();
  try {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [name]);
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
}

async function migrateStagingDatabase(name) {
  await runCommand(process.execPath, [path.join(__dirname, 'db', 'migrate.js')], {
    database: name,
    errorCode: 'RESTORE_MIGRATION_FAILED',
    environment: { DATABASE_URL: databaseUrlFor(name) },
  });
}

async function prepareStagingDatabase(prepared, name) {
  await createStagingDatabase(name);
  try {
    await runCommand('pg_restore', [
      '--exit-on-error', '--no-owner', '--no-privileges', `--dbname=${name}`, prepared.dumpPath,
    ], { database: name, errorCode: 'DATABASE_RESTORE_FAILED' });
    await migrateStagingDatabase(name);
    const client = clientFor(name);
    await client.connect();
    try {
      await client.query('SELECT 1 FROM students LIMIT 1');
      const configuration = await client.query(
        'SELECT enabled, frequency, execution_time, weekday FROM backup_configuration WHERE id = 1',
      );
      const row = configuration.rows[0];
      const nextRunAt = row?.enabled
        ? calculateNextRunAt({
          frequency: row.frequency,
          executionTime: String(row.execution_time).slice(0, 5),
          weekday: row.weekday,
          after: new Date(),
        })
        : null;
      await client.query('UPDATE backup_configuration SET next_run_at = $1 WHERE id = 1', [nextRunAt]);
      await client.query(
        `INSERT INTO restore_history (
           started_at, finished_at, source, filename, backup_generated_at,
           status, fingerprint_match
         ) VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $1, $2, $3, 'success', $4)`,
        [prepared.source, prepared.filename, prepared.manifest.generatedAt, prepared.fingerprintMatch],
      );
    } finally {
      await client.end();
    }
  } catch (error) {
    await dropDatabase(name);
    throw error;
  }
}

async function swapDatabaseNames(admin, { currentName, previousName, stagingName }) {
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ($1, $2)',
    [currentName, stagingName],
  );
  await admin.query(`ALTER DATABASE "${currentName.replaceAll('"', '""')}" RENAME TO "${previousName}"`);
  try {
    await admin.query(`ALTER DATABASE "${stagingName}" RENAME TO "${currentName.replaceAll('"', '""')}"`);
  } catch (swapError) {
    try {
      await admin.query(`ALTER DATABASE "${previousName}" RENAME TO "${currentName.replaceAll('"', '""')}"`);
    } catch (_rollbackError) {
      const error = new RestoreError('RESTORE_SWAP_UNRECOVERABLE');
      error.preserveStaging = true;
      console.error(
        `CRITICAL [RESTORE_SWAP_UNRECOVERABLE]: restore database swap rollback failed. Original production data remains in database "${previousName}" and the restored candidate remains in database "${stagingName}". Rename "${previousName}" back to "${currentName}" and restart Attendance Log.`,
      );
      throw error;
    }
    throw swapError;
  }
  try {
    await admin.query(`DROP DATABASE "${previousName}"`);
  } catch (error) {
    console.warn('Restored database is active, but the previous database could not be removed:', error.code || 'DATABASE_CLEANUP_FAILED');
  }
}

async function replaceDatabase(stagingName) {
  const currentName = databaseName();
  const previousName = `attendance_previous_${crypto.randomBytes(6).toString('hex')}`;
  const admin = clientFor('postgres');
  await admin.connect();
  let operationError = null;
  try {
    await swapDatabaseNames(admin, { currentName, previousName, stagingName });
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await admin.end();
    } catch (error) {
      if (!operationError) throw error;
      console.error('Unable to close PostgreSQL restore administration connection:', error.code || 'DATABASE_CONNECTION_CLOSE_FAILED');
    }
  }
}

async function recordFailedRestore(prepared, code) {
  try {
    await pool.query(
      `INSERT INTO restore_history (
         started_at, finished_at, source, filename, backup_generated_at,
         status, fingerprint_match, error_summary
       ) VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $1, $2, $3, 'failed', $4, $5)`,
      [prepared.source, prepared.filename, prepared.manifest.generatedAt,
        prepared.fingerprintMatch, String(code).slice(0, 200)],
    );
  } catch (_error) {
    // Restore diagnostics must never replace the original failure.
  }
}

async function ensureSafetyBackup(prepared) {
  if (!await isDatabasePopulated() || prepared.safetyDownloaded) return;
  try {
    const configuration = await loadBackupConfiguration();
    if (!configuration?.provider) throw new Error('not-configured');
    await runCloudBackup('manual_cloud', { alreadyLocked: true });
  } catch (_error) {
    throw new RestoreError('SAFETY_BACKUP_REQUIRED');
  }
}

async function performRestore(token) {
  const prepared = getPreparedRestore(token);
  pauseBackupScheduler();
  try {
    return await withBackupOperationLock(async () => {
      if (!enterMaintenance()) throw new RestoreError('RESTORE_IN_PROGRESS');
      const stagingName = `attendance_restore_${crypto.randomBytes(8).toString('hex')}`;
      try {
        await ensureSafetyBackup(prepared);
        await prepareStagingDatabase(prepared, stagingName);
        try {
          await replaceDatabase(stagingName);
        } catch (error) {
          if (error.code !== 'RESTORE_SWAP_UNRECOVERABLE') {
            await dropDatabase(stagingName);
          }
          throw error;
        }
        await cleanupPreparedRestore(token);
        return { restartRequired: true, fingerprintMatch: prepared.fingerprintMatch };
      } finally {
        exitMaintenance();
      }
    });
  } catch (error) {
    await recordFailedRestore(prepared, error.code || 'RESTORE_FAILED');
    throw error;
  } finally {
    resumeBackupScheduler();
  }
}

module.exports = {
  RestoreError,
  cleanupStaleRestoreWorkspaces,
  cleanupPreparedRestore,
  createPreparedRestore,
  getPreparedRestore,
  inspectArchive,
  isDatabasePopulated,
  listCloudBackups,
  markSafetyDownloaded,
  performRestore,
  prepareCloudRestore,
  replaceDatabase,
  swapDatabaseNames,
  validateManifest,
};
