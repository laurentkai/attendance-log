const { pool } = require('./db/client');
const { t } = require('./i18n');
const { isValidPublicId } = require('./public-id');
const { getTerm } = require('./terminology');
const { escapeHtml } = require('./ui');

const MAX_EXTERNAL_RECIPIENTS = 50;
const MAX_EXTERNAL_INPUT_LENGTH = 12750;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class SessionSummaryConfigurationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SessionSummaryConfigurationError';
    this.code = code;
  }
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLocaleLowerCase('en') : '';
  return email.length <= 254 && emailPattern.test(email) ? email : '';
}

function rawAdminRecipientIds(body = {}) {
  const value = body.summary_admin_user_ids;
  return Array.isArray(value) ? value : value ? [value] : [];
}

function parseExternalRecipients(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return [];
  if (input.length > MAX_EXTERNAL_INPUT_LENGTH) {
    throw new SessionSummaryConfigurationError('SUMMARY_RECIPIENTS_INVALID');
  }
  const values = input.split(/[\n,;]+/).map((entry) => entry.trim()).filter(Boolean);
  if (values.length > MAX_EXTERNAL_RECIPIENTS) {
    throw new SessionSummaryConfigurationError('SUMMARY_RECIPIENTS_INVALID');
  }
  const normalized = values.map(normalizeEmail);
  if (normalized.some((email) => !email)) {
    throw new SessionSummaryConfigurationError('SUMMARY_RECIPIENTS_INVALID');
  }
  return [...new Set(normalized)];
}

function parseSummaryRecipientInput(body = {}, { attachmentScope }) {
  const adminRecipientIds = [...new Set(rawAdminRecipientIds(body).map((value) => String(value).trim()))];
  if (adminRecipientIds.length > 50 || adminRecipientIds.some((value) => !isValidPublicId(value))) {
    throw new SessionSummaryConfigurationError('SUMMARY_RECIPIENTS_INVALID');
  }
  const externalRecipients = parseExternalRecipients(body.summary_external_recipients);
  if (attachmentScope === 'class') {
    return {
      adminRecipientIds,
      externalRecipients,
      attachXlsx: body.summary_attach_xlsx === 'on',
    };
  }
  if (attachmentScope !== 'session') {
    throw new SessionSummaryConfigurationError('SUMMARY_CONFIGURATION_INVALID');
  }
  const attachmentValue = typeof body.summary_attach_xlsx_override === 'string'
    ? body.summary_attach_xlsx_override
    : '';
  if (!['', 'true', 'false'].includes(attachmentValue)) {
    throw new SessionSummaryConfigurationError('SUMMARY_CONFIGURATION_INVALID');
  }
  return {
    adminRecipientIds,
    externalRecipients,
    attachXlsxOverride: attachmentValue === '' ? null : attachmentValue === 'true',
  };
}

async function loadSummaryAdminOptions(client = pool) {
  const result = await client.query(
    `SELECT public_id, name, email, active
     FROM admin_users
     WHERE account_type = 'otp' AND email IS NOT NULL
     ORDER BY active DESC, LOWER(name), id`,
  );
  return result.rows;
}

async function loadRecipientRows(client, { parentColumn, parentId, adminTable, externalTable }) {
  const [admins, external] = await Promise.all([
    client.query(
      `SELECT u.public_id
       FROM ${adminTable} r
       INNER JOIN admin_users u ON u.id = r.admin_user_id
       WHERE r.${parentColumn} = $1
       ORDER BY u.id`,
      [parentId],
    ),
    client.query(
      `SELECT email FROM ${externalTable}
       WHERE ${parentColumn} = $1 ORDER BY LOWER(email), id`,
      [parentId],
    ),
  ]);
  return {
    adminRecipientIds: admins.rows.map((row) => row.public_id),
    externalRecipients: external.rows.map((row) => row.email),
  };
}

async function loadClassSummaryConfiguration(classId, client = pool) {
  const result = await client.query(
    'SELECT summary_attach_xlsx FROM classes WHERE id = $1',
    [classId],
  );
  if (result.rowCount === 0) return null;
  return {
    ...await loadRecipientRows(client, {
      parentColumn: 'class_id', parentId: classId,
      adminTable: 'class_summary_admin_recipients',
      externalTable: 'class_summary_external_recipients',
    }),
    attachXlsx: result.rows[0].summary_attach_xlsx,
  };
}

