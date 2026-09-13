const express = require('express');
const { formatDateTime: formatInstallationDateTime } = require('./application-time');
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
const { DEFAULT_LANGUAGE, resolveParticipantLanguage, t } = require('./i18n');
const {
  buildParticipantDataWorkbook,
  loadParticipantDataExport,
} = require('./participant-data-export');
const {
  ANONYMIZED_TARGET_LABEL,
  StudentAnonymizationError,
  anonymizeStudent,
  getStudentAnonymizationPreview,
} = require('./student-anonymization');
const { getTerm } = require('./terminology');
const {
  businessTerm, escapeHtml, renderMetricStrip, renderMessagePage, renderPage, renderSettingsLayout,
} = require('./ui');

const router = express.Router();

function formatDateTime(value) {
  if (!value) return '—';
  return formatInstallationDateTime(value);
}

function formatInactivity(participant, language = DEFAULT_LANGUAGE) {
  if (participant.inactivity_days === null) return '—';
  const suffix = participant.last_activity_at ? '' : t(language, 'privacy.inactivity.since_creation');
  if (participant.inactivity_months < 1) {
    return `${t(language, 'privacy.inactivity.days', { count: participant.inactivity_days })}${suffix}`;
  }
  return `${t(language, 'privacy.inactivity.months', { count: participant.inactivity_months })}${suffix}`;
}

function retentionPolicyLabel(months, language = DEFAULT_LANGUAGE) {
  return months === null ? t(language, 'status.never') : t(language, 'privacy.inactivity.months', { count: months });
}

function retentionOptions(selected, language) {
  return [
    `<option value="never"${selected === null ? ' selected' : ''}>${escapeHtml(t(language, 'status.never'))}</option>`,
    ...RETENTION_MONTH_OPTIONS.map((months) => `<option value="${months}"${selected === months ? ' selected' : ''}>${escapeHtml(t(language, 'privacy.inactivity.months', { count: months }))}</option>`),
  ].join('');
}

function terminologyParams(language) {
  return {
    student: getTerm(language, 'student'),
    students: getTerm(language, 'student', 'plural'),
    membership: getTerm(language, 'membership'),
    memberships: getTerm(language, 'membership', 'plural'),
    attendance: getTerm(language, 'attendance', 'plural'),
  };
}

function translatedReasons(reasons, language) {
  return reasons.map((reason) => {
    try { return t(language, `privacy.reason.${reason}`, terminologyParams(language)); } catch (_error) { return reason; }
  });
}

