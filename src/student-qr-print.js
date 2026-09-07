const express = require('express');
const { AVERY_PROFILES, getAveryProfile, getLabelsPerSheet } = require('./avery-profiles');
const { getEffectiveLogoForClass, getGlobalLogo } = require('./branding');
const { pool } = require('./db/client');
const { isValidPublicId } = require('./public-id');
const {
  createCalibrationSheetPdf,
  createParticipantQrSheetPdf,
  canIncludeQrWarning,
} = require('./student-qr-label-pdf');
const { businessTerm, escapeHtml, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();
const MAX_PARTICIPANTS_PER_PDF = 2000;
const selectionModes = new Set(['all', 'class', 'manual']);

function normalizeSelection(body = {}) {
  const mode = typeof body.selection_mode === 'string' ? body.selection_mode : '';
  const rawIds = Array.isArray(body.student_ids)
    ? body.student_ids
    : body.student_ids ? [body.student_ids] : [];
  const studentIds = [...new Set(rawIds)];
  return {
    mode,
    classId: typeof body.class_id === 'string' ? body.class_id : '',
    studentIds,
    includeActivity: body.include_activity === 'true',
    includeWarning: body.include_warning === 'true',
  };
}

function normalizePrintOptions(body = {}) {
  const profile = getAveryProfile(body.profile);
  const firstPosition = typeof body.first_position === 'string' && /^\d+$/.test(body.first_position)
    ? Number(body.first_position)
    : Number.NaN;
  if (!profile) return { error: 'Sélectionnez un format Avery pris en charge.' };
  if (!Number.isInteger(firstPosition) || firstPosition < 1 || firstPosition > getLabelsPerSheet(profile)) {
    return { error: 'La première position disponible est invalide.' };
  }
  return { profile, firstPosition };
}

async function loadPrintChoices() {
  const [studentsResult, classesResult] = await Promise.all([
    pool.query(
      `SELECT public_id, first_name, last_name, email, student_code
       FROM students
       WHERE active = TRUE
       ORDER BY LOWER(last_name), LOWER(first_name), id`,
    ),
    pool.query(
      `SELECT c.public_id, c.name, COUNT(*)::integer AS active_student_count
       FROM classes c
       INNER JOIN student_classes sc ON sc.class_id = c.id AND sc.active = TRUE
       INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
       GROUP BY c.id
       ORDER BY LOWER(c.name), c.id`,
    ),
  ]);
  return { students: studentsResult.rows, classes: classesResult.rows };
}

function renderPrintPage({ students, classes, error = '' }) {
  const participantPlural = businessTerm('student', 'plural').toLocaleLowerCase('fr');
  const activitySingular = businessTerm('class').toLocaleLowerCase('fr');
  const profiles = Object.values(AVERY_PROFILES);
  const renderProfileOption = (profile) => {
    const displayedReferences = [profile.reference, ...(profile.compatibleReferences || [])].join(' / ');
    return `
    <option value="${profile.reference}"
      data-capacity="${getLabelsPerSheet(profile)}"
      data-width="${profile.labelWidthMm}"
      data-height="${profile.labelHeightMm}"
      data-warning-supported="${canIncludeQrWarning(profile) ? 'true' : 'false'}">${escapeHtml(displayedReferences)} — ${escapeHtml(profile.description)}</option>`;
  };
  const labelProfiles = profiles.filter((profile) => profile.category.startsWith('Étiquettes'));
  const badgeProfiles = profiles.filter((profile) => !profile.category.startsWith('Étiquettes'));
  const profileOptions = `
    <optgroup label="Étiquettes">${labelProfiles.map(renderProfileOption).join('')}</optgroup>
    <optgroup label="Badges et inserts">${badgeProfiles.map(renderProfileOption).join('')}</optgroup>`;
  const classOptions = classes.map((classRecord) => `
    <option value="${classRecord.public_id}" data-count="${classRecord.active_student_count}">${escapeHtml(classRecord.name)} · ${classRecord.active_student_count}</option>`).join('');
  const studentRows = students.length === 0
    ? `<p class="empty-state mb-0">Aucun ${participantPlural} actif n’est disponible.</p>`
    : students.map((student) => `
      <label class="list-group-item qr-print-participant" data-manual-participant data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.email} ${student.student_code}`.toLocaleLowerCase('fr'))}">
        <input class="form-check-input" name="student_ids" type="checkbox" value="${student.public_id}" data-manual-checkbox>
        <span class="compact-identity min-w-0">
          <span class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</span>
          <span class="compact-meta">${escapeHtml(student.email)} · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></span>
        </span>
      </label>`).join('');

  return renderPage('Imprimer les QR', `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <p class="eyebrow">${businessTerm('student', 'plural')}</p>
        <h1>Imprimer les QR</h1>
        <p class="page-description">Préparez une feuille A4 adaptée à un format Avery vérifié.</p>
      </div>
      <a class="btn btn-light" href="/students">Retour au répertoire</a>
    </header>
    ${error ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>` : ''}
    <p class="alert alert-info py-2" role="note"><strong>Imprimez le PDF à 100 % / Taille réelle.</strong> Désactivez « Ajuster à la page ».</p>

    <form class="qr-print-form" method="post" action="/students/qr-print/pdf" data-qr-print-form data-active-participant-count="${students.length}">
      <section class="page-section" aria-labelledby="qr-print-selection-title">
        <div class="section-header">
          <div>
            <h2 id="qr-print-selection-title">1. Choisir les ${participantPlural}</h2>
            <p class="section-description">Les fiches et ${businessTerm('membership', 'plural').toLocaleLowerCase('fr')} inactives restent exclues.</p>
          </div>
        </div>
        <div class="btn-group qr-print-mode" role="group" aria-label="Mode de sélection">
          <input class="btn-check" id="selection-all" name="selection_mode" type="radio" value="all" autocomplete="off" checked>
          <label class="btn btn-outline-secondary" for="selection-all">Tous les actifs</label>
          <input class="btn-check" id="selection-class" name="selection_mode" type="radio" value="class" autocomplete="off">
          <label class="btn btn-outline-secondary" for="selection-class">Par ${activitySingular}</label>
          <input class="btn-check" id="selection-manual" name="selection_mode" type="radio" value="manual" autocomplete="off">
          <label class="btn btn-outline-secondary" for="selection-manual">Sélection manuelle</label>
        </div>

        <div class="qr-print-dependent mt-3" data-selection-panel="class" hidden>
          <label class="form-label" for="qr-print-class">${businessTerm('class')}</label>
          <select class="form-select" id="qr-print-class" name="class_id" disabled required>
            <option value="">Choisir : ${activitySingular}</option>
            ${classOptions}
          </select>
          ${classes.length === 0 ? '<p class="help-text mt-2 mb-0">Aucun résultat actif n’est disponible pour ce mode.</p>' : ''}
        </div>

        <div class="qr-print-dependent mt-3" data-selection-panel="manual" hidden>
          <div class="d-flex flex-column flex-sm-row gap-2 align-items-sm-end mb-2">
            <div class="flex-grow-1">
              <label class="form-label" for="qr-print-search">Recherche dans les ${participantPlural}</label>
              <input class="form-control" id="qr-print-search" type="search" autocomplete="off" placeholder="Nom, e-mail ou code…" data-manual-search disabled>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-outline-secondary" type="button" data-select-all disabled>Tout sélectionner</button>
              <button class="btn btn-light" type="button" data-clear-selection disabled>Effacer</button>
            </div>
          </div>
          <p class="compact-meta mb-2">Sélection : <span data-selected-count>0</span></p>
          <div class="list-group qr-print-participant-list" data-manual-list>${studentRows}</div>
          <p class="empty-state mt-2 mb-0" data-manual-no-results hidden>Aucun résultat.</p>
        </div>
      </section>

      <section class="page-section" aria-labelledby="qr-print-format-title">
        <div class="section-header">
          <div>
            <h2 id="qr-print-format-title">2. Préparer la feuille</h2>
            <p class="section-description">La position de départ s’applique uniquement à la première feuille.</p>
          </div>
        </div>
        <div class="row g-3">
          <div class="col-12 col-md-7">
            <label class="form-label" for="qr-print-profile">Format Avery</label>
            <select class="form-select" id="qr-print-profile" name="profile" data-profile-select required>${profileOptions}</select>
          </div>
          <div class="col-12 col-md-5">
            <label class="form-label" for="first-position">Première étiquette disponible</label>
            <input class="form-control" id="first-position" name="first_position" type="number" min="1" max="21" value="1" inputmode="numeric" data-first-position required>
          </div>
        </div>
        <div class="form-check mt-3">
          <input class="form-check-input" id="include-warning" name="include_warning" type="checkbox" value="true" data-warning-option aria-describedby="include-warning-help">
          <label class="form-check-label" for="include-warning">Ajouter l’avertissement relatif au QR personnel</label>
          <p class="help-text mb-0" id="include-warning-help" data-warning-help>Disponible sur les formats offrant suffisamment d’espace pour rester lisible.</p>
        </div>
        <div class="form-check mt-3" data-activity-option hidden>
          <input class="form-check-input" id="include-activity" name="include_activity" type="checkbox" value="true" disabled>
          <label class="form-check-label" for="include-activity">Ajouter le nom (${activitySingular})</label>
        </div>
        <dl class="qr-print-summary mt-3 mb-0" aria-live="polite">
          <div><dt>Dimensions</dt><dd data-profile-dimensions>—</dd></div>
          <div><dt>Étiquettes par feuille</dt><dd data-profile-capacity>—</dd></div>
          <div><dt>${businessTerm('student', 'plural')}</dt><dd data-participant-count>—</dd></div>
          <div><dt>Feuilles estimées</dt><dd data-sheet-count>—</dd></div>
        </dl>
      </section>

      <div class="page-section form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">Générer le PDF</button>
        <button class="btn btn-outline-secondary" type="submit" formaction="/students/qr-print/calibration" formnovalidate>Imprimer une feuille de test</button>
      </div>
    </form>`, { pageClass: 'page--qr-print' });
}

