const express = require('express');
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
const { escapeHtml, renderPage, renderSettingsNavigation } = require('./ui');

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
  return [
    configuration?.password,
    result.rows[0]?.s3_secret_access_key,
    result.rows[0]?.azure_account_key,
  ].filter((value) => value && isEncryptedSecret(value));
}

async function getSecretStatus() {
  const statuses = await Promise.all([
    getStoredMailSecretStatus(),
    getStoredBackupSecretStatus(),
  ]);
  return statuses.includes('mismatch') ? 'mismatch' : 'available';
}

function sourceLabel(source) {
  return source === 'environment'
    ? 'Clé fournie par l’environnement'
    : 'Clé persistante de l’application';
}

function renderSecurityPage({ feedback = null, secretStatus = 'available' } = {}) {
  const keyInfo = getKeyInfo();
  const feedbackMessage = feedback?.message
    ? `<p class="message message-${feedback.type === 'success' ? 'success' : 'error'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';
  const mismatchMessage = secretStatus === 'mismatch'
    ? '<p class="message message-error" role="alert">La clé est configurée, mais elle est incompatible avec les secrets chiffrés actuellement stockés. Importez la clé de récupération correspondant à cette base de données.</p>'
    : '';

  return renderPage('Configuration de sécurité', `
    <div class="settings-page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Configuration</p>
          <h1>Sécurité</h1>
          <p class="page-description">Gérez la clé de récupération utilisée pour protéger les secrets sauvegardés.</p>
        </div>
        <span class="status-badge status-${secretStatus === 'available' ? 'active' : 'inactive'}">${secretStatus === 'available' ? 'Chiffrement actif' : 'Clé à vérifier'}</span>
      </header>
      ${renderSettingsNavigation('security')}
      <div class="notification-area" aria-live="polite" aria-atomic="true">
        ${feedbackMessage}
        ${mismatchMessage}
        <p class="message message-error" role="alert" data-security-client-feedback hidden></p>
      </div>

      <section class="form-card" aria-labelledby="encryption-title">
        <div class="section-header">
          <div>
            <h2 id="encryption-title">Chiffrement des données sensibles</h2>
            <p class="section-description">Conservez une copie de cette clé avec vos sauvegardes. Elle est nécessaire pour restaurer les secrets chiffrés.</p>
          </div>
        </div>
        <dl class="security-key-summary">
          <div><dt>État</dt><dd>${secretStatus === 'available' ? 'Actif et configuré' : 'Clé incompatible avec les secrets stockés'}</dd></div>
          <div><dt>Identifiant de clé</dt><dd class="student-code">${escapeHtml(keyInfo.fingerprint)}</dd></div>
          <div><dt>Source</dt><dd>${escapeHtml(sourceLabel(keyInfo.source))}</dd></div>
        </dl>
        <div class="form-actions">
          <button class="button" type="button" data-show-recovery-key>Afficher la clé</button>
          <form method="post" action="/settings/security/key/export">
            <button class="button button-quiet" type="submit">Exporter la clé</button>
          </form>
        </div>
      </section>

      <section class="page-section" aria-labelledby="import-title">
        <div class="section-header">
          <div>
            <h2 id="import-title">Importer une clé</h2>
            <p class="section-description">Utilisez le fichier de récupération associé à une base restaurée. La clé ne sera remplacée que si elle correspond aux secrets existants.</p>
          </div>
        </div>
        <form class="form-card" method="post" action="/settings/security/key/import" enctype="multipart/form-data">
          <div class="form-field">
            <label for="recovery-key-file">Fichier de clé de récupération</label>
            <input id="recovery-key-file" name="recovery_key" type="file" accept=".txt,text/plain" required>
          </div>
          <label class="checkbox-option">
            <input name="confirm_import" type="checkbox" value="yes" required>
            <span>Je confirme vouloir activer cette clé de récupération.</span>
          </label>
          <div class="form-actions">
            <button class="button button-secondary" type="submit">Importer la clé</button>
          </div>
        </form>
      </section>
    </div>

    <dialog class="security-key-dialog" data-recovery-key-dialog aria-labelledby="recovery-key-title">
      <div class="dialog-content">
        <h2 id="recovery-key-title">Clé de récupération</h2>
        <p>Toute personne possédant cette clé peut déchiffrer les secrets sauvegardés par Attendance Log.</p>
        <label for="recovery-key-value">Clé Base64</label>
        <textarea id="recovery-key-value" class="recovery-key-output" rows="3" wrap="off" readonly spellcheck="false" data-recovery-key-value></textarea>
        <p class="compact-meta" role="status" aria-live="polite" data-copy-feedback></p>
        <div class="form-actions">
          <button class="button" type="button" data-copy-recovery-key>Copier la clé</button>
          <button class="button button-quiet" type="button" data-close-recovery-key>Fermer</button>
        </div>
      </div>
    </dialog>
    <script src="/js/security.js" defer></script>`);
}

async function renderCurrentSecurity(response, options = {}) {
  response.send(renderSecurityPage({
    secretStatus: await getSecretStatus(),
    ...options,
  }));
}

router.get('/', async (request, response) => {
  const notices = {
    imported: 'La clé de récupération a été importée et activée.',
  };
  try {
    const notice = notices[request.query.notice];
    await renderCurrentSecurity(response, {
      feedback: notice ? { type: 'success', message: notice } : null,
    });
  } catch (error) {
    console.error('Unable to load security settings:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderSecurityPage({
      feedback: { type: 'error', message: 'Impossible de charger la configuration de sécurité pour le moment.' },
    }));
  }
});

router.post('/key', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({ key: getRecoveryKey(), fingerprint: getKeyInfo().fingerprint });
});

router.post('/key/export', (_request, response) => {
  response.set({
    'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="attendance-log-recovery-key.txt"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.send(exportRecoveryKey());
});

function importErrorMessage(code) {
  return {
    ENVIRONMENT_KEY_MANAGED: 'La clé est fournie par l’environnement. Modifiez-la dans le gestionnaire de secrets du déploiement.',
    IMPORT_CONFIRMATION_REQUIRED: 'Confirmez explicitement l’import de la clé.',
    RECOVERY_FINGERPRINT_MISMATCH: 'L’identifiant du fichier ne correspond pas à la clé qu’il contient.',
    RECOVERY_KEY_MISMATCH: 'Cette clé ne permet pas de déchiffrer les secrets actuellement sauvegardés. Elle n’a pas été activée.',
    RECOVERY_FORMAT_INVALID: 'Le fichier de clé de récupération n’est pas valide.',
  }[code] || 'La clé de récupération n’a pas pu être importée.';
}

router.post('/key/import', (request, response) => {
  upload.single('recovery_key')(request, response, async (uploadError) => {
    try {
      if (uploadError || !request.file) {
        response.status(400).send(renderSecurityPage({
          feedback: { type: 'error', message: 'Sélectionnez un fichier de clé de récupération valide.' },
          secretStatus: await getSecretStatus(),
        }));
        return;
      }
      if (request.body.confirm_import !== 'yes') {
        response.status(400).send(renderSecurityPage({
          feedback: { type: 'error', message: 'Confirmez explicitement l’import de la clé.' },
          secretStatus: await getSecretStatus(),
        }));
        return;
      }
      await importRecoveryKey(request.file.buffer.toString('utf8'), {
        encryptedValues: await getEncryptedSecrets(),
        confirmed: true,
      });
      response.redirect(303, '/settings/security?notice=imported');
    } catch (error) {
      console.error('Unable to import recovery key:', error.code || 'IMPORT_FAILED');
      try {
        response.status(400).send(renderSecurityPage({
          feedback: { type: 'error', message: importErrorMessage(error.code) },
          secretStatus: await getSecretStatus(),
        }));
      } catch (renderError) {
        console.error('Unable to render security settings:', renderError.code || 'DATABASE_ERROR');
        response.status(500).send('Impossible de charger la configuration de sécurité pour le moment.');
      }
    }
  });
});

module.exports = router;
