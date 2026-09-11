const express = require('express');
const ExcelJS = require('exceljs');
const { pool } = require('./db/client');
const { isValidPublicId } = require('./public-id');
const { escapeHtml, renderMessagePage, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();
const PAGE_SIZE = 25;
const MAX_EXPORT_ROWS = 50000;
const RESULTS = new Set(['success', 'denied', 'failed']);
const CATEGORY_LABELS = Object.freeze({
  attendance: 'Présences', backup: 'Sauvegardes', branding: 'Identité visuelle',
  class: 'Activités', import: 'Import', maintenance: 'Maintenance', mail: 'E-mail',
  restore: 'Restauration', security: 'Sécurité', session: 'Sessions', student: 'Participants',
  terminology: 'Terminologie', user: 'Utilisateurs', print_design: 'Design d’impression',
});
const RESULT_LABELS = Object.freeze({ success: 'Réussi', denied: 'Refusé', failed: 'Échec' });
const COMPACT_RESULT_LABELS = Object.freeze({ success: 'OK', denied: 'Refusé', failed: 'Échec' });
const RESULT_CLASSES = Object.freeze({ success: 'text-success', denied: 'text-warning-emphasis', failed: 'text-danger' });
const ACTION_LABELS = Object.freeze({
  'attendance.manual.update': 'Présence modifiée manuellement',
  'attendance.check_in_time.update': 'Heure d’arrivée corrigée',
  'attendance.qr.present': 'Présence enregistrée par QR',
  'attendance.quick.present': 'Présence enregistrée en mode rapide',
  'attendance.undo': 'Présence rapide annulée',
  'authentication.break_glass.success': 'Connexion d’urgence réussie',
  'authentication.logout': 'Déconnexion',
  'authentication.otp.success': 'Connexion par code réussie',
  'authorization.denied': 'Accès refusé',
  'backup.cloud.run': 'Sauvegarde cloud exécutée',
  'backup.configuration.update': 'Configuration des sauvegardes modifiée',
  'backup.manual.download': 'Sauvegarde téléchargée',
  'backup.scheduled.run': 'Sauvegarde planifiée exécutée',
  'branding.logo.add': 'Logo de l’installation ajouté',
  'branding.logo.remove': 'Logo de l’installation supprimé',
  'branding.logo.replace': 'Logo de l’installation remplacé',
  'class.create': 'Activité créée', 'class.delete': 'Activité supprimée', 'class.update': 'Activité modifiée',
  'class.logo.add': 'Logo d’activité ajouté', 'class.logo.remove': 'Logo d’activité supprimé', 'class.logo.replace': 'Logo d’activité remplacé',
  'mail.configuration.update': 'Configuration e-mail modifiée', 'mail.test': 'Configuration e-mail testée',
  'membership.add': 'Inscription ajoutée', 'membership.deactivate': 'Inscription désactivée', 'membership.reactivate': 'Inscription réactivée', 'membership.remove': 'Inscription supprimée',
  'operational_data.reset': 'Données métier réinitialisées',
  'print_design.save': 'Modèle d’impression enregistré', 'print_design.reset': 'Modèle d’impression réinitialisé',
  'restore.failed': 'Restauration échouée', 'restore.start': 'Restauration démarrée', 'restore.success': 'Restauration réussie',
  'security.recovery_key.export': 'Clé de récupération exportée', 'security.recovery_key.import': 'Clé de récupération importée', 'security.recovery_key.view': 'Clé de récupération affichée',
  'session.close': 'Session clôturée', 'session.create': 'Session créée', 'session.open': 'Session ouverte', 'session.reopen': 'Session rouverte', 'session.update': 'Session modifiée',
  'session.summary.configuration.update': 'Destinataires du résumé modifiés', 'session.summary.send': 'Résumé des présences envoyé', 'session.summary.resend': 'Résumé des présences renvoyé',
  'class.summary.configuration.update': 'Résumé automatique de l’activité modifié',
  'student.create': 'Participant créé', 'student.deactivate': 'Participant désactivé', 'student.import': 'Participants importés', 'student.reactivate': 'Participant réactivé', 'student.update': 'Participant modifié',
  'terminology.reset': 'Terminologie réinitialisée', 'terminology.update': 'Terminologie modifiée',
  'user.activate': 'Utilisateur réactivé', 'user.break_glass.create': 'Compte d’urgence créé', 'user.break_glass.password_change': 'Mot de passe d’urgence modifié',
  'user.create': 'Utilisateur créé', 'user.deactivate': 'Utilisateur désactivé', 'user.delete': 'Utilisateur supprimé',
  'user.edit': 'Utilisateur modifié', 'user.invitation.resend': 'Invitation renvoyée', 'user.invitation.send': 'Invitation envoyée',
  'user.role_change': 'Rôle utilisateur modifié', 'user.sessions.revoke': 'Sessions utilisateur révoquées',
});
const COMPACT_ACTION_LABELS = Object.freeze({
  'attendance.manual.update': 'Présence modifiée',
  'attendance.check_in_time.update': 'Arrivée corrigée',
  'attendance.qr.present': 'Présence QR',
  'attendance.quick.present': 'Présence rapide',
  'attendance.undo': 'Présence annulée',
  'authentication.break_glass.success': 'Connexion d’urgence',
  'authentication.logout': 'Déconnexion',
  'authentication.otp.success': 'Connexion OTP',
  'authorization.denied': 'Accès refusé',
  'backup.cloud.run': 'Sauvegarde cloud',
  'backup.configuration.update': 'Config. sauvegardes',
  'backup.manual.download': 'Sauvegarde téléchargée',
  'backup.scheduled.run': 'Sauvegarde planifiée',
  'branding.logo.add': 'Logo global ajouté',
  'branding.logo.remove': 'Logo global supprimé',
  'branding.logo.replace': 'Logo global remplacé',
  'class.create': 'Activité créée', 'class.delete': 'Activité supprimée', 'class.update': 'Activité modifiée',
  'class.logo.add': 'Logo activité ajouté', 'class.logo.remove': 'Logo activité supprimé', 'class.logo.replace': 'Logo activité remplacé',
  'mail.configuration.update': 'Config. e-mail', 'mail.test': 'Test e-mail',
  'membership.add': 'Inscription ajoutée', 'membership.deactivate': 'Inscription désactivée', 'membership.reactivate': 'Inscription réactivée', 'membership.remove': 'Inscription supprimée',
  'operational_data.reset': 'Données réinitialisées',
  'print_design.save': 'Modèle enregistré', 'print_design.reset': 'Modèle réinitialisé',
  'restore.failed': 'Restauration échouée', 'restore.start': 'Restauration démarrée', 'restore.success': 'Restauration réussie',
  'security.recovery_key.export': 'Clé exportée', 'security.recovery_key.import': 'Clé importée', 'security.recovery_key.view': 'Clé affichée',
  'session.close': 'Session clôturée', 'session.create': 'Session créée', 'session.open': 'Session ouverte', 'session.reopen': 'Session rouverte', 'session.update': 'Session modifiée',
  'session.summary.configuration.update': 'Config. résumé', 'session.summary.send': 'Résumé envoyé', 'session.summary.resend': 'Résumé renvoyé',
  'class.summary.configuration.update': 'Config. résumé activité',
  'student.create': 'Participant créé', 'student.deactivate': 'Participant désactivé', 'student.import': 'Participants importés', 'student.reactivate': 'Participant réactivé', 'student.update': 'Participant modifié',
  'terminology.reset': 'Termes réinitialisés', 'terminology.update': 'Termes modifiés',
  'user.activate': 'Utilisateur réactivé', 'user.break_glass.create': 'Compte local créé', 'user.break_glass.password_change': 'Mot de passe modifié',
  'user.create': 'Utilisateur créé', 'user.deactivate': 'Utilisateur désactivé', 'user.delete': 'Utilisateur supprimé',
  'user.edit': 'Utilisateur modifié', 'user.invitation.resend': 'Invitation renvoyée', 'user.invitation.send': 'Invitation envoyée',
  'user.role_change': 'Rôle modifié', 'user.sessions.revoke': 'Sessions révoquées',
});
const FIELD_LABELS = Object.freeze({
  active: 'État actif', date: 'Date', description: 'Description', email: 'Adresse e-mail', enabled: 'Activation',
  execution_time: 'Heure', frequency: 'Fréquence', instructor: 'Responsable', name: 'Nom',
  notes: 'Notes', retention_days: 'Rétention', role: 'Rôle', state: 'État', status: 'Statut', title: 'Titre',
  weekly_day: 'Jour hebdomadaire', student_singular: 'Participant (singulier)',
  student_plural: 'Participant (pluriel)', class_singular: 'Activité (singulier)',
  class_plural: 'Activité (pluriel)', session_singular: 'Session (singulier)',
  session_plural: 'Session (pluriel)', attendance_singular: 'Présence (singulier)',
  attendance_plural: 'Présence (pluriel)', instructor_singular: 'Responsable (singulier)',
  instructor_plural: 'Responsable (pluriel)', membership_singular: 'Inscription (singulier)',
  membership_plural: 'Inscription (pluriel)',
  checked_in_at: 'Heure d’arrivée', start_time: 'Heure de début',
  punctuality_tolerance_minutes: 'Tolérance de l’activité',
  punctuality_tolerance_override_minutes: 'Tolérance de la session',
  summary_attach_xlsx: 'Excel par défaut', summary_attach_xlsx_override: 'Excel pour la session',
  summary_admin_recipient_count: 'Utilisateurs destinataires',
  summary_external_recipient_count: 'Adresses externes',
  view_pii: 'Voir les données personnelles (PII)',
});

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
    category: Object.hasOwn(CATEGORY_LABELS, query.category) ? query.category : '',
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
  return new Intl.DateTimeFormat('fr-BE', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: process.env.BACKUP_TIMEZONE || 'Europe/Brussels',
  }).format(new Date(value));
}

