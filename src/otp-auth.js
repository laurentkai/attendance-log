const crypto = require('node:crypto');
const { pool } = require('./db/client');
const { normalizeEmail } = require('./admin-users');
const { sendMail } = require('./mail');

const OTP_LIFETIME_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const MAX_EMAIL_REQUESTS = 3;
const MAX_IP_REQUESTS = 10;
const MAX_VERIFY_ATTEMPTS = 5;

class OtpError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OtpError';
    this.code = code;
  }
}

function authenticationKey() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new OtpError('OTP_CONFIGURATION_ERROR');
  return value;
}

function keyedHash(purpose, value) {
  return crypto.createHmac('sha256', authenticationKey())
    .update(`${purpose}\0${value}`)
    .digest('hex');
}

function hashOtp(challengeId, code) {
  return keyedHash('admin-otp-code', `${challengeId}\0${code}`);
}

function safeHashEquals(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function generateOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

function renderOtpMessage(code) {
  return {
    subject: 'Attendance Log — code de connexion',
    text: `Votre code de connexion Attendance Log est : ${code}\n\nCe code expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.`,
    html: `<div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:560px;margin:0 auto">
      <h1 style="font-size:20px;margin:0 0 16px">Connexion à Attendance Log</h1>
      <p style="margin:0 0 12px">Votre code de connexion est :</p>
      <p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:0 0 16px">${code}</p>
      <p style="margin:0;color:#52606d">Ce code expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.</p>
    </div>`,
  };
}

async function cleanupExpiredChallenges(client) {
  await client.query(
    `DELETE FROM admin_otp_challenges
     WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`,
  );
}

function requestLimitState(row) {
  const checkedAt = new Date(row.checked_at).getTime();
  const candidates = [];
  const addCandidate = (value, duration) => {
    if (!value) return;
    const candidate = new Date(value).getTime() + duration;
    if (candidate > checkedAt) candidates.push(candidate);
  };

  addCandidate(row.latest_email_request, REQUEST_COOLDOWN_MS);
  addCandidate(row.latest_ip_request, REQUEST_COOLDOWN_MS);
  if (row.email_requests >= MAX_EMAIL_REQUESTS) addCandidate(row.oldest_email_request, RATE_WINDOW_MS);
  if (row.ip_requests >= MAX_IP_REQUESTS) addCandidate(row.oldest_ip_request, RATE_WINDOW_MS);

  const nextAllowedAtMs = candidates.length ? Math.max(...candidates) : checkedAt;
  return {
    allowed: nextAllowedAtMs <= checkedAt,
    nextAllowedAt: new Date(nextAllowedAtMs).toISOString(),
    retryAfterSeconds: Math.max(0, Math.ceil((nextAllowedAtMs - checkedAt) / 1000)),
  };
}

async function readRequestLimitState(client, emailHash, ipHash) {
  const result = await client.query(
    `SELECT CURRENT_TIMESTAMP AS checked_at,
       COUNT(*) FILTER (WHERE email_hash = $1)::integer AS email_requests,
       MIN(created_at) FILTER (WHERE email_hash = $1) AS oldest_email_request,
       MAX(created_at) FILTER (WHERE email_hash = $1) AS latest_email_request,
       COUNT(*) FILTER (WHERE ip_hash = $2)::integer AS ip_requests,
       MIN(created_at) FILTER (WHERE ip_hash = $2) AS oldest_ip_request,
       MAX(created_at) FILTER (WHERE ip_hash = $2) AS latest_ip_request
     FROM admin_otp_challenges
     WHERE created_at >= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 millisecond')`,
    [emailHash, ipHash, RATE_WINDOW_MS],
  );
  return requestLimitState(result.rows[0]);
}

function timingAfterRequest(createdAt) {
  const nextAllowedAtMs = new Date(createdAt).getTime() + REQUEST_COOLDOWN_MS;
  return {
    nextAllowedAt: new Date(nextAllowedAtMs).toISOString(),
    retryAfterSeconds: Math.ceil(REQUEST_COOLDOWN_MS / 1000),
  };
}

async function deliverOtpChallenge({ challengeId, recipient, code, deliver }) {
  try {
    const message = renderOtpMessage(code);
    await deliver({ to: recipient, ...message });
    const result = await pool.query(
      `UPDATE admin_otp_challenges
       SET delivered_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND delivered_at IS NULL
         AND used_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP`,
      [challengeId],
    );
    return { delivered: result.rowCount === 1 };
  } catch (error) {
    await pool.query(
      `UPDATE admin_otp_challenges
       SET invalidated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND delivered_at IS NULL`,
      [challengeId],
    ).catch(() => {});
    console.warn('Administrator OTP delivery failed:', error?.code || 'DELIVERY_FAILED');
    return { delivered: false };
  }
}

function deferOtpDelivery(delivery) {
  return new Promise((resolve) => {
    setImmediate(() => {
      deliverOtpChallenge(delivery)
        .then(resolve)
        .catch((error) => {
          console.error('Unable to finalize administrator OTP delivery:', error?.code || 'DELIVERY_STATE_FAILED');
          resolve({ delivered: false });
        });
    });
  });
}

async function getOtpRequestAvailability(emailValue, ipValue) {
  const email = normalizeEmail(emailValue);
  const emailHash = keyedHash('admin-otp-email', email);
  const ipHash = keyedHash('admin-otp-ip', String(ipValue || 'unknown'));
  return readRequestLimitState(pool, emailHash, ipHash);
}

async function requestOtp(emailValue, ipValue, { deliver = sendMail, code = generateOtp() } = {}) {
  const email = normalizeEmail(emailValue);
  const emailHash = keyedHash('admin-otp-email', email);
  const ipHash = keyedHash('admin-otp-ip', String(ipValue || 'unknown'));
  const challengeId = crypto.randomUUID();
  const client = await pool.connect();
  let user = null;
  let requestTiming = null;

  try {
    await client.query('BEGIN');
    await cleanupExpiredChallenges(client);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp-email:${emailHash}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp-ip:${ipHash}`]);
    const limitState = await readRequestLimitState(client, emailHash, ipHash);
    if (!limitState.allowed) {
      await client.query('ROLLBACK');
      const error = new OtpError('RATE_LIMITED');
      Object.assign(error, limitState);
      throw error;
    }

    const userResult = await client.query(
      `SELECT id, name, email, active
       FROM admin_users
       WHERE account_type = 'otp' AND LOWER(email) = LOWER($1)`,
      [email],
    );
    user = userResult.rows[0] || null;
    if (user) {
      await client.query(
        `UPDATE admin_otp_challenges
         SET invalidated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL`,
        [user.id],
      );
    }
    const insertResult = await client.query(
      `INSERT INTO admin_otp_challenges
         (id, user_id, email_hash, ip_hash, otp_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
       RETURNING created_at`,
      [challengeId, user?.id || null, emailHash, ipHash, user?.active ? hashOtp(challengeId, code) : null],
    );
    requestTiming = timingAfterRequest(insertResult.rows[0].created_at);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const delivery = user?.active
    ? deferOtpDelivery({ challengeId, recipient: user.email, code, deliver })
    : Promise.resolve({ delivered: false });
  return { challengeId, delivery, ...requestTiming };
}

async function verifyOtp(challengeId, code) {
  if (!/^[0-9]{6}$/.test(code || '')) throw new OtpError('INVALID_CODE');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT c.id, c.user_id, c.otp_hash, c.attempts, c.expires_at,
              c.delivered_at, c.used_at, c.invalidated_at,
              u.active, u.account_type
       FROM admin_otp_challenges c
       LEFT JOIN admin_users u ON u.id = c.user_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [challengeId],
    );
    const challenge = result.rows[0];
    if (
      !challenge
      || !challenge.user_id
      || !challenge.delivered_at
      || challenge.used_at
      || challenge.invalidated_at
      || !challenge.active
      || challenge.account_type !== 'otp'
      || new Date(challenge.expires_at).getTime() <= Date.now()
      || challenge.attempts >= MAX_VERIFY_ATTEMPTS
    ) {
      await client.query('ROLLBACK');
      throw new OtpError('INVALID_CODE');
    }

    const valid = safeHashEquals(challenge.otp_hash, hashOtp(challengeId, code));
    if (!valid) {
      await client.query(
        `UPDATE admin_otp_challenges
         SET attempts = attempts + 1,
             invalidated_at = CASE WHEN attempts + 1 >= $2 THEN CURRENT_TIMESTAMP ELSE invalidated_at END
         WHERE id = $1`,
        [challengeId, MAX_VERIFY_ATTEMPTS],
      );
      await client.query('COMMIT');
      throw new OtpError('INVALID_CODE');
    }

    await client.query(
      `UPDATE admin_otp_challenges
       SET used_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [challengeId],
    );
    const userResult = await client.query(
      `UPDATE admin_users
       SET last_login_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND active = TRUE AND account_type = 'otp'
       RETURNING id, role, session_version`,
      [challenge.user_id],
    );
    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new OtpError('INVALID_CODE');
    }
    await client.query('COMMIT');
    return userResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  MAX_VERIFY_ATTEMPTS,
  OTP_LIFETIME_MS,
  REQUEST_COOLDOWN_MS,
  OtpError,
  generateOtp,
  getOtpRequestAvailability,
  hashOtp,
  requestOtp,
  verifyOtp,
};
