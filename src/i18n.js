const EN_TRANSLATIONS = require('./i18n/en');
const FR_TRANSLATIONS = require('./i18n/fr');

const SUPPORTED_LANGUAGES = Object.freeze(['en', 'fr']);
const DEFAULT_LANGUAGE = 'en';

const TRANSLATIONS = Object.freeze({
  en: EN_TRANSLATIONS,
  fr: FR_TRANSLATIONS,
});

function isSupportedLanguage(value) {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value.trim().toLowerCase());
}

function normalizeLanguage(value) {
  if (typeof value !== 'string') return null;
  const base = value.trim().toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.includes(base) ? base : null;
}

function normalizeLanguageOverride(value) {
  if (value === null || value === undefined || value === '') return null;
  return isSupportedLanguage(value) ? value.trim().toLowerCase() : undefined;
}

function languageFromAcceptLanguage(header) {
  if (typeof header !== 'string' || !header.trim()) return DEFAULT_LANGUAGE;
  const preferences = header.split(',').map((part, index) => {
    const [tag, ...parameters] = part.trim().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const match = parameter.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
      if (match) quality = Number(match[1]);
    }
    return { language: tag === '*' ? null : normalizeLanguage(tag), quality, index };
  }).filter((entry) => entry.language && entry.quality > 0);
  preferences.sort((left, right) => right.quality - left.quality || left.index - right.index);
  return preferences[0]?.language || DEFAULT_LANGUAGE;
}

function resolveUiLanguage(savedPreference, acceptLanguage = '') {
  return isSupportedLanguage(savedPreference)
    ? savedPreference.trim().toLowerCase()
    : languageFromAcceptLanguage(acceptLanguage);
}

function canonicalLanguage(value) {
  return normalizeLanguage(value) || DEFAULT_LANGUAGE;
}

function interpolate(message, params = {}) {
  return message.replace(/\{([a-z][a-z0-9_]*)\}/gi, (_match, name) => {
    if (!Object.hasOwn(params, name)) {
      const error = new Error(`Missing translation parameter: ${name}`);
      error.code = 'I18N_MISSING_PARAMETER';
      throw error;
    }
    return String(params[name]);
  });
}

function translateFromCatalogs(catalogs, language, key, params = {}) {
  const canonical = catalogs?.[DEFAULT_LANGUAGE];
  if (!canonical || typeof canonical[key] !== 'string') {
    const error = new Error(`Missing canonical English translation: ${key}`);
    error.code = 'I18N_MISSING_CANONICAL_KEY';
    throw error;
  }
  const requested = catalogs[canonicalLanguage(language)];
  const message = typeof requested?.[key] === 'string' ? requested[key] : canonical[key];
  return interpolate(message, params);
}

function t(language, key, params = {}) {
  return translateFromCatalogs(TRANSLATIONS, language, key, params);
}

function resolveClassLanguage({ classLanguage = null, defaultLanguage = DEFAULT_LANGUAGE } = {}) {
  return canonicalLanguage(normalizeLanguage(classLanguage) || defaultLanguage);
}

function resolveSessionLanguage({ sessionLanguage = null, classLanguage = null, defaultLanguage = DEFAULT_LANGUAGE } = {}) {
  return canonicalLanguage(normalizeLanguage(sessionLanguage) || normalizeLanguage(classLanguage) || defaultLanguage);
}

function resolveParticipantLanguage({ participantLanguage = null, sessionLanguage = null, classLanguage = null, defaultLanguage = DEFAULT_LANGUAGE } = {}) {
  return canonicalLanguage(
    normalizeLanguage(participantLanguage)
      || normalizeLanguage(sessionLanguage)
      || normalizeLanguage(classLanguage)
      || defaultLanguage,
  );
}

function resolveGlobalReportLanguage({ defaultLanguage = DEFAULT_LANGUAGE } = {}) {
  return canonicalLanguage(defaultLanguage);
}

const resolveClassReportLanguage = resolveClassLanguage;
const resolveSessionReportLanguage = resolveSessionLanguage;
const resolveParticipantReportLanguage = resolveParticipantLanguage;
const resolveSessionSummaryLanguage = resolveSessionLanguage;
const resolveParticipantCommunicationLanguage = resolveParticipantLanguage;

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  TRANSLATIONS,
  isSupportedLanguage,
  languageFromAcceptLanguage,
  normalizeLanguage,
  normalizeLanguageOverride,
  resolveClassLanguage,
  resolveClassReportLanguage,
  resolveGlobalReportLanguage,
  resolveParticipantCommunicationLanguage,
  resolveParticipantLanguage,
  resolveParticipantReportLanguage,
  resolveSessionLanguage,
  resolveSessionReportLanguage,
  resolveSessionSummaryLanguage,
  resolveUiLanguage,
  t,
  translateFromCatalogs,
};
