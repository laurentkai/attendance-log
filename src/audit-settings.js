const express = require('express');
const ExcelJS = require('exceljs');
const { formatDateTime: formatInstallationDateTime, getApplicationLocale, getApplicationTimezone } = require('./application-time');
const {
  auditActionLabel: actionLabel,
  auditCategoryLabel: categoryLabel,
  auditChanges: changesFor,
  auditFieldLabel: translatedFieldLabel,
  auditResultLabel: resultLabel,
  auditSummaryLabel,
  displayAuditValue: displayValue,
} = require('./audit-presentation');
const { pool } = require('./db/client');
const { DEFAULT_LANGUAGE, resolveGlobalReportLanguage, t } = require('./i18n');
const { isValidPublicId } = require('./public-id');
const { escapeHtml, renderMessagePage, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();
const PAGE_SIZE = 25;
const MAX_EXPORT_ROWS = 50000;
const RESULTS = new Set(['success', 'denied', 'failed']);
const AUDIT_CATEGORIES = Object.freeze([
  'attendance', 'backup', 'branding', 'class', 'import', 'maintenance', 'mail',
  'restore', 'security', 'session', 'student', 'terminology', 'user', 'print_design',
  'privacy', 'internationalization',
]);
const RESULT_CLASSES = Object.freeze({ success: 'text-success', denied: 'text-warning-emphasis', failed: 'text-danger' });

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? '' : value;
}

function filtersFrom(query) {
  return {
    dateFrom: dateValue(query.date_from),
    dateTo: dateValue(query.date_to),
    actor: isValidPublicId(query.actor) ? query.actor : '',
    category: AUDIT_CATEGORIES.includes(query.category) ? query.category : '',
    action: typeof query.action === 'string' && /^[a-z][a-z0-9_.-]{0,79}$/.test(query.action) ? query.action : '',
    result: RESULTS.has(query.result) ? query.result : '',
  };
}

function buildFilterSql(filters) {
  const clauses = [];
  const values = [];
  const add = (clause, value) => { values.push(value); clauses.push(clause.replace('?', `$${values.length}`)); };
  if (filters.dateFrom) add('a.occurred_at >= ?::date', filters.dateFrom);
  if (filters.dateTo) add("a.occurred_at < (?::date + INTERVAL '1 day')", filters.dateTo);
  if (filters.actor) add('u.public_id = ?', filters.actor);
  if (filters.category) add('a.category = ?', filters.category);
  if (filters.action) add('a.action = ?', filters.action);
  if (filters.result) add('a.result = ?', filters.result);
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function formatDateTime(value) {
  return formatInstallationDateTime(value, { dateStyle: 'short', timeStyle: 'medium' });
}

function formatCompactDateTime(value) {
  return new Intl.DateTimeFormat(getApplicationLocale(), {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: getApplicationTimezone(),
  }).format(new Date(value));
}

function compactActionLabel(action, language, terminology) {
  return actionLabel(action, language, terminology);
}

function filterQuery(filters) {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.category) params.set('category', filters.category);
  if (filters.action) params.set('action', filters.action);
  if (filters.result) params.set('result', filters.result);
  return params;
}

function renderOptions(entries, selected, blankLabel) {
  return `<option value="">${escapeHtml(blankLabel)}</option>${entries.map(([value, label]) => `<option value="${escapeHtml(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;
}

async function loadExportRows(filters) {
  const filtered = buildFilterSql(filters);
  const result = await pool.query(
    `SELECT a.* FROM admin_audit_log a
     LEFT JOIN admin_users u ON u.id = a.actor_admin_user_id
     ${filtered.where}
     ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${MAX_EXPORT_ROWS + 1}`,
    filtered.values,
  );
  if (result.rows.length > MAX_EXPORT_ROWS) {
    throw Object.assign(new Error('Export too large'), { code: 'AUDIT_EXPORT_TOO_LARGE' });
  }
  return result.rows;
}

