const os = require('node:os');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
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
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();
const configuredUploadMb = Number.parseInt(process.env.BACKUP_RESTORE_MAX_MB || '512', 10);
const maximumUploadMb = Number.isInteger(configuredUploadMb) && configuredUploadMb >= 1
  ? configuredUploadMb : 512;
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: maximumUploadMb * 1024 * 1024, files: 1 },
});

function errorMessage(code) {
  return {
    BACKUP_IN_PROGRESS: 'Une opération de sauvegarde ou de restauration est déjà en cours.',
    RESTORE_IN_PROGRESS: 'Une restauration est déjà en cours.',
    RESTORE_PREPARATION_EXPIRED: 'La préparation a expiré. Sélectionnez de nouveau la sauvegarde.',
    BACKUP_ZIP_INVALID: 'Le fichier ZIP est illisible ou corrompu.',
    BACKUP_STRUCTURE_INVALID: 'L’archive ne contient pas exactement le manifeste et la sauvegarde PostgreSQL attendus.',
    BACKUP_MANIFEST_INVALID: 'Le manifeste de la sauvegarde est invalide.',
    BACKUP_INVALID: 'Ce fichier n’est pas une sauvegarde Attendance Log valide.',
    BACKUP_VERSION_UNSUPPORTED: 'Cette version du format de sauvegarde n’est pas prise en charge.',
    BACKUP_SCHEMA_NEWER: 'Cette sauvegarde provient d’une version plus récente d’Attendance Log. Mettez l’application à jour avant de la restaurer.',
    BACKUP_DUMP_INVALID: 'La sauvegarde PostgreSQL est invalide ou corrompue.',
    BACKUP_DUMP_INVALID_UNAVAILABLE: 'L’outil PostgreSQL de restauration n’est pas disponible.',
    DATABASE_RESTORE_FAILED: 'La restauration PostgreSQL a échoué. La base actuelle n’a pas été remplacée.',
    RESTORE_MIGRATION_FAILED: 'La mise à niveau de la base restaurée a échoué. La base actuelle n’a pas été remplacée.',
    RESTORE_SWAP_UNRECOVERABLE: 'La permutation des bases et son annulation ont échoué. Une intervention PostgreSQL est requise ; consultez immédiatement les logs de l’application.',
    SAFETY_BACKUP_REQUIRED: 'Une sauvegarde de sécurité doit être téléchargée avant de remplacer les données actuelles.',
    SECRET_KEY_MISMATCH: 'Les identifiants cloud ne peuvent pas être déchiffrés avec la clé active.',
    STORAGE_AUTHENTICATION_FAILED: 'L’authentification auprès de la destination cloud a échoué.',
    STORAGE_PERMISSION_DENIED: 'La destination cloud a refusé l’opération.',
    STORAGE_NOT_FOUND: 'La sauvegarde cloud ou sa destination est introuvable.',
    STORAGE_CONNECTION_FAILED: 'Impossible de joindre la destination cloud.',
    CONFIRMATION_REQUIRED: 'Cochez la confirmation et saisissez RESTAURER pour continuer.',
    FILE_REQUIRED: 'Sélectionnez un fichier de sauvegarde ZIP.',
    PROVIDER_REQUIRED: 'Configurez une destination S3 ou Azure pour afficher les sauvegardes cloud.',
    BACKUP_FAILED: 'La destination cloud n’a pas pu être consultée.',
  }[code] || 'La restauration n’a pas pu être effectuée.';
}

function formatTimestamp(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-BE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.BACKUP_TIMEZONE || 'Europe/Brussels',
  }).format(new Date(value));
}

function formatSize(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('fr-BE', {
    style: 'unit', unit: Number(value) >= 1024 * 1024 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1,
  }).format(Number(value) / (Number(value) >= 1024 * 1024 ? 1024 * 1024 : 1024));
}

