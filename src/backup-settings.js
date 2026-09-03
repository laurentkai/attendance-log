const express = require('express');
const { pool } = require('./db/client');
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
const { escapeHtml, renderPage, renderSettingsNavigation } = require('./ui');
const restoreSettingsRouter = require('./restore-settings');

const router = express.Router();
router.use('/restore', restoreSettingsRouter);
const frequencies = new Set(['daily', 'weekly']);
const providers = new Set(['', 's3', 'azure']);
const weekdays = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
];

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
  if (!frequencies.has(values.frequency)) return new BackupError('FREQUENCY_INVALID');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.executionTime)) {
    return new BackupError('EXECUTION_TIME_INVALID');
  }
  if (values.frequency === 'weekly' && !/^[0-6]$/.test(values.weekday)) {
    return new BackupError('WEEKDAY_INVALID');
  }
  const retentionDays = Number(values.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    return new BackupError('RETENTION_INVALID');
  }
  return null;
}

function errorMessage(code) {
  return {
    BACKUP_IN_PROGRESS: 'Une sauvegarde est déjà en cours. Réessayez lorsqu’elle sera terminée.',
    PG_DUMP_UNAVAILABLE: 'L’outil PostgreSQL de sauvegarde n’est pas disponible dans l’application.',
    PG_DUMP_FAILED: 'La sauvegarde PostgreSQL a échoué. Vérifiez la disponibilité de la base de données.',
    PROVIDER_REQUIRED: 'Sélectionnez une destination avant d’activer les sauvegardes automatiques.',
    PROVIDER_UNSUPPORTED: 'La destination sélectionnée n’est pas prise en charge.',
    FREQUENCY_INVALID: 'Sélectionnez une fréquence quotidienne ou hebdomadaire.',
    EXECUTION_TIME_INVALID: 'Indiquez une heure d’exécution valide.',
    WEEKDAY_INVALID: 'Sélectionnez un jour pour la sauvegarde hebdomadaire.',
    RETENTION_INVALID: 'La durée de rétention doit être comprise entre 1 et 3650 jours.',
    S3_BUCKET_REQUIRED: 'Indiquez le compartiment S3.',
    S3_REGION_REQUIRED: 'Indiquez la région S3.',
    S3_ENDPOINT_INVALID: 'L’URL du point de terminaison S3 n’est pas valide.',
    S3_CREDENTIALS_INCOMPLETE: 'Renseignez l’identifiant et la clé secrète S3 ensemble, ou laissez les deux vides.',
    AZURE_ACCOUNT_INVALID: 'Le nom du compte Azure n’est pas valide.',
    AZURE_CONTAINER_INVALID: 'Le nom du conteneur Azure n’est pas valide.',
    AZURE_CREDENTIAL_REQUIRED: 'Indiquez la clé du compte Azure.',
    SECRET_KEY_MISMATCH: 'Les identifiants de sauvegarde ne peuvent pas être déchiffrés avec la clé active. Vérifiez la clé de récupération.',
    STORAGE_AUTHENTICATION_FAILED: 'L’authentification auprès de la destination a échoué.',
    STORAGE_PERMISSION_DENIED: 'La destination a refusé l’opération. Vérifiez les autorisations.',
    STORAGE_NOT_FOUND: 'Le compartiment ou conteneur configuré est introuvable.',
    STORAGE_CONNECTION_FAILED: 'Impossible de joindre la destination de sauvegarde.',
  }[code] || 'L’opération de sauvegarde a échoué.';
}

function formatTimestamp(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-BE', {
    dateStyle: 'short', timeStyle: 'short', timeZone: process.env.BACKUP_TIMEZONE || 'Europe/Brussels',
  }).format(new Date(value));
}

function formatSize(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('fr-BE', {
    style: 'unit', unit: Number(value) >= 1024 * 1024 ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: 1,
  }).format(Number(value) / (Number(value) >= 1024 * 1024 ? 1024 * 1024 : 1024));
}

