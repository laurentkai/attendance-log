const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_APPLICATION_LOCALE,
  SUPPORTED_APPLICATION_LOCALES,
  configureApplicationRegionalSettings,
  formatDateTime,
  formatNumber,
  formatPercent,
  getApplicationLocale,
  getApplicationTimezone,
  isValidLocale,
  isValidTimeZone,
} = require('../src/application-time');

test('locale and timezone validation is bounded to supported locales and valid IANA zones', () => {
  assert.deepEqual(SUPPORTED_APPLICATION_LOCALES, ['en-GB', 'en-US', 'fr-BE', 'fr-FR']);
  assert.equal(isValidLocale('fr-BE'), true);
  assert.equal(isValidLocale('de-DE'), false);
  assert.equal(isValidTimeZone('Europe/Brussels'), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
});

test('regional configuration keeps locale and timezone independent', () => {
  configureApplicationRegionalSettings({ locale: 'en-GB', timezone: 'Europe/Brussels' });
  assert.equal(getApplicationLocale(), 'en-GB');
  assert.equal(getApplicationTimezone(), 'Europe/Brussels');
  configureApplicationRegionalSettings({ locale: DEFAULT_APPLICATION_LOCALE, timezone: 'Europe/Brussels' });
});

test('known absolute instant formats in configured locale and timezone without mutation', () => {
  const instant = new Date('2026-09-11T19:05:40Z');
  const original = instant.toISOString();
  const belgianFrench = formatDateTime(instant, { locale: 'fr-BE', timeZone: 'Europe/Brussels' });
  const britishEnglish = formatDateTime(instant, { locale: 'en-GB', timeZone: 'Europe/Brussels' });
  const americanEnglish = formatDateTime(instant, { locale: 'en-US', timeZone: 'America/New_York' });
  assert.match(belgianFrench, /11/);
  assert.match(belgianFrench, /21[\s:]?05/);
  assert.match(britishEnglish, /11/);
  assert.match(britishEnglish, /21[\s:]?05/);
  assert.match(americanEnglish, /3[\s:]?05|15[\s:]?05/i);
  assert.equal(instant.toISOString(), original);
});

test('central number and percentage formatting does not depend on process locale', () => {
  assert.match(formatNumber(1234.5, { locale: 'en-US' }), /1,234\.5/);
  assert.match(formatNumber(1234.5, { locale: 'fr-BE' }), /1[\s\u00a0\u202f.]234,5/);
  assert.match(formatPercent(0.875, { locale: 'en-GB' }), /87\.5%/);
});
