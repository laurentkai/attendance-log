const express = require('express');
const { formatDateTime, formatNumber, getApplicationLocale, getApplicationTimezone } = require('./application-time');
const { recordAuditEvent, recordAuditEventSafely } = require('./audit');
const { pool, withTransaction } = require('./db/client');
const {
  BackupError,
  calculateNextRunAt,
  createManualDownload,
  loadBackupConfiguration,
  runCloudBackup,
  secretPurposes,
  testDestination,
  validateProviderConfiguration,
} = require('./backup');
const { encryptSecret } = require('./secrets');
const { DEFAULT_LANGUAGE, t } = require('./i18n');
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');
const restoreSettingsRouter = require('./restore-settings');

const router = express.Router();
router.use('/restore', restoreSettingsRouter);
const frequencies = new Set(['daily', 'weekly']);
const providers = new Set(['', 's3', 'azure']);
function weekdays() {
  const formatter = new Intl.DateTimeFormat(getApplicationLocale(), { weekday: 'long', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_value, index) => formatter.format(new Date(Date.UTC(2023, 0, index + 1))));
}

function emptyValues() {
  return {
    enabled: false,
    provider: '',
    frequency: 'daily',
    executionTime: '02:00',
    weekday: '',
    retentionDays: '30',
    s3: {
      bucket: '', region: '', endpoint: '', prefix: '', accessKeyId: '', forcePathStyle: false,
    },
    azure: { accountName: '', containerName: '' },
  };
}

function publicValues(configuration) {
  if (!configuration) return emptyValues();
  return {
    enabled: configuration.enabled,
    provider: configuration.provider,
    frequency: configuration.frequency,
    executionTime: configuration.executionTime,
    weekday: configuration.weekday,
    retentionDays: String(configuration.retentionDays),
    s3: {
      bucket: configuration.s3.bucket,
      region: configuration.s3.region,
      endpoint: configuration.s3.endpoint,
      prefix: configuration.s3.prefix,
      accessKeyId: configuration.s3.accessKeyId,
      forcePathStyle: configuration.s3.forcePathStyle,
    },
    azure: {
      accountName: configuration.azure.accountName,
      containerName: configuration.azure.containerName,
    },
  };
}

function getFormValues(body = {}) {
  const text = (name) => typeof body[name] === 'string' ? body[name].trim() : '';
  return {
    enabled: body.enabled === 'yes',
    provider: text('provider'),
    frequency: text('frequency'),
    executionTime: text('execution_time'),
    weekday: text('weekday'),
    retentionDays: text('retention_days'),
    s3: {
      bucket: text('s3_bucket'),
      region: text('s3_region'),
      endpoint: text('s3_endpoint'),
      prefix: text('s3_prefix'),
      accessKeyId: text('s3_access_key_id'),
      secretAccessKey: typeof body.s3_secret_access_key === 'string'
        ? body.s3_secret_access_key : '',
      forcePathStyle: body.s3_force_path_style === 'yes',
    },
    azure: {
      accountName: text('azure_account_name').toLowerCase(),
      containerName: text('azure_container_name').toLowerCase(),
      accountKey: typeof body.azure_account_key === 'string' ? body.azure_account_key : '',
    },
  };
}

function validateSchedule(values) {
  if (!providers.has(values.provider)) return new BackupError('PROVIDER_UNSUPPORTED');
  if (values.enabled && !values.provider) return new BackupError('PROVIDER_REQUIRED');
  const retentionDays = Number(values.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    return new BackupError('RETENTION_INVALID');
  }
  if (!values.enabled) return null;
  if (!frequencies.has(values.frequency)) return new BackupError('FREQUENCY_INVALID');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.executionTime)) {
    return new BackupError('EXECUTION_TIME_INVALID');
  }
  if (values.frequency === 'weekly' && !/^[0-6]$/.test(values.weekday)) {
    return new BackupError('WEEKDAY_INVALID');
  }
  return null;
}

function errorMessage(code, language = DEFAULT_LANGUAGE) {
  try { return t(language, `backup.error.${code}`); } catch (_error) { return t(language, 'backup.error.default'); }
}

function formatTimestamp(value) {
  if (!value) return '—';
  return formatDateTime(value, { dateStyle: 'short', timeStyle: 'short' });
}

function formatSize(value) {
  if (value === null || value === undefined) return '—';
  return formatNumber(Number(value) / (Number(value) >= 1024 * 1024 ? 1024 * 1024 : 1024), {
    style: 'unit', unit: Number(value) >= 1024 * 1024 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1,
  });
}

