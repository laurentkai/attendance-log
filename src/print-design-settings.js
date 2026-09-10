const crypto = require('node:crypto');
const express = require('express');
const { recordAuditEvent } = require('./audit');
const { AVERY_PROFILES, getAveryProfile } = require('./avery-profiles');
const { getGlobalLogo } = require('./branding');
const { pool, withTransaction } = require('./db/client');
const {
  getSavedPrintDesign,
  PrintDesignValidationError,
  resetPrintDesign,
  savePrintDesign,
  validatePrintDesign,
} = require('./print-design');
const { canIncludeQrWarning, createDefaultPrintDesign, createParticipantQrSheetPdf } = require('./student-qr-label-pdf');
const { createStudentQrPng } = require('./student-qr');
const { PERSONAL_QR_WARNING } = require('./student-qr-content');
const { escapeHtml, renderMessagePage, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();
const SAMPLE = Object.freeze({
  participant: Object.freeze({
    first_name: 'Paul', last_name: 'BALDEWYNS', student_code: 'NAV2027', qr_token: crypto.randomUUID(),
  }),
  title: 'Carte étudiant 2027',
  activityName: 'Cours de navigation 2026-2027',
});

function selectedProfile(reference) {
  return getAveryProfile(reference) || Object.values(AVERY_PROFILES)[0];
}

function logoDataUrl(logo) {
  return logo?.data ? `data:${logo.mimeType};base64,${logo.data.toString('base64')}` : '';
}

function serializeForAttribute(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function renderElementControls(name, label, element) {
  const text = ['code', 'title', 'name', 'activity', 'disclaimer'].includes(name);
  const align = ['title', 'name', 'activity', 'disclaimer'].includes(name);
  return `<div class="print-design-controls" data-controls-for="${name}" hidden>
    <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
      <strong>${escapeHtml(label)}</strong>
      ${name === 'qr' ? '' : `<div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" id="design-${name}-enabled" data-control="enabled"${element.enabled ? ' checked' : ''}><label class="form-check-label" for="design-${name}-enabled">Afficher</label></div>`}
    </div>
    <div class="row g-2">
      ${[['x', 'X'], ['y', 'Y'], ['width', 'Largeur'], ['height', 'Hauteur']].map(([property, caption]) => `<div class="col-6"><label class="form-label" for="design-${name}-${property}">${caption} (mm)</label><input class="form-control form-control-sm" id="design-${name}-${property}" type="number" step="0.1" data-control="${property}" value="${element[property]}"></div>`).join('')}
      ${text ? `<div class="col-6"><label class="form-label" for="design-${name}-fontSize">Corps (pt)</label><input class="form-control form-control-sm" id="design-${name}-fontSize" type="number" step="0.5" data-control="fontSize" value="${element.fontSize}"></div>` : ''}
      ${align ? `<div class="col-6"><label class="form-label" for="design-${name}-align">Alignement</label><select class="form-select form-select-sm" id="design-${name}-align" data-control="align"><option value="left"${element.align === 'left' ? ' selected' : ''}>Gauche</option><option value="center"${element.align === 'center' ? ' selected' : ''}>Centré</option><option value="right"${element.align === 'right' ? ' selected' : ''}>Droite</option></select></div>` : ''}
      ${name === 'code' ? `<div class="col-6"><label class="form-label" for="design-code-rotation">Rotation</label><select class="form-select form-select-sm" id="design-code-rotation" data-control="rotation"><option value="-90"${element.rotation === -90 ? ' selected' : ''}>−90°</option><option value="0"${element.rotation === 0 ? ' selected' : ''}>0°</option><option value="90"${element.rotation === 90 ? ' selected' : ''}>90°</option></select></div>` : ''}
    </div>
  </div>`;
}

function renderEditor(profile, design, customized, logo, qrPreview, query = {}, error = '') {
  const labels = { qr: 'QR', code: 'Code participant', title: 'Titre', name: 'Nom du participant', activity: 'Activité', logo: 'Logo', disclaimer: 'Avertissement' };
  const previewText = {
    code: 'NAV2027', title: SAMPLE.title, name: `${SAMPLE.participant.first_name} ${SAMPLE.participant.last_name}`,
    activity: SAMPLE.activityName, disclaimer: PERSONAL_QR_WARNING,
  };
  const options = Object.values(AVERY_PROFILES).map((item) => `<option value="${item.reference}"${item.reference === profile.reference ? ' selected' : ''}>${escapeHtml(item.reference)} — ${escapeHtml(item.description)}</option>`).join('');
  const elements = Object.entries(design.elements).map(([name, element]) => {
    const content = name === 'qr' ? `<img src="data:image/png;base64,${qrPreview.toString('base64')}" alt="">`
      : name === 'logo' ? (logo ? `<img src="${logoDataUrl(logo)}" alt="Logo actuel">` : '<span>LOGO</span>')
        : escapeHtml(previewText[name]);
    return `<button class="print-design-element print-design-element--${name}" type="button" data-design-element="${name}" style="--x:${element.x};--y:${element.y};--w:${element.width};--h:${element.height};--font:${element.fontSize || 10};--rotation:${element.rotation || 0}deg;text-align:${element.align || 'center'}"${element.enabled ? '' : ' data-disabled="true"'} aria-label="Modifier : ${escapeHtml(labels[name])}"><span class="print-design-element-content">${content}</span><span class="print-design-resize" aria-hidden="true"></span></button>`;
  }).join('');
  const controls = Object.entries(design.elements).map(([name, element]) => renderElementControls(name, labels[name], element)).join('');
  const notification = error ? `<p class="alert alert-danger py-2" role="alert">${escapeHtml(error)}</p>` : query.saved ? '<p class="alert alert-success py-2" role="status">Le modèle a été enregistré.</p>'
    : query.reset ? '<p class="alert alert-success py-2" role="status">Le modèle par défaut a été restauré.</p>' : '';

  return renderPage('Design d’impression', renderSettingsLayout({
    activeSection: 'print-design',
    title: 'Design d’impression',
    description: 'Ajustez le contenu d’un badge sans modifier la géométrie Avery.',
    notifications: notification,
    content: `<section class="page-section" aria-labelledby="print-design-profile-title">
      <div class="section-header"><div><h2 id="print-design-profile-title">Modèle Avery</h2><p class="section-description">Les dimensions, marges, pas et positions sur la feuille A4 restent verrouillés.</p></div><span class="badge text-bg-light">${customized ? 'Personnalisé' : 'Par défaut'}</span></div>
      <form method="get" action="/settings/print-design"><label class="form-label" for="print-design-profile">Format</label><select class="form-select" id="print-design-profile" name="profile" data-print-design-profile>${options}</select></form>
    </section>
    <section class="page-section" aria-labelledby="print-design-editor-title">
      <div class="section-header"><div><h2 id="print-design-editor-title">Composition</h2><p class="section-description">Sélectionnez, déplacez ou redimensionnez un élément. Les valeurs sont exprimées en millimètres.</p></div></div>
      <p class="alert alert-info d-lg-none mb-0">L’édition du modèle nécessite un écran plus large.</p>
      <div class="print-design-editor d-none d-lg-grid" data-print-design-editor data-profile-width="${profile.labelWidthMm}" data-profile-height="${profile.labelHeightMm}" data-design="${serializeForAttribute(design)}">
        <div class="print-design-aids d-flex flex-wrap gap-3" aria-label="Aides au placement">
          <div class="form-check form-switch mb-0"><input class="form-check-input" id="print-design-grid" type="checkbox" data-grid-toggle><label class="form-check-label" for="print-design-grid">Afficher la grille</label></div>
          <div class="form-check form-switch mb-0"><input class="form-check-input" id="print-design-snap" type="checkbox" data-grid-snap aria-describedby="print-design-snap-help"><label class="form-check-label" for="print-design-snap">Aimantation à la grille</label></div>
          <span class="small text-body-secondary" id="print-design-snap-help">Les repères d’alignement restent actifs indépendamment.</span>
        </div>
        <div class="print-design-stage-wrap">
          <div class="print-design-stage" data-design-stage tabindex="-1" style="--profile-ratio:${profile.labelWidthMm} / ${profile.labelHeightMm};--profile-width:${profile.labelWidthMm};--profile-height:${profile.labelHeightMm}">
            ${elements}
            <span class="print-design-guide print-design-guide--vertical" data-design-guide="x" aria-hidden="true" hidden></span>
            <span class="print-design-guide print-design-guide--horizontal" data-design-guide="y" aria-hidden="true" hidden></span>
          </div>
          <p class="compact-meta mt-2 mb-0">${profile.labelWidthMm} × ${profile.labelHeightMm} mm · aperçu physique proportionnel</p>
        </div>
        <aside class="print-design-inspector" aria-label="Propriétés de l’élément">${controls}<p class="empty-state mb-0" data-no-design-selection>Sélectionnez un élément dans l’aperçu.</p></aside>
        <form class="print-design-actions" method="post" action="/settings/print-design/save" data-print-design-form>
          <input type="hidden" name="profile" value="${profile.reference}"><input type="hidden" name="layout" data-design-json>
          <div class="form-actions d-flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">Enregistrer</button><button class="btn btn-outline-secondary" type="button" data-example-preview>Aperçu avec données exemple</button><button class="btn btn-outline-secondary" type="submit" formaction="/settings/print-design/test">Générer une page de test</button></div>
        </form>
        <form class="print-design-reset" method="post" action="/settings/print-design/reset" data-confirm="Réinitialiser ce modèle Avery ?"><input type="hidden" name="profile" value="${profile.reference}"><button class="btn btn-outline-danger" type="submit"${customized ? '' : ' disabled'}>Réinitialiser le modèle</button></form>
        <p class="alert alert-danger py-2 mb-0 print-design-error" role="alert" data-design-error hidden></p>
      </div>
    </section>`,
  }));
}

async function loadPage(request, response, status = 200, error = '', profileReference = request.query.profile) {
  try {
    const profile = selectedProfile(profileReference);
    const [saved, logo, qrPreview] = await Promise.all([
      getSavedPrintDesign(profile.reference), getGlobalLogo(), createStudentQrPng(SAMPLE.participant.qr_token),
    ]);
    const design = saved ? validatePrintDesign(profile, saved) : createDefaultPrintDesign(profile, SAMPLE);
    const html = renderEditor(profile, design, Boolean(saved), logo, qrPreview, request.query, error);
    response.status(status).send(html);
  } catch (error) {
    console.error('Unable to load print design editor:', error.code || error.name);
    const page = renderMessagePage('Design indisponible', 'Impossible de charger le design d’impression pour le moment.');
    response.status(page.status).send(page.html);
  }
}

router.get('/', (request, response) => loadPage(request, response));

function parseDesign(request) {
  const profile = getAveryProfile(request.body.profile);
  if (!profile || typeof request.body.layout !== 'string' || Buffer.byteLength(request.body.layout, 'utf8') > 16 * 1024) {
    throw new PrintDesignValidationError('Le modèle d’impression est invalide.');
  }
  let parsed;
  try { parsed = JSON.parse(request.body.layout); } catch (_error) { throw new PrintDesignValidationError('Le modèle d’impression est invalide.'); }
  return { profile, design: validatePrintDesign(profile, parsed) };
}

router.post('/save', async (request, response) => {
  try {
    const { profile, design } = parseDesign(request);
    await withTransaction(pool, async (client) => {
      await savePrintDesign(profile, design, request.currentUser.id, client);
      await recordAuditEvent({ client, action: 'print_design.save', category: 'print_design', targetType: 'avery_profile', targetLabel: profile.reference, summary: `Modèle d’impression ${profile.reference} enregistré.`, metadata: { profile_reference: profile.reference } });
    });
    response.redirect(303, `/settings/print-design?profile=${encodeURIComponent(profile.reference)}&saved=1`);
  } catch (error) {
    if (error.code === 'PRINT_DESIGN_INVALID') { await loadPage(request, response, 400, error.message, request.body.profile); return; }
    console.error('Unable to save print design:', error.code || error.name); const page = renderMessagePage('Enregistrement impossible', 'Impossible d’enregistrer le modèle pour le moment.'); response.status(page.status).send(page.html);
  }
});

router.post('/reset', async (request, response) => {
  const profile = getAveryProfile(request.body.profile);
  if (!profile) { const page = renderMessagePage('Modèle introuvable', 'Le modèle Avery demandé est introuvable.', 404); response.status(page.status).send(page.html); return; }
  try {
    await withTransaction(pool, async (client) => {
      await resetPrintDesign(profile.reference, client);
      await recordAuditEvent({ client, action: 'print_design.reset', category: 'print_design', targetType: 'avery_profile', targetLabel: profile.reference, summary: `Modèle d’impression ${profile.reference} réinitialisé.`, metadata: { profile_reference: profile.reference } });
    });
    response.redirect(303, `/settings/print-design?profile=${encodeURIComponent(profile.reference)}&reset=1`);
  } catch (error) {
    console.error('Unable to reset print design:', error.code || error.name);
    const page = renderMessagePage('Réinitialisation impossible', 'Impossible de réinitialiser le modèle pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/test', async (request, response) => {
  try {
    const { profile, design } = parseDesign(request);
    const logo = await getGlobalLogo();
    const includeWarning = canIncludeQrWarning(profile);
    const pdf = await createParticipantQrSheetPdf({ profile, participants: [SAMPLE.participant], activityName: SAMPLE.activityName, includeWarning, title: SAMPLE.title, logo, design });
    response.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="attendance-log-design-${profile.reference.toLowerCase()}.pdf"`, 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' }).send(pdf);
  } catch (error) {
    if (error.code === 'PRINT_DESIGN_INVALID') { await loadPage(request, response, 400, error.message, request.body.profile); return; }
    console.error('Unable to generate print design preview:', error.code || error.name); const page = renderMessagePage('PDF indisponible', 'Impossible de générer le PDF de test pour le moment.'); response.status(page.status).send(page.html);
  }
});

module.exports = router;