function queryFor({ filter, search, page = null }) {
  const params = new URLSearchParams();
  if (filter && filter !== 'all') params.set('eligibility', filter);
  if (search) params.set('q', search);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

function renderSummary(summary, language) {
  const items = [
    [t(language, 'privacy.summary.total'), summary.total],
    [t(language, 'privacy.summary.inactive'), summary.inactive],
    [t(language, 'privacy.summary.eligible'), summary.eligible],
    [t(language, 'privacy.summary.active_membership', terminologyParams(language)), summary.blockedByActiveMembership],
    [t(language, 'privacy.summary.recent_activity'), summary.blockedByRecentActivity],
    [t(language, 'privacy.summary.insufficient_date'), summary.blockedByInsufficientDate],
    [t(language, 'privacy.summary.policy_disabled'), summary.blockedByDisabledPolicy],
  ];
  return renderMetricStrip(items, t(language, 'privacy.summary.label'), 'policy-summary');
}

function renderRows(participants, language) {
  if (participants.length === 0) {
    return `<tr><td class="text-center text-body-secondary py-4" colspan="5">${escapeHtml(t(language, 'privacy.table.none', { participant: businessTerm(language, 'student') }))}</td></tr>`;
  }
  return participants.map((participant) => {
    const name = `${participant.first_name} ${participant.last_name}`;
    const detailUrl = `/settings/privacy/participants/${participant.public_id}`;
    return `<tr class="data-table-log-row" data-retention-detail-url="${detailUrl}">
      <td><span class="data-table-cell-truncate fw-semibold" title="${escapeHtml(name)}">${escapeHtml(name)}</span></td>
      <td><span class="data-table-cell-truncate" title="${escapeHtml(formatDateTime(participant.last_activity_at))}">${participant.last_activity_at ? escapeHtml(formatDateTime(participant.last_activity_at)) : '—'}</span></td>
      <td><span class="data-table-cell-truncate" title="${escapeHtml(formatInactivity(participant, language))}">${escapeHtml(formatInactivity(participant, language))}</span></td>
      <td><span class="data-table-result-state ${participant.eligible ? 'text-success' : 'text-body-secondary'}">${escapeHtml(t(language, participant.eligible ? 'privacy.filter.eligible' : 'privacy.filter.ineligible'))}</span></td>
      <td class="data-table-chevron"><button class="data-table-row-trigger" type="button" data-retention-detail-url="${detailUrl}" aria-label="${escapeHtml(t(language, 'privacy.table.details_for', { name }))}" title="${escapeHtml(t(language, 'privacy.table.details'))}">›</button></td>
    </tr>`;
  }).join('');
}

function renderPrivacyPage(preview, { error = '', notice = '', language = DEFAULT_LANGUAGE } = {}) {
  const notifications = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : notice
      ? `<p class="alert alert-success" role="status">${escapeHtml(notice)}</p>`
      : '';
  const previous = preview.page > 1
    ? `<a class="btn btn-sm btn-light" href="${escapeHtml(queryFor({ ...preview, page: preview.page - 1 }))}">${escapeHtml(t(language, 'common.previous'))}</a>`
    : '<span></span>';
  const next = preview.page < preview.totalPages
    ? `<a class="btn btn-sm btn-light" href="${escapeHtml(queryFor({ ...preview, page: preview.page + 1 }))}">${escapeHtml(t(language, 'common.next'))}</a>`
    : '<span></span>';
  const pagination = preview.totalPages > 1
    ? `<nav class="d-flex align-items-center justify-content-between gap-3 px-2 py-2" aria-label="${escapeHtml(t(language, 'common.pagination'))}">${previous}<span class="small text-body-secondary">${escapeHtml(t(language, 'common.page_of', { page: preview.page, pages: preview.totalPages }))}</span>${next}</nav>`
    : `<p class="small text-body-secondary px-2 py-2 mb-0">${escapeHtml(t(language, 'privacy.results', { count: preview.totalFiltered }))}</p>`;
  const participantTerm = getTerm(language, 'student');

  return renderPage(t(language, 'privacy.settings.title'), renderSettingsLayout({
    activeSection: 'privacy',
    title: t(language, 'privacy.settings.title'),
    description: t(language, 'privacy.settings.description', terminologyParams(language)),
    notifications,
    content: `<section class="page-section" aria-labelledby="retention-policy-title">
      <div class="section-header">
        <div>
          <h2 id="retention-policy-title">${escapeHtml(t(language, 'privacy.retention.title'))}</h2>
          <p class="section-description">${escapeHtml(t(language, 'privacy.retention.help'))}</p>
        </div>
      </div>
      <form class="card card-body app-form" method="post" action="/settings/privacy/retention">
        <div class="form-field">
          <label for="retention-months">${escapeHtml(t(language, 'privacy.retention.label', { participants: businessTerm(language, 'student', 'plural') }))}</label>
          <select class="form-select" id="retention-months" name="retention_months" required>${retentionOptions(preview.configuration.retentionMonths, language)}</select>
          <p class="form-text">${escapeHtml(t(language, 'privacy.retention.never_help'))}</p>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'privacy.retention.save'))}</button></div>
      </form>
    </section>
    <section class="page-section" aria-labelledby="retention-preview-title">
      <div class="section-header">
        <div>
          <h2 id="retention-preview-title">${escapeHtml(t(language, 'privacy.preview.title'))}</h2>
          <p class="section-description">${escapeHtml(t(language, 'privacy.preview.help', { participant: participantTerm }))}</p>
        </div>
      </div>
      ${renderSummary(preview.summary, language)}
      <form class="search" method="get" action="/settings/privacy" role="search">
        ${preview.filter !== 'all' ? `<input name="eligibility" type="hidden" value="${escapeHtml(preview.filter)}">` : ''}
        <label for="privacy-search">${escapeHtml(t(language, 'privacy.search', { participant: participantTerm }))}</label>
        <div class="search-controls">
          <input class="form-control" id="privacy-search" name="q" type="search" value="${escapeHtml(preview.search)}" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t(language, 'privacy.search_placeholder'))}">
          <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'action.search'))}</button>
          ${preview.search ? `<a class="btn btn-outline-secondary" href="/settings/privacy${escapeHtml(queryFor({ filter: preview.filter, search: '' }))}">${escapeHtml(t(language, 'action.clear'))}</a>` : ''}
        </div>
      </form>
      <nav class="nav nav-pills view-switch" aria-label="${escapeHtml(t(language, 'privacy.filter.label'))}">
        <a class="nav-link${preview.filter === 'all' ? ' active' : ''}" href="/settings/privacy${escapeHtml(queryFor({ filter: 'all', search: preview.search }))}"${preview.filter === 'all' ? ' aria-current="page"' : ''}>${escapeHtml(t(language, 'privacy.filter.all'))}</a>
        <a class="nav-link${preview.filter === 'eligible' ? ' active' : ''}" href="/settings/privacy${escapeHtml(queryFor({ filter: 'eligible', search: preview.search }))}"${preview.filter === 'eligible' ? ' aria-current="page"' : ''}>${escapeHtml(t(language, 'privacy.filter.eligible'))}</a>
        <a class="nav-link${preview.filter === 'ineligible' ? ' active' : ''}" href="/settings/privacy${escapeHtml(queryFor({ filter: 'ineligible', search: preview.search }))}"${preview.filter === 'ineligible' ? ' aria-current="page"' : ''}>${escapeHtml(t(language, 'privacy.filter.ineligible'))}</a>
      </nav>
      <div class="table-responsive data-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(t(language, 'privacy.table.label', terminologyParams(language)))}">
        <table class="table table-sm table-hover align-middle mb-0 data-table data-table-compact">
          <colgroup><col class="data-table-col-identity"><col class="data-table-col-timestamp"><col class="data-table-col-duration"><col class="data-table-col-state"><col class="data-table-col-chevron"></colgroup>
          <thead><tr><th scope="col">${businessTerm(language, 'student')}</th><th scope="col">${escapeHtml(t(language, 'privacy.table.last_activity'))}</th><th scope="col">${escapeHtml(t(language, 'privacy.table.inactivity'))}</th><th scope="col">${escapeHtml(t(language, 'privacy.table.eligibility'))}</th><th class="data-table-chevron" scope="col"><span class="visually-hidden">${escapeHtml(t(language, 'action.details'))}</span></th></tr></thead>
          <tbody>${renderRows(preview.participants, language)}</tbody>
        </table>
      </div>
      ${pagination}
    </section>`,
    after: `<div class="offcanvas offcanvas-end" tabindex="-1" id="privacy-participant-detail" aria-labelledby="privacy-participant-detail-title">
      <div class="offcanvas-header"><h2 class="offcanvas-title h5" id="privacy-participant-detail-title">${escapeHtml(t(language, 'privacy.drawer.title', terminologyParams(language)))}</h2><button class="btn-close" type="button" data-bs-dismiss="offcanvas" aria-label="${escapeHtml(t(language, 'action.close'))}"></button></div>
      <div class="offcanvas-body">
        <section><h3 class="h6">${escapeHtml(t(language, 'privacy.drawer.identity'))}</h3><dl class="audit-detail-list">
          <dt>${escapeHtml(businessTerm(language, 'student'))}</dt><dd data-privacy-field="name">—</dd><dt>${escapeHtml(t(language, 'privacy.drawer.email'))}</dt><dd class="text-break" data-privacy-field="email">—</dd><dt>${escapeHtml(t(language, 'privacy.drawer.code'))}</dt><dd class="font-monospace" data-privacy-field="code">—</dd><dt>${escapeHtml(t(language, 'common.status'))}</dt><dd data-privacy-field="status">—</dd><dt>${escapeHtml(t(language, 'privacy.drawer.anonymized_at'))}</dt><dd data-privacy-field="anonymizedAt">—</dd>
        </dl></section>
        <section class="border-top pt-3 mt-3"><h3 class="h6">${escapeHtml(t(language, 'privacy.drawer.retention'))}</h3><dl class="audit-detail-list">
          <dt>${escapeHtml(t(language, 'privacy.drawer.created_at'))}</dt><dd data-privacy-field="createdAt">—</dd><dt>${escapeHtml(t(language, 'privacy.table.last_activity'))}</dt><dd data-privacy-field="lastActivityAt">—</dd><dt>${escapeHtml(t(language, 'privacy.drawer.reference_date'))}</dt><dd data-privacy-field="referenceDate">—</dd><dt>${escapeHtml(t(language, 'privacy.table.inactivity'))}</dt><dd data-privacy-field="inactivity">—</dd><dt>${escapeHtml(t(language, 'privacy.drawer.policy'))}</dt><dd data-privacy-field="retentionPolicy">—</dd><dt>${escapeHtml(t(language, 'privacy.drawer.active_memberships', terminologyParams(language)))}</dt><dd data-privacy-field="activeMemberships">—</dd><dt>${escapeHtml(t(language, 'privacy.table.eligibility'))}</dt><dd data-privacy-field="eligibility">—</dd><dt>${escapeHtml(t(language, 'privacy.drawer.reason'))}</dt><dd data-privacy-field="reasons">—</dd>
        </dl></section>
        <div class="border-top pt-3 mt-3"><a class="btn btn-primary disabled" aria-disabled="true" tabindex="-1" data-privacy-export>${escapeHtml(t(language, 'privacy.drawer.export'))}</a></div>
        <section class="border-top pt-3 mt-3" aria-labelledby="privacy-anonymization-title">
          <h3 class="h6 text-danger" id="privacy-anonymization-title">${escapeHtml(t(language, 'privacy.anonymization.title'))}</h3>
          <p class="small text-body-secondary" data-privacy-anonymization-message>${escapeHtml(t(language, 'privacy.anonymization.load_help'))}</p>
          <button class="btn btn-outline-danger disabled" type="button" disabled aria-disabled="true" data-privacy-anonymize>${escapeHtml(t(language, 'privacy.anonymization.action', terminologyParams(language)))}</button>
        </section>
      </div>
    </div>
    <div class="modal fade" id="privacy-anonymization-modal" tabindex="-1" aria-labelledby="privacy-anonymization-modal-title" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
        <form method="post" data-privacy-anonymization-form data-submit-once>
          <div class="modal-header"><h2 class="modal-title fs-5" id="privacy-anonymization-modal-title">${escapeHtml(t(language, 'privacy.anonymization.action', terminologyParams(language)))}</h2><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="${escapeHtml(t(language, 'action.close'))}"></button></div>
          <div class="modal-body">
            <p class="fw-semibold text-danger">${escapeHtml(t(language, 'privacy.anonymization.irreversible'))}</p>
            <ul class="small mb-3">
              <li>${escapeHtml(t(language, 'privacy.anonymization.identity'))}</li>
              <li><strong data-privacy-anonymization-count="memberships">0</strong> ${escapeHtml(t(language, 'privacy.anonymization.memberships', terminologyParams(language)))}</li>
              <li><strong data-privacy-anonymization-count="attendanceRecords">0</strong> ${escapeHtml(t(language, 'privacy.anonymization.attendance', terminologyParams(language)))}</li>
              <li><strong data-privacy-anonymization-count="auditRows">0</strong> ${escapeHtml(t(language, 'privacy.anonymization.audit'))}</li>
              <li>${escapeHtml(t(language, 'privacy.anonymization.qr'))}</li>
            </ul>
            <input name="confirmation" type="hidden" value="ANONYMIZE">
          </div>
          <div class="modal-footer"><button class="btn btn-light" type="button" data-bs-dismiss="modal">${escapeHtml(t(language, 'action.cancel'))}</button><button class="btn btn-danger" type="submit">${escapeHtml(t(language, 'privacy.anonymization.confirm'))}</button></div>
        </form>
      </div></div>
    </div>
    <script src="/js/privacy-center.js" defer></script>`,
  }), { language });
}

async function sendPrivacyPage(request, response, feedback = {}, status = 200) {
  const preview = await getRetentionEligibilityPreview({
    filter: request.query.eligibility,
    search: request.query.q,
    page: request.query.page,
  });
  response.set('Cache-Control', 'private, no-store');
  response.status(status).send(renderPrivacyPage(preview, { ...feedback, language: request.uiLanguage }));
}

router.get('/', async (request, response) => {
  const notices = {
    saved: t(request.uiLanguage, 'privacy.notice.policy_saved'),
    anonymized: t(request.uiLanguage, 'privacy.notice.anonymized', terminologyParams(request.uiLanguage)),
  };
  try {
    await sendPrivacyPage(request, response, { notice: notices[request.query.notice] || '' });
  } catch (error) {
    console.error('Unable to load data protection settings:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderPage(t(request.uiLanguage, 'privacy.settings.title'), renderSettingsLayout({
      activeSection: 'privacy',
      title: t(request.uiLanguage, 'privacy.settings.title'),
      notifications: `<p class="alert alert-danger" role="alert">${escapeHtml(t(request.uiLanguage, 'privacy.error.load'))}</p>`,
    }), { language: request.uiLanguage }));
  }
});