async function loadSelectedParticipants(selection) {
  const selectColumns = `s.public_id, s.first_name, s.last_name, s.student_code, s.qr_token`;
  if (!selectionModes.has(selection.mode)) {
    throw Object.assign(new Error('Sélectionnez un mode de sélection valide.'), { code: 'VALIDATION_ERROR' });
  }
  if (selection.mode === 'all') {
    const [result, logo] = await Promise.all([
      pool.query(
        `SELECT ${selectColumns}
         FROM students s
         WHERE s.active = TRUE
         ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
      ),
      getGlobalLogo(),
    ]);
    return { participants: result.rows, activityName: '', logo };
  }

  if (selection.mode === 'class') {
    if (!isValidPublicId(selection.classId)) {
      throw Object.assign(new Error('La sélection demandée est invalide.'), { code: 'VALIDATION_ERROR' });
    }
    const [classResult, participantsResult, logo] = await Promise.all([
      pool.query('SELECT name FROM classes WHERE public_id = $1', [selection.classId]),
      pool.query(
        `SELECT ${selectColumns}
         FROM students s
         INNER JOIN student_classes sc ON sc.student_id = s.id AND sc.active = TRUE
         INNER JOIN classes c ON c.id = sc.class_id
         WHERE c.public_id = $1 AND s.active = TRUE
         ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
        [selection.classId],
      ),
      getEffectiveLogoForClass(selection.classId),
    ]);
    if (classResult.rowCount === 0) {
      throw Object.assign(new Error('La sélection demandée est invalide.'), { code: 'VALIDATION_ERROR' });
    }
    return {
      participants: participantsResult.rows,
      activityName: selection.includeActivity ? classResult.rows[0].name : '',
      logo,
    };
  }

  if (selection.studentIds.length === 0 || selection.studentIds.length > MAX_PARTICIPANTS_PER_PDF
      || selection.studentIds.some((studentId) => !isValidPublicId(studentId))) {
    throw Object.assign(new Error('Sélectionnez au moins un participant actif.'), { code: 'VALIDATION_ERROR' });
  }
  const [result, logo] = await Promise.all([
    pool.query(
      `SELECT ${selectColumns}
       FROM students s
       WHERE s.active = TRUE AND s.public_id = ANY($1::uuid[])
       ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
      [selection.studentIds],
    ),
    getGlobalLogo(),
  ]);
  if (result.rowCount !== selection.studentIds.length) {
    throw Object.assign(new Error('La sélection contient une fiche inactive ou indisponible.'), { code: 'VALIDATION_ERROR' });
  }
  return { participants: result.rows, activityName: '', logo };
}

function sendPdf(response, pdf, filename) {
  response.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': pdf.length,
    'Content-Type': 'application/pdf',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.send(pdf);
}

async function renderCurrentPage(response, error = '', status = 200) {
  try {
    const choices = await loadPrintChoices();
    response.status(status).send(renderPrintPage({ ...choices, error }));
  } catch (loadError) {
    console.error('Unable to load QR print choices:', loadError.code || 'DATABASE_ERROR');
    const page = renderMessagePage('Impression indisponible', 'Impossible de charger les options d’impression pour le moment.');
    response.status(page.status).send(page.html);
  }
}

router.get('/', async (_request, response) => renderCurrentPage(response));

router.post('/pdf', async (request, response) => {
  const options = normalizePrintOptions(request.body);
  if (options.error) {
    await renderCurrentPage(response, options.error, 400);
    return;
  }

  try {
    const selection = normalizeSelection(request.body);
    const { participants, activityName, logo } = await loadSelectedParticipants(selection);
    if (participants.length === 0) {
      await renderCurrentPage(response, 'Aucun résultat actif ne correspond à cette sélection.', 400);
      return;
    }
    if (participants.length > MAX_PARTICIPANTS_PER_PDF) {
      await renderCurrentPage(response, 'La sélection est trop importante pour un seul PDF.', 413);
      return;
    }
    if (selection.includeWarning && !canIncludeQrWarning(options.profile)) {
      await renderCurrentPage(response, 'L’avertissement ne peut pas rester lisible sur ce format Avery.', 400);
      return;
    }
    const pdf = await createParticipantQrSheetPdf({
      profile: options.profile,
      participants,
      firstPosition: options.firstPosition,
      activityName,
      includeWarning: selection.includeWarning,
      logo,
    });
    sendPdf(response, pdf, `attendance-log-qr-${options.profile.reference.toLowerCase()}.pdf`);
  } catch (error) {
    if (error.code === 'VALIDATION_ERROR') {
      await renderCurrentPage(response, error.message, 400);
      return;
    }
    console.error('Unable to generate participant QR sheet:', error.code || error.name || 'PDF_ERROR');
    const page = renderMessagePage('PDF indisponible', 'Impossible de générer le PDF pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/calibration', async (request, response) => {
  const profile = getAveryProfile(request.body.profile);
  if (!profile) {
    await renderCurrentPage(response, 'Sélectionnez un format Avery pris en charge.', 400);
    return;
  }
  try {
    const pdf = await createCalibrationSheetPdf(profile);
    sendPdf(response, pdf, `attendance-log-test-${profile.reference.toLowerCase()}.pdf`);
  } catch (error) {
    console.error('Unable to generate Avery calibration sheet:', error.code || error.name || 'PDF_ERROR');
    const page = renderMessagePage('Feuille de test indisponible', 'Impossible de générer la feuille de test pour le moment.');
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
