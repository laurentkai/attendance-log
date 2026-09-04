const express = require('express');
const { createManualDownload } = require('./backup');
const {
  getOperationalDataCounts,
  resetOperationalDataWithSafety,
  totalOperationalRecords,
} = require('./operational-reset');
const { businessTerm, escapeHtml, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();
const localSafetyLifetimeMs = 30 * 60 * 1000;

function saveSession(request) {
  return new Promise((resolve, reject) => request.session.save((error) => (
    error ? reject(error) : resolve()
  )));
}

function localSafetyIsReady(request) {
  const safety = request.session?.operationalResetSafety;
  return Boolean(safety
    && String(safety.userId) === String(request.currentUser.id)
    && Number.isFinite(Number(safety.completedAt))
    && Date.now() - Number(safety.completedAt) < localSafetyLifetimeMs);
}

function clearLocalSafety(request) {
  delete request.session.operationalResetSafety;
}

function resetErrorMessage(code) {
  return {
    BACKUP_IN_PROGRESS: 'Une sauvegarde ou une restauration est déjà en cours. Réessayez lorsqu’elle sera terminée.',
    RESET_IN_PROGRESS: 'Une opération de maintenance est déjà en cours.',
    RESET_CONFIRMATION_REQUIRED: 'Cochez la confirmation et saisissez EFFACER pour continuer.',
    RESET_SAFETY_BACKUP_REQUIRED: 'La sauvegarde cloud n’a pas pu être créée. Téléchargez complètement la sauvegarde de sécurité locale avant de réessayer.',
    RESET_EMPTY: 'Aucune donnée métier ne doit être réinitialisée.',
  }[code] || 'Les données métier n’ont pas pu être réinitialisées.';
}

function renderMaintenancePage({ counts, localSafetyReady = false, feedback = null }) {
  const total = totalOperationalRecords(counts);
  const feedbackHtml = feedback?.message
    ? `<p class="alert alert-${feedback.type === 'success' ? 'success' : 'danger'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';
  const countSummary = total === 0
    ? '<p class="empty-state mb-0">Aucune donnée métier n’est actuellement enregistrée.</p>'
    : `<dl class="security-key-summary mb-0">
        <div><dt>${businessTerm('student', 'plural')}</dt><dd>${counts.students}</dd></div>
        <div><dt>${businessTerm('class', 'plural')}</dt><dd>${counts.classes}</dd></div>
        <div><dt>${businessTerm('membership', 'plural')}</dt><dd>${counts.memberships}</dd></div>
        <div><dt>${businessTerm('session', 'plural')}</dt><dd>${counts.courseSessions}</dd></div>
        <div><dt>${businessTerm('attendance', 'plural')}</dt><dd>${counts.attendanceRecords}</dd></div>
      </dl>`;

  return renderPage('Maintenance', renderSettingsLayout({
    activeSection: 'maintenance',
    title: 'Maintenance',
    description: 'Gérez les opérations exceptionnelles sur les données de l’application.',
    notifications: feedbackHtml,
    content: `<section class="page-section" aria-labelledby="reset-business-data-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="reset-business-data-title">Réinitialiser les données métier</h2>
            <p class="section-description">Supprime : ${businessTerm('student', 'plural')}, ${businessTerm('class', 'plural')}, ${businessTerm('membership', 'plural')}, ${businessTerm('session', 'plural')} et ${businessTerm('attendance', 'plural')}. Les comptes administrateur, la configuration, les sauvegardes et les secrets chiffrés sont conservés.</p>
          </div>
          <span class="badge text-bg-danger">Action destructive</span>
        </div>
        <div class="card card-body app-form border-danger-subtle">
          ${countSummary}
          ${total > 0 ? `<div class="alert alert-warning mb-0" role="status">
            Une sauvegarde de sécurité récente est obligatoire. Attendance Log tentera d’abord une sauvegarde cloud. Si la destination est indisponible, téléchargez la sauvegarde locale ci-dessous.
          </div>
          <div class="d-flex flex-column flex-sm-row align-items-sm-center gap-2">
            <form method="post" action="/settings/maintenance/safety-download">
              <button class="btn btn-outline-secondary" type="submit">Télécharger la sauvegarde de sécurité</button>
            </form>
            ${localSafetyReady ? '<span class="badge text-bg-success">Sauvegarde locale téléchargée</span>' : ''}
          </div>
          <form class="d-grid gap-3 pt-3 border-top" method="post" action="/settings/maintenance/reset" autocomplete="off">
            <label class="form-check">
              <input class="form-check-input" name="understood" type="checkbox" value="yes" required>
              <span class="form-check-label">Je comprends que toutes les données métier seront supprimées définitivement.</span>
            </label>
            <div class="form-field">
              <label for="reset-confirmation">Saisissez EFFACER</label>
              <input class="form-control" id="reset-confirmation" name="confirmation" type="text" autocomplete="off" spellcheck="false" required>
            </div>
            <div><button class="btn btn-danger" type="submit">Réinitialiser les données métier</button></div>
          </form>` : ''}
        </div>
      </section>`,
  }));
}

async function renderCurrent(response, request, feedback = null, status = 200) {
  response.status(status).send(renderMaintenancePage({
    counts: await getOperationalDataCounts(),
    localSafetyReady: localSafetyIsReady(request),
    feedback,
  }));
}

router.get('/', async (request, response) => {
  const feedback = request.query.notice === 'reset'
    ? { type: 'success', message: 'Les données métier ont été réinitialisées.' }
    : null;
  try {
    await renderCurrent(response, request, feedback);
  } catch (error) {
    console.error('Unable to load maintenance settings:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderMaintenancePage({
      counts: { students: 0, classes: 0, memberships: 0, courseSessions: 0, attendanceRecords: 0 },
      feedback: { type: 'error', message: 'Impossible de charger la maintenance pour le moment.' },
    }));
  }
});

router.post('/safety-download', async (request, response) => {
  let artifact;
  try {
    if (totalOperationalRecords(await getOperationalDataCounts()) === 0) {
      return response.redirect(303, '/settings/maintenance');
    }
    artifact = await createManualDownload();
    response.download(artifact.zipPath, `avant-reinitialisation-${artifact.filename}`, {
      headers: { 'Cache-Control': 'private, no-store' },
    }, async (error) => {
      try {
        if (!error) {
          request.session.operationalResetSafety = {
            userId: String(request.currentUser.id),
            completedAt: Date.now(),
          };
          await saveSession(request);
        }
      } catch (saveError) {
        console.error('Unable to confirm reset safety backup delivery:', saveError.code || 'SESSION_SAVE_FAILED');
      } finally {
        try {
          await artifact.cleanup();
        } catch (cleanupError) {
          console.warn('Unable to clean up reset safety backup:', cleanupError.code || 'BACKUP_CLEANUP_FAILED');
        }
      }
      if (error) {
        console.warn('Reset safety backup download did not complete:', error.code || 'DOWNLOAD_INTERRUPTED');
        if (!response.headersSent) response.status(500).end();
      }
    });
  } catch (error) {
    if (artifact) await artifact.cleanup();
    console.error('Unable to create reset safety backup:', error.code || 'BACKUP_FAILED');
    await renderCurrent(response, request, {
      type: 'error', message: 'La sauvegarde de sécurité n’a pas pu être créée.',
    }, 500);
  }
});

router.post('/reset', async (request, response) => {
  if (request.body.understood !== 'yes' || request.body.confirmation !== 'EFFACER') {
    return renderCurrent(response, request, {
      type: 'error', message: resetErrorMessage('RESET_CONFIRMATION_REQUIRED'),
    }, 400);
  }
  try {
    const counts = await getOperationalDataCounts();
    if (totalOperationalRecords(counts) === 0) {
      return renderCurrent(response, request, {
        type: 'error', message: resetErrorMessage('RESET_EMPTY'),
      }, 409);
    }
    const localSafetyCompleted = localSafetyIsReady(request);
    await resetOperationalDataWithSafety({ localSafetyCompleted });
    clearLocalSafety(request);
    try {
      await saveSession(request);
    } catch (error) {
      console.warn('Operational reset completed, but its safety marker could not be cleared:', error.code || 'SESSION_SAVE_FAILED');
    }
    return response.redirect(303, '/settings/maintenance?notice=reset');
  } catch (error) {
    if (error.causeCode) {
      console.warn('Cloud safety backup unavailable for operational reset:', error.causeCode);
    }
    console.error('Operational data reset failed:', error.code || 'RESET_FAILED');
    const conflictCodes = new Set([
      'BACKUP_IN_PROGRESS',
      'RESET_IN_PROGRESS',
      'RESET_SAFETY_BACKUP_REQUIRED',
    ]);
    return renderCurrent(response, request, {
      type: 'error', message: resetErrorMessage(error.code),
    }, conflictCodes.has(error.code) ? 409 : 500);
  }
});

module.exports = router;
