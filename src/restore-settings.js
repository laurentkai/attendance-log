const os = require('node:os');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { formatDateTime, formatNumber } = require('./application-time');
const { createManualDownload, normalizeBackupError, withBackupOperationLock } = require('./backup');
const {
  RestoreError,
  createPreparedRestore,
  getPreparedRestore,
  listCloudBackups,
  markSafetyDownloaded,
  performRestore,
  prepareCloudRestore,
} = require('./restore');
const { getKeyInfo } = require('./secrets');
const { getInstanceId } = require('./instance');
const { DEFAULT_LANGUAGE, t } = require('./i18n');
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();
const configuredUploadMb = Number.parseInt(process.env.BACKUP_RESTORE_MAX_MB || '512', 10);
const maximumUploadMb = Number.isInteger(configuredUploadMb) && configuredUploadMb >= 1
  ? configuredUploadMb : 512;
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: maximumUploadMb * 1024 * 1024, files: 1 },
});

function errorMessage(code, language = DEFAULT_LANGUAGE) {
  try { return t(language, `restore.error.${code}`); } catch (_error) { return t(language, 'restore.error.default'); }
}

function formatTimestamp(value) {
  if (!value) return '—';
  return formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatSize(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return formatNumber(Number(value) / (Number(value) >= 1024 * 1024 ? 1024 * 1024 : 1024), {
    style: 'unit', unit: Number(value) >= 1024 * 1024 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1,
  });
}

function renderRestorePage({ cloud = null, feedback = null, history = [], language = DEFAULT_LANGUAGE }) {
  const cloudContent = cloud?.backups?.length
    ? `<form class="card card-body app-form" method="post" action="/settings/backups/restore/cloud">
        <div class="form-field">
          <label for="cloud-backup">${escapeHtml(t(language, 'restore.cloud.available'))}</label>
          <select class="form-select" id="cloud-backup" name="object_key" required>
            ${cloud.backups.map((backup) => `<option value="${escapeHtml(backup.key)}">${escapeHtml(formatTimestamp(backup.lastModified))} · ${escapeHtml(path.basename(backup.key))} · ${escapeHtml(formatSize(backup.size))}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-outline-secondary" type="submit">${escapeHtml(t(language, 'restore.cloud.inspect'))}</button>
      </form>`
    : `<p class="empty-state">${cloud?.error ? escapeHtml(errorMessage(cloud.error, language)) : escapeHtml(t(language, 'restore.cloud.empty'))}</p>`;
  const notification = feedback
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(feedback)}</p>` : '';
  const historyContent = history.length === 0
    ? `<p class="empty-state">${escapeHtml(t(language, 'restore.history.empty'))}</p>`
    : `<div class="list-group compact-list">${history.map((entry) => `<article class="list-group-item compact-row compact-row-status"><div class="compact-identity"><p class="compact-title">${escapeHtml(entry.filename)}</p><p class="compact-meta">${escapeHtml(formatTimestamp(entry.started_at))} · ${escapeHtml(entry.source.toUpperCase())}</p></div><div class="compact-status"><span class="badge status-badge status-${entry.status === 'success' ? 'active' : 'absent'}">${escapeHtml(t(language, entry.status === 'success' ? 'status.success' : 'status.failed'))}</span>${entry.error_summary ? `<p class="compact-meta">${escapeHtml(errorMessage(entry.error_summary, language))}</p>` : ''}</div></article>`).join('')}</div>`;
  return renderPage(t(language, 'restore.title'), renderSettingsLayout({
    activeSection: 'backups',
    title: t(language, 'restore.title'),
    description: t(language, 'restore.description'),
    status: `<a class="btn btn-light" href="/settings/backups">${escapeHtml(t(language, 'restore.back'))}</a>`,
    notifications: notification,
    contentClass: 'restore-settings',
    content: `<p class="alert alert-warning">${escapeHtml(t(language, 'restore.warning'))}</p>
      <section class="page-section" aria-labelledby="local-restore-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="local-restore-title">${escapeHtml(t(language, 'restore.local.title'))}</h2><p class="section-description">${escapeHtml(t(language, 'restore.local.help', { size: maximumUploadMb }))}</p></div></div>
        <form class="card card-body app-form" method="post" action="/settings/backups/restore/local" enctype="multipart/form-data">
          <div class="form-field"><label for="restore-file">${escapeHtml(t(language, 'restore.file'))}</label><input class="form-control" id="restore-file" name="backup" type="file" accept=".zip,application/zip" required></div>
          <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'restore.inspect_file'))}</button>
        </form>
      </section>
      <section class="page-section" aria-labelledby="cloud-restore-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="cloud-restore-title">${escapeHtml(t(language, 'restore.cloud.title'))}</h2><p class="section-description">${escapeHtml(t(language, 'restore.cloud.help'))}</p></div></div>
        ${cloudContent}
      </section>
      <section class="page-section" aria-labelledby="restore-history-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="restore-history-title">${escapeHtml(t(language, 'restore.history.title'))}</h2><p class="section-description">${escapeHtml(t(language, 'restore.history.help'))}</p></div></div>
        ${historyContent}
      </section>`,
  }), { language });
}

function renderPreview(prepared, feedback = null, language = DEFAULT_LANGUAGE) {
  const manifest = prepared.manifest;
  const currentFingerprint = getKeyInfo().fingerprint;
  const keyStatus = prepared.fingerprintMatch
    ? `<p class="alert alert-success">${escapeHtml(t(language, 'restore.key.compatible'))}</p>`
    : `<p class="alert alert-warning">${escapeHtml(t(language, 'restore.key.mismatch'))}</p>`;
  const instanceStatus = manifest.instanceId && !prepared.instanceMatch
    ? `<p class="alert alert-info">${escapeHtml(t(language, 'restore.instance.other'))}</p>`
    : '';
  const safety = prepared.currentDatabasePopulated
    ? `<div class="card card-body app-form"><h2>${escapeHtml(t(language, 'restore.safety.title'))}</h2><p>${escapeHtml(t(language, 'restore.safety.help'))}</p>
        <form method="post" action="/settings/backups/restore/${escapeHtml(prepared.token)}/safety-download"><button class="btn btn-outline-secondary" type="submit">${escapeHtml(t(language, 'restore.safety.download'))}</button></form>
        ${prepared.safetyDownloaded ? `<span class="badge status-badge status-active">${escapeHtml(t(language, 'restore.safety.generated'))}</span>` : ''}</div>` : '';
  return renderPage(t(language, 'restore.preview.title'), renderSettingsLayout({
    activeSection: 'backups',
    title: t(language, 'restore.preview.title'),
    description: t(language, 'restore.preview.description'),
    status: `<a class="btn btn-light" href="/settings/backups/restore">${escapeHtml(t(language, 'restore.preview.change'))}</a>`,
    notifications: feedback ? `<p class="alert alert-danger" role="alert">${escapeHtml(feedback)}</p>` : '',
    contentClass: 'restore-settings',
    content: `<section class="card card-body app-form restore-summary" aria-labelledby="backup-summary-title">
        <h2 id="backup-summary-title">${escapeHtml(prepared.filename)}</h2>
        <dl class="security-key-summary">
          <div><dt>${escapeHtml(t(language, 'restore.backup_date'))}</dt><dd>${escapeHtml(formatTimestamp(manifest.generatedAt))}</dd></div>
          <div><dt>${escapeHtml(t(language, 'restore.application_version'))}</dt><dd>${escapeHtml(manifest.application?.version || '—')}${manifest.application?.commit ? ` · ${escapeHtml(manifest.application.commit)}` : ''}</dd></div>
          <div><dt>${escapeHtml(t(language, 'restore.database_migration'))}</dt><dd>${escapeHtml(manifest.database?.migration || t(language, 'common.none'))}</dd></div>
          <div><dt>PostgreSQL</dt><dd>${escapeHtml(manifest.database?.version || '—')}</dd></div>
          <div><dt>${escapeHtml(t(language, 'restore.source_instance'))}</dt><dd><code>${escapeHtml(manifest.instanceId || t(language, 'restore.not_provided_legacy'))}</code></dd></div>
          <div><dt>${escapeHtml(t(language, 'restore.current_instance'))}</dt><dd><code>${escapeHtml(getInstanceId())}</code></dd></div>
          <div><dt>${escapeHtml(t(language, 'restore.backup_key'))}</dt><dd><code>${escapeHtml(manifest.encryptionKeyFingerprint || t(language, 'restore.not_provided'))}</code></dd></div>
          <div><dt>${escapeHtml(t(language, 'restore.current_key'))}</dt><dd><code>${escapeHtml(currentFingerprint)}</code></dd></div>
        </dl>
        ${instanceStatus}
        ${keyStatus}
      </section>
      ${safety}
      <section class="page-section" aria-labelledby="restore-confirm-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="restore-confirm-title">${escapeHtml(t(language, 'restore.confirm.title'))}</h2><p class="section-description">${escapeHtml(t(language, 'restore.confirm.help'))}</p></div></div>
        <form class="card card-body app-form" method="post" action="/settings/backups/restore/${escapeHtml(prepared.token)}/confirm" autocomplete="off">
          <label class="checkbox-option"><input class="form-check-input" name="understood" type="checkbox" value="yes" required><span>${escapeHtml(t(language, 'restore.confirm.understood'))}</span></label>
          <div class="form-field"><label for="restore-confirmation">${escapeHtml(t(language, 'restore.confirm.type'))}</label><input class="form-control" id="restore-confirmation" name="confirmation" required autocomplete="off" spellcheck="false"></div>
          <button class="btn btn-danger" type="submit">${escapeHtml(t(language, 'restore.confirm.submit'))}</button>
        </form>
      </section>`,
  }), { language });
}

async function loadCloudListing() {
  try {
    return await withBackupOperationLock(() => listCloudBackups());
  } catch (error) {
    return { backups: [], error: normalizeBackupError(error).code };
  }
}

async function loadRestoreHistory() {
  const { pool } = require('./db/client');
  const result = await pool.query(
    `SELECT started_at, source, filename, status, error_summary
     FROM restore_history ORDER BY started_at DESC, id DESC LIMIT 10`,
  );
  return result.rows;
}

async function renderLanding(response, feedback = null, status = 200, language = DEFAULT_LANGUAGE) {
  response.status(status).send(renderRestorePage({
    cloud: await loadCloudListing(),
    history: await loadRestoreHistory(),
    feedback, language,
  }));
}

router.get('/', async (request, response) => {
  await renderLanding(response, request.query.error ? errorMessage(request.query.error, request.uiLanguage) : null, 200, request.uiLanguage);
});

router.post('/local', upload.single('backup'), async (request, response) => {
  if (!request.file) return renderLanding(response, errorMessage('FILE_REQUIRED', request.uiLanguage), 400, request.uiLanguage);
  try {
    const prepared = await createPreparedRestore(request.file.path, {
      source: 'local', filename: request.file.originalname,
    });
    return response.redirect(303, `/settings/backups/restore/${prepared.token}`);
  } catch (error) {
    try { await require('node:fs/promises').rm(request.file.path, { force: true }); } catch (_cleanupError) { /* Nothing else to clean. */ }
    return renderLanding(response, errorMessage(error.code, request.uiLanguage), 400, request.uiLanguage);
  }
});

router.post('/cloud', async (request, response) => {
  try {
    const prepared = await prepareCloudRestore(String(request.body.object_key || ''));
    response.redirect(303, `/settings/backups/restore/${prepared.token}`);
  } catch (error) {
    const code = error instanceof RestoreError ? error.code : normalizeBackupError(error).code;
    await renderLanding(response, errorMessage(code, request.uiLanguage), 400, request.uiLanguage);
  }
});

router.get('/:token', (request, response) => {
  try {
    response.send(renderPreview(getPreparedRestore(request.params.token), null, request.uiLanguage));
  } catch (error) {
    response.redirect(303, `/settings/backups/restore?error=${encodeURIComponent(error.code)}`);
  }
});

router.post('/:token/safety-download', async (request, response) => {
  let artifact;
  try {
    getPreparedRestore(request.params.token);
    artifact = await createManualDownload();
    response.download(artifact.zipPath, `${t(request.uiLanguage, 'restore.safety_backup_prefix')}-${artifact.filename}`, {
      headers: { 'Cache-Control': 'private, no-store' },
    }, async (error) => {
      try {
        if (!error) await markSafetyDownloaded(request.params.token);
      } catch (markError) {
        console.error('Unable to confirm safety backup delivery:', markError.code || 'SAFETY_BACKUP_CONFIRMATION_FAILED');
      } finally {
        try {
          await artifact.cleanup();
        } catch (cleanupError) {
          console.warn('Unable to clean up safety backup artifact:', cleanupError.code || 'BACKUP_CLEANUP_FAILED');
        }
      }
      if (error) {
        console.warn('Safety backup download did not complete:', error.code || 'DOWNLOAD_INTERRUPTED');
      }
    });
  } catch (error) {
    if (artifact) await artifact.cleanup();
    response.status(400).send(renderPreview(getPreparedRestore(request.params.token), errorMessage(error.code, request.uiLanguage), request.uiLanguage));
  }
});

router.post('/:token/confirm', async (request, response) => {
  let prepared;
  try {
    prepared = getPreparedRestore(request.params.token);
    if (request.body.understood !== 'yes' || request.body.confirmation !== 'RESTAURER') {
      throw new RestoreError('CONFIRMATION_REQUIRED');
    }
    const result = await performRestore(request.params.token);
    const language = request.uiLanguage;
    response.status(200).send(renderPage(t(language, 'restore.complete.title'), renderSettingsLayout({
      activeSection: 'backups',
      title: t(language, 'restore.complete.title'),
      description: t(language, 'restore.complete.description'),
      notifications: `<p class="alert alert-success">${escapeHtml(t(language, 'restore.complete.success'))}${result.fingerprintMatch ? '' : escapeHtml(t(language, 'restore.complete.external'))}</p>`,
      content: `<p>${escapeHtml(t(language, 'restore.complete.relogin'))}</p>`,
    }), { language }));
    response.once('finish', () => setTimeout(() => process.exit(0), 250));
  } catch (error) {
    console.error('Restore failed:', error.code || 'RESTORE_FAILED');
    const message = errorMessage(error.code, request.uiLanguage);
    if (prepared) return response.status(400).send(renderPreview(prepared, message, request.uiLanguage));
    return renderLanding(response, message, 400, request.uiLanguage);
  }
});

router.use((error, request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? t(request.uiLanguage, 'restore.error.upload_size', { size: maximumUploadMb }) : t(request.uiLanguage, 'restore.error.upload');
    return renderLanding(response, message, 400, request.uiLanguage);
  }
  console.error('Restore upload failed:', error.code || 'UPLOAD_FAILED');
  return renderLanding(response, t(request.uiLanguage, 'restore.error.upload'), 400, request.uiLanguage);
});

module.exports = router;
