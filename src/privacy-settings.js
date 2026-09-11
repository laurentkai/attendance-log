const express = require('express');
const { getApplicationTimezone } = require('./application-time');
const { recordAuditEvent } = require('./audit');
const {
  RETENTION_MONTH_OPTIONS,
  getRetentionEligibilityPreview,
  loadRetentionConfiguration,
  normalizeRetentionMonths,
  saveRetentionConfiguration,
} = require('./data-retention');
const { pool, withTransaction } = require('./db/client');
const { getTerm } = require('./terminology');
const { businessTerm, escapeHtml, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-BE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: getApplicationTimezone(),
  }).format(new Date(value));
}

function formatInactivity(participant) {
  if (participant.inactivity_days === null) return '—';
  const suffix = participant.last_activity_at ? '' : ' depuis la création';
  if (participant.inactivity_months < 1) {
    return `${participant.inactivity_days} jour${participant.inactivity_days === 1 ? '' : 's'}${suffix}`;
  }
  return `${participant.inactivity_months} mois${suffix}`;
}

function retentionOptions(selected) {
  return [
    `<option value="never"${selected === null ? ' selected' : ''}>Jamais</option>`,
    ...RETENTION_MONTH_OPTIONS.map((months) => `<option value="${months}"${selected === months ? ' selected' : ''}>${months} mois</option>`),
  ].join('');
}

