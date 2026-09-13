const crypto = require('node:crypto');
const { DEFAULT_LANGUAGE, normalizeLanguageOverride, t } = require('./i18n');

const studentCodeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateStudentCode() {
  return Array.from(
    crypto.randomBytes(7),
    (byte) => studentCodeAlphabet[byte % studentCodeAlphabet.length],
  ).join('');
}

function normalizeStudentValues(values = {}) {
  return {
    firstName: typeof values.first_name === 'string' ? values.first_name.trim() : '',
    lastName: typeof values.last_name === 'string' ? values.last_name.trim() : '',
    email: typeof values.email === 'string' ? values.email.trim().toLowerCase() : '',
    language: normalizeLanguageOverride(values.language),
  };
}

function validateStudentValues(values, language = DEFAULT_LANGUAGE) {
  if (!values.firstName || !values.lastName || !values.email) {
    return t(language, 'students.error.required_identity');
  }

  if (!emailPattern.test(values.email)) {
    return t(language, 'students.error.invalid_email');
  }
  if (values.language === undefined) return t(language, 'students.error.invalid_language');

  return '';
}

async function insertStudent(client, values) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const studentCode = generateStudentCode();

    try {
      await client.query('SAVEPOINT student_code_generation');
      const result = await client.query(
        `INSERT INTO students (first_name, last_name, email, student_code, language)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, public_id, student_code`,
        [values.firstName, values.lastName, values.email, studentCode, values.language ?? null],
      );
      await client.query('RELEASE SAVEPOINT student_code_generation');
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'students_student_code_key') {
        await client.query('ROLLBACK TO SAVEPOINT student_code_generation');
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unable to generate a unique student code');
}

module.exports = {
  generateStudentCode,
  insertStudent,
  normalizeStudentValues,
  validateStudentValues,
};
