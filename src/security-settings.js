const express = require('express');
const { recordAuditEventSafely } = require('./audit');
const multer = require('multer');
const { pool } = require('./db/client');
const { getStoredBackupSecretStatus } = require('./backup');
const {
  getStoredMailSecretStatus,
  loadStoredMailConfiguration,
} = require('./mail');
const {
  exportRecoveryKey,
  getKeyInfo,
  getRecoveryKey,
  importRecoveryKey,
  isEncryptedSecret,
} = require('./secrets');
const {
  getEncryptedReportingPseudonymSecret,
  getReportingPseudonymSecretStatus,
} = require('./reporting-privacy');
const { DEFAULT_LANGUAGE, t } = require('./i18n');
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 4096 },
});

async function getEncryptedSecrets() {
  // New encrypted secret purposes must also be added here for recovery-key validation.
  const configuration = await loadStoredMailConfiguration();
  const result = await pool.query(
    'SELECT s3_secret_access_key, azure_account_key FROM backup_configuration WHERE id = 1',
  );
  const reportingPseudonymSecret = await getEncryptedReportingPseudonymSecret();
  return [
    configuration?.password,
    result.rows[0]?.s3_secret_access_key,
    result.rows[0]?.azure_account_key,
    reportingPseudonymSecret,
  ].filter((value) => value && isEncryptedSecret(value));
}

async function getSecretStatus() {
  const statuses = await Promise.all([
    getStoredMailSecretStatus(),
    getStoredBackupSecretStatus(),
    getReportingPseudonymSecretStatus(),
  ]);
  return statuses.includes('mismatch') ? 'mismatch' : 'available';
}

function sourceLabel(source, language) {
  return t(language, source === 'environment' ? 'security.source.environment' : 'security.source.application');
}

function renderSecurityPage({ feedback = null, secretStatus = 'available', language = DEFAULT_LANGUAGE } = {}) {
  const keyInfo = getKeyInfo();
  const feedbackMessage = feedback?.message
    ? `<p class="alert alert-${feedback.type === 'success' ? 'success' : 'danger'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';
  const mismatchMessage = secretStatus === 'mismatch'
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(t(language, 'security.mismatch'))}</p>`
    : '';

  return renderPage(t(language, 'security.title'), renderSettingsLayout({
    activeSection: 'security',
    title: t(language, 'security.title'),
    description: t(language, 'security.description'),
    status: `<span class="badge status-badge status-${secretStatus === 'available' ? 'active' : 'inactive'}">${escapeHtml(t(language, secretStatus === 'available' ? 'security.encryption_active' : 'security.key_check'))}</span>`,
    notifications: `${feedbackMessage}${mismatchMessage}<p class="alert alert-danger" role="alert" data-security-client-feedback hidden></p>`,
    content: `<section class="card card-body app-form" aria-labelledby="encryption-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="encryption-title">${escapeHtml(t(language, 'security.encryption.title'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'security.encryption.help'))}</p>
          </div>
        </div>
        <dl class="security-key-summary">
          <div><dt>${escapeHtml(t(language, 'security.state'))}</dt><dd>${escapeHtml(t(language, secretStatus === 'available' ? 'security.state.active' : 'security.state.mismatch'))}</dd></div>
          <div><dt>${escapeHtml(t(language, 'security.key_id'))}</dt><dd class="student-code">${escapeHtml(keyInfo.fingerprint)}</dd></div>
          <div><dt>${escapeHtml(t(language, 'security.source'))}</dt><dd>${escapeHtml(sourceLabel(keyInfo.source, language))}</dd></div>
        </dl>
        <div class="form-actions d-flex flex-wrap gap-2">
          <button class="btn btn-primary" type="button" data-show-recovery-key>${escapeHtml(t(language, 'security.show_key'))}</button>
          <form method="post" action="/settings/security/key/export">
            <button class="btn btn-light" type="submit">${escapeHtml(t(language, 'security.export_key'))}</button>
          </form>
        </div>
      </section>

      <section class="page-section" aria-labelledby="import-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="import-title">${escapeHtml(t(language, 'security.import.title'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'security.import.help'))}</p>
          </div>
        </div>
        <form class="card card-body app-form" method="post" action="/settings/security/key/import" enctype="multipart/form-data">
          <div class="form-field">
            <label for="recovery-key-file">${escapeHtml(t(language, 'security.import.file'))}</label>
            <input class="form-control" id="recovery-key-file" name="recovery_key" type="file" accept=".txt,text/plain" required>
          </div>
          <label class="checkbox-option">
            <input class="form-check-input" name="confirm_import" type="checkbox" value="yes" required>
            <span>${escapeHtml(t(language, 'security.import.confirm'))}</span>
          </label>
          <div class="form-actions d-flex flex-wrap gap-2">
            <button class="btn btn-outline-secondary" type="submit">${escapeHtml(t(language, 'security.import.submit'))}</button>
          </div>
        </form>
      </section>`,
    after: `
    <dialog class="security-key-dialog" data-recovery-key-dialog aria-labelledby="recovery-key-title">
      <div class="dialog-content">
        <h2 id="recovery-key-title">${escapeHtml(t(language, 'security.dialog.title'))}</h2>
        <p>${escapeHtml(t(language, 'security.dialog.warning'))}</p>
        <label for="recovery-key-value">${escapeHtml(t(language, 'security.dialog.base64'))}</label>
        <textarea id="recovery-key-value" class="form-control recovery-key-output" rows="3" wrap="off" readonly spellcheck="false" data-recovery-key-value></textarea>
        <p class="compact-meta" role="status" aria-live="polite" data-copy-feedback></p>
        <div class="form-actions d-flex flex-wrap gap-2">
          <button class="btn btn-primary" type="button" data-copy-recovery-key>${escapeHtml(t(language, 'security.dialog.copy'))}</button>
          <button class="btn btn-light" type="button" data-close-recovery-key>${escapeHtml(t(language, 'action.close'))}</button>
        </div>
      </div>
    </dialog>
    <script src="/js/security.js" defer></script>`,
  }), language);
}

