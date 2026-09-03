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

module.exports = { pool, verifyDatabaseConnection };
