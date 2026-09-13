const crypto = require('node:crypto');
const { pool, withTransaction } = require('./db/client');
const { isValidPublicId } = require('./public-id');
const { decryptSecret, encryptSecret } = require('./secrets');
const { getTerm } = require('./terminology');

const PSEUDONYM_SECRET_PURPOSE = 'reporting.pseudonym.v1';
const PSEUDONYM_INPUT_PURPOSE = 'reporting-pseudonym:v1';
const PSEUDONYM_KEY_BYTES = 32;

class ReportingPrivacyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReportingPrivacyError';
    this.code = code;
  }
}

function decodePseudonymKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new ReportingPrivacyError('PSEUDONYM_SECRET_INVALID');
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== PSEUDONYM_KEY_BYTES || key.toString('base64') !== value) {
    throw new ReportingPrivacyError('PSEUDONYM_SECRET_INVALID');
  }
  return key;
}

function decryptPseudonymKey(ciphertext) {
  try {
    return decodePseudonymKey(decryptSecret(ciphertext, PSEUDONYM_SECRET_PURPOSE));
  } catch (error) {
    if (error instanceof ReportingPrivacyError) throw error;
    throw new ReportingPrivacyError('PSEUDONYM_SECRET_UNAVAILABLE');
  }
}

async function createPseudonymKey() {
  return withTransaction(pool, async (client) => {
    const result = await client.query(
      `SELECT pseudonym_secret_ciphertext
       FROM reporting_privacy_configuration
       WHERE id = 1
       FOR UPDATE`,
    );
    if (result.rowCount === 0) {
      throw new ReportingPrivacyError('PSEUDONYM_CONFIGURATION_MISSING');
    }
    if (result.rows[0].pseudonym_secret_ciphertext) {
      return decryptPseudonymKey(result.rows[0].pseudonym_secret_ciphertext);
    }

    const key = crypto.randomBytes(PSEUDONYM_KEY_BYTES);
    const ciphertext = encryptSecret(key.toString('base64'), PSEUDONYM_SECRET_PURPOSE);
    await client.query(
      `UPDATE reporting_privacy_configuration
       SET pseudonym_secret_ciphertext = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [ciphertext],
    );
    return key;
  });
}

async function getPseudonymKey() {
  const result = await pool.query(
    `SELECT pseudonym_secret_ciphertext
     FROM reporting_privacy_configuration
     WHERE id = 1`,
  );
  if (result.rowCount === 0) {
    throw new ReportingPrivacyError('PSEUDONYM_CONFIGURATION_MISSING');
  }
  const ciphertext = result.rows[0].pseudonym_secret_ciphertext;
  return ciphertext ? decryptPseudonymKey(ciphertext) : createPseudonymKey();
}

function formatPseudonym(digest, language, terminology) {
  return `${getTerm(language, 'student', 'singular', terminology)} ${digest.slice(0, 12).toUpperCase().match(/.{1,4}/g).join('-')}`;
}

function pseudonymFor(key, activityPublicId, studentPublicId, language = 'en', terminology) {
  if (!isValidPublicId(activityPublicId) || !isValidPublicId(studentPublicId)) {
    throw new ReportingPrivacyError('PSEUDONYM_INPUT_INVALID');
  }
  const digest = crypto.createHmac('sha256', key)
    .update(`${PSEUDONYM_INPUT_PURPOSE}:${activityPublicId}:${studentPublicId}`)
    .digest('hex');
  return formatPseudonym(digest, language, terminology);
}

async function createReportingPrivacyContext(canViewPii, language = 'en', terminology) {
  if (canViewPii === true) {
    return Object.freeze({ canViewPii: true });
  }
  const key = await getPseudonymKey();
  return Object.freeze({
    canViewPii: false,
    pseudonymize(activityPublicId, studentPublicId) {
      return pseudonymFor(key, activityPublicId, studentPublicId, language, terminology);
    },
  });
}

async function getEncryptedReportingPseudonymSecret() {
  const result = await pool.query(
    'SELECT pseudonym_secret_ciphertext FROM reporting_privacy_configuration WHERE id = 1',
  );
  return result.rows[0]?.pseudonym_secret_ciphertext || null;
}

async function getReportingPseudonymSecretStatus() {
  const ciphertext = await getEncryptedReportingPseudonymSecret();
  if (!ciphertext) return 'available';
  try {
    decryptPseudonymKey(ciphertext);
    return 'available';
  } catch (_error) {
    return 'mismatch';
  }
}

module.exports = {
  PSEUDONYM_INPUT_PURPOSE,
  PSEUDONYM_SECRET_PURPOSE,
  ReportingPrivacyError,
  createReportingPrivacyContext,
  getEncryptedReportingPseudonymSecret,
  getReportingPseudonymSecretStatus,
  pseudonymFor,
};
