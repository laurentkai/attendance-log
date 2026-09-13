const { pool } = require('./db/client');
const {
  SUPPORTED_APPLICATION_LOCALES,
  configureApplicationRegionalSettings,
  isValidLocale,
  isValidTimeZone,
} = require('./application-time');
const { DEFAULT_LANGUAGE, isSupportedLanguage } = require('./i18n');

const SUPPORTED_LOCALES = SUPPORTED_APPLICATION_LOCALES;
const LEGACY_LOCALE = 'fr-BE';
const MAX_TIMEZONE_LENGTH = 100;

function isSupportedLocale(value) {
  return isValidLocale(value);
}

function normalizeInternationalSettings(values = {}) {
  return {
    defaultLanguage: typeof values.default_language === 'string'
      ? values.default_language.trim().toLowerCase() : '',
    locale: typeof values.locale === 'string' ? values.locale.trim() : '',
    timezone: typeof values.timezone === 'string' ? values.timezone.trim() : '',
  };
}

function validateInternationalSettings(values) {
  return Boolean(
    isSupportedLanguage(values?.defaultLanguage)
      && isSupportedLocale(values?.locale)
      && typeof values?.timezone === 'string'
      && values.timezone.length > 0
      && values.timezone.length <= MAX_TIMEZONE_LENGTH
      && isValidTimeZone(values.timezone),
  );
}

function settingsFromRow(row = {}) {
  const settings = {
    defaultLanguage: isSupportedLanguage(row.default_language)
      ? row.default_language.toLowerCase() : DEFAULT_LANGUAGE,
    locale: isSupportedLocale(row.locale) ? row.locale : LEGACY_LOCALE,
    timezone: row.timezone,
  };
  if (!validateInternationalSettings(settings)) {
    const error = new Error('Stored international settings are invalid');
    error.code = 'INTERNATIONAL_SETTINGS_INVALID';
    throw error;
  }
  return settings;
}

async function loadInternationalSettings(client = pool, { forUpdate = false } = {}) {
  const result = await client.query(
    `SELECT default_language, locale, timezone FROM international_settings WHERE id = 1${forUpdate ? ' FOR UPDATE' : ''}`,
  );
  if (result.rowCount !== 1) {
    const error = new Error('International settings are missing');
    error.code = 'INTERNATIONAL_SETTINGS_MISSING';
    throw error;
  }
  return settingsFromRow(result.rows[0]);
}

async function saveInternationalSettings(values, client = pool) {
  if (!validateInternationalSettings(values)) {
    const error = new Error('International settings are invalid');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const result = await client.query(
    `UPDATE international_settings
     SET default_language = $1, locale = $2, timezone = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1
     RETURNING default_language, locale, timezone`,
    [values.defaultLanguage, values.locale, values.timezone],
  );
  if (result.rowCount !== 1) {
    const error = new Error('International settings are missing');
    error.code = 'INTERNATIONAL_SETTINGS_MISSING';
    throw error;
  }
  return settingsFromRow(result.rows[0]);
}

async function initializeInternationalSettings(client = pool) {
  const settings = await loadInternationalSettings(client);
  configureApplicationRegionalSettings(settings);
  return settings;
}

module.exports = {
  LEGACY_LOCALE,
  MAX_TIMEZONE_LENGTH,
  SUPPORTED_LOCALES,
  initializeInternationalSettings,
  isSupportedLocale,
  loadInternationalSettings,
  normalizeInternationalSettings,
  saveInternationalSettings,
  settingsFromRow,
  validateInternationalSettings,
};
