const express = require('express');
const { recordAuditEvent } = require('./audit');
const { pool, withTransaction } = require('./db/client');
const {
  SUPPORTED_LOCALES,
  loadInternationalSettings,
  normalizeInternationalSettings,
  saveInternationalSettings,
  validateInternationalSettings,
} = require('./international-settings');
const { SUPPORTED_LANGUAGES, t } = require('./i18n');
const { configureApplicationRegionalSettings } = require('./application-time');
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();

function languageOptions(selected, language) {
  return SUPPORTED_LANGUAGES.map((value) => (
    `<option value="${value}"${selected === value ? ' selected' : ''}>${escapeHtml(t(language, `language.${value}`))}</option>`
  )).join('');
}

function localeOptions(selected) {
  return SUPPORTED_LOCALES.map((value) => (
    `<option value="${value}"${selected === value ? ' selected' : ''}>${value}</option>`
  )).join('');
}

function renderInternationalSettingsPage(request, {
  values = request.internationalization,
  error = '',
  notice = '',
} = {}) {
  const language = request.uiLanguage;
  const notification = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="alert alert-success" role="status">${escapeHtml(notice)}</p>`
      : '';
  const pageTitle = t(language, 'settings.international.title');
  const interfaceValue = request.currentUser.ui_language || '';
  const returnTarget = request.originalUrl || '/settings/internationalization';
  return renderPage(pageTitle, renderSettingsLayout({
    activeSection: 'internationalization',
    title: pageTitle,
    description: t(language, 'settings.international.description'),
    notifications: notification,
    content: `<section class="card card-body app-form" aria-labelledby="installation-language-title">
      <h2 class="h5" id="installation-language-title">${escapeHtml(t(language, 'settings.international.title'))}</h2>
      <form class="app-form" method="post" action="/settings/internationalization">
        <div class="form-field">
          <label for="default-language">${escapeHtml(t(language, 'settings.international.default_language'))}</label>
          <select class="form-select" id="default-language" name="default_language" required>${languageOptions(values.defaultLanguage, language)}</select>
        </div>
        <div class="form-field">
          <label for="installation-locale">${escapeHtml(t(language, 'settings.international.locale'))}</label>
          <select class="form-select" id="installation-locale" name="locale" required>${localeOptions(values.locale)}</select>
          <p class="form-text mb-0">${escapeHtml(t(language, 'settings.international.locale_help'))}</p>
        </div>
        <div class="form-field">
          <label for="installation-timezone">${escapeHtml(t(language, 'settings.international.timezone'))}</label>
          <input class="form-control" id="installation-timezone" name="timezone" type="text" value="${escapeHtml(values.timezone)}" maxlength="100" autocomplete="off" spellcheck="false" required>
          <p class="form-text mb-0">${escapeHtml(t(language, 'settings.international.timezone_help'))}</p>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'action.save'))}</button></div>
      </form>
    </section>
    <section class="card card-body app-form" aria-labelledby="interface-language-title">
      <h2 class="h5" id="interface-language-title">${escapeHtml(t(language, 'settings.interface_language'))}</h2>
      <p class="form-text">${escapeHtml(t(language, 'settings.interface_language_help'))}</p>
      <form class="app-form" method="post" action="/preferences/ui-language">
        <input name="return_to" type="hidden" value="${escapeHtml(returnTarget)}">
        <div class="form-field">
          <label for="interface-language">${escapeHtml(t(language, 'settings.interface_language'))}</label>
          <select class="form-select" id="interface-language" name="ui_language">
            <option value=""${interfaceValue ? '' : ' selected'}>${escapeHtml(t(language, 'language.automatic'))}</option>
            ${languageOptions(interfaceValue, language)}
          </select>
        </div>
        <div class="form-actions"><button class="btn btn-outline-primary" type="submit">${escapeHtml(t(language, 'action.save'))}</button></div>
      </form>
    </section>`,
  }), { language });
}

router.get('/', async (request, response) => {
  const notices = {
    saved: t(request.uiLanguage, 'settings.international.saved'),
  };
  response.send(renderInternationalSettingsPage(request, {
    notice: notices[request.query.notice] || '',
  }));
});

router.post('/', async (request, response) => {
  const values = normalizeInternationalSettings(request.body);
  if (!validateInternationalSettings(values)) {
    return response.status(400).send(renderInternationalSettingsPage(request, {
      values,
      error: t(request.uiLanguage, 'validation.invalid_settings'),
    }));
  }
  try {
    const saved = await withTransaction(pool, async (client) => {
      const before = await loadInternationalSettings(client, { forUpdate: true });
      const after = await saveInternationalSettings(values, client);
      await recordAuditEvent({
        client,
        category: 'internationalization',
        action: 'international.settings.update',
        summary: 'International and regional settings updated.',
        beforeData: {
          default_language: before.defaultLanguage,
          locale: before.locale,
          timezone: before.timezone,
        },
        afterData: {
          default_language: after.defaultLanguage,
          locale: after.locale,
          timezone: after.timezone,
        },
      });
      return after;
    });
    configureApplicationRegionalSettings(saved);
    return response.redirect(303, '/settings/internationalization?notice=saved');
  } catch (error) {
    console.error('Unable to save international settings:', error.code || error.message);
    return response.status(500).send(renderInternationalSettingsPage(request, {
      values,
      error: t(request.uiLanguage, 'settings.international.error'),
    }));
  }
});

module.exports = { renderInternationalSettingsPage, router };
