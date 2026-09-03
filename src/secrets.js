const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const algorithm = 'aes-256-gcm';
const envelopeVersion = 'v1';
const keyLength = 32;
const ivLength = 12;
const authTagLength = 16;
const additionalData = Buffer.from('attendance-log-secret:v1', 'utf8');
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

function encryptWithKey(value, key) {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, key, iv, { authTagLength });
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [envelopeVersion, iv, authTag, ciphertext]
    .map((part) => Buffer.isBuffer(part) ? part.toString('base64url') : part)
    .join(':');
}

function parseEnvelope(value) {
  if (typeof value !== 'string') throw new SecretError('INVALID_ENVELOPE');
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== envelopeVersion) {
    throw new SecretError('INVALID_ENVELOPE');
  }
  try {
    if (!parts.slice(1).every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
      throw new Error('Invalid envelope encoding');
    }
    const iv = Buffer.from(parts[1], 'base64url');
    const authTag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== ivLength || authTag.length !== authTagLength || parts[3] === '') {
      throw new Error('Invalid envelope parts');
    }
    if ([iv, authTag, ciphertext].some((part, index) => part.toString('base64url') !== parts[index + 1])) {
      throw new Error('Non-canonical envelope encoding');
    }
    return { iv, authTag, ciphertext };
  } catch (_error) {
    throw new SecretError('INVALID_ENVELOPE');
  }
}

function decryptWithKey(value, key) {
  const { iv, authTag, ciphertext } = parseEnvelope(value);
  try {
    const decipher = createDecipheriv(algorithm, key, iv, { authTagLength });
    decipher.setAAD(additionalData);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (_error) {
    throw new SecretError('SECRET_KEY_MISMATCH');
  }
}

function encryptSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return encryptWithKey(value, requireKey());
}

function decryptSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (!isEncryptedSecret(value)) return value;
  return decryptWithKey(value, requireKey());
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
      existingEncryptedValues.forEach((value) => decryptWithKey(value, candidateKey));
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
