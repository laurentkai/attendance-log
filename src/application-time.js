const DEFAULT_APPLICATION_TIMEZONE = 'Europe/Brussels';

let cachedTimezone;

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

function formatLocalTime(value) {
  if (!value) return '';
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: getApplicationTimezone(),
  }).format(instant);
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
  DEFAULT_APPLICATION_TIMEZONE,
  formatLocalTime,
  getApplicationTimezone,
  isValidTimeZone,
  normalizeClockTime,
};
