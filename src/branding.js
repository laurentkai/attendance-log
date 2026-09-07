const multer = require('multer');
const sharp = require('sharp');
const { pool } = require('./db/client');

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const MAX_STORED_DIMENSION = 1200;
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png']);

class BrandingError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BrandingError';
    this.code = code;
  }
}

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

async function normalizeLogoUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || !acceptedMimeTypes.has(file.mimetype)) {
    throw new BrandingError('INVALID_LOGO');
  }

  try {
    const image = sharp(file.buffer, {
      failOn: 'warning',
      limitInputPixels: MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (!['jpeg', 'png'].includes(metadata.format)
        || !Number.isInteger(metadata.width)
        || !Number.isInteger(metadata.height)
        || metadata.width < 1
        || metadata.height < 1
        || metadata.width > MAX_IMAGE_DIMENSION
        || metadata.height > MAX_IMAGE_DIMENSION) {
      throw new BrandingError('INVALID_LOGO');
    }

    const data = await image
      .rotate()
      .resize({
        width: MAX_STORED_DIMENSION,
        height: MAX_STORED_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    if (data.length > MAX_UPLOAD_BYTES) throw new BrandingError('LOGO_TOO_LARGE');
    return { data, mimeType: 'image/png' };
  } catch (error) {
    if (error instanceof BrandingError) throw error;
    throw new BrandingError('INVALID_LOGO');
  }
}

function logoFromRow(row) {
  if (!row?.logo_data || row.logo_mime_type !== 'image/png') return null;
  return { data: row.logo_data, mimeType: row.logo_mime_type };
}

async function getGlobalLogo(client = pool) {
  const result = await client.query(
    'SELECT logo_data, logo_mime_type FROM application_branding WHERE id = 1',
  );
  return logoFromRow(result.rows[0]);
}

async function saveGlobalLogo(logo, client = pool) {
  await client.query(
    `UPDATE application_branding
     SET logo_data = $1, logo_mime_type = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [logo.data, logo.mimeType],
  );
}

async function removeGlobalLogo(client = pool) {
  await client.query(
    `UPDATE application_branding
     SET logo_data = NULL, logo_mime_type = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
  );
}

async function getClassLogo(publicId, client = pool) {
  const result = await client.query(
    'SELECT logo_data, logo_mime_type FROM classes WHERE public_id = $1',
    [publicId],
  );
  return result.rowCount === 0 ? undefined : logoFromRow(result.rows[0]);
}

async function getEffectiveLogoForClass(publicId, client = pool) {
  const classLogo = await getClassLogo(publicId, client);
  if (classLogo === undefined) return undefined;
  return classLogo || getGlobalLogo(client);
}

async function getEffectiveLogoForStudent(studentId, client = pool) {
  const result = await client.query(
    `SELECT c.logo_data, c.logo_mime_type
     FROM student_classes sc
     INNER JOIN classes c ON c.id = sc.class_id
     WHERE sc.student_id = $1
       AND sc.active = TRUE
       AND c.logo_data IS NOT NULL
     ORDER BY c.id`,
    [studentId],
  );
  const classLogos = result.rows.map(logoFromRow).filter(Boolean);
  if (classLogos.length > 0
      && classLogos.every((logo) => logo.data.equals(classLogos[0].data))) {
    return classLogos[0];
  }
  return getGlobalLogo(client);
}

async function saveClassLogo(publicId, logo, client = pool) {
  const result = await client.query(
    `UPDATE classes
     SET logo_data = $1, logo_mime_type = $2, logo_updated_at = CURRENT_TIMESTAMP
     WHERE public_id = $3`,
    [logo.data, logo.mimeType, publicId],
  );
  return result.rowCount === 1;
}

async function removeClassLogo(publicId, client = pool) {
  const result = await client.query(
    `UPDATE classes
     SET logo_data = NULL, logo_mime_type = NULL, logo_updated_at = NULL
     WHERE public_id = $1`,
    [publicId],
  );
  return result.rowCount === 1;
}

module.exports = {
  BrandingError,
  MAX_UPLOAD_BYTES,
  getClassLogo,
  getEffectiveLogoForClass,
  getEffectiveLogoForStudent,
  getGlobalLogo,
  logoUpload,
  normalizeLogoUpload,
  removeClassLogo,
  removeGlobalLogo,
  saveClassLogo,
  saveGlobalLogo,
};
