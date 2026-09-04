const crypto = require('node:crypto');
const { normalizeUsername, verifyPassword } = require('./admin-users');
const { pool } = require('./db/client');

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;
const DUMMY_PASSWORD_HASH = '$2b$12$.hmsAbAYTXzyR7IaFD/CvODU/wPeWQ/Y7LwFZXzLqoqtAnpjlL0WC';

class BreakGlassAuthError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BreakGlassAuthError';
    this.code = code;
  }
}

function rateLimitHash(purpose, value) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(`${purpose}\0${value}`)
    .digest('hex');
}

async function authenticateBreakGlass({ username: usernameValue, password, ip }) {
  const username = normalizeUsername(usernameValue);
  const usernameHash = rateLimitHash('break-glass-username', username);
  const ipHash = rateLimitHash('break-glass-ip', String(ip || 'unknown'));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`break-glass-username:${usernameHash}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`break-glass-ip:${ipHash}`]);
    await client.query(
      `DELETE FROM admin_break_glass_attempts
       WHERE attempted_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`,
    );

    const failures = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE username_hash = $1)::integer AS username_failures,
         COUNT(*) FILTER (WHERE ip_hash = $2)::integer AS ip_failures
       FROM admin_break_glass_attempts
       WHERE attempted_at >= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 minute')`,
      [usernameHash, ipHash, LOCKOUT_MINUTES],
    );
    if (
      failures.rows[0].username_failures >= MAX_FAILURES
      || failures.rows[0].ip_failures >= MAX_FAILURES
    ) {
      await client.query('ROLLBACK');
      throw new BreakGlassAuthError('RATE_LIMITED');
    }

    const result = await client.query(
      `SELECT id, password_hash, role, session_version
       FROM admin_users
       WHERE account_type = 'break_glass'
         AND LOWER(username) = LOWER($1)
         AND active = TRUE
       FOR UPDATE`,
      [username],
    );
    const user = result.rows[0];
    const validPassword = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !validPassword) {
      await client.query(
        `INSERT INTO admin_break_glass_attempts (username_hash, ip_hash)
         VALUES ($1, $2)`,
        [usernameHash, ipHash],
      );
      await client.query('COMMIT');
      throw new BreakGlassAuthError('INVALID_CREDENTIALS');
    }

    await client.query(
      `DELETE FROM admin_break_glass_attempts
       WHERE username_hash = $1`,
      [usernameHash],
    );
    const loginResult = await client.query(
      `UPDATE admin_users
       SET last_login_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND active = TRUE AND account_type = 'break_glass'
       RETURNING id, role, session_version`,
      [user.id],
    );
    if (loginResult.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new BreakGlassAuthError('INVALID_CREDENTIALS');
    }
    await client.query('COMMIT');
    return loginResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  BreakGlassAuthError,
  LOCKOUT_MINUTES,
  MAX_FAILURES,
  authenticateBreakGlass,
};