function historyLabel(value, language) {
  if (['s3', 'azure'].includes(value)) return value === 's3' ? 'S3' : 'Azure Blob';
  try { return t(language, `backup.history.${value}`); } catch (_error) { return value; }
}

function renderBackupPage({ values, history = [], feedback = null, nextRunAt = null, language = DEFAULT_LANGUAGE }) {
  const configured = Boolean(values.provider);
  const feedbackMessage = feedback?.message
    ? `<p class="alert alert-${feedback.type === 'success' ? 'success' : 'danger'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';
  const historyRows = history.length === 0
    ? `<p class="empty-state">${escapeHtml(t(language, 'backup.history.empty'))}</p>`
    : `<div class="table-responsive data-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(t(language, 'backup.history.label'))}">
        <table class="table table-sm table-hover align-middle mb-0 data-table backup-history-table">
          <thead class="table-light"><tr><th>${escapeHtml(t(language, 'common.date'))}</th><th>${escapeHtml(t(language, 'backup.history.type'))}</th><th>${escapeHtml(t(language, 'backup.destination'))}</th><th>${escapeHtml(t(language, 'backup.history.size'))}</th><th>${escapeHtml(t(language, 'common.status'))}</th></tr></thead>
          <tbody>${history.map((entry) => `<tr>
            <td>${escapeHtml(formatTimestamp(entry.started_at))}</td>
            <td>${escapeHtml(historyLabel(entry.run_type, language))}</td>
            <td>${escapeHtml(historyLabel(entry.provider, language))}</td>
            <td class="numeric">${escapeHtml(formatSize(entry.size_bytes))}</td>
            <td><span class="badge status-badge status-${entry.status === 'success' ? 'active' : 'absent'}">${escapeHtml(t(language, entry.status === 'success' ? 'status.success' : 'status.failed'))}</span>${entry.error_summary ? `<p class="compact-meta">${escapeHtml(errorMessage(entry.error_summary, language))}</p>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  const latestFailure = history[0]?.status === 'failed'
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(t(language, 'backup.history.latest_failure', { date: formatTimestamp(history[0].started_at), message: errorMessage(history[0].error_summary, language) }))}</p>`
    : '';

  return renderPage(t(language, 'backup.title'), renderSettingsLayout({
    activeSection: 'backups',
    title: t(language, 'backup.title'),
    description: t(language, 'backup.description'),
    status: `<span class="badge status-badge status-${values.enabled ? 'active' : 'inactive'}">${escapeHtml(t(language, values.enabled ? 'backup.automatic.active' : 'backup.automatic.inactive'))}</span>`,
    notifications: feedbackMessage,
    contentClass: 'backup-settings',
    content: `<section class="page-section" aria-labelledby="manual-backup-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="manual-backup-title">${escapeHtml(t(language, 'backup.manual.title'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'backup.manual.description'))}</p>
          </div>
        </div>
        <div class="card card-body app-form">
          <p class="help-text">${escapeHtml(t(language, 'backup.manual.secret_help'))}</p>
          <form method="post" action="/settings/backups/download">
            <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'backup.manual.download'))}</button>
          </form>
        </div>
      </section>

      <section class="page-section" aria-labelledby="automatic-backup-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="automatic-backup-title">${escapeHtml(t(language, 'backup.automatic.title'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'backup.automatic.schedule', { timezone: getApplicationTimezone() }))}${nextRunAt ? ` · ${escapeHtml(t(language, 'backup.automatic.next', { date: formatTimestamp(nextRunAt) }))}` : ''}.</p>
          </div>
        </div>
        <form class="card card-body app-form" method="post" action="/settings/backups" autocomplete="off">
          <section class="backup-form-section" aria-labelledby="backup-destination-title">
            <div>
              <h3 id="backup-destination-title">${escapeHtml(t(language, 'backup.destination.title'))}</h3>
              <p class="section-description">${escapeHtml(t(language, 'backup.destination.help'))}</p>
            </div>
            <div class="form-field">
              <label for="backup-provider">${escapeHtml(t(language, 'backup.destination'))}</label>
              <select class="form-select" id="backup-provider" name="provider" data-backup-provider>
                <option value=""${values.provider === '' ? ' selected' : ''}>${escapeHtml(t(language, 'backup.select'))}</option>
                <option value="s3"${values.provider === 's3' ? ' selected' : ''}>Amazon S3 / S3-compatible</option>
                <option value="azure"${values.provider === 'azure' ? ' selected' : ''}>Azure Blob Storage</option>
              </select>
            </div>

            <fieldset data-provider-fields="s3"${values.provider !== 's3' ? ' hidden' : ''}>
              <legend>S3-compatible</legend>
              <div class="form-field"><label for="s3-bucket">${escapeHtml(t(language, 'backup.s3.bucket'))}</label><input class="form-control" id="s3-bucket" name="s3_bucket" value="${escapeHtml(values.s3.bucket)}" autocomplete="off" spellcheck="false"></div>
              <div class="form-field"><label for="s3-region">${escapeHtml(t(language, 'backup.s3.region'))}</label><input class="form-control" id="s3-region" name="s3_region" value="${escapeHtml(values.s3.region)}" autocomplete="off" spellcheck="false" placeholder="eu-west-1"></div>
              <div class="form-field"><label for="s3-endpoint">${escapeHtml(t(language, 'backup.s3.endpoint'))}</label><input class="form-control" id="s3-endpoint" name="s3_endpoint" type="url" value="${escapeHtml(values.s3.endpoint)}" autocomplete="off" spellcheck="false" placeholder="https://storage.example.com"></div>
              <div class="form-field"><label for="s3-prefix">${escapeHtml(t(language, 'backup.s3.prefix'))}</label><input class="form-control" id="s3-prefix" name="s3_prefix" value="${escapeHtml(values.s3.prefix)}" autocomplete="off" spellcheck="false" placeholder="backups"></div>
              <div class="form-field"><label for="s3-access-key">${escapeHtml(t(language, 'backup.s3.access_key'))}</label><input class="form-control" id="s3-access-key" name="s3_access_key_id" value="${escapeHtml(values.s3.accessKeyId)}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
              <div class="form-field"><label for="s3-secret-key">${escapeHtml(t(language, 'backup.s3.secret_key'))}</label><input class="form-control" id="s3-secret-key" name="s3_secret_access_key" type="password" value="" autocomplete="new-password" placeholder="${escapeHtml(t(language, 'backup.secret.placeholder'))}"><p class="help-text">${escapeHtml(t(language, 'backup.secret.keep'))}</p></div>
              <label class="checkbox-option"><input class="form-check-input" name="s3_force_path_style" type="checkbox" value="yes"${values.s3.forcePathStyle ? ' checked' : ''}><span>${escapeHtml(t(language, 'backup.s3.path_style'))}</span></label>
            </fieldset>

            <fieldset data-provider-fields="azure"${values.provider !== 'azure' ? ' hidden' : ''}>
              <legend>Azure Blob Storage</legend>
              <div class="form-field"><label for="azure-account">${escapeHtml(t(language, 'backup.azure.account'))}</label><input class="form-control" id="azure-account" name="azure_account_name" value="${escapeHtml(values.azure.accountName)}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
              <div class="form-field"><label for="azure-container">${escapeHtml(t(language, 'backup.azure.container'))}</label><input class="form-control" id="azure-container" name="azure_container_name" value="${escapeHtml(values.azure.containerName)}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
              <div class="form-field"><label for="azure-key">${escapeHtml(t(language, 'backup.azure.key'))}</label><input class="form-control" id="azure-key" name="azure_account_key" type="password" value="" autocomplete="new-password" placeholder="${escapeHtml(t(language, 'backup.secret.placeholder'))}"><p class="help-text">${escapeHtml(t(language, 'backup.secret.keep'))}</p></div>
            </fieldset>

            <div class="form-field"><label for="retention-days">${escapeHtml(t(language, 'backup.retention_days'))}</label><input class="form-control" id="retention-days" name="retention_days" type="number" min="1" max="3650" inputmode="numeric" value="${escapeHtml(values.retentionDays)}" required></div>
            <p class="help-text">${escapeHtml(t(language, 'backup.retention_help'))}</p>
          </section>

          <section class="backup-form-section backup-schedule-section" aria-labelledby="backup-schedule-title">
            <div>
              <h3 id="backup-schedule-title">${escapeHtml(t(language, 'backup.schedule.title'))}</h3>
              <p class="section-description">${escapeHtml(t(language, 'backup.schedule.help'))}</p>
            </div>
            <div class="form-check form-switch backup-schedule-switch">
              <input class="form-check-input" id="backup-enabled" name="enabled" type="checkbox" role="switch" value="yes" data-backup-enabled aria-controls="backup-schedule-controls"${values.enabled ? ' checked' : ''}>
              <label class="form-check-label" for="backup-enabled">${escapeHtml(t(language, 'backup.schedule.enable'))}</label>
            </div>
            <div class="backup-schedule-controls${values.enabled ? '' : ' is-disabled'}" id="backup-schedule-controls" data-backup-schedule-controls aria-disabled="${values.enabled ? 'false' : 'true'}">
              <div class="backup-schedule-grid">
                <div class="form-field"><label for="backup-frequency">${escapeHtml(t(language, 'backup.schedule.frequency'))}</label><select class="form-select" id="backup-frequency" name="frequency" data-backup-frequency data-saved-value="${escapeHtml(values.frequency || 'daily')}" required${values.enabled ? '' : ' disabled'}><option value=""${values.enabled ? '' : ' selected'}>${escapeHtml(t(language, 'backup.select'))}</option><option value="daily"${values.enabled && values.frequency === 'daily' ? ' selected' : ''}>${escapeHtml(t(language, 'backup.schedule.daily'))}</option><option value="weekly"${values.enabled && values.frequency === 'weekly' ? ' selected' : ''}>${escapeHtml(t(language, 'backup.schedule.weekly'))}</option></select></div>
                <div class="form-field"><label for="backup-time">${escapeHtml(t(language, 'backup.schedule.time'))}</label><input class="form-control" id="backup-time" name="execution_time" type="time" value="${values.enabled ? escapeHtml(values.executionTime) : ''}" data-saved-value="${escapeHtml(values.executionTime || '02:00')}" required${values.enabled ? '' : ' disabled'}></div>
                <div class="form-field" data-weekday-field${!values.enabled || values.frequency !== 'weekly' ? ' hidden' : ''}><label for="backup-weekday">${escapeHtml(t(language, 'backup.schedule.day'))}</label><select class="form-select" id="backup-weekday" name="weekday" data-saved-value="${escapeHtml(String(values.weekday === '' ? 1 : values.weekday))}"${values.enabled && values.frequency === 'weekly' ? '' : ' disabled'}><option value=""${values.enabled ? '' : ' selected'}>${escapeHtml(t(language, 'backup.select'))}</option>${weekdays().map((day, index) => `<option value="${index}"${values.enabled && String(values.weekday) === String(index) ? ' selected' : ''}>${escapeHtml(day)}</option>`).join('')}</select></div>
              </div>
            </div>
          </section>
          <p class="help-text">${escapeHtml(t(language, 'backup.encryption_help'))}</p>
          <div class="form-actions d-flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'backup.save'))}</button></div>
        </form>
        <div class="form-actions backup-cloud-actions">
          <form method="post" action="/settings/backups/test"><button class="btn btn-light" type="submit"${configured ? '' : ' disabled'}>${escapeHtml(t(language, 'backup.test'))}</button></form>
          <form method="post" action="/settings/backups/run"><button class="btn btn-outline-secondary" type="submit"${configured ? '' : ' disabled'}>${escapeHtml(t(language, 'backup.run_now'))}</button></form>
        </div>
      </section>

      <section class="page-section" aria-labelledby="restore-backup-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="restore-backup-title">${escapeHtml(t(language, 'backup.restore.title'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'backup.restore.help'))}</p>
          </div>
          <a class="btn btn-outline-danger" href="/settings/backups/restore">${escapeHtml(t(language, 'backup.restore.action'))}</a>
        </div>
      </section>

      <section class="page-section" aria-labelledby="backup-history-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="backup-history-title">${escapeHtml(t(language, 'backup.history.title'))}</h2><p class="section-description">${escapeHtml(t(language, 'backup.history.help'))}</p></div></div>
        ${latestFailure}
        ${historyRows}
      </section>`,
    after: '<script src="/js/backup-settings.js" defer></script>',
  }), { language });
}

async function loadHistory() {
  const result = await pool.query(
    `SELECT started_at, run_type, provider, size_bytes, status, error_summary
     FROM backup_history ORDER BY started_at DESC, id DESC LIMIT 20`,
  );
  return result.rows;
}

async function renderCurrent(response, options = {}) {
  const configuration = await loadBackupConfiguration();
  response.send(renderBackupPage({
    values: publicValues(configuration),
    history: await loadHistory(),
    nextRunAt: configuration.nextRunAt,
    ...options,
  }));
}

router.get('/', async (request, response) => {
  const notices = {
    saved: t(request.uiLanguage, 'backup.notice.saved'),
    tested: t(request.uiLanguage, 'backup.notice.tested'),
    completed: t(request.uiLanguage, 'backup.notice.completed'),
  };
  try {
    const feedback = notices[request.query.notice]
      ? { type: 'success', message: notices[request.query.notice] }
      : request.query.error
        ? { type: 'error', message: errorMessage(request.query.error, request.uiLanguage) }
        : null;
    await renderCurrent(response, { feedback, language: request.uiLanguage });
  } catch (error) {
    console.error('Unable to load backup settings:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderBackupPage({
      values: emptyValues(),
      feedback: { type: 'error', message: t(request.uiLanguage, 'backup.error.load') },
      language: request.uiLanguage,
    }));
  }
});

router.post('/', async (request, response) => {
  let values = getFormValues(request.body);
  try {
    const existing = await loadBackupConfiguration();
    if (!values.enabled) {
      values = {
        ...values,
        frequency: existing?.frequency || 'daily',
        executionTime: existing?.executionTime || '02:00',
        weekday: existing?.weekday ?? '',
      };
    }
    const scheduleError = validateSchedule(values);
    if (scheduleError) throw scheduleError;

    let s3Secret = null;
    let azureKey = null;
    if (values.provider === 's3') {
      const sameCredential = existing.provider === 's3'
        && existing.s3.accessKeyId === values.s3.accessKeyId;
      s3Secret = values.s3.secretAccessKey
        ? encryptSecret(values.s3.secretAccessKey, secretPurposes.s3)
        : sameCredential ? existing.s3.secretAccessKey || null : null;
      const validation = {
        ...values,
        retentionDays: Number(values.retentionDays),
        s3: { ...values.s3, secretAccessKey: s3Secret },
      };
      validateProviderConfiguration(validation);
    } else if (values.provider === 'azure') {
      const sameCredential = existing.provider === 'azure'
        && existing.azure.accountName === values.azure.accountName;
      azureKey = values.azure.accountKey
        ? encryptSecret(values.azure.accountKey, secretPurposes.azure)
        : sameCredential ? existing.azure.accountKey || null : null;
      validateProviderConfiguration({
        ...values,
        retentionDays: Number(values.retentionDays),
        azure: { ...values.azure, accountKey: azureKey },
      });
    }

    const nextRunAt = values.enabled
      ? calculateNextRunAt({
        frequency: values.frequency,
        executionTime: values.executionTime,
        weekday: values.frequency === 'weekly' ? Number(values.weekday) : null,
      })
      : null;
    await withTransaction(pool, async (client) => {
      await client.query(
      `UPDATE backup_configuration SET
         enabled = $1, provider = $2, frequency = $3, execution_time = $4,
         weekday = $5, retention_days = $6, next_run_at = $7,
         s3_bucket = $8, s3_region = $9, s3_endpoint = $10, s3_prefix = $11,
         s3_access_key_id = $12, s3_secret_access_key = $13, s3_force_path_style = $14,
         azure_account_name = $15, azure_container_name = $16, azure_account_key = $17,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [
        values.enabled, values.provider || null, values.frequency, values.executionTime,
        values.frequency === 'weekly' ? Number(values.weekday) : null,
        Number(values.retentionDays), nextRunAt,
        values.provider === 's3' ? values.s3.bucket : null,
        values.provider === 's3' ? values.s3.region : null,
        values.provider === 's3' ? values.s3.endpoint || null : null,
        values.provider === 's3' ? values.s3.prefix || null : null,
        values.provider === 's3' ? values.s3.accessKeyId || null : null,
        values.provider === 's3' ? s3Secret : null,
        values.provider === 's3' && values.s3.forcePathStyle,
        values.provider === 'azure' ? values.azure.accountName : null,
        values.provider === 'azure' ? values.azure.containerName : null,
        values.provider === 'azure' ? azureKey : null,
      ],
      );
      await recordAuditEvent({
        client, category: 'backup', action: 'backup.configuration.update',
        summary: 'Configuration des sauvegardes mise à jour.',
        beforeData: existing ? {
          enabled: existing.enabled, provider: existing.provider, frequency: existing.frequency,
          execution_time: existing.executionTime, weekly_day: existing.weekday, retention_days: existing.retentionDays,
          s3_bucket: existing.s3.bucket, s3_region: existing.s3.region, s3_endpoint: existing.s3.endpoint,
          s3_prefix: existing.s3.prefix, azure_account_name: existing.azure.accountName,
          azure_container_name: existing.azure.containerName,
        } : null,
        afterData: {
          enabled: values.enabled, provider: values.provider || null, frequency: values.frequency,
          execution_time: values.executionTime, weekly_day: values.frequency === 'weekly' ? Number(values.weekday) : null,
          retention_days: Number(values.retentionDays), s3_bucket: values.provider === 's3' ? values.s3.bucket : null,
          s3_region: values.provider === 's3' ? values.s3.region : null, s3_endpoint: values.provider === 's3' ? values.s3.endpoint || null : null,
          s3_prefix: values.provider === 's3' ? values.s3.prefix || null : null,
          azure_account_name: values.provider === 'azure' ? values.azure.accountName : null,
          azure_container_name: values.provider === 'azure' ? values.azure.containerName : null,
        },
        metadata: {
          schedule_enabled: values.enabled, provider: values.provider || 'none',
          credential_change: Boolean(values.s3.secretAccessKey || values.azure.accountKey),
        },
      });
    });
    response.redirect(303, '/settings/backups?notice=saved');
  } catch (error) {
    console.error('Unable to save backup settings:', error.code || 'DATABASE_ERROR');
    let history = [];
    try { history = await loadHistory(); } catch (_error) { /* Rendering remains available. */ }
    response.status(400).send(renderBackupPage({
      values,
      history,
      feedback: { type: 'error', message: errorMessage(error.code, request.uiLanguage) },
      language: request.uiLanguage,
    }));
  }
});

