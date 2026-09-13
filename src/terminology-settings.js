const express = require('express');
const { recordAuditEvent } = require('./audit');
const { pool, withTransaction } = require('./db/client');
const {
  DEFAULT_TERMINOLOGY,
  MAX_TERMINOLOGY_LENGTH,
  TERMINOLOGY_CONCEPTS,
  loadTerminology,
  resetTerminology,
  saveTerminology,
  validateTerminology,
  valuesFromBody,
} = require('./terminology');
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');
const { SUPPORTED_LANGUAGES, t } = require('./i18n');

const router = express.Router();

function auditValues(language, values) {
  return {
    language,
    ...Object.fromEntries(TERMINOLOGY_CONCEPTS.flatMap((concept) => [
      [`${concept}_singular`, values[concept].singular],
      [`${concept}_plural`, values[concept].plural],
    ])),
  };
}

function renderTerminologyInput(values, terminologyLanguage, concept, form, uiLanguage) {
  const id = `${terminologyLanguage}_${concept}_${form}`;
  const label = t(uiLanguage, 'terminology.input_label', {
    concept: t(uiLanguage, `terminology.concept.${concept}`),
    language: t(uiLanguage, `language.${terminologyLanguage}`),
    form: t(uiLanguage, `terminology.${form}`),
  });
  return `<div class="terminology-field">
    <label class="form-label mb-0" for="${id}"><span aria-hidden="true">${escapeHtml(t(uiLanguage, `terminology.${form}`))}</span><span class="visually-hidden">${escapeHtml(label)}</span></label>
    <input class="form-control form-control-sm" id="${id}" name="${id}" type="text" maxlength="${MAX_TERMINOLOGY_LENGTH}" value="${escapeHtml(values[terminologyLanguage][concept][form])}" autocomplete="off" required>
  </div>`;
}

function renderLanguageRow(values, terminologyLanguage, concept, uiLanguage) {
  return `<div class="terminology-language-row" data-terminology-language="${terminologyLanguage}">
    <p class="terminology-language-label">${escapeHtml(t(uiLanguage, `language.${terminologyLanguage}`))}</p>
    ${renderTerminologyInput(values, terminologyLanguage, concept, 'singular', uiLanguage)}
    ${renderTerminologyInput(values, terminologyLanguage, concept, 'plural', uiLanguage)}
  </div>`;
}

function renderTerminologyConcepts(values, uiLanguage) {
  return `<div class="terminology-concepts">
    ${TERMINOLOGY_CONCEPTS.map((concept) => `<section class="card terminology-concept" aria-labelledby="terminology-${concept}-title">
      <h2 class="terminology-concept-title" id="terminology-${concept}-title">${escapeHtml(t(uiLanguage, `terminology.concept.${concept}`))}</h2>
      ${renderLanguageRow(values, 'en', concept, uiLanguage)}
      ${renderLanguageRow(values, 'fr', concept, uiLanguage)}
    </section>`).join('')}
  </div>`;
}

function renderTerminologyPage({ values, error = '', notice = '', language }) {
  const notifications = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : notice ? `<p class="alert alert-success" role="status">${escapeHtml(notice)}</p>` : '';
  return renderPage(t(language, 'terminology.title'), renderSettingsLayout({
    activeSection: 'terminology',
    title: t(language, 'terminology.title'),
    description: t(language, 'terminology.description'),
    notifications,
    content: `<section class="page-section" aria-label="${escapeHtml(t(language, 'terminology.business_terms'))}">
      <form class="d-grid gap-3" method="post" action="/settings/terminology">
        <p class="section-description mb-0">${escapeHtml(t(language, 'terminology.internal_unchanged'))}</p>
        ${renderTerminologyConcepts(values, language)}
        <div class="form-actions d-flex flex-wrap gap-2">
          <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'action.save'))}</button>
        </div>
      </form>
    </section>
    <section class="page-section" aria-labelledby="terminology-reset-title">
      <div class="section-header"><div>
        <h2 id="terminology-reset-title">${escapeHtml(t(language, 'terminology.defaults'))}</h2>
        <p class="section-description">${escapeHtml(t(language, 'terminology.defaults_help'))}</p>
      </div></div>
      <form class="card card-body app-form" method="post" action="/settings/terminology/reset" data-confirm="${escapeHtml(t(language, 'terminology.reset_confirm'))}">
        <div class="form-actions d-flex flex-wrap gap-2">
          <button class="btn btn-outline-secondary" type="submit">${escapeHtml(t(language, 'terminology.reset'))}</button>
        </div>
      </form>
    </section>`,
  }, language), { language });
}