function renderRestorePage({ cloud = null, feedback = null, history = [] }) {
  const cloudContent = cloud?.backups?.length
    ? `<form class="card card-body app-form" method="post" action="/settings/backups/restore/cloud">
        <div class="form-field">
          <label for="cloud-backup">Sauvegarde disponible</label>
          <select class="form-select" id="cloud-backup" name="object_key" required>
            ${cloud.backups.map((backup) => `<option value="${escapeHtml(backup.key)}">${escapeHtml(formatTimestamp(backup.lastModified))} · ${escapeHtml(path.basename(backup.key))} · ${escapeHtml(formatSize(backup.size))}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-outline-secondary" type="submit">Inspecter la sauvegarde cloud</button>
      </form>`
    : `<p class="empty-state">${cloud?.error ? escapeHtml(errorMessage(cloud.error)) : 'Aucune sauvegarde Attendance Log disponible sur la destination configurée.'}</p>`;
  const notification = feedback
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(feedback)}</p>` : '';
  const historyContent = history.length === 0
    ? '<p class="empty-state">Aucune restauration n’a encore été exécutée.</p>'
    : `<div class="list-group compact-list">${history.map((entry) => `<article class="list-group-item compact-row compact-row-status"><div class="compact-identity"><p class="compact-title">${escapeHtml(entry.filename)}</p><p class="compact-meta">${escapeHtml(formatTimestamp(entry.started_at))} · ${escapeHtml(entry.source.toUpperCase())}</p></div><div class="compact-status"><span class="badge status-badge status-${entry.status === 'success' ? 'active' : 'absent'}">${entry.status === 'success' ? 'Réussie' : 'Échec'}</span>${entry.error_summary ? `<p class="compact-meta">${escapeHtml(errorMessage(entry.error_summary))}</p>` : ''}</div></article>`).join('')}</div>`;
  return renderPage('Restaurer une sauvegarde', renderSettingsLayout({
    activeSection: 'backups',
    title: 'Restaurer une sauvegarde',
    description: 'Inspectez une sauvegarde avant de remplacer les données de l’installation.',
    status: '<a class="btn btn-light" href="/settings/backups">Retour aux sauvegardes</a>',
    notifications: notification,
    content: `<div class="backup-settings restore-settings">
      <p class="alert alert-warning">Une restauration remplace entièrement la base actuelle. Les données métier restent restaurables même si la clé de chiffrement est différente.</p>
      <section class="page-section" aria-labelledby="local-restore-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="local-restore-title">Depuis un fichier</h2><p class="section-description">Archive ZIP créée par Attendance Log, jusqu’à ${maximumUploadMb} Mo.</p></div></div>
        <form class="card card-body app-form" method="post" action="/settings/backups/restore/local" enctype="multipart/form-data">
          <div class="form-field"><label for="restore-file">Fichier de sauvegarde</label><input class="form-control" id="restore-file" name="backup" type="file" accept=".zip,application/zip" required></div>
          <button class="btn btn-primary" type="submit">Inspecter le fichier</button>
        </form>
      </section>
      <section class="page-section" aria-labelledby="cloud-restore-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="cloud-restore-title">Depuis le cloud</h2><p class="section-description">Sauvegardes du préfixe Attendance Log de la destination actuellement configurée.</p></div></div>
        ${cloudContent}
      </section>
      <section class="page-section" aria-labelledby="restore-history-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="restore-history-title">Historique des restaurations</h2><p class="section-description">Dernières tentatives enregistrées dans la base actuelle.</p></div></div>
        ${historyContent}
      </section>
    </div>`,
  }));
}

