const { pool } = require('./db/client');
const { getCurrentRequest } = require('./request-context');

const TERMINOLOGY_CONCEPTS = Object.freeze([
  'student',
  'class',
  'session',
  'attendance',
  'instructor',
  'membership',
]);
const TERMINOLOGY_FORMS = Object.freeze(['singular', 'plural']);
const MAX_TERMINOLOGY_LENGTH = 40;
const INVALID_PLAIN_TEXT = /[\u0000-\u001f\u007f]/;

const DEFAULT_TERMINOLOGY = Object.freeze({
  student: Object.freeze({ singular: 'Participant', plural: 'Participants' }),
  class: Object.freeze({ singular: 'Activité', plural: 'Activités' }),
  session: Object.freeze({ singular: 'Session', plural: 'Sessions' }),
  attendance: Object.freeze({ singular: 'Présence', plural: 'Présences' }),
  instructor: Object.freeze({ singular: 'Responsable', plural: 'Responsables' }),
  membership: Object.freeze({ singular: 'Inscription', plural: 'Inscriptions' }),
});

function copyDefaults() {
  return Object.fromEntries(TERMINOLOGY_CONCEPTS.map((concept) => [
    concept,
    { ...DEFAULT_TERMINOLOGY[concept] },
  ]));
}

function terminologyFromRow(row = {}) {
  return Object.fromEntries(TERMINOLOGY_CONCEPTS.map((concept) => [
    concept,
    Object.fromEntries(TERMINOLOGY_FORMS.map((form) => [
      form,
      row[`${concept}_${form}`] || DEFAULT_TERMINOLOGY[concept][form],
    ])),
  ]));
}

async function loadTerminology(client = pool) {
  const result = await client.query('SELECT * FROM application_terminology WHERE id = 1');
  return result.rowCount === 0 ? copyDefaults() : terminologyFromRow(result.rows[0]);
}

function getTerminology() {
  return getCurrentRequest()?.terminology || DEFAULT_TERMINOLOGY;
}

function getTerm(concept, form = 'singular') {
  if (!TERMINOLOGY_CONCEPTS.includes(concept) || !TERMINOLOGY_FORMS.includes(form)) {
    throw new TypeError('Unknown terminology concept or form');
  }
  return getTerminology()[concept][form];
}

function valuesFromBody(body = {}) {
  return Object.fromEntries(TERMINOLOGY_CONCEPTS.map((concept) => [
    concept,
    Object.fromEntries(TERMINOLOGY_FORMS.map((form) => {
      const value = body[`${concept}_${form}`];
      return [form, typeof value === 'string' ? value.trim() : ''];
    })),
  ]));
}

function validateTerminology(values) {
  for (const concept of TERMINOLOGY_CONCEPTS) {
    for (const form of TERMINOLOGY_FORMS) {
      const value = values?.[concept]?.[form] || '';
      if (!value) return 'Tous les termes sont obligatoires.';
      if (value.length > MAX_TERMINOLOGY_LENGTH) {
        return `Chaque terme doit contenir au maximum ${MAX_TERMINOLOGY_LENGTH} caractères.`;
      }
      if (INVALID_PLAIN_TEXT.test(value)) {
        return 'Les termes doivent être du texte simple sur une seule ligne.';
      }
    }
  }
  return '';
}

function flattenedValues(values) {
  return TERMINOLOGY_CONCEPTS.flatMap((concept) => TERMINOLOGY_FORMS.map(
    (form) => values[concept][form],
  ));
}

async function saveTerminology(values, client = pool) {
  const error = validateTerminology(values);
  if (error) {
    const validationError = new Error(error);
    validationError.code = 'VALIDATION_ERROR';
    throw validationError;
  }
  const columns = TERMINOLOGY_CONCEPTS.flatMap((concept) => TERMINOLOGY_FORMS.map(
    (form) => `${concept}_${form}`,
  ));
  const assignments = columns.map((column) => `${column} = EXCLUDED.${column}`);
  const placeholders = columns.map((_column, index) => `$${index + 1}`);
  await client.query(
    `INSERT INTO application_terminology (id, ${columns.join(', ')})
     VALUES (1, ${placeholders.join(', ')})
     ON CONFLICT (id) DO UPDATE
     SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP`,
    flattenedValues(values),
  );
}

async function resetTerminology(client = pool) {
  await saveTerminology(copyDefaults(), client);
}

module.exports = {
  DEFAULT_TERMINOLOGY,
  MAX_TERMINOLOGY_LENGTH,
  TERMINOLOGY_CONCEPTS,
  getTerm,
  getTerminology,
  loadTerminology,
  resetTerminology,
  saveTerminology,
  validateTerminology,
  valuesFromBody,
};
