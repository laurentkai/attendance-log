const archiver = require('archiver');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { pool } = require('./db/client');
const { createStorageBackend } = require('./backup-storage');
const { getInstanceId } = require('./instance');
const { decryptSecret, getKeyInfo } = require('./secrets');

const applicationPackage = require('../package.json');
const backupLockId = 104729;
const backupFormatVersion = 1;
const schedulerIntervalMs = 60 * 1000;
const defaultTimezone = 'Europe/Brussels';
const secretPurposes = {
  s3: 'backup.s3.secret_access_key',
  azure: 'backup.azure.account_key',
};
let schedulerPaused = false;

class BackupError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BackupError';
    this.code = code;
  }
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function backupFilename(date = new Date()) {
  return `attendance-log-backup-${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.zip`;
}

function normalizePrefix(value = '', instanceId = getInstanceId()) {
  const prefix = String(value).trim().replace(/^\/+|\/+$/g, '');
  return `${prefix ? `${prefix}/` : ''}attendance-log/${instanceId}/`;
}

function objectKeyFor(filename, date = new Date(), prefix = '', instanceId = getInstanceId()) {
  return `${normalizePrefix(prefix, instanceId)}${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${filename}`;
}

function normalizeConfiguration(row, { decrypt = false } = {}) {
  if (!row) return null;
  const configuration = {
    enabled: row.enabled,
    provider: row.provider || '',
    frequency: row.frequency,
    executionTime: String(row.execution_time).slice(0, 5),
    weekday: row.weekday === null ? '' : Number(row.weekday),
    retentionDays: Number(row.retention_days),
    nextRunAt: row.next_run_at,
    s3: {
      bucket: row.s3_bucket || '',
      region: row.s3_region || '',
      endpoint: row.s3_endpoint || '',
      prefix: row.s3_prefix || '',
      accessKeyId: row.s3_access_key_id || '',
      secretAccessKey: row.s3_secret_access_key || '',
      forcePathStyle: row.s3_force_path_style,
    },
    azure: {
      accountName: row.azure_account_name || '',
      containerName: row.azure_container_name || '',
      accountKey: row.azure_account_key || '',
    },
  };
  if (!decrypt) return configuration;
  try {
    if (configuration.s3.secretAccessKey) {
      configuration.s3.secretAccessKey = decryptSecret(
        configuration.s3.secretAccessKey,
        secretPurposes.s3,
      );
    }
    if (configuration.azure.accountKey) {
      configuration.azure.accountKey = decryptSecret(
        configuration.azure.accountKey,
        secretPurposes.azure,
      );
    }
  } catch (error) {
    if (['SECRET_KEY_MISMATCH', 'SECRET_PURPOSE_MISMATCH', 'INVALID_ENVELOPE'].includes(error?.code)) {
      throw new BackupError('SECRET_KEY_MISMATCH');
    }
    throw error;
  }
  return configuration;
}

async function loadBackupConfiguration(options = {}) {
  const result = await pool.query('SELECT * FROM backup_configuration WHERE id = 1');
  return normalizeConfiguration(result.rows[0], options);
}

async function getStoredBackupSecretStatus() {
  const configuration = await loadBackupConfiguration();
  try {
    if (configuration?.s3.secretAccessKey) {
      decryptSecret(configuration.s3.secretAccessKey, secretPurposes.s3);
    }
    if (configuration?.azure.accountKey) {
      decryptSecret(configuration.azure.accountKey, secretPurposes.azure);
    }
    return 'available';
  } catch (error) {
    if (['SECRET_KEY_MISMATCH', 'SECRET_PURPOSE_MISMATCH', 'INVALID_ENVELOPE'].includes(error?.code)) {
      return 'mismatch';
    }
    throw error;
  }
}

function validateProviderConfiguration(configuration) {
  if (configuration.provider === 's3') {
    if (!configuration.s3.bucket) throw new BackupError('S3_BUCKET_REQUIRED');
    if (!configuration.s3.region) throw new BackupError('S3_REGION_REQUIRED');
    if (configuration.s3.endpoint) {
      try {
        const endpoint = new URL(configuration.s3.endpoint);
        if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('protocol');
      } catch (_error) {
        throw new BackupError('S3_ENDPOINT_INVALID');
      }
    }
    const hasAccessKey = Boolean(configuration.s3.accessKeyId);
    const hasSecret = Boolean(configuration.s3.secretAccessKey);
    if (hasAccessKey !== hasSecret) throw new BackupError('S3_CREDENTIALS_INCOMPLETE');
    return;
  }
  if (configuration.provider === 'azure') {
    if (!/^[a-z0-9]{3,24}$/.test(configuration.azure.accountName)) {
      throw new BackupError('AZURE_ACCOUNT_INVALID');
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(configuration.azure.containerName)) {
      throw new BackupError('AZURE_CONTAINER_INVALID');
    }
    if (!configuration.azure.accountKey) throw new BackupError('AZURE_CREDENTIAL_REQUIRED');
    return;
  }
  throw new BackupError('PROVIDER_REQUIRED');
}