async function loadSessionSummaryConfiguration(sessionId, client = pool) {
  const result = await client.query(
    `SELECT cs.summary_attach_xlsx_override, c.summary_attach_xlsx AS class_attach_xlsx
     FROM course_sessions cs INNER JOIN classes c ON c.id = cs.class_id
     WHERE cs.id = $1`,
    [sessionId],
  );
  if (result.rowCount === 0) return null;
  return {
    ...await loadRecipientRows(client, {
      parentColumn: 'session_id', parentId: sessionId,
      adminTable: 'session_summary_admin_recipients',
      externalTable: 'session_summary_external_recipients',
    }),
    attachXlsxOverride: result.rows[0].summary_attach_xlsx_override,
    classAttachXlsx: result.rows[0].class_attach_xlsx,
  };
}

async function replaceSummaryRecipients(client, {
  parentColumn, parentId, adminTable, externalTable, adminRecipientIds, externalRecipients,
}) {
  const resolved = adminRecipientIds.length === 0 ? { rows: [] } : await client.query(
    `SELECT id, public_id FROM admin_users
     WHERE public_id = ANY($1::uuid[]) AND account_type = 'otp' AND email IS NOT NULL`,
    [adminRecipientIds],
  );
  if (resolved.rows.length !== adminRecipientIds.length) {
    throw new SessionSummaryConfigurationError('SUMMARY_RECIPIENTS_INVALID');
  }
  await client.query(`DELETE FROM ${adminTable} WHERE ${parentColumn} = $1`, [parentId]);
  await client.query(`DELETE FROM ${externalTable} WHERE ${parentColumn} = $1`, [parentId]);
  for (const user of resolved.rows) {
    await client.query(
      `INSERT INTO ${adminTable} (${parentColumn}, admin_user_id) VALUES ($1, $2)`,
      [parentId, user.id],
    );
  }
  for (const email of externalRecipients) {
    await client.query(
      `INSERT INTO ${externalTable} (${parentColumn}, email) VALUES ($1, $2)`,
      [parentId, email],
    );
  }
}

async function saveClassSummaryConfiguration(client, classId, configuration) {
  await client.query('UPDATE classes SET summary_attach_xlsx = $1 WHERE id = $2', [configuration.attachXlsx, classId]);
  await replaceSummaryRecipients(client, {
    parentColumn: 'class_id', parentId: classId,
    adminTable: 'class_summary_admin_recipients',
    externalTable: 'class_summary_external_recipients',
    ...configuration,
  });
}

async function saveSessionSummaryConfiguration(client, sessionId, configuration) {
  await client.query(
    'UPDATE course_sessions SET summary_attach_xlsx_override = $1 WHERE id = $2',
    [configuration.attachXlsxOverride, sessionId],
  );
  await replaceSummaryRecipients(client, {
    parentColumn: 'session_id', parentId: sessionId,
    adminTable: 'session_summary_admin_recipients',
    externalTable: 'session_summary_external_recipients',
    ...configuration,
  });
}

function summaryConfigurationSnapshot(configuration, scope) {
  return {
    summary_admin_recipient_count: configuration.adminRecipientIds.length,
    summary_external_recipient_count: configuration.externalRecipients.length,
    ...(scope === 'class'
      ? { summary_attach_xlsx: configuration.attachXlsx }
      : { summary_attach_xlsx_override: configuration.attachXlsxOverride }),
  };
}

function summaryConfigurationChanged(before, after, scope) {
  const normalizeIds = (values) => [...values].sort().join('|');
  const normalizeEmails = (values) => [...values].map(normalizeEmail).sort().join('|');
  return normalizeIds(before.adminRecipientIds) !== normalizeIds(after.adminRecipientIds)
    || normalizeEmails(before.externalRecipients) !== normalizeEmails(after.externalRecipients)
    || (scope === 'class'
      ? before.attachXlsx !== after.attachXlsx
      : before.attachXlsxOverride !== after.attachXlsxOverride);
}

