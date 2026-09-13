const { pool } = require('./db/client');
const { getCurrentRequest } = require('./request-context');
const {
  DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isSupportedLanguage, normalizeLanguage, t,
} = require('./i18n');

const TERMINOLOGY_CONCEPTS = Object.freeze([
  'student', 'class', 'session', 'attendance', 'instructor', 'membership',
]);
const TERMINOLOGY_FORMS = Object.freeze(['singular', 'plural']);
const MAX_TERMINOLOGY_LENGTH = 40;
const INVALID_PLAIN_TEXT = /[\u0000-\u001f\u007f]/;

const DEFAULT_TERMINOLOGY = Object.freeze({
  en: Object.freeze({
    student: Object.freeze({ singular: 'Student', plural: 'Students' }),
    class: Object.freeze({ singular: 'Class', plural: 'Classes' }),
    session: Object.freeze({ singular: 'Session', plural: 'Sessions' }),
    attendance: Object.freeze({ singular: 'Attendance', plural: 'Attendance' }),
    instructor: Object.freeze({ singular: 'Instructor', plural: 'Instructors' }),
    membership: Object.freeze({ singular: 'Registration', plural: 'Registrations' }),
  }),
  fr: Object.freeze({
    student: Object.freeze({ singular: 'Participant', plural: 'Participants' }),
    class: Object.freeze({ singular: 'Activité', plural: 'Activités' }),
    session: Object.freeze({ singular: 'Session', plural: 'Sessions' }),
    attendance: Object.freeze({ singular: 'Présence', plural: 'Présences' }),
    instructor: Object.freeze({ singular: 'Responsable', plural: 'Responsables' }),
    membership: Object.freeze({ singular: 'Inscription', plural: 'Inscriptions' }),
  }),
});

function copyTerminology(values = DEFAULT_TERMINOLOGY) {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map((language) => [
    language,
    Object.fromEntries(TERMINOLOGY_CONCEPTS.map((concept) => [
      concept,
      { ...values[language][concept] },
    ])),
  ]));
}

function terminologyFromRow(row, language) {
  return Object.fromEntries(TERMINOLOGY_CONCEPTS.map((concept) => [
    concept,
    Object.fromEntries(TERMINOLOGY_FORMS.map((form) => [
      form,
      row[`${concept}_${form}`],
    ])),
  ]));
}

async function loadTerminology(client = pool) {
  const result = await client.query('SELECT * FROM application_terminology ORDER BY language');
  const values = {};
  for (const row of result.rows) {
    if (isSupportedLanguage(row.language)) {
      const language = normalizeLanguage(row.language);
      values[language] = terminologyFromRow(row, language);
    }
  }
  if (!SUPPORTED_LANGUAGES.every((language) => values[language])) {
    const error = new Error('Localized application terminology is incomplete.');
    error.code = 'TERMINOLOGY_INCOMPLETE';
    throw error;
  }
  return values;
}

function resolveTerminologyLanguage(language) {
  return normalizeLanguage(language) || DEFAULT_LANGUAGE;
}

function getTerminology(terminology, language) {
  const resolvedLanguage = resolveTerminologyLanguage(language);
  const values = terminology || DEFAULT_TERMINOLOGY;
  const selected = values[resolvedLanguage] || values[DEFAULT_LANGUAGE];
  if (!selected) {
    const error = new Error('Canonical English terminology is missing.');
    error.code = 'TERMINOLOGY_MISSING_CANONICAL';
    throw error;
  }
  return selected;
}

function getTerm(language, concept, form = 'singular', terminology = getCurrentRequest()?.terminology) {
  if (!TERMINOLOGY_CONCEPTS.includes(concept) || !TERMINOLOGY_FORMS.includes(form)) {
    throw new TypeError('Unknown terminology concept or form');
  }
  const resolvedLanguage = resolveTerminologyLanguage(language);
  const values = terminology || DEFAULT_TERMINOLOGY;
  const requestedValue = getTerminology(values, resolvedLanguage)?.[concept]?.[form];
  if (typeof requestedValue === 'string' && requestedValue.length > 0) return requestedValue;
  const canonicalValue = values[DEFAULT_LANGUAGE]?.[concept]?.[form];
  if (typeof canonicalValue !== 'string' || canonicalValue.length === 0) {
    const error = new Error(`Missing canonical terminology: ${concept}.${form}`);
    error.code = 'TERMINOLOGY_MISSING_VALUE';
    throw error;
  }
  return canonicalValue;
}

function valuesFromBody(body = {}, language) {
  if (!isSupportedLanguage(language)) throw new TypeError('A supported terminology language is required');
  return Object.fromEntries(TERMINOLOGY_CONCEPTS.map((concept) => [
    concept,
    Object.fromEntries(TERMINOLOGY_FORMS.map((form) => {
      const value = body[`${language}_${concept}_${form}`];
      return [form, typeof value === 'string' ? value.trim() : ''];
    })),
  ]));
}

function validateTerminology(values, uiLanguage = DEFAULT_LANGUAGE) {
  for (const concept of TERMINOLOGY_CONCEPTS) {
    for (const form of TERMINOLOGY_FORMS) {
      const value = values?.[concept]?.[form] || '';
      if (!value) return t(uiLanguage, 'terminology.validation.required');
      if (value.length > MAX_TERMINOLOGY_LENGTH) {
        return t(uiLanguage, 'terminology.validation.length', { length: MAX_TERMINOLOGY_LENGTH });
      }
      if (INVALID_PLAIN_TEXT.test(value)) return t(uiLanguage, 'terminology.validation.plain');
    }
  }
  return '';
}

function flattenedValues(values) {
  return TERMINOLOGY_CONCEPTS.flatMap((concept) => TERMINOLOGY_FORMS.map(
    (form) => values[concept][form],
  ));
}

async function saveTerminology(language, values, client = pool, uiLanguage = DEFAULT_LANGUAGE) {
  if (!isSupportedLanguage(language)) {
    const error = new Error('Unsupported terminology language');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const normalizedLanguage = normalizeLanguage(language);
  const validationError = validateTerminology(values, uiLanguage);
  if (validationError) {
    const error = new Error(validationError);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const columns = TERMINOLOGY_CONCEPTS.flatMap((concept) => TERMINOLOGY_FORMS.map(
    (form) => `${concept}_${form}`,
  ));
  const assignments = columns.map((column) => `${column} = EXCLUDED.${column}`);
  const placeholders = columns.map((_column, index) => `$${index + 2}`);
  await client.query(
    `INSERT INTO application_terminology (language, ${columns.join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     ON CONFLICT (language) DO UPDATE
     SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP`,
    [normalizedLanguage, ...flattenedValues(values)],
  );
}

async function resetTerminology(language, client = pool) {
  const normalizedLanguage = resolveTerminologyLanguage(language);
  await saveTerminology(normalizedLanguage, copyTerminology()[normalizedLanguage], client);
}

module.exports = {
  DEFAULT_TERMINOLOGY,
  MAX_TERMINOLOGY_LENGTH,
  TERMINOLOGY_CONCEPTS,
  TERMINOLOGY_FORMS,
  copyTerminology,
  getTerm,
  getTerminology,
  loadTerminology,
  resetTerminology,
  saveTerminology,
  validateTerminology,
  valuesFromBody,
};