function storageConfiguration(configuration) {
  validateProviderConfiguration(configuration);
  if (configuration.provider === 's3') {
    return {
      provider: 's3',
      ...configuration.s3,
      ownedPrefix: normalizePrefix(configuration.s3.prefix),
    };
  }
  return {
    provider: 'azure',
    ...configuration.azure,
    ownedPrefix: normalizePrefix(''),
  };
}

function pgEnvironment() {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  return {
    ...process.env,
    PGHOST: databaseUrl.hostname,
    PGPORT: databaseUrl.port || '5432',
    PGUSER: decodeURIComponent(databaseUrl.username),
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGDATABASE: databaseUrl.pathname.replace(/^\//, ''),
    PGSSLMODE: process.env.DATABASE_SSL === 'true' ? 'verify-full' : 'disable',
  };
}

async function createDatabaseDump(filename) {
  await new Promise((resolve, reject) => {
    const child = spawn('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--exclude-table-data=public.user_sessions',
      '--exclude-table-data=public.admin_otp_challenges',
      '--exclude-table-data=public.admin_break_glass_attempts',
      `--file=${filename}`,
    ], {
      env: pgEnvironment(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errorOutput = '';
    child.stderr.on('data', (chunk) => {
      if (errorOutput.length < 4096) errorOutput += chunk.toString('utf8');
    });
    child.on('error', () => reject(new BackupError('PG_DUMP_UNAVAILABLE')));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const error = new BackupError('PG_DUMP_FAILED');
        error.safeDetail = errorOutput.trim().slice(0, 300);
        reject(error);
      }
    });
  });
}

async function buildManifest(type, generatedAt) {
  const [postgresResult, migrationResult] = await Promise.all([
    pool.query('SHOW server_version'),
    pool.query('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1'),
  ]);
  return {
    formatVersion: backupFormatVersion,
    backupType: type,
    generatedAt: generatedAt.toISOString(),
    application: {
      id: 'attendance-log',
      version: applicationPackage.version,
      commit: process.env.APP_COMMIT?.trim() || null,
    },
    database: {
      engine: 'PostgreSQL',
      version: postgresResult.rows[0].server_version,
      migration: migrationResult.rows[0]?.name || null,
      dumpFormat: 'custom',
    },
    instanceId: getInstanceId(),
    encryptionKeyFingerprint: getKeyInfo().fingerprint,
  };
}

async function createZip(zipPath, dumpPath, manifest) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath, { mode: 0o600 });
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(dumpPath, { name: 'database.dump' });
    archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'manifest.json' });
    archive.finalize().catch(reject);
  });
}

