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

function validateAdminUserInput({ name, email, role, password }, { passwordRequired = true } = {}) {
  if (!validateName(name)) {
    return 'Le nom doit contenir entre 2 et 120 caractères.';
  }
  if (!validateEmail(normalizeEmail(email))) {
    return 'L’adresse e-mail est invalide.';
  }
  if (!roleValues.has(role)) {
    return 'Le rôle sélectionné est invalide.';
  }
  return validatePassword(password, { required: passwordRequired });
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

async function createAdminUser({ name, email, password, role = roles.administrator }) {
  const normalized = {
    name: typeof name === 'string' ? name.trim() : '',
    email: normalizeEmail(email),
    password,
    role,
  };
  const validationError = validateAdminUserInput(normalized);
  if (validationError) {
    const error = new Error(validationError);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const passwordHash = await hashPassword(password);
  try {
    const result = await pool.query(
      `INSERT INTO admin_users (name, email, password_hash, role, active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, name, email, role, active, created_at, updated_at, last_login_at`,
      [normalized.name, normalized.email, passwordHash, normalized.role],
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

module.exports = {
  PASSWORD_MIN_LENGTH,
  createAdminUser,
  hashPassword,
  normalizeEmail,
  roles,
  validateAdminUserInput,
  validatePassword,
  verifyPassword,
};
