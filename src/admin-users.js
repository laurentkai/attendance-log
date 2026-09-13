const bcrypt = require('bcryptjs');
const { recordAuditEvent } = require('./audit');
const { pool, withTransaction } = require('./db/client');
const { roles } = require('./permissions');
const { DEFAULT_LANGUAGE, normalizeLanguageOverride, t } = require('./i18n');

const PASSWORD_MIN_LENGTH = 12;
const BCRYPT_COST = 12;
const roleValues = new Set(Object.values(roles));

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en') : '';
}

function validateEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateName(name) {
  return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 120;
}

function validatePassword(password, { required = true, language = DEFAULT_LANGUAGE } = {}) {
  if (!password && !required) {
    return '';
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return t(language, 'users.validation.password_short', { length: PASSWORD_MIN_LENGTH });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return t(language, 'users.validation.password_long');
  }
  return '';
}

function validateAdminUserInput({ name, email, role }, language = DEFAULT_LANGUAGE) {
  if (!validateName(name)) {
    return t(language, 'users.validation.name');
  }
  if (!validateEmail(normalizeEmail(email))) {
    return t(language, 'users.validation.email');
  }
  if (!roleValues.has(role)) {
    return t(language, 'users.validation.role');
  }
  return '';
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en') : '';
}

function validateUsername(username) {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalizeUsername(username));
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

async function createAdminUser({ name, email, role = roles.manager, viewPii = true, uiLanguage = null }, client = pool, language = DEFAULT_LANGUAGE) {
  const normalized = {
    name: typeof name === 'string' ? name.trim() : '',
    email: normalizeEmail(email),
    role,
    viewPii: viewPii !== false,
    uiLanguage: normalizeLanguageOverride(uiLanguage),
  };
  const validationError = validateAdminUserInput(normalized, language);
  if (validationError || normalized.uiLanguage === undefined) {
    const error = new Error(validationError || t(language, 'users.error.invalid_ui_language'));
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  try {
    const result = await client.query(
      `INSERT INTO admin_users (name, email, password_hash, role, active, account_type, view_pii, ui_language)
       VALUES ($1, $2, NULL, $3, TRUE, 'otp', $4, $5)
      RETURNING id, public_id, name, email, role, active, account_type, view_pii, ui_language, session_version,
                 created_at, updated_at, last_login_at`,
      [normalized.name, normalized.email, normalized.role, normalized.viewPii, normalized.uiLanguage],
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      const duplicateError = new Error(t(language, 'users.validation.email_exists'));
      duplicateError.code = 'EMAIL_EXISTS';
      throw duplicateError;
    }
    throw error;
  }
}

async function createBreakGlassUser({ name, username, password }) {
  const normalizedName = typeof name === 'string' && name.trim()
    ? name.trim()
    : 'Administrateur d’urgence';
  const normalizedUsername = normalizeUsername(username);
  if (!validateName(normalizedName)) {
    const error = new Error('Le nom doit contenir entre 2 et 120 caractères.');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!validateUsername(normalizedUsername)) {
    const error = new Error('Le nom d’utilisateur doit contenir 3 à 64 caractères (lettres, chiffres, point, tiret ou soulignement).');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    const error = new Error(passwordError);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const passwordHash = await hashPassword(password);
  try {
    return await withTransaction(pool, async (client) => {
      const result = await client.query(
        `INSERT INTO admin_users
           (name, email, username, password_hash, role, active, account_type)
         VALUES ($1, NULL, $2, $3, 'administrator', TRUE, 'break_glass')
         RETURNING id, public_id, name, username, role, active, account_type, view_pii, session_version,
                   created_at, updated_at, last_login_at`,
        [normalizedName, normalizedUsername, passwordHash],
      );
      const user = result.rows[0];
      await recordAuditEvent({
        client, actor: null, request: null, category: 'user', action: 'user.break_glass.create',
        targetType: 'admin_user', targetPublicId: user.public_id, targetLabel: user.name,
        summary: 'Compte local d’urgence créé.', afterData: { name: user.name, role: user.role, active: user.active },
        metadata: { source: 'create_admin_cli' },
      });
      return user;
    });
  } catch (error) {
    if (error.code === '23505') {
      const duplicateError = new Error('Un compte d’urgence existe déjà.');
      duplicateError.code = 'BREAK_GLASS_EXISTS';
      throw duplicateError;
    }
    throw error;
  }
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  createAdminUser,
  createBreakGlassUser,
  hashPassword,
  normalizeEmail,
  normalizeUsername,
  roles,
  validateAdminUserInput,
  validateEmail,
  validateName,
  validatePassword,
  validateUsername,
  verifyPassword,
};
