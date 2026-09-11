const express = require('express');
const { getApplicationTimezone } = require('./application-time');
const { recordAuditEvent, recordAuditEventSafely } = require('./audit');
const {
  RETENTION_MONTH_OPTIONS,
  getParticipantRetentionDetail,
  getRetentionEligibilityPreview,
  loadRetentionConfiguration,
  normalizeRetentionMonths,
  saveRetentionConfiguration,
} = require('./data-retention');
const { pool, withTransaction } = require('./db/client');
const { isValidPublicId } = require('./public-id');
const {
  buildParticipantDataWorkbook,
  loadParticipantDataExport,
} = require('./participant-data-export');
const {
  StudentAnonymizationError,
  anonymizeStudent,
  getStudentAnonymizationPreview,
} = require('./student-anonymization');
const { getTerm } = require('./terminology');
const {
  businessTerm, escapeHtml, renderMessagePage, renderPage, renderSettingsLayout,
} = require('./ui');

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

function retentionPolicyLabel(months) {
  return months === null ? 'Jamais' : `${months} mois`;
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
    return `<tr><td class="text-center text-body-secondary py-4" colspan="5">Aucun ${businessTerm('student').toLocaleLowerCase('fr')} ne correspond aux critères.</td></tr>`;
  }
  return participants.map((participant) => {
    const name = `${participant.first_name} ${participant.last_name}`;
    const detailUrl = `/settings/privacy/participants/${participant.public_id}`;
    return `<tr class="data-table-log-row" data-retention-detail-url="${detailUrl}">
      <td><span class="data-table-cell-truncate fw-semibold" title="${escapeHtml(name)}">${escapeHtml(name)}</span></td>
      <td><span class="data-table-cell-truncate" title="${escapeHtml(formatDateTime(participant.last_activity_at))}">${participant.last_activity_at ? escapeHtml(formatDateTime(participant.last_activity_at)) : '—'}</span></td>
      <td><span class="data-table-cell-truncate" title="${escapeHtml(formatInactivity(participant))}">${escapeHtml(formatInactivity(participant))}</span></td>
      <td><span class="data-table-result-state ${participant.eligible ? 'text-success' : 'text-body-secondary'}">${participant.eligible ? 'Éligible' : 'Non éligible'}</span></td>
      <td class="data-table-chevron"><button class="data-table-row-trigger" type="button" data-retention-detail-url="${detailUrl}" aria-label="Afficher les détails de rétention pour ${escapeHtml(name)}" title="Afficher les détails">›</button></td>
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
    description: 'Prévisualisez l’éligibilité et anonymisez individuellement les participants après une vérification irréversible.',
    notifications,
    content: `<section class="page-section" aria-labelledby="retention-policy-title">
      <div class="section-header">
        <div>
          <h2 id="retention-policy-title">Politique de rétention</h2>
          <p class="section-description">La liste reste un aperçu. Chaque anonymisation exige une confirmation et une nouvelle vérification côté serveur.</p>
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
        <table class="table table-sm table-hover align-middle mb-0 data-table data-table-compact">
          <colgroup><col class="data-table-col-identity"><col class="data-table-col-timestamp"><col class="data-table-col-duration"><col class="data-table-col-state"><col class="data-table-col-chevron"></colgroup>
          <thead><tr><th scope="col">${businessTerm('student')}</th><th scope="col">Dernière activité</th><th scope="col">Inactivité</th><th scope="col">Éligibilité</th><th class="data-table-chevron" scope="col"><span class="visually-hidden">Détails</span></th></tr></thead>
          <tbody>${renderRows(preview.participants)}</tbody>
        </table>
      </div>
      ${pagination}
    </section>`,
    after: `<div class="offcanvas offcanvas-end" tabindex="-1" id="privacy-participant-detail" aria-labelledby="privacy-participant-detail-title">
      <div class="offcanvas-header"><h2 class="offcanvas-title h5" id="privacy-participant-detail-title">Données du participant</h2><button class="btn-close" type="button" data-bs-dismiss="offcanvas" aria-label="Fermer"></button></div>
      <div class="offcanvas-body">
        <section><h3 class="h6">Identité</h3><dl class="audit-detail-list">
          <dt>Participant</dt><dd data-privacy-field="name">—</dd><dt>E-mail</dt><dd class="text-break" data-privacy-field="email">—</dd><dt>Code</dt><dd class="font-monospace" data-privacy-field="code">—</dd><dt>Statut</dt><dd data-privacy-field="status">—</dd><dt>Anonymisé le</dt><dd data-privacy-field="anonymizedAt">—</dd>
        </dl></section>
        <section class="border-top pt-3 mt-3"><h3 class="h6">Rétention</h3><dl class="audit-detail-list">
          <dt>Créé le</dt><dd data-privacy-field="createdAt">—</dd><dt>Dernière activité</dt><dd data-privacy-field="lastActivityAt">—</dd><dt>Date de référence</dt><dd data-privacy-field="referenceDate">—</dd><dt>Inactivité</dt><dd data-privacy-field="inactivity">—</dd><dt>Politique</dt><dd data-privacy-field="retentionPolicy">—</dd><dt>Inscriptions actives</dt><dd data-privacy-field="activeMemberships">—</dd><dt>Éligibilité</dt><dd data-privacy-field="eligibility">—</dd><dt>Motif</dt><dd data-privacy-field="reasons">—</dd>
        </dl></section>
        <div class="border-top pt-3 mt-3"><a class="btn btn-primary disabled" aria-disabled="true" tabindex="-1" data-privacy-export>Exporter les données</a></div>
        <section class="border-top pt-3 mt-3" aria-labelledby="privacy-anonymization-title">
          <h3 class="h6 text-danger" id="privacy-anonymization-title">Anonymisation irréversible</h3>
          <p class="small text-body-secondary" data-privacy-anonymization-message>Chargez les détails pour vérifier l’éligibilité actuelle.</p>
          <button class="btn btn-outline-danger disabled" type="button" disabled aria-disabled="true" data-privacy-anonymize>Anonymiser le participant</button>
        </section>
      </div>
    </div>
    <div class="modal fade" id="privacy-anonymization-modal" tabindex="-1" aria-labelledby="privacy-anonymization-modal-title" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
        <form method="post" data-privacy-anonymization-form data-submit-once>
          <div class="modal-header"><h2 class="modal-title fs-5" id="privacy-anonymization-modal-title">Anonymiser le participant</h2><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Fermer"></button></div>
          <div class="modal-body">
            <p class="fw-semibold text-danger">Cette opération est irréversible.</p>
            <ul class="small mb-3">
              <li>Les champs d’identité seront détruits ou remplacés.</li>
              <li><strong data-privacy-anonymization-count="memberships">0</strong> inscription(s) historique(s) seront conservées.</li>
              <li><strong data-privacy-anonymization-count="attendanceRecords">0</strong> présence(s) seront conservées.</li>
              <li><strong data-privacy-anonymization-count="auditRows">0</strong> événement(s) d’audit seront expurgés.</li>
              <li>L’ancien QR cessera immédiatement de fonctionner.</li>
            </ul>
            <input name="confirmation" type="hidden" value="ANONYMIZE">
          </div>
          <div class="modal-footer"><button class="btn btn-light" type="button" data-bs-dismiss="modal">Annuler</button><button class="btn btn-danger" type="submit">Confirmer l’anonymisation</button></div>
        </form>
      </div></div>
    </div>
    <script src="/js/privacy-center.js" defer></script>`,
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
  const notices = {
    saved: 'La politique de rétention a été enregistrée.',
    anonymized: 'Le participant a été anonymisé de façon irréversible.',
  };
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

router.get('/participants/:studentId/export.xlsx', async (request, response) => {
  response.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (!isValidPublicId(request.params.studentId)) return response.status(404).send('Participant introuvable.');
  let data = null;
  try {
    data = await loadParticipantDataExport(request.params.studentId);
    if (!data) return response.status(404).send('Participant introuvable.');
    const workbook = buildParticipantDataWorkbook(data);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await recordAuditEvent({
      category: 'privacy', action: 'privacy.student.export', targetType: 'student',
      targetPublicId: data.identity.publicId,
      targetLabel: `${data.identity.firstName} ${data.identity.lastName}`,
      summary: 'Données personnelles d’un participant exportées.',
      metadata: { format: 'xlsx', counts: { memberships: data.memberships.length, attendance: data.attendance.length, audit: data.audit.length } },
    });
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="attendance-log-data-export-${data.identity.publicId}.xlsx"`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return response.send(buffer);
  } catch (error) {
    await recordAuditEventSafely({
      category: 'privacy', action: 'privacy.student.export', targetType: 'student',
      targetPublicId: request.params.studentId,
      targetLabel: data ? `${data.identity.firstName} ${data.identity.lastName}` : null,
      result: 'failed', summary: 'Échec de l’export des données personnelles d’un participant.',
      metadata: { format: 'xlsx', error_code: error.code || 'EXPORT_FAILED' },
    });
    console.error('Unable to export participant personal data:', error.code || 'EXPORT_FAILED');
    return response.status(500).send('Impossible d’exporter les données pour le moment.');
  }
});