function historyLabel(value) {
  return {
    manual_download: 'Téléchargement manuel',
    manual_cloud: 'Manuelle cloud',
    scheduled: 'Planifiée',
    local: 'Téléchargement',
    s3: 'S3',
    azure: 'Azure Blob',
  }[value] || value;
}

function renderBackupPage({ values, history = [], feedback = null, nextRunAt = null }) {
  const configured = Boolean(values.provider);
  const feedbackMessage = feedback?.message
    ? `<p class="message message-${feedback.type === 'success' ? 'success' : 'error'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';
  const historyRows = history.length === 0
    ? '<p class="empty-state">Aucune sauvegarde n’a encore été exécutée.</p>'
    : `<div class="data-table-scroll" tabindex="0" role="region" aria-label="Historique des sauvegardes">
        <table class="data-table backup-history-table">
          <thead><tr><th>Date</th><th>Type</th><th>Destination</th><th>Taille</th><th>Statut</th></tr></thead>
          <tbody>${history.map((entry) => `<tr>
            <td>${escapeHtml(formatTimestamp(entry.started_at))}</td>
            <td>${escapeHtml(historyLabel(entry.run_type))}</td>
            <td>${escapeHtml(historyLabel(entry.provider))}</td>
            <td class="numeric">${escapeHtml(formatSize(entry.size_bytes))}</td>
            <td><span class="status-badge status-${entry.status === 'success' ? 'active' : 'absent'}">${entry.status === 'success' ? 'Réussie' : 'Échec'}</span>${entry.error_summary ? `<p class="compact-meta">${escapeHtml(errorMessage(entry.error_summary))}</p>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  const latestFailure = history[0]?.status === 'failed'
    ? `<p class="message message-error" role="alert">Dernière sauvegarde : échec le ${escapeHtml(formatTimestamp(history[0].started_at))}. ${escapeHtml(errorMessage(history[0].error_summary))}</p>`
    : '';

  return renderPage('Configuration des sauvegardes', `
    <div class="settings-page backup-settings" data-backup-settings>
      <header class="page-header">
        <div>
          <p class="eyebrow">Configuration</p>
          <h1>Sauvegardes</h1>
          <p class="page-description">Téléchargez une sauvegarde ou automatisez son envoi vers un stockage cloud.</p>
        </div>
        <span class="status-badge status-${values.enabled ? 'active' : 'inactive'}">${values.enabled ? 'Sauvegardes automatiques actives' : 'Sauvegardes automatiques désactivées'}</span>
      </header>
      ${renderSettingsNavigation('backups')}
      <div class="notification-area" aria-live="polite" aria-atomic="true">${feedbackMessage}</div>

      <section class="page-section" aria-labelledby="manual-backup-title">
        <div class="section-header">
          <div>
            <h2 id="manual-backup-title">Sauvegarde manuelle</h2>
            <p class="section-description">Le fichier contient la base PostgreSQL et un manifeste, mais jamais la clé de récupération.</p>
          </div>
        </div>
        <div class="form-card">
          <p class="help-text">Les secrets fournisseur restent chiffrés dans la sauvegarde. Conservez séparément la clé de récupération correspondante.</p>
          <form method="post" action="/settings/backups/download">
            <button class="button" type="submit">Télécharger une sauvegarde</button>
          </form>
        </div>
      </section>

      <section class="page-section" aria-labelledby="automatic-backup-title">
        <div class="section-header">
          <div>
            <h2 id="automatic-backup-title">Sauvegardes automatiques</h2>
            <p class="section-description">Planification selon le fuseau ${escapeHtml(process.env.BACKUP_TIMEZONE || 'Europe/Brussels')}${nextRunAt ? ` · prochaine exécution ${escapeHtml(formatTimestamp(nextRunAt))}` : ''}.</p>
          </div>
        </div>
        <form class="form-card" method="post" action="/settings/backups" autocomplete="off">
          <label class="checkbox-option">
            <input name="enabled" type="checkbox" value="yes"${values.enabled ? ' checked' : ''}>
            <span>Activer les sauvegardes automatiques</span>
          </label>
          <div class="form-field">
            <label for="backup-provider">Destination</label>
            <select id="backup-provider" name="provider" data-backup-provider>
              <option value=""${values.provider === '' ? ' selected' : ''}>Sélectionner…</option>
              <option value="s3"${values.provider === 's3' ? ' selected' : ''}>Amazon S3 / S3-compatible</option>
              <option value="azure"${values.provider === 'azure' ? ' selected' : ''}>Azure Blob Storage</option>
            </select>
          </div>

          <fieldset data-provider-fields="s3"${values.provider !== 's3' ? ' hidden' : ''}>
            <legend>S3-compatible</legend>
            <div class="form-field"><label for="s3-bucket">Compartiment</label><input id="s3-bucket" name="s3_bucket" value="${escapeHtml(values.s3.bucket)}" autocomplete="off" spellcheck="false"></div>
            <div class="form-field"><label for="s3-region">Région</label><input id="s3-region" name="s3_region" value="${escapeHtml(values.s3.region)}" autocomplete="off" spellcheck="false" placeholder="eu-west-1"></div>
            <div class="form-field"><label for="s3-endpoint">Point de terminaison personnalisé</label><input id="s3-endpoint" name="s3_endpoint" type="url" value="${escapeHtml(values.s3.endpoint)}" autocomplete="off" spellcheck="false" placeholder="https://stockage.example.com"></div>
            <div class="form-field"><label for="s3-prefix">Préfixe</label><input id="s3-prefix" name="s3_prefix" value="${escapeHtml(values.s3.prefix)}" autocomplete="off" spellcheck="false" placeholder="sauvegardes"></div>
            <div class="form-field"><label for="s3-access-key">Identifiant de clé d’accès</label><input id="s3-access-key" name="s3_access_key_id" value="${escapeHtml(values.s3.accessKeyId)}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
            <div class="form-field"><label for="s3-secret-key">Clé d’accès secrète</label><input id="s3-secret-key" name="s3_secret_access_key" type="password" value="" autocomplete="new-password" placeholder="Laisser vide pour conserver la clé…"><p class="help-text">Laissez vide pour conserver la clé lorsque l’identifiant ne change pas.</p></div>
            <label class="checkbox-option"><input name="s3_force_path_style" type="checkbox" value="yes"${values.s3.forcePathStyle ? ' checked' : ''}><span>Utiliser l’adressage par chemin</span></label>
          </fieldset>

          <fieldset data-provider-fields="azure"${values.provider !== 'azure' ? ' hidden' : ''}>
            <legend>Azure Blob Storage</legend>
            <div class="form-field"><label for="azure-account">Compte de stockage</label><input id="azure-account" name="azure_account_name" value="${escapeHtml(values.azure.accountName)}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
            <div class="form-field"><label for="azure-container">Conteneur</label><input id="azure-container" name="azure_container_name" value="${escapeHtml(values.azure.containerName)}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
            <div class="form-field"><label for="azure-key">Clé du compte</label><input id="azure-key" name="azure_account_key" type="password" value="" autocomplete="new-password" placeholder="Laisser vide pour conserver la clé…"><p class="help-text">Laissez vide pour conserver la clé lorsque le compte ne change pas.</p></div>
          </fieldset>

          <div class="backup-schedule-grid">
            <div class="form-field"><label for="backup-frequency">Fréquence</label><select id="backup-frequency" name="frequency" data-backup-frequency><option value="daily"${values.frequency === 'daily' ? ' selected' : ''}>Quotidienne</option><option value="weekly"${values.frequency === 'weekly' ? ' selected' : ''}>Hebdomadaire</option></select></div>
            <div class="form-field"><label for="backup-time">Heure</label><input id="backup-time" name="execution_time" type="time" value="${escapeHtml(values.executionTime)}" required></div>
            <div class="form-field" data-weekday-field${values.frequency !== 'weekly' ? ' hidden' : ''}><label for="backup-weekday">Jour</label><select id="backup-weekday" name="weekday">${weekdays.map((day, index) => `<option value="${index}"${String(values.weekday) === String(index) ? ' selected' : ''}>${day}</option>`).join('')}</select></div>
            <div class="form-field"><label for="retention-days">Durée de rétention (jours)</label><input id="retention-days" name="retention_days" type="number" min="1" max="3650" inputmode="numeric" value="${escapeHtml(values.retentionDays)}" required></div>
          </div>
          <p class="help-text">Les secrets sont chiffrés par Attendance Log dans la base. Le stockage cloud protège également le fichier sauvegardé au repos.</p>
          <div class="form-actions"><button class="button" type="submit">Enregistrer la configuration</button></div>
        </form>
        <div class="form-actions backup-cloud-actions">
          <form method="post" action="/settings/backups/test"><button class="button button-quiet" type="submit"${configured ? '' : ' disabled'}>Tester la destination</button></form>
          <form method="post" action="/settings/backups/run"><button class="button button-secondary" type="submit"${configured ? '' : ' disabled'}>Sauvegarder maintenant</button></form>
        </div>
      </section>

      <section class="page-section" aria-labelledby="restore-backup-title">
        <div class="section-header">
          <div>
            <h2 id="restore-backup-title">Restauration</h2>
            <p class="section-description">Inspectez puis restaurez une sauvegarde locale ou cloud dans un parcours séparé.</p>
          </div>
          <a class="button button-danger-secondary" href="/settings/backups/restore">Restaurer une sauvegarde</a>
        </div>
      </section>

      <section class="page-section" aria-labelledby="backup-history-title">
        <div class="section-header"><div><h2 id="backup-history-title">Historique</h2><p class="section-description">Dernières exécutions enregistrées.</p></div></div>
        ${latestFailure}
        ${historyRows}
      </section>
    </div>
    <script src="/js/backup-settings.js" defer></script>`);
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
    saved: 'La configuration des sauvegardes a été enregistrée.',
    tested: 'La destination de sauvegarde est accessible.',
    completed: 'La sauvegarde a été envoyée vers la destination configurée.',
  };
  try {
    const feedback = notices[request.query.notice]
      ? { type: 'success', message: notices[request.query.notice] }
      : request.query.error
        ? { type: 'error', message: errorMessage(request.query.error) }
        : null;
    await renderCurrent(response, { feedback });
  } catch (error) {
    console.error('Unable to load backup settings:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderBackupPage({
      values: emptyValues(),
      feedback: { type: 'error', message: 'Impossible de charger la configuration des sauvegardes.' },
    }));
  }
});

router.post('/', async (request, response) => {
  const values = getFormValues(request.body);
  try {
    const existing = await loadBackupConfiguration();
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
    await pool.query(
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
    response.redirect(303, '/settings/backups?notice=saved');
  } catch (error) {
    console.error('Unable to save backup settings:', error.code || 'DATABASE_ERROR');
    let history = [];
    try { history = await loadHistory(); } catch (_error) { /* Rendering remains available. */ }
    response.status(400).send(renderBackupPage({
      values,
      history,
      feedback: { type: 'error', message: errorMessage(error.code) },
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
      if (error && !response.headersSent) {
        response.redirect(303, '/settings/backups?error=BACKUP_FAILED');
      }
    });
  } catch (error) {
    if (artifact) await artifact.cleanup();
    console.error('Manual backup download failed:', error.code || 'BACKUP_FAILED');
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
    await runCloudBackup('manual_cloud');
    response.redirect(303, '/settings/backups?notice=completed');
  } catch (error) {
    console.error('Cloud backup failed:', error.code || 'BACKUP_FAILED');
    response.redirect(303, `/settings/backups?error=${encodeURIComponent(error.code || 'BACKUP_FAILED')}`);
  }
});

module.exports = router;
