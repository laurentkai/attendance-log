const express = require('express');
const multer = require('multer');
const { recordAuditEvent } = require('./audit');
const { pool, withTransaction } = require('./db/client');
const {
  getGlobalLogo,
  logoUpload,
  normalizeLogoUpload,
  removeGlobalLogo,
  saveGlobalLogo,
} = require('./branding');
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');
const { t } = require('./i18n');

const router = express.Router();

function logoFeedback(query = {}, language) {
  const messages = {
    saved: ['success', t(language, 'branding.notice.saved')],
    removed: ['success', t(language, 'branding.notice.removed')],
    invalid: ['danger', t(language, 'branding.notice.invalid')],
    failed: ['danger', t(language, 'branding.notice.failed')],
  };
  const feedback = messages[query.notice];
  return feedback
    ? `<p class="alert alert-${feedback[0]}" role="${feedback[0] === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback[1])}</p>`
    : '';
}

function renderBrandingPage(hasLogo, query = {}, language) {
  return renderPage(t(language, 'branding.title'), renderSettingsLayout({
    activeSection: 'branding',
    title: t(language, 'branding.title'),
    description: t(language, 'branding.description'),
    notifications: logoFeedback(query, language),
    content: `<section class="page-section" aria-labelledby="installation-logo-title">
      <div class="section-header">
        <div>
          <h2 id="installation-logo-title">${escapeHtml(t(language, 'branding.logo.title'))}</h2>
          <p class="section-description">${escapeHtml(t(language, 'branding.logo.help'))}</p>
        </div>
      </div>
      <div class="card card-body app-form">
        ${hasLogo ? `<div class="branding-logo-preview">
          <img src="/settings/branding/logo" width="240" height="96" alt="${escapeHtml(t(language, 'branding.logo.current_alt'))}">
        </div>` : `<p class="empty-state mb-0">${escapeHtml(t(language, 'branding.logo.none'))}</p>`}
        <form class="app-form" method="post" action="/settings/branding/logo" enctype="multipart/form-data">
          <div class="form-field">
            <label for="installation-logo">${escapeHtml(t(language, hasLogo ? 'branding.logo.replace' : 'branding.logo.choose'))}</label>
            <input class="form-control" id="installation-logo" name="logo" type="file" accept="image/png,image/jpeg" required>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">${escapeHtml(t(language, hasLogo ? 'branding.logo.replace' : 'action.save'))}</button>
          </div>
        </form>
        ${hasLogo ? `<form method="post" action="/settings/branding/logo/remove" data-confirm="${escapeHtml(t(language, 'branding.logo.confirm_remove'))}">
          <button class="btn btn-outline-danger" type="submit">${escapeHtml(t(language, 'branding.logo.remove'))}</button>
        </form>` : ''}
      </div>
    </section>`,
  }, language), { language });
}

router.get('/', async (request, response) => {
  try {
    response.send(renderBrandingPage(Boolean(await getGlobalLogo()), request.query, request.uiLanguage));
  } catch (error) {
    console.error('Unable to load installation branding:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderBrandingPage(false, { notice: 'failed' }, request.uiLanguage));
  }
});

router.get('/logo', async (_request, response) => {
  try {
    const logo = await getGlobalLogo();
    if (!logo) return response.status(404).end();
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': logo.mimeType,
      'X-Content-Type-Options': 'nosniff',
    });
    return response.send(logo.data);
  } catch (error) {
    console.error('Unable to render installation logo:', error.code || 'DATABASE_ERROR');
    return response.status(500).end();
  }
});

router.post('/logo', (request, response) => {
  logoUpload.single('logo')(request, response, async (uploadError) => {
    if (uploadError instanceof multer.MulterError || uploadError || !request.file) {
      response.redirect(303, '/settings/branding?notice=invalid');
      return;
    }
    try {
      const logo = await normalizeLogoUpload(request.file);
      await withTransaction(pool, async (client) => {
        const current = await getGlobalLogo(client);
        await saveGlobalLogo(logo, client);
        await recordAuditEvent({
          client, category: 'branding', action: current ? 'branding.logo.replace' : 'branding.logo.add',
          summary: current ? 'Logo de l’installation remplacé.' : 'Logo de l’installation ajouté.',
          metadata: { logo_change: current ? 'replaced' : 'added' },
        });
      });
      response.redirect(303, '/settings/branding?notice=saved');
    } catch (error) {
      if (['INVALID_LOGO', 'LOGO_TOO_LARGE'].includes(error.code)) {
        response.redirect(303, '/settings/branding?notice=invalid');
        return;
      }
      console.error('Unable to save installation logo:', error.code || 'DATABASE_ERROR');
      response.redirect(303, '/settings/branding?notice=failed');
    }
  });
});

router.post('/logo/remove', async (_request, response) => {
  try {
    await withTransaction(pool, async (client) => {
      await removeGlobalLogo(client);
      await recordAuditEvent({
        client, category: 'branding', action: 'branding.logo.remove', summary: 'Logo de l’installation supprimé.',
        metadata: { logo_change: 'removed' },
      });
    });
    response.redirect(303, '/settings/branding?notice=removed');
  } catch (error) {
    console.error('Unable to remove installation logo:', error.code || 'DATABASE_ERROR');
    response.redirect(303, '/settings/branding?notice=failed');
  }
});

module.exports = router;