router.get('/participants/:studentId/anonymization-preview', async (request, response) => {
  response.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (!isValidPublicId(request.params.studentId)) return response.status(404).json({ error: 'PARTICIPANT_NOT_FOUND' });
  try {
    const preview = await getStudentAnonymizationPreview(request.params.studentId);
    if (!preview) return response.status(404).json({ error: 'PARTICIPANT_NOT_FOUND' });
    if (preview.participant.anonymized_at) {
      return response.status(409).json({ error: 'PARTICIPANT_ALREADY_ANONYMIZED', message: 'Ce participant est déjà anonymisé.' });
    }
    if (!preview.participant.eligible) {
      return response.status(409).json({
        error: 'PARTICIPANT_NOT_ELIGIBLE',
        message: `Anonymisation impossible : ${preview.participant.reasons.join(' · ')}.`,
      });
    }
    return response.json({
      counts: preview.counts,
      actionUrl: `/settings/privacy/participants/${preview.participant.public_id}/anonymize`,
    });
  } catch (error) {
    console.error('Unable to load participant anonymization preview:', error.code || 'DATABASE_ERROR');
    return response.status(500).json({ error: 'ANONYMIZATION_PREVIEW_UNAVAILABLE', message: 'La vérification est indisponible pour le moment.' });
  }
});