async function createBackupArtifact(type) {
  const generatedAt = new Date();
  const filename = backupFilename(generatedAt);
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'attendance-log-backup-'));
  const dumpPath = path.join(temporaryDirectory, 'database.dump');
  const zipPath = path.join(temporaryDirectory, filename);
  try {
    await createDatabaseDump(dumpPath);
    const manifest = await buildManifest(type, generatedAt);
    await createZip(zipPath, dumpPath, manifest);
    const stat = await fsp.stat(zipPath);
    return {
      filename,
      generatedAt,
      manifest,
      size: stat.size,
      zipPath,
      cleanup: () => fsp.rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function withBackupOperationLock(action) {
  const connectionUrl = new URL(process.env.DATABASE_URL);
  connectionUrl.pathname = '/postgres';
  const client = new Client({
    connectionString: connectionUrl.toString(),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
  });
  let connected = false;
  let acquired = false;
  try {
    await client.connect();
    connected = true;
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [backupLockId]);
    if (!result.rows[0].acquired) throw new BackupError('BACKUP_IN_PROGRESS');
    acquired = true;
    return await action();
  } finally {
    try {
      if (acquired) await client.query('SELECT pg_advisory_unlock($1)', [backupLockId]);
    } finally {
      if (connected) await client.end();
    }
  }
}

async function recordHistory({
  startedAt,
  runType,
  provider,
  filename,
  objectKey = null,
  size = null,
  status,
  errorSummary = null,
}) {
  await pool.query(
    `INSERT INTO backup_history (
       started_at, finished_at, run_type, provider, filename, object_key,
       size_bytes, status, error_summary
     ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7, $8)`,
    [startedAt, runType, provider, filename, objectKey, size, status, errorSummary?.slice(0, 500) || null],
  );
}

function normalizeBackupError(error) {
  if (error instanceof BackupError) return error;
  if (error?.code === 'SECRET_KEY_MISMATCH') return new BackupError('SECRET_KEY_MISMATCH');
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode);
  const identifier = `${error?.name || ''} ${error?.code || ''}`;
  if (status === 401 || /Authentication|InvalidAccessKey|SignatureDoesNotMatch/i.test(identifier)) {
    return new BackupError('STORAGE_AUTHENTICATION_FAILED');
  }
  if (status === 403 || /AccessDenied|AuthorizationPermissionMismatch/i.test(identifier)) {
    return new BackupError('STORAGE_PERMISSION_DENIED');
  }
  if (status === 404 || /NoSuchBucket|ContainerNotFound/i.test(identifier)) {
    return new BackupError('STORAGE_NOT_FOUND');
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|NetworkingError/i.test(identifier)) {
    return new BackupError('STORAGE_CONNECTION_FAILED');
  }
  return new BackupError('BACKUP_FAILED');
}

async function createManualDownload() {
  const startedAt = new Date();
  const fallbackFilename = backupFilename(startedAt);
  let artifact;
  try {
    artifact = await withBackupOperationLock(() => createBackupArtifact('manual_download'));
    await recordHistory({
      startedAt,
      runType: 'manual_download',
      provider: 'local',
      filename: artifact.filename,
      size: artifact.size,
      status: 'success',
    });
    return artifact;
  } catch (rawError) {
    const error = normalizeBackupError(rawError);
    if (artifact) await artifact.cleanup();
    try {
      await recordHistory({
        startedAt,
        runType: 'manual_download',
        provider: 'local',
        filename: artifact?.filename || fallbackFilename,
        size: artifact?.size || null,
        status: 'failed',
        errorSummary: error.code,
      });
    } catch (historyError) {
      console.error('Unable to record backup failure:', historyError.code || 'DATABASE_ERROR');
    }
    throw error;
  }
}

async function applyRetention(configuration, now = new Date()) {
  const cutoff = new Date(now.getTime() - configuration.retentionDays * 24 * 60 * 60 * 1000);
  const storage = storageConfiguration(configuration);
  const objects = await createStorageBackend(storage).listBackups();
  for (const object of objects) {
    if (object.lastModified instanceof Date && object.lastModified < cutoff) {
      await createStorageBackend(storage).deleteBackup(object.key);
    }
  }
}

async function runCloudBackup(runType = 'manual_cloud', { alreadyLocked = false } = {}) {
  const startedAt = new Date();
  let configuration;
  let artifact;
  let objectKey = null;
  try {
    const action = async () => {
      configuration = await loadBackupConfiguration({ decrypt: true });
      validateProviderConfiguration(configuration);
      artifact = await createBackupArtifact(runType);
      objectKey = objectKeyFor(
        artifact.filename,
        artifact.generatedAt,
        configuration.provider === 's3' ? configuration.s3.prefix : '',
      );
      await createStorageBackend(storageConfiguration(configuration)).upload({
        filename: artifact.filename,
        filePath: artifact.zipPath,
        objectKey,
      });
      await recordHistory({
        startedAt,
        runType,
        provider: configuration.provider,
        filename: artifact.filename,
        objectKey,
        size: artifact.size,
        status: 'success',
      });
      try {
        await applyRetention(configuration, artifact.generatedAt);
      } catch (error) {
        console.warn('Backup retention cleanup failed:', normalizeBackupError(error).code);
      }
      return { filename: artifact.filename, objectKey, size: artifact.size };
    };
    return await (alreadyLocked ? action() : withBackupOperationLock(action));
  } catch (rawError) {
    const error = normalizeBackupError(rawError);
    try {
      await recordHistory({
        startedAt,
        runType,
        provider: configuration?.provider || 'local',
        filename: artifact?.filename || backupFilename(startedAt),
        objectKey,
        size: artifact?.size || null,
        status: 'failed',
        errorSummary: error.code,
      });
    } catch (historyError) {
      console.error('Unable to record backup failure:', historyError.code || 'DATABASE_ERROR');
    }
    throw error;
  } finally {
    if (artifact) await artifact.cleanup();
  }
}

