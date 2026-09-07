const { Pool } = require('pg');
const { isMaintenanceActive } = require('../maintenance');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: true }
    : false,
});

pool.on('error', (error) => {
  if (isMaintenanceActive()) return;
  console.error('Unexpected PostgreSQL client error:', error);
});

async function verifyDatabaseConnection() {
  await pool.query('SELECT 1');
}

// A normal callback return commits; only a thrown exception rolls back. To commit and
// then report a failure, return an error/result and throw it after this call completes.
// Never return a rejection outcome after writes that were intended to roll back.
async function withTransaction(targetPool, asyncAction) {
  const client = await targetPool.connect();
  let transactionError = null;
  try {
    await client.query('BEGIN');
    const result = await asyncAction(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    transactionError = error;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      try {
        console.error('Unable to roll back PostgreSQL transaction:', rollbackError);
      } catch (_loggingError) {
        // Preserve the original transaction error even if diagnostic logging fails.
      }
    }
    throw error;
  } finally {
    try {
      client.release();
    } catch (releaseError) {
      if (!transactionError) throw releaseError;
      try {
        console.error('Unable to release PostgreSQL transaction client:', releaseError);
      } catch (_loggingError) {
        // Preserve the original transaction error even if diagnostic logging fails.
      }
    }
  }
}

module.exports = { pool, verifyDatabaseConnection, withTransaction };
