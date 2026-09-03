const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const backupFilenamePattern = /^attendance-log-backup-\d{4}-\d{2}-\d{2}-\d{6}\.zip$/;

function isOwnedBackupKey(objectKey, ownedPrefix) {
  return typeof objectKey === 'string'
    && objectKey.startsWith(ownedPrefix)
    && backupFilenamePattern.test(path.posix.basename(objectKey.slice(ownedPrefix.length)));
}

function createS3Backend(configuration) {
  function createClient() {
    return new S3Client({
      region: configuration.region,
      endpoint: configuration.endpoint || undefined,
      forcePathStyle: configuration.forcePathStyle,
      credentials: configuration.accessKeyId && configuration.secretAccessKey
        ? {
          accessKeyId: configuration.accessKeyId,
          secretAccessKey: configuration.secretAccessKey,
        }
        : undefined,
    });
  }

  async function test() {
    const client = createClient();
    const key = `${configuration.ownedPrefix}.probe-${randomUUID()}`;
    let testError = null;
    try {
      await client.send(new PutObjectCommand({
        Bucket: configuration.bucket,
        Key: key,
        Body: 'attendance-log-backup-test',
        ServerSideEncryption: 'AES256',
      }));
      const result = await client.send(new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: key,
      }));
      if (result.Body?.transformToString) await result.Body.transformToString();
    } catch (error) {
      testError = error;
      throw error;
    } finally {
      try {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: configuration.bucket, Key: key }));
        } catch (cleanupError) {
          if (!testError) throw cleanupError;
        }
      } finally {
        client.destroy();
      }
    }
  }

  async function upload({ filename, filePath, objectKey }) {
    if (!isOwnedBackupKey(objectKey, configuration.ownedPrefix)) {
      throw new Error('BACKUP_OBJECT_OUTSIDE_PREFIX');
    }
    const client = createClient();
    try {
      await client.send(new PutObjectCommand({
        Bucket: configuration.bucket,
        Key: objectKey,
        Body: fs.createReadStream(filePath),
        ContentType: 'application/zip',
        ContentDisposition: `attachment; filename="${filename}"`,
        ServerSideEncryption: 'AES256',
      }));
      return { objectKey };
    } finally {
      client.destroy();
    }
  }

  async function listBackups() {
    const client = createClient();
    const objects = [];
    let continuationToken;
    try {
      do {
        const result = await client.send(new ListObjectsV2Command({
          Bucket: configuration.bucket,
          Prefix: configuration.ownedPrefix,
          ContinuationToken: continuationToken,
        }));
        for (const item of result.Contents || []) {
          if (isOwnedBackupKey(item.Key, configuration.ownedPrefix)) {
            objects.push({ key: item.Key, lastModified: item.LastModified, size: item.Size });
          }
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuationToken);
      return objects;
    } finally {
      client.destroy();
    }
  }

  async function deleteBackup(objectKey) {
    if (!isOwnedBackupKey(objectKey, configuration.ownedPrefix)) {
      throw new Error('BACKUP_OBJECT_OUTSIDE_PREFIX');
    }
    const client = createClient();
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: configuration.bucket,
        Key: objectKey,
      }));
    } finally {
      client.destroy();
    }
  }

  async function downloadBackup(objectKey, destinationPath) {
    if (!isOwnedBackupKey(objectKey, configuration.ownedPrefix)) {
      throw new Error('BACKUP_OBJECT_OUTSIDE_PREFIX');
    }
    const client = createClient();
    try {
      const result = await client.send(new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: objectKey,
      }));
      if (!result.Body) throw new Error('BACKUP_OBJECT_EMPTY');
      await pipeline(result.Body, fs.createWriteStream(destinationPath, { mode: 0o600 }));
    } finally {
      client.destroy();
    }
  }

  return { deleteBackup, downloadBackup, listBackups, test, upload };
}

module.exports = { createS3Backend, isOwnedBackupKey };
