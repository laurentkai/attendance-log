const { createAzureBackend } = require('./azure');
const { createS3Backend } = require('./s3');

function createStorageBackend(configuration) {
  if (configuration.provider === 's3') return createS3Backend(configuration);
  if (configuration.provider === 'azure') return createAzureBackend(configuration);
  throw new Error('BACKUP_PROVIDER_UNSUPPORTED');
}

module.exports = { createStorageBackend };
