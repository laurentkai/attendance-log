const express = require('express');
const {
  DEFAULT_TERMINOLOGY,
  MAX_TERMINOLOGY_LENGTH,
  loadTerminology,
  resetTerminology,
  saveTerminology,
  validateTerminology,
  valuesFromBody,
} = require('./terminology');
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();

const fieldGroups = [
  ['student', 'Participant'],
  ['class', 'Activité'],
  ['session', 'Session'],
  ['attendance', 'Présence'],
  ['instructor', 'Responsable'],
  ['membership', 'Inscription'],
];

function renderTerminologyPage({ values, error = '', notice = '' }) {
  const notifications = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="alert alert-success" role="status">${escapeHtml(notice)}</p>`
      : '';
  const fields = fieldGroups.map(([concept, label]) => `
    <div class="border-bottom pb-3">
      <p class="mb-2 fw-semibold">${escapeHtml(label)}</p>
      <div class="row g-3">
        <div class="col-12 col-sm-6 form-field">
          <label for="${concept}_singular">Singulier</label>
          <input class="form-control" id="${concept}_singular" name="${concept}_singular" type="text" maxlength="${MAX_TERMINOLOGY_LENGTH}" value="${escapeHtml(values[concept].singular)}" required>
        </div>
        <div class="col-12 col-sm-6 form-field">
          <label for="${concept}_plural">Pluriel</label>
          <input class="form-control" id="${concept}_plural" name="${concept}_plural" type="text" maxlength="${MAX_TERMINOLOGY_LENGTH}" value="${escapeHtml(values[concept].plural)}" required>
        </div>
      </div>
    </div>`).join('');

  return renderPage('Terminologie', renderSettingsLayout({
    activeSection: 'terminology',
    title: 'Terminologie',
    description: 'Adaptez les principaux termes métier affichés dans Attendance Log.',
    notifications,
    content: `<section class="page-section" aria-labelledby="terminology-title">
      <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
        <div>
          <h2 id="terminology-title">Termes métier</h2>
          <p class="section-description">Les routes, données et fonctions internes ne sont pas renommées.</p>
        </div>
      </div>
      <form class="card card-body app-form" method="post" action="/settings/terminology">
        ${fields}
        <div class="form-actions d-flex flex-wrap gap-2">
          <button class="btn btn-primary" type="submit">Enregistrer</button>
        </div>
      </form>
    </section>
    <section class="page-section" aria-labelledby="terminology-reset-title">
      <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
        <div>
          <h2 id="terminology-reset-title">Termes par défaut</h2>
          <p class="section-description">Rétablissez la terminologie fournie avec Attendance Log.</p>
        </div>
      </div>
      <form class="card card-body app-form" method="post" action="/settings/terminology/reset" data-confirm="Réinitialiser tous les termes par défaut ?">
        <div class="form-actions d-flex flex-wrap gap-2">
          <button class="btn btn-outline-secondary" type="submit">Réinitialiser les termes par défaut</button>
        </div>
      </form>
    </section>`,
  }));
}

router.get('/', async (request, response) => {
  try {
    const values = await loadTerminology();
    const notices = {
      saved: 'La terminologie a été enregistrée.',
      reset: 'Les termes par défaut ont été rétablis.',
    };
    response.send(renderTerminologyPage({ values, notice: notices[request.query.notice] || '' }));
  } catch (error) {
    console.error('Unable to load terminology settings:', error.code || error.message);
    response.status(500).send(renderTerminologyPage({
      values: DEFAULT_TERMINOLOGY,
      error: 'Impossible de charger la terminologie pour le moment.',
    }));
  }
});

router.post('/', async (request, response) => {
  const values = valuesFromBody(request.body);
  const validationError = validateTerminology(values);
  if (validationError) {
    response.status(400).send(renderTerminologyPage({ values, error: validationError }));
    return;
  }
  try {
    await saveTerminology(values);
    response.redirect(303, '/settings/terminology?notice=saved');
  } catch (error) {
    console.error('Unable to save terminology settings:', error.code || error.message);
    response.status(500).send(renderTerminologyPage({
      values,
      error: 'Impossible d’enregistrer la terminologie pour le moment.',
    }));
  }
});

router.post('/reset', async (_request, response) => {
  try {
    await resetTerminology();
    response.redirect(303, '/settings/terminology?notice=reset');
  } catch (error) {
    console.error('Unable to reset terminology settings:', error.code || error.message);
    response.status(500).send(renderTerminologyPage({
      values: DEFAULT_TERMINOLOGY,
      error: 'Impossible de réinitialiser la terminologie pour le moment.',
    }));
  }
});

module.exports = router;