router.get('/participants/:studentId/export.xlsx', async (request, response) => {
  response.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (!isValidPublicId(request.params.studentId)) return response.status(404).send(t(request.uiLanguage, 'privacy.error.not_found', terminologyParams(request.uiLanguage)));
  let data = null;
  try {
    data = await loadParticipantDataExport(request.params.studentId);
    if (!data) return response.status(404).send(t(request.uiLanguage, 'privacy.error.not_found', terminologyParams(request.uiLanguage)));
    const workbook = buildParticipantDataWorkbook(data, {
      language: resolveParticipantLanguage({
        participantLanguage: data.identity.language,
        defaultLanguage: request.internationalization.defaultLanguage,
      }),
      terminology: request.terminology,
    });
    const auditTargetLabel = data.identity.anonymized
      ? ANONYMIZED_TARGET_LABEL
      : `${data.identity.firstName} ${data.identity.lastName}`;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await recordAuditEvent({
      category: 'privacy', action: 'privacy.student.export', targetType: 'student',
      targetPublicId: data.identity.publicId,
      targetLabel: auditTargetLabel,
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
      targetLabel: data
        ? (data.identity.anonymized ? ANONYMIZED_TARGET_LABEL : `${data.identity.firstName} ${data.identity.lastName}`)
        : null,
      result: 'failed', summary: 'Échec de l’export des données personnelles d’un participant.',
      metadata: { format: 'xlsx', error_code: error.code || 'EXPORT_FAILED' },
    });
    console.error('Unable to export participant personal data:', error.code || 'EXPORT_FAILED');
    return response.status(500).send(t(request.uiLanguage, 'privacy.error.export'));
  }
});

