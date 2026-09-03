const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const algorithm = 'aes-256-gcm';
const legacyEnvelopeVersion = 'v1';
const purposeEnvelopeVersion = 'v2';
const keyLength = 32;
const ivLength = 12;
const authTagLength = 16;
const legacyAdditionalData = Buffer.from('attendance-log-secret:v1', 'utf8');
const defaultKeyFile = '/app-secrets/encryption.key';

class SecretError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SecretError';
    this.code = code;
  }
}

let activeKey = null;
let keySource = null;
let keyFile = null;

function decodeKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value.trim())) {
    throw new SecretError('INVALID_KEY');
  }
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== keyLength || key.toString('base64') !== value.trim()) {
    throw new SecretError('INVALID_KEY');
  }
  return key;
}

function encodeKey(key) {
  return key.toString('base64');
}

function keyFingerprint(key) {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 20).toUpperCase();
  return digest.match(/.{1,4}/g).join('-');
}

async function readKeyFile(filename) {
  return decodeKey(await fs.readFile(filename, 'utf8'));
}

async function writeKeyFile(filename, key, { exclusive = false } = {}) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporaryFilename = `${filename}.${process.pid}.tmp`;
  if (exclusive) {
    await fs.writeFile(filename, `${encodeKey(key)}\n`, { flag: 'wx', mode: 0o600 });
  } else {
    await fs.writeFile(temporaryFilename, `${encodeKey(key)}\n`, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporaryFilename, filename);
  }
}

async function initializeSecrets() {
  if (activeKey) return getKeyInfo();

  const environmentKey = process.env.APP_ENCRYPTION_KEY?.trim();
  keyFile = process.env.APP_ENCRYPTION_KEY_FILE?.trim() || defaultKeyFile;
  if (environmentKey) {
    activeKey = decodeKey(environmentKey);
    keySource = 'environment';
    return getKeyInfo();
  }

  if (keyFile === defaultKeyFile) {
    await fs.mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(keyFile), 0o700);
  }

  try {
    activeKey = await readKeyFile(keyFile);
    keySource = 'persistent-file';
    return getKeyInfo();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generatedKey = randomBytes(keyLength);
  try {
    await writeKeyFile(keyFile, generatedKey, { exclusive: true });
    activeKey = generatedKey;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    activeKey = await readKeyFile(keyFile);
  }
  keySource = 'persistent-file';
  return getKeyInfo();
}

function requireKey() {
  if (!activeKey) throw new SecretError('KEY_NOT_INITIALIZED');
  return activeKey;
}

function isEncryptedSecret(value) {
  return typeof value === 'string' && /^v\d+:/.test(value);
}

function purposeAdditionalData(purpose) {
  return Buffer.from(`attendance-log-secret:v2:${purpose}`, 'utf8');
}

function validatePurpose(purpose) {
  if (typeof purpose !== 'string' || !/^[a-z0-9._-]{1,100}$/.test(purpose)) {
    throw new SecretError('INVALID_SECRET_PURPOSE');
  }
  return purpose;
}

function encryptWithKey(value, key, purpose = null) {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, key, iv, { authTagLength });
  const normalizedPurpose = purpose === null ? null : validatePurpose(purpose);
  cipher.setAAD(normalizedPurpose === null
    ? legacyAdditionalData
    : purposeAdditionalData(normalizedPurpose));
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const envelopeParts = normalizedPurpose === null
    ? [legacyEnvelopeVersion, iv, authTag, ciphertext]
    : [purposeEnvelopeVersion, Buffer.from(normalizedPurpose, 'utf8'), iv, authTag, ciphertext];
  return envelopeParts
    .map((part) => Buffer.isBuffer(part) ? part.toString('base64url') : part)
    .join(':');
}

function parseEnvelope(value) {
  if (typeof value !== 'string') throw new SecretError('INVALID_ENVELOPE');
  const parts = value.split(':');
  const version = parts[0];
  const expectedLength = version === legacyEnvelopeVersion ? 4 : 5;
  if (![legacyEnvelopeVersion, purposeEnvelopeVersion].includes(version) || parts.length !== expectedLength) {
    throw new SecretError('INVALID_ENVELOPE');
  }
  try {
    if (!parts.slice(1).every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
      throw new Error('Invalid envelope encoding');
    }
    const offset = version === purposeEnvelopeVersion ? 1 : 0;
    const purpose = offset
      ? validatePurpose(Buffer.from(parts[1], 'base64url').toString('utf8'))
      : null;
    if (offset && Buffer.from(purpose, 'utf8').toString('base64url') !== parts[1]) {
      throw new Error('Non-canonical purpose encoding');
    }
    const iv = Buffer.from(parts[1 + offset], 'base64url');
    const authTag = Buffer.from(parts[2 + offset], 'base64url');
    const ciphertext = Buffer.from(parts[3 + offset], 'base64url');
    if (iv.length !== ivLength || authTag.length !== authTagLength || ciphertext.length === 0) {
      throw new Error('Invalid envelope parts');
    }
    if ([iv, authTag, ciphertext].some(
      (part, index) => part.toString('base64url') !== parts[index + 1 + offset],
    )) {
      throw new Error('Non-canonical envelope encoding');
    }
    return { version, purpose, iv, authTag, ciphertext };
  } catch (_error) {
    throw new SecretError('INVALID_ENVELOPE');
  }
}