function formatCompactDateTime(value) {
  return new Intl.DateTimeFormat('fr-BE', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: process.env.BACKUP_TIMEZONE || 'Europe/Brussels',
  }).format(new Date(value));
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${displayValue(item)}`).join(', ');
  return String(value);
}

function changesFor(row) {
  const before = row.before_data || {};
  const after = row.after_data || {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].map((field) => ({
    field,
    label: FIELD_LABELS[field] || field.replaceAll('_', ' '),
    before: displayValue(before[field]),
    after: displayValue(after[field]),
  })).filter((change) => change.before !== change.after);
}

function actionLabel(action) {
  return ACTION_LABELS[action] || action.split('.').map((part) => part.replaceAll('_', ' ')).join(' · ');
}

function compactActionLabel(action) {
  return COMPACT_ACTION_LABELS[action] || actionLabel(action);
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

function exportRow(row) {
  const changes = changesFor(row).map((change) => `${change.label}: ${change.before} -> ${change.after}`).join(' | ');
  return [
    new Date(row.occurred_at).toISOString(), row.actor_name || 'Système', row.actor_role || '',
    CATEGORY_LABELS[row.category] || row.category, row.action, row.target_type || '',
    row.target_label || '', RESULT_LABELS[row.result] || row.result, row.summary, changes,
  ];
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

router.get('/', async (request, response) => {
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
      <td><span class="data-table-cell-truncate fw-semibold" title="${escapeHtml(event.actor_name || 'Système')}">${escapeHtml(event.actor_name || 'Système')}</span></td>
      <td><span class="data-table-cell-truncate" title="${escapeHtml(actionLabel(event.action))}">${escapeHtml(compactActionLabel(event.action))}</span></td>
      <td><span class="data-table-cell-truncate" title="${escapeHtml(event.target_label || event.target_type || '—')}">${escapeHtml(event.target_label || event.target_type || '—')}</span></td>
      <td><span class="data-table-result-state ${RESULT_CLASSES[event.result]}">${escapeHtml(COMPACT_RESULT_LABELS[event.result])}</span></td>
      <td class="data-table-chevron"><button class="data-table-row-trigger" type="button" data-audit-detail-url="/settings/audit/${event.public_id}" aria-label="Afficher les détails de l’événement du ${escapeHtml(formatDateTime(event.occurred_at))}" title="Afficher les détails">›</button></td>
    </tr>`).join('') : '<tr><td class="text-center text-body-secondary py-4" colspan="6">Aucun événement ne correspond aux filtres.</td></tr>';
    const params = filterQuery(filters);
    const previous = new URLSearchParams(params); previous.set('page', String(page - 1));
    const next = new URLSearchParams(params); next.set('page', String(page + 1));
    const exportParams = params.toString();
    const pagination = totalPages > 1 ? `<nav class="d-flex align-items-center justify-content-between gap-3" aria-label="Pagination du journal">
      ${page > 1 ? `<a class="btn btn-sm btn-light" href="?${previous}">Précédent</a>` : '<span></span>'}
      <span class="small text-body-secondary">Page ${page} sur ${totalPages}</span>
      ${page < totalPages ? `<a class="btn btn-sm btn-light" href="?${next}">Suivant</a>` : '<span></span>'}
    </nav>` : '';
    response.set('Cache-Control', 'private, no-store');
    response.send(renderPage('Journal d’audit', renderSettingsLayout({
      activeSection: 'audit',
      title: 'Journal d’audit',
      description: 'Consultez les actions métier et de sécurité significatives. Les événements sont conservés sans suppression automatique.',
      status: `<div class="btn-group" role="group" aria-label="Exporter le journal"><a class="btn btn-light" href="/settings/audit/export.csv${exportParams ? `?${escapeHtml(exportParams)}` : ''}">CSV</a><a class="btn btn-light" href="/settings/audit/export.xlsx${exportParams ? `?${escapeHtml(exportParams)}` : ''}">Excel</a></div>`,
      content: `<form class="card card-body app-form" method="get" action="/settings/audit">
        <div class="row g-3">
          <div class="col-sm-6 col-xl-3"><label class="form-label" for="audit-date-from">Du</label><input class="form-control" id="audit-date-from" name="date_from" type="date" value="${escapeHtml(filters.dateFrom)}"></div>
          <div class="col-sm-6 col-xl-3"><label class="form-label" for="audit-date-to">Au</label><input class="form-control" id="audit-date-to" name="date_to" type="date" value="${escapeHtml(filters.dateTo)}"></div>
          <div class="col-sm-6 col-xl-3"><label class="form-label" for="audit-actor">Utilisateur</label><select class="form-select" id="audit-actor" name="actor">${renderOptions(actors.rows.map((actor) => [actor.public_id, actor.name]), filters.actor, 'Tous')}</select></div>
          <div class="col-sm-6 col-xl-3"><label class="form-label" for="audit-result">Résultat</label><select class="form-select" id="audit-result" name="result">${renderOptions(Object.entries(RESULT_LABELS), filters.result, 'Tous')}</select></div>
          <div class="col-sm-6"><label class="form-label" for="audit-category">Catégorie</label><select class="form-select" id="audit-category" name="category">${renderOptions(Object.entries(CATEGORY_LABELS), filters.category, 'Toutes')}</select></div>
          <div class="col-sm-6"><label class="form-label" for="audit-action">Action</label><select class="form-select" id="audit-action" name="action">${renderOptions(actions.rows.map(({ action }) => [action, actionLabel(action)]), filters.action, 'Toutes')}</select></div>
        </div>
        <div class="form-actions d-flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">Filtrer</button><a class="btn btn-outline-secondary" href="/settings/audit">Réinitialiser</a></div>
      </form>
      <section aria-label="Événements d’audit">
        <div class="table-responsive border-top border-bottom" tabindex="0" role="region" aria-label="Liste des événements d’audit"><table class="table table-sm table-hover align-middle mb-0 data-table data-table-compact"><colgroup><col class="data-table-col-date"><col class="data-table-col-actor"><col class="data-table-col-action"><col class="data-table-col-target"><col class="data-table-col-result"><col class="data-table-col-chevron"></colgroup><thead><tr><th scope="col">Date</th><th scope="col">Utilisateur</th><th scope="col">Action</th><th scope="col">Cible</th><th scope="col">Résultat</th><th class="data-table-chevron" scope="col"><span class="visually-hidden">Détails</span></th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="px-2 py-2">${pagination || `<span class="small text-body-secondary">${total} événement${total === 1 ? '' : 's'}</span>`}</div>
      </section>`,
      after: `<div class="offcanvas offcanvas-end" tabindex="-1" id="audit-detail" aria-labelledby="audit-detail-title">
        <div class="offcanvas-header"><h2 class="offcanvas-title h5" id="audit-detail-title">Détail de l’événement</h2><button class="btn-close" type="button" data-bs-dismiss="offcanvas" aria-label="Fermer"></button></div>
        <div class="offcanvas-body">
          <section><h3 class="h6">Détails</h3><dl class="audit-detail-list">
            <dt>Date</dt><dd data-audit-field="timestamp">—</dd><dt>Utilisateur</dt><dd data-audit-field="actor">—</dd><dt>Rôle</dt><dd data-audit-field="role">—</dd><dt>Action</dt><dd data-audit-field="action">—</dd><dt>Cible</dt><dd data-audit-field="target">—</dd><dt>Résultat</dt><dd data-audit-field="result">—</dd><dt>Résumé</dt><dd data-audit-field="summary">—</dd><dt>Empreinte IP</dt><dd class="text-break font-monospace small" data-audit-field="ipHash">—</dd><dt>Empreinte navigateur</dt><dd class="text-break font-monospace small" data-audit-field="userAgentHash">—</dd>
          </dl></section>
          <section class="border-top pt-3 mt-3"><h3 class="h6">Modifications</h3><div data-audit-changes></div></section>
          <section class="border-top pt-3 mt-3"><h3 class="h6">Informations complémentaires</h3><ul class="small ps-3 mb-0" data-audit-metadata></ul></section>
        </div>
      </div><script src="/js/audit-log.js" defer></script>`,
    })));
  } catch (error) {
    console.error('Unable to load audit log:', error.code || error.message);
    const pageContent = renderMessagePage('Journal d’audit indisponible', 'Impossible de charger le journal d’audit pour le moment.');
    response.status(pageContent.status).send(pageContent.html);
  }
});

