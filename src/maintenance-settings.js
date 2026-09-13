const express = require('express');
const { recordAuditEventSafely } = require('./audit');
const { createManualDownload } = require('./backup');
const {
  getOperationalDataCounts,
  resetOperationalDataWithSafety,
  totalOperationalRecords,
} = require('./operational-reset');
const { businessTerm, escapeHtml, renderPage, renderSettingsLayout } = require('./ui');
const { t } = require('./i18n');

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

function resetErrorMessage(code, language) {
  return t(language, `maintenance.error.${['BACKUP_IN_PROGRESS', 'RESET_IN_PROGRESS', 'RESET_CONFIRMATION_REQUIRED', 'RESET_SAFETY_BACKUP_REQUIRED', 'RESET_EMPTY'].includes(code) ? code : 'default'}`);
}

function renderMaintenancePage({ counts, localSafetyReady = false, feedback = null, language }) {
  const total = totalOperationalRecords(counts);
  const feedbackHtml = feedback?.message
    ? `<p class="alert alert-${feedback.type === 'success' ? 'success' : 'danger'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';
  const countSummary = total === 0
    ? `<p class="empty-state mb-0">${escapeHtml(t(language, 'maintenance.empty'))}</p>`
    : `<dl class="security-key-summary mb-0">
        <div><dt>${businessTerm(language, 'student', 'plural')}</dt><dd>${counts.students}</dd></div>
        <div><dt>${businessTerm(language, 'class', 'plural')}</dt><dd>${counts.classes}</dd></div>
        <div><dt>${businessTerm(language, 'membership', 'plural')}</dt><dd>${counts.memberships}</dd></div>
        <div><dt>${businessTerm(language, 'session', 'plural')}</dt><dd>${counts.courseSessions}</dd></div>
        <div><dt>${businessTerm(language, 'attendance', 'plural')}</dt><dd>${counts.attendanceRecords}</dd></div>
      </dl>`;

  return renderPage(t(language, 'maintenance.title'), renderSettingsLayout({
    activeSection: 'maintenance',
    title: t(language, 'maintenance.title'),
    description: t(language, 'maintenance.description'),
    notifications: feedbackHtml,
    content: `<section class="page-section" aria-labelledby="reset-business-data-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="reset-business-data-title">${escapeHtml(t(language, 'maintenance.reset.title'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'maintenance.reset.description', { students: businessTerm(language, 'student', 'plural'), classes: businessTerm(language, 'class', 'plural'), memberships: businessTerm(language, 'membership', 'plural'), sessions: businessTerm(language, 'session', 'plural'), attendance: businessTerm(language, 'attendance', 'plural') }))}</p>
          </div>
          <span class="badge text-bg-danger">${escapeHtml(t(language, 'maintenance.destructive'))}</span>
        </div>
        <div class="card card-body app-form border-danger-subtle">
          ${countSummary}
          ${total > 0 ? `<div class="alert alert-warning mb-0" role="status">
            ${escapeHtml(t(language, 'maintenance.safety_help'))}
          </div>
          <div class="d-flex flex-column flex-sm-row align-items-sm-center gap-2">
            <form method="post" action="/settings/maintenance/safety-download">
              <button class="btn btn-outline-secondary" type="submit">${escapeHtml(t(language, 'maintenance.safety_download'))}</button>
            </form>
            ${localSafetyReady ? `<span class="badge text-bg-success">${escapeHtml(t(language, 'maintenance.safety_downloaded'))}</span>` : ''}
          </div>
          <form class="d-grid gap-3 pt-3 border-top" method="post" action="/settings/maintenance/reset" autocomplete="off">
            <label class="form-check">
              <input class="form-check-input" name="understood" type="checkbox" value="yes" required>
              <span class="form-check-label">${escapeHtml(t(language, 'maintenance.confirm'))}</span>
            </label>
            <div class="form-field">
              <label for="reset-confirmation">${escapeHtml(t(language, 'maintenance.type_delete'))}</label>
              <input class="form-control" id="reset-confirmation" name="confirmation" type="text" autocomplete="off" spellcheck="false" required>
            </div>
            <div><button class="btn btn-danger" type="submit">${escapeHtml(t(language, 'maintenance.reset.submit'))}</button></div>
          </form>` : ''}
        </div>
      </section>`,
  }, language), { language });
}

async function renderCurrent(response, request, feedback = null, status = 200) {
  response.status(status).send(renderMaintenancePage({
    counts: await getOperationalDataCounts(),
    localSafetyReady: localSafetyIsReady(request),
    feedback,
    language: request.uiLanguage,
  }));
}

router.get('/', async (request, response) => {
  const feedback = request.query.notice === 'reset'
    ? { type: 'success', message: t(request.uiLanguage, 'maintenance.notice.reset') }
    : null;
  try {
    await renderCurrent(response, request, feedback);
  } catch (error) {
    console.error('Unable to load maintenance settings:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderMaintenancePage({
      counts: { students: 0, classes: 0, memberships: 0, courseSessions: 0, attendanceRecords: 0 },
      feedback: { type: 'error', message: t(request.uiLanguage, 'maintenance.error.load') }, language: request.uiLanguage,
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
    response.download(artifact.zipPath, `${t(request.uiLanguage, 'maintenance.safety_backup_prefix')}-${artifact.filename}`, {
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
      type: 'error', message: t(request.uiLanguage, 'maintenance.error.safety'),
    }, 500);
  }
});

router.post('/reset', async (request, response) => {
    if (request.body.understood !== 'yes' || request.body.confirmation !== 'EFFACER') {
    await recordAuditEventSafely({ category: 'maintenance', action: 'operational_data.reset', result: 'denied', summary: 'Réinitialisation des données métier refusée faute de confirmation.', metadata: { reason: 'RESET_CONFIRMATION_REQUIRED' } });
    return renderCurrent(response, request, {
      type: 'error', message: resetErrorMessage('RESET_CONFIRMATION_REQUIRED', request.uiLanguage),
    }, 400);
  }
  try {
    const counts = await getOperationalDataCounts();
    if (totalOperationalRecords(counts) === 0) {
      return renderCurrent(response, request, {
        type: 'error', message: resetErrorMessage('RESET_EMPTY', request.uiLanguage),
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
    await recordAuditEventSafely({ category: 'maintenance', action: 'operational_data.reset', result: error.code === 'RESET_SAFETY_BACKUP_REQUIRED' || error.code === 'RESET_IN_PROGRESS' || error.code === 'BACKUP_IN_PROGRESS' ? 'denied' : 'failed', summary: 'Réinitialisation des données métier non exécutée.', metadata: { reason: error.code || 'RESET_FAILED' } });
    const conflictCodes = new Set([
      'BACKUP_IN_PROGRESS',
      'RESET_IN_PROGRESS',
      'RESET_SAFETY_BACKUP_REQUIRED',
    ]);
    return renderCurrent(response, request, {
      type: 'error', message: resetErrorMessage(error.code, request.uiLanguage),
    }, conflictCodes.has(error.code) ? 409 : 500);
  }
});

module.exports = router;