router.post('/download', async (_request, response) => {
  let artifact;
  try {
    artifact = await createManualDownload();
    response.download(artifact.zipPath, artifact.filename, {
      headers: { 'Cache-Control': 'private, no-store' },
    }, async (error) => {
      await artifact.cleanup();
      await recordAuditEventSafely({
        category: 'backup', action: 'backup.manual.download', result: error ? 'failed' : 'success',
        summary: error ? 'Téléchargement de la sauvegarde interrompu.' : 'Sauvegarde manuelle téléchargée.',
        metadata: { backup_type: 'manual_download', filename: artifact.filename, size: artifact.size || null, error_code: error?.code || null },
      });
      if (error && !response.headersSent) {
        response.redirect(303, '/settings/backups?error=BACKUP_FAILED');
      }
    });
  } catch (error) {
    if (artifact) await artifact.cleanup();
    console.error('Manual backup download failed:', error.code || 'BACKUP_FAILED');
    await recordAuditEventSafely({ category: 'backup', action: 'backup.manual.download', result: 'failed', summary: 'Échec de la sauvegarde manuelle.', metadata: { error_code: error.code || 'BACKUP_FAILED' } });
    response.redirect(303, `/settings/backups?error=${encodeURIComponent(error.code || 'BACKUP_FAILED')}`);
  }
});