router.get('/participants/:studentId/anonymization-preview', async (request, response) => {
  response.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (!isValidPublicId(request.params.studentId)) return response.status(404).json({ error: 'PARTICIPANT_NOT_FOUND' });
  try {
    const preview = await getStudentAnonymizationPreview(request.params.studentId);
    if (!preview) return response.status(404).json({ error: 'PARTICIPANT_NOT_FOUND' });
    if (preview.participant.anonymized_at) {
      return response.status(409).json({ error: 'PARTICIPANT_ALREADY_ANONYMIZED', message: t(request.uiLanguage, 'privacy.anonymization.already', terminologyParams(request.uiLanguage)) });
    }
    if (!preview.participant.eligible) {
      return response.status(409).json({
        error: 'PARTICIPANT_NOT_ELIGIBLE',
        message: t(request.uiLanguage, 'privacy.anonymization.impossible_reason', { reasons: translatedReasons(preview.participant.reasons, request.uiLanguage).join(' · ') }),
      });
    }
    return response.json({
      counts: preview.counts,
      actionUrl: `/settings/privacy/participants/${preview.participant.public_id}/anonymize`,
    });
  } catch (error) {
    console.error('Unable to load participant anonymization preview:', error.code || 'DATABASE_ERROR');
    return response.status(500).json({ error: 'ANONYMIZATION_PREVIEW_UNAVAILABLE', message: t(request.uiLanguage, 'privacy.anonymization.unavailable') });
  }
});