router.post('/participants/:studentId/anonymize', async (request, response) => {
  if (!isValidPublicId(request.params.studentId)) {
    const page = renderMessagePage('Participant introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
    return response.status(page.status).send(page.html);
  }
  if (request.body.confirmation !== 'ANONYMIZE') {
    const page = renderMessagePage('Confirmation requise', 'L’anonymisation irréversible doit être confirmée explicitement.', 400);
    return response.status(page.status).send(page.html);
  }
  try {
    await anonymizeStudent(request.params.studentId);
    return response.redirect(303, '/settings/privacy?notice=anonymized');
  } catch (error) {
    if (error instanceof StudentAnonymizationError) {
      if (error.code === 'STUDENT_NOT_FOUND') {
        const page = renderMessagePage('Participant introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
        return response.status(page.status).send(page.html);
      }
      const message = error.code === 'STUDENT_ALREADY_ANONYMIZED'
        ? 'Ce participant est déjà anonymisé.'
        : `Le participant n’est plus éligible. ${error.reasons?.join(' · ') || 'Actualisez la Protection des données.'}`;
      const page = renderMessagePage('Anonymisation impossible', message, 409);
      return response.status(page.status).send(page.html);
    }
    console.error('Unable to anonymize participant:', error.code || 'ANONYMIZATION_FAILED');
    const page = renderMessagePage('Anonymisation impossible', 'Aucune donnée n’a été modifiée. Réessayez plus tard.');
    return response.status(page.status).send(page.html);
  }
});

router.get('/participants/:studentId', async (request, response) => {
  response.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (!isValidPublicId(request.params.studentId)) return response.status(404).json({ error: 'PARTICIPANT_NOT_FOUND' });
  try {
    const detail = await getParticipantRetentionDetail(request.params.studentId);
    if (!detail) return response.status(404).json({ error: 'PARTICIPANT_NOT_FOUND' });
    const participant = detail.participant;
    response.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    return response.json({
      fields: {
        name: `${participant.first_name} ${participant.last_name}`,
        email: participant.anonymized_at ? 'Donnée anonymisée' : participant.email,
        code: participant.anonymized_at ? 'Donnée anonymisée' : participant.student_code,
        status: participant.anonymized_at ? 'Anonymisé' : participant.active ? 'Actif' : 'Inactif',
        anonymizedAt: formatDateTime(participant.anonymized_at),
        createdAt: formatDateTime(participant.created_at),
        lastActivityAt: formatDateTime(participant.last_activity_at),
        referenceDate: formatDateTime(participant.reference_date),
        inactivity: formatInactivity(participant),
        retentionPolicy: retentionPolicyLabel(detail.configuration.retentionMonths),
        activeMemberships: String(participant.active_memberships),
        eligibility: participant.eligible ? 'Éligible' : 'Non éligible',
        reasons: participant.reasons.join(' · '),
      },
      exportUrl: `/settings/privacy/participants/${participant.public_id}/export.xlsx`,
      anonymization: {
        eligible: participant.eligible && !participant.anonymized_at,
        alreadyAnonymized: Boolean(participant.anonymized_at),
        previewUrl: participant.eligible && !participant.anonymized_at
          ? `/settings/privacy/participants/${participant.public_id}/anonymization-preview`
          : null,
        message: participant.anonymized_at
          ? `Anonymisé le ${formatDateTime(participant.anonymized_at)}.`
          : participant.eligible
            ? 'Ce participant est actuellement éligible à l’anonymisation.'
            : `Action indisponible : ${participant.reasons.join(' · ')}.`,
      },
    });
  } catch (error) {
    console.error('Unable to load participant retention detail:', error.code || 'DATABASE_ERROR');
    return response.status(500).json({ error: 'PARTICIPANT_DETAIL_UNAVAILABLE' });
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