function decryptWithKey(value, key, expectedPurpose = null, allowEmbeddedPurpose = false) {
  const { version, purpose, iv, authTag, ciphertext } = parseEnvelope(value);
  if (version === purposeEnvelopeVersion) {
    if (!allowEmbeddedPurpose && expectedPurpose === null) {
      throw new SecretError('SECRET_PURPOSE_REQUIRED');
    }
    if (expectedPurpose !== null && validatePurpose(expectedPurpose) !== purpose) {
      throw new SecretError('SECRET_PURPOSE_MISMATCH');
    }
  } else if (expectedPurpose !== null) {
    throw new SecretError('SECRET_PURPOSE_MISMATCH');
  }
  try {
    const decipher = createDecipheriv(algorithm, key, iv, { authTagLength });
    decipher.setAAD(version === legacyEnvelopeVersion
      ? legacyAdditionalData
      : purposeAdditionalData(purpose));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (_error) {
    throw new SecretError('SECRET_KEY_MISMATCH');
  }
}

function encryptSecret(value, purpose = null) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return encryptWithKey(value, requireKey(), purpose);
}

function decryptSecret(value, purpose = null) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (!isEncryptedSecret(value)) return value;
  return decryptWithKey(value, requireKey(), purpose);
}

function getKeyInfo() {
  const key = requireKey();
  return {
    fingerprint: keyFingerprint(key),
    source: keySource,
  };
}

function getRecoveryKey() {
  return encodeKey(requireKey());
}

function exportRecoveryKey() {
  const key = requireKey();
  return [
    'Attendance Log recovery key',
    'Version: 1',
    `Fingerprint: ${keyFingerprint(key)}`,
    `Key: ${encodeKey(key)}`,
    '',
  ].join('\n');
}

function parseRecoveryKey(contents) {
  if (typeof contents !== 'string' || Buffer.byteLength(contents, 'utf8') > 4096) {
    throw new SecretError('RECOVERY_FORMAT_INVALID');
  }
  const normalized = contents.replace(/\r\n/g, '\n').trim();
  const match = /^Attendance Log recovery key\nVersion: 1\nFingerprint: ([A-F0-9-]+)\nKey: ([A-Za-z0-9+/]+=*)$/.exec(normalized);
  if (!match) throw new SecretError('RECOVERY_FORMAT_INVALID');
  let key;
  try {
    key = decodeKey(match[2]);
  } catch (_error) {
    throw new SecretError('RECOVERY_FORMAT_INVALID');
  }
  if (match[1] !== keyFingerprint(key)) {
    throw new SecretError('RECOVERY_FINGERPRINT_MISMATCH');
  }
  return key;
}

async function importRecoveryKey(contents, { encryptedValues = [], confirmed = false } = {}) {
  if (keySource === 'environment') throw new SecretError('ENVIRONMENT_KEY_MANAGED');
  const candidateKey = parseRecoveryKey(contents);
  const existingEncryptedValues = encryptedValues.filter(isEncryptedSecret);
  if (existingEncryptedValues.length > 0) {
    try {
      existingEncryptedValues.forEach((value) => decryptWithKey(value, candidateKey, null, true));
    } catch (_error) {
      throw new SecretError('RECOVERY_KEY_MISMATCH');
    }
  } else if (!confirmed) {
    throw new SecretError('IMPORT_CONFIRMATION_REQUIRED');
  }

  if (keyFingerprint(candidateKey) === getKeyInfo().fingerprint) {
    return getKeyInfo();
  }
  await writeKeyFile(keyFile, candidateKey);
  activeKey = candidateKey;
  return getKeyInfo();
}

module.exports = {
  SecretError,
  decryptSecret,
  encryptSecret,
  exportRecoveryKey,
  getKeyInfo,
  getRecoveryKey,
  importRecoveryKey,
  initializeSecrets,
  isEncryptedSecret,
  parseRecoveryKey,
};
