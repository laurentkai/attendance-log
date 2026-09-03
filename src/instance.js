const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const defaultInstanceIdFile = '/app-secrets/instance-id';
const instanceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class InstanceIdentityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'InstanceIdentityError';
    this.code = code;
  }
}

let activeInstanceId = null;

function normalizeInstanceId(value) {
  const instanceId = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!instanceIdPattern.test(instanceId)) {
    throw new InstanceIdentityError('INVALID_INSTANCE_ID');
  }
  return instanceId;
}

function isValidInstanceId(value) {
  try {
    normalizeInstanceId(value);
    return true;
  } catch (_error) {
    return false;
  }
}

async function readInstanceId(filename) {
  return normalizeInstanceId(await fs.readFile(filename, 'utf8'));
}

async function initializeInstanceIdentity() {
  if (activeInstanceId) return activeInstanceId;

  const filename = process.env.APP_INSTANCE_ID_FILE?.trim() || defaultInstanceIdFile;
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  try {
    activeInstanceId = await readInstanceId(filename);
    return activeInstanceId;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generatedId = randomUUID();
  try {
    await fs.writeFile(filename, `${generatedId}\n`, { flag: 'wx', mode: 0o600 });
    activeInstanceId = generatedId;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    activeInstanceId = await readInstanceId(filename);
  }
  return activeInstanceId;
}

function getInstanceId() {
  if (!activeInstanceId) throw new InstanceIdentityError('INSTANCE_ID_NOT_INITIALIZED');
  return activeInstanceId;
}

module.exports = {
  InstanceIdentityError,
  getInstanceId,
  initializeInstanceIdentity,
  isValidInstanceId,
};