function queryFor({ filter, search, page = null }) {
  const params = new URLSearchParams();
  if (filter && filter !== 'all') params.set('eligibility', filter);
  if (search) params.set('q', search);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

function renderSummary(summary) {
  const items = [
    ['Total', summary.total],
    ['Inactifs', summary.inactive],
    ['Éligibles', summary.eligible],
    ['Inscription active', summary.blockedByActiveMembership],
    ['Activité récente', summary.blockedByRecentActivity],
    ['Date insuffisante', summary.blockedByInsufficientDate],
    ['Rétention désactivée', summary.blockedByDisabledPolicy],
  ];
  return `<div class="row g-2" aria-label="Synthèse de l’éligibilité">${items.map(([label, value]) => `<div class="col-6 col-md-4"><div class="border rounded bg-body px-3 py-2 h-100"><span class="d-block small text-body-secondary">${escapeHtml(label)}</span><strong class="fs-5 font-monospace">${value}</strong></div></div>`).join('')}</div>`;
}

function renderRows(participants) {
  if (participants.length === 0) {
    return `<tr><td class="text-center text-body-secondary py-4" colspan="7">Aucun ${businessTerm('student').toLocaleLowerCase('fr')} ne correspond aux critères.</td></tr>`;
  }
  return participants.map((participant) => {
    const name = `${participant.first_name} ${participant.last_name}`;
    return `<tr>
      <td><span class="fw-semibold">${escapeHtml(name)}</span> <span class="text-body-secondary text-nowrap">· <span class="student-code" translate="no">${escapeHtml(participant.student_code)}</span></span></td>
      <td><span class="badge status-badge status-${participant.active ? 'active' : 'inactive'}">${participant.active ? 'Actif' : 'Inactif'}</span></td>
      <td class="text-nowrap">${participant.last_activity_at ? escapeHtml(formatDateTime(participant.last_activity_at)) : '—'}</td>
      <td class="numeric">${participant.active_memberships}</td>
      <td>${escapeHtml(formatInactivity(participant))}</td>
      <td><span class="fw-semibold ${participant.eligible ? 'text-success' : 'text-body-secondary'}">${participant.eligible ? 'Éligible' : 'Non éligible'}</span></td>
      <td>${escapeHtml(participant.reasons.join(' · '))}</td>
    </tr>`;
  }).join('');
}

function renderPrivacyPage(preview, { error = '', notice = '' } = {}) {
  const notifications = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="alert alert-success" role="status">${escapeHtml(notice)}</p>`
      : '';
  const previous = preview.page > 1
    ? `<a class="btn btn-sm btn-light" href="${escapeHtml(queryFor({ ...preview, page: preview.page - 1 }))}">Précédent</a>`
    : '<span></span>';
  const next = preview.page < preview.totalPages
    ? `<a class="btn btn-sm btn-light" href="${escapeHtml(queryFor({ ...preview, page: preview.page + 1 }))}">Suivant</a>`
    : '<span></span>';
  const pagination = preview.totalPages > 1
    ? `<nav class="d-flex align-items-center justify-content-between gap-3 px-2 py-2" aria-label="Pagination des participants">${previous}<span class="small text-body-secondary">Page ${preview.page} sur ${preview.totalPages}</span>${next}</nav>`
    : `<p class="small text-body-secondary px-2 py-2 mb-0">${preview.totalFiltered} résultat${preview.totalFiltered === 1 ? '' : 's'}</p>`;
  const participantTerm = getTerm('student').toLocaleLowerCase('fr');

  return renderPage('Protection des données', renderSettingsLayout({
    activeSection: 'privacy',
    title: 'Protection des données',
    description: 'Prévisualisez les participants inactifs qui pourraient être anonymisés selon la politique de rétention.',
    notifications,
    content: `<section class="page-section" aria-labelledby="retention-policy-title">
      <div class="section-header">
        <div>
          <h2 id="retention-policy-title">Politique de rétention</h2>
          <p class="section-description">Cette phase identifie uniquement les candidats. Aucune donnée personnelle n’est modifiée ou supprimée.</p>
        </div>
      </div>
      <form class="card card-body app-form" method="post" action="/settings/privacy/retention">
        <div class="form-field">
          <label for="retention-months">Anonymiser les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')} inactifs après</label>
          <select class="form-select" id="retention-months" name="retention_months" required>${retentionOptions(preview.configuration.retentionMonths)}</select>
          <p class="form-text">« Jamais » désactive l’éligibilité et conserve le comportement actuel.</p>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer la politique</button></div>
      </form>
    </section>
    <section class="page-section" aria-labelledby="retention-preview-title">
      <div class="section-header">
        <div>
          <h2 id="retention-preview-title">Aperçu d’éligibilité</h2>
          <p class="section-description">Un ${escapeHtml(participantTerm)} actif ou avec une inscription active reste toujours exclu.</p>
        </div>
      </div>
      ${renderSummary(preview.summary)}
      <form class="search" method="get" action="/settings/privacy" role="search">
        ${preview.filter !== 'all' ? `<input name="eligibility" type="hidden" value="${escapeHtml(preview.filter)}">` : ''}
        <label for="privacy-search">Rechercher un ${escapeHtml(participantTerm)}</label>
        <div class="search-controls">
          <input class="form-control" id="privacy-search" name="q" type="search" value="${escapeHtml(preview.search)}" autocomplete="off" spellcheck="false" placeholder="Nom, e-mail ou code…">
          <button class="btn btn-primary" type="submit">Rechercher</button>
          ${preview.search ? `<a class="btn btn-outline-secondary" href="/settings/privacy${escapeHtml(queryFor({ filter: preview.filter, search: '' }))}">Effacer</a>` : ''}
        </div>
      </form>
      <nav class="nav nav-pills view-switch" aria-label="Filtrer par éligibilité">
        <a class="nav-link${preview.filter === 'all' ? ' active' : ''}" href="/settings/privacy${escapeHtml(queryFor({ filter: 'all', search: preview.search }))}"${preview.filter === 'all' ? ' aria-current="page"' : ''}>Tous</a>
        <a class="nav-link${preview.filter === 'eligible' ? ' active' : ''}" href="/settings/privacy${escapeHtml(queryFor({ filter: 'eligible', search: preview.search }))}"${preview.filter === 'eligible' ? ' aria-current="page"' : ''}>Éligibles</a>
        <a class="nav-link${preview.filter === 'ineligible' ? ' active' : ''}" href="/settings/privacy${escapeHtml(queryFor({ filter: 'ineligible', search: preview.search }))}"${preview.filter === 'ineligible' ? ' aria-current="page"' : ''}>Non éligibles</a>
      </nav>
      <div class="table-responsive data-table-scroll" tabindex="0" role="region" aria-label="Aperçu de l’éligibilité des participants">
        <table class="table table-sm table-hover align-middle mb-0 data-table">
          <thead><tr><th scope="col">${businessTerm('student')}</th><th scope="col">Statut</th><th scope="col">Dernière activité</th><th class="numeric" scope="col">Inscriptions actives</th><th scope="col">Inactivité</th><th scope="col">Éligibilité</th><th scope="col">Motif</th></tr></thead>
          <tbody>${renderRows(preview.participants)}</tbody>
        </table>
      </div>
      ${pagination}
    </section>`,
  }));
}

async function sendPrivacyPage(request, response, feedback = {}, status = 200) {
  const preview = await getRetentionEligibilityPreview({
    filter: request.query.eligibility,
    search: request.query.q,
    page: request.query.page,
  });
  response.set('Cache-Control', 'private, no-store');
  response.status(status).send(renderPrivacyPage(preview, feedback));
}

router.get('/', async (request, response) => {
  const notices = { saved: 'La politique de rétention a été enregistrée.' };
  try {
    await sendPrivacyPage(request, response, { notice: notices[request.query.notice] || '' });
  } catch (error) {
    console.error('Unable to load data protection settings:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderPage('Protection des données', renderSettingsLayout({
      activeSection: 'privacy',
      title: 'Protection des données',
      notifications: '<p class="alert alert-danger" role="alert">Impossible de charger l’aperçu de rétention pour le moment.</p>',
    })));
  }
});

router.post('/retention', async (request, response) => {
  const retentionMonths = normalizeRetentionMonths(request.body.retention_months);
  if (retentionMonths === undefined) {
    try {
      await sendPrivacyPage(request, response, { error: 'Choisissez une durée de rétention valide.' }, 400);
    } catch (error) {
      console.error('Unable to render invalid retention policy:', error.code || 'DATABASE_ERROR');
      response.status(400).send('Politique de rétention invalide.');
    }
    return;
  }

  try {
    await withTransaction(pool, async (client) => {
      const before = await loadRetentionConfiguration(client, { forUpdate: true });
      await saveRetentionConfiguration(client, retentionMonths);
      if (before.retentionMonths !== retentionMonths) {
        await recordAuditEvent({
          client,
          category: 'privacy',
          action: 'privacy.retention.update',
          summary: 'Politique de rétention des participants mise à jour.',
          beforeData: { retention_months: before.retentionMonths },
          afterData: { retention_months: retentionMonths },
        });
      }
    });
    response.redirect(303, '/settings/privacy?notice=saved');
  } catch (error) {
    console.error('Unable to save retention policy:', error.code || 'DATABASE_ERROR');
    try {
      await sendPrivacyPage(request, response, { error: 'Impossible d’enregistrer la politique de rétention pour le moment.' }, 500);
    } catch (_renderError) {
      response.status(500).send('Impossible d’enregistrer la politique de rétention pour le moment.');
    }
  }
});

module.exports = router;
