const bcrypt = require('bcryptjs');
const { pool } = require('./db/client');
const { roles } = require('./permissions');

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

function validatePassword(password, { required = true } = {}) {
  if (!password && !required) {
    return '';
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'Le mot de passe est trop long.';
  }
  return '';
}

function validateAdminUserInput({ name, email, role }) {
  if (!validateName(name)) {
    return 'Le nom doit contenir entre 2 et 120 caractères.';
  }
  if (!validateEmail(normalizeEmail(email))) {
    return 'L’adresse e-mail est invalide.';
  }
  if (!roleValues.has(role)) {
    return 'Le rôle sélectionné est invalide.';
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

async function createAdminUser({ name, email, role = roles.manager }) {
  const normalized = {
    name: typeof name === 'string' ? name.trim() : '',
    email: normalizeEmail(email),
    role,
  };
  const validationError = validateAdminUserInput(normalized);
  if (validationError) {
    const error = new Error(validationError);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  try {
    const result = await pool.query(
      `INSERT INTO admin_users (name, email, password_hash, role, active, account_type)
       VALUES ($1, $2, NULL, $3, TRUE, 'otp')
       RETURNING id, name, email, role, active, account_type, session_version,
                 created_at, updated_at, last_login_at`,
      [normalized.name, normalized.email, normalized.role],
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      const duplicateError = new Error('Un compte utilise déjà cette adresse e-mail.');
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
    const result = await pool.query(
      `INSERT INTO admin_users
         (name, email, username, password_hash, role, active, account_type)
       VALUES ($1, NULL, $2, $3, 'administrator', TRUE, 'break_glass')
       RETURNING id, name, username, role, active, account_type, session_version,
                 created_at, updated_at, last_login_at`,
      [normalizedName, normalizedUsername, passwordHash],
    );
    return result.rows[0];
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
