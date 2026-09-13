const DEFAULT_APPLICATION_TIMEZONE = 'Europe/Brussels';
const DEFAULT_APPLICATION_LOCALE = 'fr-BE';
const SUPPORTED_APPLICATION_LOCALES = Object.freeze(['en-GB', 'en-US', 'fr-BE', 'fr-FR']);

let cachedTimezone;
let cachedLocale;

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch (_error) {
    return false;
  }
}

function getApplicationTimezone() {
  if (cachedTimezone) return cachedTimezone;
  const configured = (process.env.APP_TIMEZONE || process.env.BACKUP_TIMEZONE || DEFAULT_APPLICATION_TIMEZONE).trim();
  if (!isValidTimeZone(configured)) {
    throw Object.assign(new Error('APP_TIMEZONE must be a valid IANA timezone'), {
      code: 'INVALID_APPLICATION_TIMEZONE',
    });
  }
  cachedTimezone = configured;
  return cachedTimezone;
}

function isValidLocale(value) {
  if (typeof value !== 'string' || !SUPPORTED_APPLICATION_LOCALES.includes(value.trim())) return false;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([value.trim()]).length === 1;
  } catch (_error) {
    return false;
  }
}

function configureApplicationRegionalSettings({ locale, timezone }) {
  if (!isValidLocale(locale) || !isValidTimeZone(timezone)) {
    const error = new Error('Installation locale or timezone is invalid');
    error.code = 'INVALID_REGIONAL_SETTINGS';
    throw error;
  }
  cachedLocale = locale;
  cachedTimezone = timezone;
}

function getApplicationLocale() {
  return cachedLocale || DEFAULT_APPLICATION_LOCALE;
}

function validInstant(value) {
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function formatDate(value, options = {}) {
  const instant = validInstant(value);
  if (!instant) return '';
  return new Intl.DateTimeFormat(options.locale || getApplicationLocale(), {
    dateStyle: options.dateStyle || 'medium',
    timeZone: options.timeZone || getApplicationTimezone(),
  }).format(instant);
}

function formatDateTime(value, options = {}) {
  const instant = validInstant(value);
  if (!instant) return '';
  return new Intl.DateTimeFormat(options.locale || getApplicationLocale(), {
    dateStyle: options.dateStyle || 'medium',
    timeStyle: options.timeStyle || 'short',
    timeZone: options.timeZone || getApplicationTimezone(),
  }).format(instant);
}

function formatTime(value, options = {}) {
  const instant = validInstant(value);
  if (!instant) return '';
  return new Intl.DateTimeFormat(options.locale || getApplicationLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: options.hourCycle || 'h23',
    timeZone: options.timeZone || getApplicationTimezone(),
  }).format(instant);
}

function formatNumber(value, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const { locale = getApplicationLocale(), ...formatOptions } = options;
  return new Intl.NumberFormat(locale, formatOptions).format(value);
}

function formatPercent(value, options = {}) {
  return formatNumber(value, { style: 'percent', maximumFractionDigits: 1, ...options });
}

function getSpreadsheetDateFormats(locale = getApplicationLocale()) {
  return locale === 'en-US'
    ? { date: 'm/d/yyyy', dateTime: 'm/d/yyyy h:mm' }
    : { date: 'dd/mm/yyyy', dateTime: 'dd/mm/yyyy hh:mm' };
}

function formatLocalTime(value) {
  return formatTime(value);
}

function normalizeClockTime(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? `${match[1]}:${match[2]}` : '';
}

module.exports = {
  DEFAULT_APPLICATION_LOCALE,
  DEFAULT_APPLICATION_TIMEZONE,
  SUPPORTED_APPLICATION_LOCALES,
  configureApplicationRegionalSettings,
  formatDate,
  formatDateTime,
  formatLocalTime,
  formatNumber,
  formatPercent,
  formatTime,
  getApplicationLocale,
  getApplicationTimezone,
  getSpreadsheetDateFormats,
  isValidLocale,
  isValidTimeZone,
  normalizeClockTime,
};