router.get('/export.csv', async (request, response) => {
  try {
    const rows = await loadExportRows(filtersFrom(request.query));
    const headers = ['Timestamp', 'Utilisateur', 'Rôle', 'Catégorie', 'Action', 'Type de cible', 'Cible', 'Résultat', 'Résumé', 'Modifications'];
    const csv = [headers, ...rows.map(exportRow)].map((row) => row.map(csvCell).join(',')).join('\r\n');
    response.set({ 'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="attendance-log-audit.csv"', 'Content-Type': 'text/csv; charset=utf-8' });
    response.send(`\uFEFF${csv}`);
  } catch (error) {
    const status = error.code === 'AUDIT_EXPORT_TOO_LARGE' ? 413 : 500;
    response.status(status).send(renderMessagePage('Export indisponible', status === 413 ? 'Affinez les filtres avant d’exporter le journal.' : 'Impossible d’exporter le journal pour le moment.', status).html);
  }
});

router.get('/export.xlsx', async (request, response) => {
  try {
    const rows = await loadExportRows(filtersFrom(request.query));
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Attendance Log';
    const sheet = workbook.addWorksheet('Journal audit');
    sheet.columns = [
      ['Timestamp', 26], ['Utilisateur', 24], ['Rôle', 20], ['Catégorie', 20], ['Action', 28],
      ['Type de cible', 18], ['Cible', 28], ['Résultat', 14], ['Résumé', 55], ['Modifications', 55],
    ].map(([header, width]) => ({ header, width }));
    for (const row of rows) sheet.addRow(exportRow(row));
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: 'J1' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    response.set({ 'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="attendance-log-audit.xlsx"', 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    response.send(Buffer.from(buffer));
  } catch (error) {
    const status = error.code === 'AUDIT_EXPORT_TOO_LARGE' ? 413 : 500;
    response.status(status).send(renderMessagePage('Export indisponible', status === 413 ? 'Affinez les filtres avant d’exporter le journal.' : 'Impossible d’exporter le journal pour le moment.', status).html);
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
        timestamp: formatDateTime(event.occurred_at), actor: event.actor_name || 'Système', role: event.actor_role || '—',
        action: `${CATEGORY_LABELS[event.category] || event.category} · ${actionLabel(event.action)}`,
        target: event.target_label || event.target_type || '—', result: RESULT_LABELS[event.result] || event.result,
        summary: event.summary, ipHash: event.ip_hash, userAgentHash: event.user_agent_hash,
      },
      changes: changesFor(event),
      metadata: Object.entries(event.metadata || {}).map(([key, value]) => ({ label: key.replaceAll('_', ' '), value: displayValue(value) })),
    });
  } catch (error) {
    console.error('Unable to load audit event detail:', error.code || error.message);
    response.status(500).json({ error: 'AUDIT_EVENT_UNAVAILABLE' });
  }
});

module.exports = router;