async function testDestination() {
  try {
    await withBackupOperationLock(async () => {
      const configuration = await loadBackupConfiguration({ decrypt: true });
      const storage = storageConfiguration(configuration);
      await createStorageBackend(storage).test();
    });
  } catch (error) {
    throw normalizeBackupError(error);
  }
}

function localTimeParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    time: `${parts.hour}:${parts.minute}`,
  };
}

function calculateNextRunAt({ frequency, executionTime, weekday, after = new Date(), timezone }) {
  const zone = timezone || process.env.BACKUP_TIMEZONE || defaultTimezone;
  const cursor = new Date(after);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const maximumMinutes = 8 * 24 * 60;
  for (let index = 0; index < maximumMinutes; index += 1) {
    const local = localTimeParts(cursor, zone);
    if (local.time === executionTime
        && (frequency === 'daily' || local.weekday === Number(weekday))) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new BackupError('SCHEDULE_INVALID');
}

async function runDueBackup() {
  if (schedulerPaused) return;
  try {
    await withBackupOperationLock(async () => {
      if (schedulerPaused) return;
      const dueResult = await pool.query(
        `SELECT next_run_at, frequency, execution_time, weekday
         FROM backup_configuration
         WHERE id = 1 AND enabled = TRUE AND next_run_at <= CURRENT_TIMESTAMP`,
      );
      if (dueResult.rowCount === 0) return;
      const due = dueResult.rows[0];
      const minimumSpacing = due.frequency === 'weekly'
        ? 6 * 24 * 60 * 60 * 1000
        : 20 * 60 * 60 * 1000;
      const nextSearchStart = new Date(Math.max(
        Date.now(),
        new Date(due.next_run_at).getTime() + minimumSpacing,
      ));
      const nextRunAt = calculateNextRunAt({
        frequency: due.frequency,
        executionTime: String(due.execution_time).slice(0, 5),
        weekday: due.weekday,
        after: nextSearchStart,
      });
      const claim = await pool.query(
        `UPDATE backup_configuration
         SET next_run_at = $1
         WHERE id = 1 AND enabled = TRUE AND next_run_at <= CURRENT_TIMESTAMP
         RETURNING id`,
        [nextRunAt],
      );
      if (claim.rowCount === 0) return;
      await runCloudBackup('scheduled', { alreadyLocked: true });
    });
  } catch (error) {
    if (error.code !== 'BACKUP_IN_PROGRESS') {
      console.error('Scheduled backup failed:', error.code || 'BACKUP_FAILED');
    }
  }
}

function pauseBackupScheduler() {
  schedulerPaused = true;
}

function resumeBackupScheduler() {
  schedulerPaused = false;
}

async function recalculateBackupSchedule(after = new Date()) {
  const configuration = await loadBackupConfiguration();
  const nextRunAt = configuration.enabled
    ? calculateNextRunAt({
      frequency: configuration.frequency,
      executionTime: configuration.executionTime,
      weekday: configuration.weekday,
      after,
    })
    : null;
  await pool.query(
    'UPDATE backup_configuration SET next_run_at = $1, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
    [nextRunAt],
  );
  return nextRunAt;
}

function startBackupScheduler() {
  const check = () => runDueBackup().catch((error) => {
    console.error('Unable to check scheduled backups:', error.code || 'SCHEDULER_FAILED');
  });
  check();
  const interval = setInterval(check, schedulerIntervalMs);
  interval.unref();
  console.log('Backup scheduler started.');
  return interval;
}

module.exports = {
  BackupError,
  applyRetention,
  backupFilename,
  calculateNextRunAt,
  createBackupArtifact,
  createManualDownload,
  getStoredBackupSecretStatus,
  loadBackupConfiguration,
  normalizeBackupError,
  normalizePrefix,
  objectKeyFor,
  pauseBackupScheduler,
  recalculateBackupSchedule,
  resumeBackupScheduler,
  runCloudBackup,
  runDueBackup,
  secretPurposes,
  startBackupScheduler,
  storageConfiguration,
  testDestination,
  validateProviderConfiguration,
  withBackupOperationLock,
};