function renderAdminRecipientOptions(adminUsers, selectedIds, language) {
  const selected = new Set(selectedIds);
  if (adminUsers.length === 0) return `<p class="form-text mb-0">${escapeHtml(t(language, 'summary.config.no_users'))}</p>`;
  return `<div class="border rounded p-2 d-grid gap-1">${adminUsers.map((user) => `<label class="form-check mb-0">
    <input class="form-check-input" name="summary_admin_user_ids" type="checkbox" value="${escapeHtml(user.public_id)}"${selected.has(user.public_id) ? ' checked' : ''}>
    <span class="form-check-label">${escapeHtml(user.name)} <span class="text-body-secondary">· ${escapeHtml(user.email)}${user.active ? '' : ` · ${escapeHtml(t(language, 'status.inactive'))}`}</span></span>
  </label>`).join('')}</div>`;
}

function renderSummaryConfigurationFields({ adminUsers = [], values, scope, inheritedAttachXlsx = false, language }) {
  const classTerm = getTerm(language, 'class');
  const sessionTerm = getTerm(language, 'session');
  const externalValue = values.externalRecipients.join('\n');
  const attachmentControl = scope === 'class'
    ? `<div class="form-check form-switch mb-0">
        <input class="form-check-input" id="summary-attach-xlsx" name="summary_attach_xlsx" type="checkbox"${values.attachXlsx ? ' checked' : ''}>
        <label class="form-check-label" for="summary-attach-xlsx">${escapeHtml(t(language, 'summary.config.attach_xlsx'))}</label>
      </div>`
    : `<div class="form-field mb-0">
        <label for="summary-attach-xlsx-override">${escapeHtml(t(language, 'summary.config.attach_xlsx'))}</label>
        <select class="form-select" id="summary-attach-xlsx-override" name="summary_attach_xlsx_override" data-session-summary-attachment>
          <option value="" data-summary-inherit-option${values.attachXlsxOverride === null ? ' selected' : ''}>${escapeHtml(t(language, 'summary.config.inherit', { class: classTerm, value: t(language, inheritedAttachXlsx ? 'common.yes' : 'common.no') }))}</option>
          <option value="true"${values.attachXlsxOverride === true ? ' selected' : ''}>${escapeHtml(t(language, 'common.yes'))}</option>
          <option value="false"${values.attachXlsxOverride === false ? ' selected' : ''}>${escapeHtml(t(language, 'common.no'))}</option>
        </select>
      </div>`;
  return `<section class="border-top pt-3" aria-labelledby="summary-email-title">
    <div class="section-header mb-3">
      <div><h2 class="h5 mb-1" id="summary-email-title">${escapeHtml(t(language, 'summary.config.title'))}</h2>
      <p class="form-text mb-0">${escapeHtml(t(language, scope === 'class' ? 'summary.config.class_help' : 'summary.config.session_help', scope === 'class' ? { class: classTerm } : { session: sessionTerm }))}</p></div>
    </div>
    <div class="form-field">
      <span class="form-label d-block">${escapeHtml(t(language, 'summary.config.users'))}</span>
      ${renderAdminRecipientOptions(adminUsers, values.adminRecipientIds, language)}
    </div>
    <div class="form-field">
      <label for="summary-external-recipients">${escapeHtml(t(language, 'summary.config.external'))}</label>
      <textarea class="form-control" id="summary-external-recipients" name="summary_external_recipients" rows="3" maxlength="${MAX_EXTERNAL_INPUT_LENGTH}" placeholder="${escapeHtml(t(language, 'summary.config.external_placeholder'))}">${escapeHtml(externalValue)}</textarea>
      <p class="form-text mb-0">${escapeHtml(t(language, 'summary.config.external_help'))}</p>
    </div>
    ${attachmentControl}
  </section>`;
}

module.exports = {
  MAX_EXTERNAL_RECIPIENTS,
  SessionSummaryConfigurationError,
  loadClassSummaryConfiguration,
  loadSessionSummaryConfiguration,
  loadSummaryAdminOptions,
  normalizeEmail,
  parseSummaryRecipientInput,
  renderSummaryConfigurationFields,
  saveClassSummaryConfiguration,
  saveSessionSummaryConfiguration,
  summaryConfigurationChanged,
  summaryConfigurationSnapshot,
};