async function renderCurrentSecurity(response, options = {}) {
  response.send(renderSecurityPage({
    secretStatus: await getSecretStatus(),
    ...options,
  }));
}

router.get('/', async (request, response) => {
  const notices = {
    imported: t(request.uiLanguage, 'security.notice.imported'),
  };
  try {
    const notice = notices[request.query.notice];
    await renderCurrentSecurity(response, {
      language: request.uiLanguage,
      feedback: notice ? { type: 'success', message: notice } : null,
    });
  } catch (error) {
    console.error('Unable to load security settings:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderSecurityPage({
      feedback: { type: 'error', message: t(request.uiLanguage, 'security.error.load') },
      language: request.uiLanguage,
    }));
  }
});

router.post('/key', async (_request, response) => {
  await recordAuditEventSafely({ category: 'security', action: 'security.recovery_key.view', summary: 'Clé de récupération affichée.' });
  response.set('Cache-Control', 'no-store');
  response.json({ key: getRecoveryKey(), fingerprint: getKeyInfo().fingerprint });
});

router.post('/key/export', async (_request, response) => {
  await recordAuditEventSafely({ category: 'security', action: 'security.recovery_key.export', summary: 'Clé de récupération exportée.' });
  response.set({
    'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="attendance-log-recovery-key.txt"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.send(exportRecoveryKey());
});

function importErrorMessage(code, language = DEFAULT_LANGUAGE) {
  try {
    return t(language, `security.error.${code}`);
  } catch (_error) {
    return t(language, 'security.error.default');
  }
}

router.post('/key/import', (request, response) => {
  upload.single('recovery_key')(request, response, async (uploadError) => {
    try {
      if (uploadError || !request.file) {
        response.status(400).send(renderSecurityPage({
          feedback: { type: 'error', message: t(request.uiLanguage, 'security.error.file') },
          secretStatus: await getSecretStatus(),
          language: request.uiLanguage,
        }));
        return;
      }
      if (request.body.confirm_import !== 'yes') {
        response.status(400).send(renderSecurityPage({
          feedback: { type: 'error', message: t(request.uiLanguage, 'security.error.IMPORT_CONFIRMATION_REQUIRED') },
          secretStatus: await getSecretStatus(),
          language: request.uiLanguage,
        }));
        return;
      }
      await importRecoveryKey(request.file.buffer.toString('utf8'), {
        encryptedValues: await getEncryptedSecrets(),
        confirmed: true,
      });
      await recordAuditEventSafely({ category: 'security', action: 'security.recovery_key.import', summary: 'Clé de récupération importée et activée.' });
      response.redirect(303, '/settings/security?notice=imported');
    } catch (error) {
      await recordAuditEventSafely({ category: 'security', action: 'security.recovery_key.import', result: 'failed', summary: 'Échec de l’import de la clé de récupération.', metadata: { error_code: error.code || 'IMPORT_FAILED' } });
      console.error('Unable to import recovery key:', error.code || 'IMPORT_FAILED');
      try {
        response.status(400).send(renderSecurityPage({
          feedback: { type: 'error', message: importErrorMessage(error.code, request.uiLanguage) },
          secretStatus: await getSecretStatus(),
          language: request.uiLanguage,
        }));
      } catch (renderError) {
        console.error('Unable to render security settings:', renderError.code || 'DATABASE_ERROR');
        response.status(500).send(t(request.uiLanguage, 'security.error.load'));
      }
    }
  });
});

module.exports = router;
