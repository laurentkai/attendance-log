const {
  BlobServiceClient,
  StorageSharedKeyCredential,
} = require('@azure/storage-blob');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const backupFilenamePattern = /^attendance-log-backup-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/;

function isOwnedBackupKey(objectKey, ownedPrefix) {
  return typeof objectKey === 'string'
    && objectKey.startsWith(ownedPrefix)
    && backupFilenamePattern.test(path.posix.basename(objectKey.slice(ownedPrefix.length)));
}

function createAzureBackend(configuration) {
  const credential = new StorageSharedKeyCredential(
    configuration.accountName,
    configuration.accountKey,
  );
  const serviceClient = new BlobServiceClient(
    `https://${configuration.accountName}.blob.core.windows.net`,
    credential,
  );
  const container = serviceClient.getContainerClient(configuration.containerName);

  async function test() {
    const name = `${configuration.ownedPrefix}.probe-${randomUUID()}`;
    const blob = container.getBlockBlobClient(name);
    let testError = null;
    try {
      await blob.upload('attendance-log-backup-test', 26, {
        blobHTTPHeaders: { blobContentType: 'text/plain' },
      });
      await blob.downloadToBuffer();
    } catch (error) {
      testError = error;
      throw error;
    } finally {
      try {
        await blob.deleteIfExists();
      } catch (cleanupError) {
        if (!testError) throw cleanupError;
      }
    }
  }

  async function upload({ filePath, objectKey }) {
    const blob = container.getBlockBlobClient(objectKey);
    await blob.uploadFile(filePath, {
      blobHTTPHeaders: {
        blobContentType: 'application/zip',
        blobContentDisposition: `attachment; filename="${objectKey.split('/').pop()}"`,
      },
    });
    return { objectKey };
  }

  async function listBackups() {
    const objects = [];
    for await (const blob of container.listBlobsFlat({ prefix: configuration.ownedPrefix })) {
      if (isOwnedBackupKey(blob.name, configuration.ownedPrefix)) {
        objects.push({
          key: blob.name,
          lastModified: blob.properties.lastModified,
          size: blob.properties.contentLength,
        });
      }
    }
    return objects;
  }

  async function deleteBackup(objectKey) {
    if (!isOwnedBackupKey(objectKey, configuration.ownedPrefix)) {
      throw new Error('BACKUP_OBJECT_OUTSIDE_PREFIX');
    }
    await container.deleteBlob(objectKey);
  }

  async function downloadBackup(objectKey, destinationPath) {
    if (!isOwnedBackupKey(objectKey, configuration.ownedPrefix)) {
      throw new Error('BACKUP_OBJECT_OUTSIDE_PREFIX');
    }
    await container.getBlockBlobClient(objectKey).downloadToFile(destinationPath);
  }

  return { deleteBackup, downloadBackup, listBackups, test, upload };
}

module.exports = { createAzureBackend, isOwnedBackupKey };