router.post('/test', async (_request, response) => {
  try {
    await testDestination();
    response.redirect(303, '/settings/backups?notice=tested');
  } catch (error) {
    console.error('Backup destination test failed:', error.code || 'BACKUP_FAILED');
    response.redirect(303, `/settings/backups?error=${encodeURIComponent(error.code || 'BACKUP_FAILED')}`);
  }
});

router.post('/run', async (_request, response) => {
  try {
    const result = await runCloudBackup('manual_cloud');
    await recordAuditEventSafely({ category: 'backup', action: 'backup.cloud.run', summary: 'Sauvegarde cloud terminée.', metadata: { backup_type: 'manual_cloud', provider: result?.provider || null, filename: result?.filename || null, size: result?.size || null } });
    response.redirect(303, '/settings/backups?notice=completed');
  } catch (error) {
    console.error('Cloud backup failed:', error.code || 'BACKUP_FAILED');
    await recordAuditEventSafely({ category: 'backup', action: 'backup.cloud.run', result: 'failed', summary: 'Échec de la sauvegarde cloud.', metadata: { backup_type: 'manual_cloud', error_code: error.code || 'BACKUP_FAILED' } });
    response.redirect(303, `/settings/backups?error=${encodeURIComponent(error.code || 'BACKUP_FAILED')}`);
  }
});

module.exports = router;