router.get('/', async (request, response) => {
  try {
    const values = await loadTerminology();
    const notices = {
      saved: t(request.uiLanguage, 'terminology.notice.saved'),
      reset: t(request.uiLanguage, 'terminology.notice.reset'),
    };
    response.send(renderTerminologyPage({ values, notice: notices[request.query.notice] || '', language: request.uiLanguage }));
  } catch (error) {
    console.error('Unable to load terminology settings:', error.code || error.message);
    response.status(500).send(renderTerminologyPage({
      values: DEFAULT_TERMINOLOGY,
      error: t(request.uiLanguage, 'terminology.error.load'), language: request.uiLanguage,
    }));
  }
});

router.post('/', async (request, response) => {
  let values;
  try {
    values = Object.fromEntries(SUPPORTED_LANGUAGES.map((terminologyLanguage) => [
      terminologyLanguage,
      valuesFromBody(request.body, terminologyLanguage),
    ]));
  } catch {
    response.status(400).send(renderTerminologyPage({
      values: DEFAULT_TERMINOLOGY,
      error: t(request.uiLanguage, 'terminology.validation.required'), language: request.uiLanguage,
    }));
    return;
  }
  const validationError = SUPPORTED_LANGUAGES.map(
    (terminologyLanguage) => validateTerminology(values[terminologyLanguage], request.uiLanguage),
  ).find(Boolean);
  if (validationError) {
    response.status(400).send(renderTerminologyPage({ values, error: validationError, language: request.uiLanguage }));
    return;
  }
  try {
    await withTransaction(pool, async (client) => {
      const before = await loadTerminology(client);
      for (const terminologyLanguage of SUPPORTED_LANGUAGES) {
        await saveTerminology(terminologyLanguage, values[terminologyLanguage], client, request.uiLanguage);
        await recordAuditEvent({
          client, category: 'terminology', action: 'terminology.update',
          summary: 'Localized application terminology updated.',
          beforeData: auditValues(terminologyLanguage, before[terminologyLanguage]),
          afterData: auditValues(terminologyLanguage, values[terminologyLanguage]),
        });
      }
    });
    response.redirect(303, '/settings/terminology?notice=saved');
  } catch (error) {
    console.error('Unable to save terminology settings:', error.code || error.message);
    response.status(500).send(renderTerminologyPage({
      values, error: t(request.uiLanguage, 'terminology.error.save'), language: request.uiLanguage,
    }));
  }
});

router.post('/reset', async (request, response) => {
  try {
    await withTransaction(pool, async (client) => {
      const before = await loadTerminology(client);
      for (const terminologyLanguage of SUPPORTED_LANGUAGES) {
        await resetTerminology(terminologyLanguage, client);
        await recordAuditEvent({
          client, category: 'terminology', action: 'terminology.reset',
          summary: 'Localized application terminology reset.',
          beforeData: auditValues(terminologyLanguage, before[terminologyLanguage]),
          afterData: auditValues(terminologyLanguage, DEFAULT_TERMINOLOGY[terminologyLanguage]),
        });
      }
    });
    response.redirect(303, '/settings/terminology?notice=reset');
  } catch (error) {
    console.error('Unable to reset terminology settings:', error.code || error.message);
    response.status(500).send(renderTerminologyPage({
      values: DEFAULT_TERMINOLOGY,
      error: t(request.uiLanguage, 'terminology.error.reset'), language: request.uiLanguage,
    }));
  }
});

router.renderTerminologyPage = renderTerminologyPage;
module.exports = router;