function renderPreview(prepared, feedback = null) {
  const manifest = prepared.manifest;
  const currentFingerprint = getKeyInfo().fingerprint;
  const keyStatus = prepared.fingerprintMatch
    ? '<p class="alert alert-success">Clé compatible — les secrets chiffrés devraient rester utilisables.</p>'
    : '<p class="alert alert-warning">La clé actuelle ne correspond pas à celle de cette sauvegarde. Les données métier seront restaurées, mais les identifiants chiffrés devront être récupérés avec la clé correspondante ou reconfigurés.</p>';
  const instanceStatus = manifest.instanceId && !prepared.instanceMatch
    ? '<p class="alert alert-info">Cette sauvegarde provient d’une autre instance. La restauration reste autorisée et l’identité de l’installation actuelle sera conservée.</p>'
    : '';
  const safety = prepared.currentDatabasePopulated
    ? `<div class="card card-body app-form"><h2>Données actuelles détectées</h2><p>Avant leur remplacement, Attendance Log tentera une sauvegarde cloud. Si elle est indisponible, téléchargez obligatoirement cette sauvegarde de sécurité.</p>
        <form method="post" action="/settings/backups/restore/${escapeHtml(prepared.token)}/safety-download"><button class="btn btn-outline-secondary" type="submit">Télécharger la sauvegarde de sécurité</button></form>
        ${prepared.safetyDownloaded ? '<span class="badge status-badge status-active">Sauvegarde de sécurité générée</span>' : ''}</div>` : '';
  return renderPage('Confirmer la restauration', renderSettingsLayout({
    activeSection: 'backups',
    title: 'Confirmer la restauration',
    description: 'Vérifiez l’origine et la compatibilité avant de continuer.',
    status: '<a class="btn btn-light" href="/settings/backups/restore">Changer de sauvegarde</a>',
    notifications: feedback ? `<p class="alert alert-danger" role="alert">${escapeHtml(feedback)}</p>` : '',
    content: `<div class="backup-settings restore-settings">
      <section class="card card-body app-form restore-summary" aria-labelledby="backup-summary-title">
        <h2 id="backup-summary-title">${escapeHtml(prepared.filename)}</h2>
        <dl class="security-key-summary">
          <div><dt>Date de sauvegarde</dt><dd>${escapeHtml(formatTimestamp(manifest.generatedAt))}</dd></div>
          <div><dt>Version de l’application</dt><dd>${escapeHtml(manifest.application?.version || '—')}${manifest.application?.commit ? ` · ${escapeHtml(manifest.application.commit)}` : ''}</dd></div>
          <div><dt>Migration de base</dt><dd>${escapeHtml(manifest.database?.migration || 'Aucune')}</dd></div>
          <div><dt>PostgreSQL</dt><dd>${escapeHtml(manifest.database?.version || '—')}</dd></div>
          <div><dt>Instance source</dt><dd><code>${escapeHtml(manifest.instanceId || 'Non renseignée (ancienne sauvegarde)')}</code></dd></div>
          <div><dt>Instance actuelle</dt><dd><code>${escapeHtml(getInstanceId())}</code></dd></div>
          <div><dt>Clé de la sauvegarde</dt><dd><code>${escapeHtml(manifest.encryptionKeyFingerprint || 'Non renseignée')}</code></dd></div>
          <div><dt>Clé actuelle</dt><dd><code>${escapeHtml(currentFingerprint)}</code></dd></div>
        </dl>
        ${instanceStatus}
        ${keyStatus}
      </section>
      ${safety}
      <section class="page-section" aria-labelledby="restore-confirm-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="restore-confirm-title">Confirmation destructive</h2><p class="section-description">La base actuelle sera remplacée après validation complète dans une base temporaire.</p></div></div>
        <form class="card card-body app-form" method="post" action="/settings/backups/restore/${escapeHtml(prepared.token)}/confirm" autocomplete="off">
          <label class="checkbox-option"><input class="form-check-input" name="understood" type="checkbox" value="yes" required><span>Je comprends que les données actuelles seront remplacées.</span></label>
          <div class="form-field"><label for="restore-confirmation">Saisissez RESTAURER</label><input class="form-control" id="restore-confirmation" name="confirmation" required autocomplete="off" spellcheck="false"></div>
          <button class="btn btn-danger" type="submit">Restaurer cette sauvegarde</button>
        </form>
      </section>
    </div>`,
  }));
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

async function renderLanding(response, feedback = null, status = 200) {
  response.status(status).send(renderRestorePage({
    cloud: await loadCloudListing(),
    history: await loadRestoreHistory(),
    feedback,
  }));
}

router.get('/', async (request, response) => {
  await renderLanding(response, request.query.error ? errorMessage(request.query.error) : null);
});

router.post('/local', upload.single('backup'), async (request, response) => {
  if (!request.file) return renderLanding(response, errorMessage('FILE_REQUIRED'), 400);
  try {
    const prepared = await createPreparedRestore(request.file.path, {
      source: 'local', filename: request.file.originalname,
    });
    return response.redirect(303, `/settings/backups/restore/${prepared.token}`);
  } catch (error) {
    try { await require('node:fs/promises').rm(request.file.path, { force: true }); } catch (_cleanupError) { /* Nothing else to clean. */ }
    return renderLanding(response, errorMessage(error.code), 400);
  }
});

router.post('/cloud', async (request, response) => {
  try {
    const prepared = await prepareCloudRestore(String(request.body.object_key || ''));
    response.redirect(303, `/settings/backups/restore/${prepared.token}`);
  } catch (error) {
    const code = error instanceof RestoreError ? error.code : normalizeBackupError(error).code;
    await renderLanding(response, errorMessage(code), 400);
  }
});

router.get('/:token', (request, response) => {
  try {
    response.send(renderPreview(getPreparedRestore(request.params.token)));
  } catch (error) {
    response.redirect(303, `/settings/backups/restore?error=${encodeURIComponent(error.code)}`);
  }
});

router.post('/:token/safety-download', async (request, response) => {
  let artifact;
  try {
    getPreparedRestore(request.params.token);
    artifact = await createManualDownload();
    response.download(artifact.zipPath, `avant-restauration-${artifact.filename}`, {
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
    response.status(400).send(renderPreview(getPreparedRestore(request.params.token), errorMessage(error.code)));
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
    response.status(200).send(renderPage('Restauration terminée', renderSettingsLayout({
      activeSection: 'backups',
      title: 'Restauration terminée',
      description: 'Attendance Log redémarre avec les données restaurées.',
      notifications: `<p class="alert alert-success">La restauration a réussi.${result.fingerprintMatch ? '' : ' Certaines connexions externes devront être récupérées avec la clé correspondante ou reconfigurées.'}</p>`,
      content: '<p>Vous devrez vous reconnecter après le redémarrage.</p>',
    })));
    response.once('finish', () => setTimeout(() => process.exit(0), 250));
  } catch (error) {
    console.error('Restore failed:', error.code || 'RESTORE_FAILED');
    const message = errorMessage(error.code);
    if (prepared) return response.status(400).send(renderPreview(prepared, message));
    return renderLanding(response, message, 400);
  }
});

router.use((error, request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Le fichier dépasse la limite de ${maximumUploadMb} Mo.` : 'Le fichier n’a pas pu être reçu.';
    return renderLanding(response, message, 400);
  }
  console.error('Restore upload failed:', error.code || 'UPLOAD_FAILED');
  return renderLanding(response, 'Le fichier n’a pas pu être reçu.', 400);
});

module.exports = router;
