(() => {
  let messages = {};

  function translate(key, params = {}) {
    const message = typeof messages[key] === 'string' ? messages[key] : key;
    return message.replace(/\{([a-z][a-z0-9_]*)\}/gi, (_match, name) => (
      Object.hasOwn(params, name) ? String(params[name]) : `{${name}}`
    ));
  }

  function applyDocumentTranslations(language) {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = translate(element.dataset.i18n);
    });
    const titleKey = document.documentElement.dataset.i18nTitle;
    if (titleKey) document.title = `${translate(titleKey)} · Attendance Log`;
  }

  const documentLanguage = document.documentElement.lang === 'en' || document.documentElement.lang === 'fr'
    ? document.documentElement.lang
    : null;

  const browserLanguage = [...(navigator.languages || [navigator.language || 'en'])]
    .map((value) => String(value).toLowerCase().split('-')[0])
    .find((value) => value === 'en' || value === 'fr') || 'en';

  async function loadCatalog(language) {
    const response = await fetch(`/i18n/${language}.json`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('translation resource unavailable');
    messages = await response.json();
    return language;
  }

  const preferredLanguage = documentLanguage || browserLanguage;
  const ready = (async () => {
    try {
      return await loadCatalog(preferredLanguage);
    } catch (_error) {
      if (preferredLanguage !== 'en') return loadCatalog('en');
      throw _error;
    }
  })();

  window.AttendanceLogI18n = Object.freeze({ ready, t: translate });
  ready.then(applyDocumentTranslations).catch(() => {
    // Keep the server-rendered or static canonical text when resources are unavailable.
  });
})();