function exportRow(row, language, terminology) {
  const changes = changesFor(row, language, terminology).map((change) => `${change.label}: ${change.before} -> ${change.after}`).join(' | ');
  return [
    new Date(row.occurred_at).toISOString(), row.actor_name || t(language, 'audit.system'), row.actor_role || '',
    categoryLabel(row.category, language, terminology), actionLabel(row.action, language, terminology), row.target_type || '',
    row.target_label || '', resultLabel(row.result, language), auditSummaryLabel(row, language, terminology), changes,
  ];
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

router.get('/', async (request, response) => {
  const language = request.uiLanguage;
  const filters = filtersFrom(request.query);
  const page = Math.max(1, Math.min(100000, Number.parseInt(request.query.page, 10) || 1));
  const filtered = buildFilterSql(filters);
  try {
    const [events, count, actors, actions] = await Promise.all([
      pool.query(
        `SELECT a.public_id, a.occurred_at, a.actor_name, a.actor_role, a.action, a.category,
                a.target_type, a.target_label, a.result, a.summary
         FROM admin_audit_log a LEFT JOIN admin_users u ON u.id = a.actor_admin_user_id
         ${filtered.where}
         ORDER BY a.occurred_at DESC, a.id DESC LIMIT $${filtered.values.length + 1} OFFSET $${filtered.values.length + 2}`,
        [...filtered.values, PAGE_SIZE, (page - 1) * PAGE_SIZE],
      ),
      pool.query(`SELECT COUNT(*)::integer AS total FROM admin_audit_log a LEFT JOIN admin_users u ON u.id = a.actor_admin_user_id ${filtered.where}`, filtered.values),
      pool.query("SELECT public_id, name FROM admin_users ORDER BY LOWER(name), id"),
      pool.query('SELECT DISTINCT action FROM admin_audit_log ORDER BY action'),
    ]);
    const total = count.rows[0].total;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rows = events.rows.length ? events.rows.map((event) => `<tr class="data-table-log-row" data-audit-detail-url="/settings/audit/${event.public_id}">
      <td class="data-table-date"><time datetime="${escapeHtml(new Date(event.occurred_at).toISOString())}" title="${escapeHtml(formatDateTime(event.occurred_at))}">${escapeHtml(formatCompactDateTime(event.occurred_at))}</time></td>
      <td><span class="data-table-cell-truncate fw-semibold" title="${escapeHtml(event.actor_name || t(language, 'audit.system'))}">${escapeHtml(event.actor_name || t(language, 'audit.system'))}</span></td>
      <td><span class="data-table-cell-truncate" title="${escapeHtml(actionLabel(event.action, language, request.terminology))}">${escapeHtml(compactActionLabel(event.action, language, request.terminology))}</span></td>
      <td><span class="data-table-cell-truncate" title="${escapeHtml(event.target_label || event.target_type || '—')}">${escapeHtml(event.target_label || event.target_type || '—')}</span></td>
      <td><span class="data-table-result-state ${RESULT_CLASSES[event.result]}">${escapeHtml(event.result === 'success' ? 'OK' : resultLabel(event.result, language))}</span></td>
      <td class="data-table-chevron"><button class="data-table-row-trigger" type="button" data-audit-detail-url="/settings/audit/${event.public_id}" aria-label="${escapeHtml(t(language, 'audit.details.show_event', { date: formatDateTime(event.occurred_at) }))}" title="${escapeHtml(t(language, 'audit.details.show'))}">›</button></td>
    </tr>`).join('') : `<tr><td class="text-center text-body-secondary py-4" colspan="6">${escapeHtml(t(language, 'audit.no_match'))}</td></tr>`;
    const params = filterQuery(filters);
    const previous = new URLSearchParams(params); previous.set('page', String(page - 1));
    const next = new URLSearchParams(params); next.set('page', String(page + 1));
    const exportParams = params.toString();
    const pagination = totalPages > 1 ? `<nav class="d-flex align-items-center justify-content-between gap-3" aria-label="${escapeHtml(t(language, 'common.pagination'))}">
      ${page > 1 ? `<a class="btn btn-sm btn-light" href="?${previous}">${escapeHtml(t(language, 'common.previous'))}</a>` : '<span></span>'}
      <span class="small text-body-secondary">${escapeHtml(t(language, 'common.page_of', { page, pages: totalPages }))}</span>
      ${page < totalPages ? `<a class="btn btn-sm btn-light" href="?${next}">${escapeHtml(t(language, 'common.next'))}</a>` : '<span></span>'}
    </nav>` : '';
    response.set('Cache-Control', 'private, no-store');
    response.send(renderPage(t(language, 'audit.title'), renderSettingsLayout({
      activeSection: 'audit',
      title: t(language, 'audit.title'),
      description: t(language, 'audit.description'),
      status: `<div class="btn-group" role="group" aria-label="${escapeHtml(t(language, 'audit.export_label'))}"><a class="btn btn-light" href="/settings/audit/export.csv${exportParams ? `?${escapeHtml(exportParams)}` : ''}">CSV</a><a class="btn btn-light" href="/settings/audit/export.xlsx${exportParams ? `?${escapeHtml(exportParams)}` : ''}">Excel</a></div>`,
      content: `<form class="card card-body app-form" method="get" action="/settings/audit">
        <div class="row g-3">
          <div class="col-sm-6 col-xl-3"><label class="form-label" for="audit-date-from">${escapeHtml(t(language, 'audit.from'))}</label><input class="form-control" id="audit-date-from" name="date_from" type="date" value="${escapeHtml(filters.dateFrom)}"></div>
          <div class="col-sm-6 col-xl-3"><label class="form-label" for="audit-date-to">${escapeHtml(t(language, 'audit.to'))}</label><input class="form-control" id="audit-date-to" name="date_to" type="date" value="${escapeHtml(filters.dateTo)}"></div>
          <div class="col-sm-6 col-xl-3"><label class="form-label" for="audit-actor">${escapeHtml(t(language, 'audit.user'))}</label><select class="form-select" id="audit-actor" name="actor">${renderOptions(actors.rows.map((actor) => [actor.public_id, actor.name]), filters.actor, t(language, 'common.all'))}</select></div>
          <div class="col-sm-6 col-xl-3"><label class="form-label" for="audit-result">${escapeHtml(t(language, 'audit.result'))}</label><select class="form-select" id="audit-result" name="result">${renderOptions([...RESULTS].map((result) => [result, resultLabel(result, language)]), filters.result, t(language, 'common.all'))}</select></div>
          <div class="col-sm-6"><label class="form-label" for="audit-category">${escapeHtml(t(language, 'audit.category'))}</label><select class="form-select" id="audit-category" name="category">${renderOptions(AUDIT_CATEGORIES.map((category) => [category, categoryLabel(category, language, request.terminology)]), filters.category, t(language, 'common.all'))}</select></div>
          <div class="col-sm-6"><label class="form-label" for="audit-action">${escapeHtml(t(language, 'audit.action'))}</label><select class="form-select" id="audit-action" name="action">${renderOptions(actions.rows.map(({ action }) => [action, actionLabel(action, language, request.terminology)]), filters.action, t(language, 'common.all'))}</select></div>
        </div>
        <div class="form-actions d-flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'audit.filter'))}</button><a class="btn btn-outline-secondary" href="/settings/audit">${escapeHtml(t(language, 'action.reset'))}</a></div>
      </form>
      <section aria-label="${escapeHtml(t(language, 'audit.events'))}">
        <div class="table-responsive border-top border-bottom" tabindex="0" role="region" aria-label="${escapeHtml(t(language, 'audit.events_list'))}"><table class="table table-sm table-hover align-middle mb-0 data-table data-table-compact"><colgroup><col class="data-table-col-date"><col class="data-table-col-actor"><col class="data-table-col-action"><col class="data-table-col-target"><col class="data-table-col-result"><col class="data-table-col-chevron"></colgroup><thead><tr><th scope="col">${escapeHtml(t(language, 'common.date'))}</th><th scope="col">${escapeHtml(t(language, 'audit.user'))}</th><th scope="col">${escapeHtml(t(language, 'audit.action'))}</th><th scope="col">${escapeHtml(t(language, 'audit.target'))}</th><th scope="col">${escapeHtml(t(language, 'audit.result'))}</th><th class="data-table-chevron" scope="col"><span class="visually-hidden">${escapeHtml(t(language, 'action.details'))}</span></th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="px-2 py-2">${pagination || `<span class="small text-body-secondary">${escapeHtml(t(language, 'audit.event_count', { count: total }))}</span>`}</div>
      </section>`,
      after: `<div class="offcanvas offcanvas-end" tabindex="-1" id="audit-detail" aria-labelledby="audit-detail-title">
        <div class="offcanvas-header"><h2 class="offcanvas-title h5" id="audit-detail-title">${escapeHtml(t(language, 'audit.details.title'))}</h2><button class="btn-close" type="button" data-bs-dismiss="offcanvas" aria-label="${escapeHtml(t(language, 'action.close'))}"></button></div>
        <div class="offcanvas-body">
          <section><h3 class="h6">${escapeHtml(t(language, 'audit.details.section'))}</h3><dl class="audit-detail-list">
            <dt>${escapeHtml(t(language, 'common.date'))}</dt><dd data-audit-field="timestamp">—</dd><dt>${escapeHtml(t(language, 'audit.user'))}</dt><dd data-audit-field="actor">—</dd><dt>${escapeHtml(t(language, 'audit.details.role'))}</dt><dd data-audit-field="role">—</dd><dt>${escapeHtml(t(language, 'audit.action'))}</dt><dd data-audit-field="action">—</dd><dt>${escapeHtml(t(language, 'audit.target'))}</dt><dd data-audit-field="target">—</dd><dt>${escapeHtml(t(language, 'audit.result'))}</dt><dd data-audit-field="result">—</dd><dt>${escapeHtml(t(language, 'audit.details.summary'))}</dt><dd data-audit-field="summary">—</dd><dt>${escapeHtml(t(language, 'audit.details.ip'))}</dt><dd class="text-break font-monospace small" data-audit-field="ipHash">—</dd><dt>${escapeHtml(t(language, 'audit.details.user_agent'))}</dt><dd class="text-break font-monospace small" data-audit-field="userAgentHash">—</dd>
          </dl></section>
          <section class="border-top pt-3 mt-3"><h3 class="h6">${escapeHtml(t(language, 'audit.details.changes'))}</h3><div data-audit-changes></div></section>
          <section class="border-top pt-3 mt-3"><h3 class="h6">${escapeHtml(t(language, 'audit.details.metadata'))}</h3><ul class="small ps-3 mb-0" data-audit-metadata></ul></section>
        </div>
      </div><script src="/js/audit-log.js" defer></script>`,
    }), { language }));
  } catch (error) {
    console.error('Unable to load audit log:', error.code || error.message);
    const pageContent = renderMessagePage(t(language, 'audit.error.unavailable.title'), t(language, 'audit.error.unavailable.message'), 500, language);
    response.status(pageContent.status).send(pageContent.html);
  }
});

router.get('/export.csv', async (request, response) => {
  try {
    const language = resolveGlobalReportLanguage({ defaultLanguage: request.internationalization.defaultLanguage });
    const rows = await loadExportRows(filtersFrom(request.query));
    const headers = [t(language, 'audit.export.timestamp'), t(language, 'audit.user'), t(language, 'audit.details.role'), t(language, 'audit.category'), t(language, 'audit.action'), t(language, 'audit.export.target_type'), t(language, 'audit.target'), t(language, 'audit.result'), t(language, 'audit.details.summary'), t(language, 'audit.export.changes')];
    const csv = [headers, ...rows.map((row) => exportRow(row, language, request.terminology))].map((row) => row.map(csvCell).join(',')).join('\r\n');
    response.set({ 'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="attendance-log-audit.csv"', 'Content-Type': 'text/csv; charset=utf-8' });
    response.send(`\uFEFF${csv}`);
  } catch (error) {
    const status = error.code === 'AUDIT_EXPORT_TOO_LARGE' ? 413 : 500;
    response.status(status).send(renderMessagePage(t(request.uiLanguage, 'audit.error.export.title'), t(request.uiLanguage, status === 413 ? 'audit.error.export.large' : 'audit.error.export.message'), status, request.uiLanguage).html);
  }
});

router.get('/export.xlsx', async (request, response) => {
  try {
    const language = resolveGlobalReportLanguage({ defaultLanguage: request.internationalization.defaultLanguage });
    const rows = await loadExportRows(filtersFrom(request.query));
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Attendance Log';
    const sheet = workbook.addWorksheet(t(language, 'audit.export.sheet'));
    sheet.columns = [
      [t(language, 'audit.export.timestamp'), 26], [t(language, 'audit.user'), 24], [t(language, 'audit.details.role'), 20], [t(language, 'audit.category'), 20], [t(language, 'audit.action'), 28],
      [t(language, 'audit.export.target_type'), 18], [t(language, 'audit.target'), 28], [t(language, 'audit.result'), 14], [t(language, 'audit.details.summary'), 55], [t(language, 'audit.export.changes'), 55],
    ].map(([header, width]) => ({ header, width }));
    for (const row of rows) sheet.addRow(exportRow(row, language, request.terminology));
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: 'J1' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    response.set({ 'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="attendance-log-audit.xlsx"', 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    response.send(Buffer.from(buffer));
  } catch (error) {
    const status = error.code === 'AUDIT_EXPORT_TOO_LARGE' ? 413 : 500;
    response.status(status).send(renderMessagePage(t(request.uiLanguage, 'audit.error.export.title'), t(request.uiLanguage, status === 413 ? 'audit.error.export.large' : 'audit.error.export.message'), status, request.uiLanguage).html);
  }
});

router.get('/:id', async (request, response) => {
  if (!isValidPublicId(request.params.id)) return response.status(404).json({ error: 'AUDIT_EVENT_NOT_FOUND' });
  try {
    const result = await pool.query('SELECT * FROM admin_audit_log WHERE public_id = $1', [request.params.id]);
    if (result.rowCount === 0) return response.status(404).json({ error: 'AUDIT_EVENT_NOT_FOUND' });
    const event = result.rows[0];
    response.set('Cache-Control', 'private, no-store');
    response.json({
      fields: {
        timestamp: formatDateTime(event.occurred_at), actor: event.actor_name || t(request.uiLanguage, 'audit.system'), role: event.actor_role || '—',
        action: `${categoryLabel(event.category, request.uiLanguage, request.terminology)} · ${actionLabel(event.action, request.uiLanguage, request.terminology)}`,
        target: event.target_label || event.target_type || '—', result: resultLabel(event.result, request.uiLanguage),
        summary: auditSummaryLabel(event, request.uiLanguage, request.terminology), ipHash: event.ip_hash, userAgentHash: event.user_agent_hash,
      },
      changes: changesFor(event, request.uiLanguage, request.terminology),
      metadata: Object.entries(event.metadata || {}).map(([key, value]) => ({ label: translatedFieldLabel(key, request.uiLanguage, request.terminology), value: displayValue(value, request.uiLanguage, request.terminology) })),
    });
  } catch (error) {
    console.error('Unable to load audit event detail:', error.code || error.message);
    response.status(500).json({ error: 'AUDIT_EVENT_UNAVAILABLE' });
  }
});

module.exports = router;
