require('dotenv').config({ quiet: true });

const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('./client');
const { DEFAULT_APPLICATION_TIMEZONE, isValidTimeZone } = require('../application-time');

const migrationsDirectory = path.join(__dirname, 'migrations');

async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('attendance_log_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationFiles = (await fs.readdir(migrationsDirectory))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();

    const appliedResult = await client.query('SELECT name FROM schema_migrations');
    const appliedMigrations = new Set(appliedResult.rows.map((row) => row.name));
    const freshInstall = appliedMigrations.size === 0;
    const bootstrapTimezone = (process.env.APP_TIMEZONE
      || process.env.BACKUP_TIMEZONE
      || DEFAULT_APPLICATION_TIMEZONE).trim();
    if (!isValidTimeZone(bootstrapTimezone)) {
      throw new Error('APP_TIMEZONE must be a valid IANA timezone');
    }

    for (const fileName of migrationFiles) {
      if (appliedMigrations.has(fileName)) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDirectory, fileName), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('attendance_log.fresh_install', $1, TRUE),
                  set_config('attendance_log.bootstrap_timezone', $2, TRUE)`,
          [String(freshInstall), bootstrapTimezone],
        );
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [fileName],
        );
        await client.query('COMMIT');
        console.log(`Applied migration: ${fileName}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log('Database migrations are up to date.');
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('attendance_log_migrations'))");
    client.release();
  }
}

runMigrations()
  .catch((error) => {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