router.post('/participants/:studentId/anonymize', async (request, response) => {
  if (!isValidPublicId(request.params.studentId)) {
    const page = renderMessagePage(t(request.uiLanguage, 'privacy.error.not_found.title', terminologyParams(request.uiLanguage)), t(request.uiLanguage, 'privacy.error.not_found.message'), 404, request.uiLanguage);
    return response.status(page.status).send(page.html);
  }
  if (request.body.confirmation !== 'ANONYMIZE') {
    const page = renderMessagePage(t(request.uiLanguage, 'privacy.error.confirmation.title'), t(request.uiLanguage, 'privacy.error.confirmation.message'), 400, request.uiLanguage);
    return response.status(page.status).send(page.html);
  }
  try {
    await anonymizeStudent(request.params.studentId);
    return response.redirect(303, '/settings/privacy?notice=anonymized');
  } catch (error) {
    if (error instanceof StudentAnonymizationError) {
      if (error.code === 'STUDENT_NOT_FOUND') {
        const page = renderMessagePage(t(request.uiLanguage, 'privacy.error.not_found.title', terminologyParams(request.uiLanguage)), t(request.uiLanguage, 'privacy.error.not_found.message'), 404, request.uiLanguage);
        return response.status(page.status).send(page.html);
      }
      const message = error.code === 'STUDENT_ALREADY_ANONYMIZED'
        ? t(request.uiLanguage, 'privacy.anonymization.already', terminologyParams(request.uiLanguage))
        : `${t(request.uiLanguage, 'privacy.anonymization.no_longer_eligible', terminologyParams(request.uiLanguage))} ${error.reasons ? translatedReasons(error.reasons, request.uiLanguage).join(' · ') : t(request.uiLanguage, 'privacy.error.refresh')}`;
      const page = renderMessagePage(t(request.uiLanguage, 'privacy.error.anonymize.title'), message, 409, request.uiLanguage);
      return response.status(page.status).send(page.html);
    }
    console.error('Unable to anonymize participant:', error.code || 'ANONYMIZATION_FAILED');
    const page = renderMessagePage(t(request.uiLanguage, 'privacy.error.anonymize.title'), t(request.uiLanguage, 'privacy.error.no_changes'), 500, request.uiLanguage);
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
        email: participant.anonymized_at ? t(request.uiLanguage, 'privacy.value.anonymized_data') : participant.email,
        code: participant.anonymized_at ? t(request.uiLanguage, 'privacy.value.anonymized_data') : participant.student_code,
        status: participant.anonymized_at ? t(request.uiLanguage, 'privacy.value.anonymized') : t(request.uiLanguage, participant.active ? 'status.active' : 'status.inactive'),
        anonymizedAt: formatDateTime(participant.anonymized_at),
        createdAt: formatDateTime(participant.created_at),
        lastActivityAt: formatDateTime(participant.last_activity_at),
        referenceDate: formatDateTime(participant.reference_date),
        inactivity: formatInactivity(participant, request.uiLanguage),
        retentionPolicy: retentionPolicyLabel(detail.configuration.retentionMonths, request.uiLanguage),
        activeMemberships: String(participant.active_memberships),
        eligibility: t(request.uiLanguage, participant.eligible ? 'privacy.filter.eligible' : 'privacy.filter.ineligible'),
        reasons: translatedReasons(participant.reasons, request.uiLanguage).join(' · '),
      },
      exportUrl: `/settings/privacy/participants/${participant.public_id}/export.xlsx`,
      anonymization: {
        eligible: participant.eligible && !participant.anonymized_at,
        alreadyAnonymized: Boolean(participant.anonymized_at),
        previewUrl: participant.eligible && !participant.anonymized_at
          ? `/settings/privacy/participants/${participant.public_id}/anonymization-preview`
          : null,
        message: participant.anonymized_at
          ? t(request.uiLanguage, 'privacy.anonymization.date', { date: formatDateTime(participant.anonymized_at) })
          : participant.eligible
            ? t(request.uiLanguage, 'privacy.anonymization.currently_eligible', terminologyParams(request.uiLanguage))
            : t(request.uiLanguage, 'privacy.anonymization.action_unavailable', { reasons: translatedReasons(participant.reasons, request.uiLanguage).join(' · ') }),
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
      await sendPrivacyPage(request, response, { error: t(request.uiLanguage, 'privacy.error.retention_invalid') }, 400);
    } catch (error) {
      console.error('Unable to render invalid retention policy:', error.code || 'DATABASE_ERROR');
      response.status(400).send(t(request.uiLanguage, 'privacy.error.retention_invalid_short'));
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
      await sendPrivacyPage(request, response, { error: t(request.uiLanguage, 'privacy.error.retention_save') }, 500);
    } catch (_renderError) {
      response.status(500).send(t(request.uiLanguage, 'privacy.error.retention_save'));
    }
  }
});

module.exports = router;
