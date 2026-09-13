const express = require('express');
const { AVERY_PROFILES, getAveryProfile, getLabelsPerSheet } = require('./avery-profiles');
const { getEffectiveLogoForClass, getGlobalLogo } = require('./branding');
const { pool } = require('./db/client');
const { getSavedPrintDesign } = require('./print-design');
const { isValidPublicId } = require('./public-id');
const { DEFAULT_LANGUAGE, resolveParticipantLanguage, t } = require('./i18n');
const { getTerm } = require('./terminology');
const {
  createCalibrationSheetPdf,
  createParticipantQrSheetPdf,
  canIncludeQrWarning,
} = require('./student-qr-label-pdf');
const { businessTerm, escapeHtml, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();
const MAX_PARTICIPANTS_PER_PDF = 2000;
const MAX_BADGE_TITLE_LENGTH = 40;
const selectionModes = new Set(['all', 'class', 'manual']);

function normalizeBadgeTitle(value, language = DEFAULT_LANGUAGE) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string') {
    throw Object.assign(new Error(t(language, 'qr.print.error.title_invalid')), { code: 'VALIDATION_ERROR' });
  }
  const title = value.trim();
  if (Array.from(title).length > MAX_BADGE_TITLE_LENGTH
      || /[<>\u0000-\u001f\u007f\u2028\u2029]/u.test(title)) {
    throw Object.assign(new Error(t(language, 'qr.print.error.title_length')), { code: 'VALIDATION_ERROR' });
  }
  return title;
}

function normalizeSelection(body = {}, language = DEFAULT_LANGUAGE) {
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
    title: normalizeBadgeTitle(body.title, language),
  };
}

function normalizePrintOptions(body = {}, language = DEFAULT_LANGUAGE) {
  const profile = getAveryProfile(body.profile);
  const firstPosition = typeof body.first_position === 'string' && /^\d+$/.test(body.first_position)
    ? Number(body.first_position)
    : Number.NaN;
  if (!profile) return { error: t(language, 'qr.print.error.profile') };
  if (!Number.isInteger(firstPosition) || firstPosition < 1 || firstPosition > getLabelsPerSheet(profile)) {
    return { error: t(language, 'qr.print.error.position') };
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

function renderPrintPage({ students, classes, error = '', language = DEFAULT_LANGUAGE }) {
  const participantPlural = businessTerm(language, 'student', 'plural');
  const activitySingular = businessTerm(language, 'class');
  const membershipPlural = businessTerm(language, 'membership', 'plural');
  const profiles = Object.values(AVERY_PROFILES);
  const renderProfileOption = (profile) => {
    const displayedReferences = [profile.reference, ...(profile.compatibleReferences || [])].join(' / ');
    return `
    <option value="${profile.reference}"
      data-capacity="${getLabelsPerSheet(profile)}"
      data-width="${profile.labelWidthMm}"
      data-height="${profile.labelHeightMm}"
      data-warning-supported="${canIncludeQrWarning(profile) ? 'true' : 'false'}">${escapeHtml(displayedReferences)} — ${escapeHtml(t(language, 'avery.description', { width: profile.labelWidthMm, height: profile.labelHeightMm, count: getLabelsPerSheet(profile) }))}</option>`;
  };
  const labelProfiles = profiles.filter((profile) => profile.kind === 'label');
  const badgeProfiles = profiles.filter((profile) => profile.kind === 'badge');
  const profileOptions = `
    <optgroup label="${escapeHtml(t(language, 'avery.group.labels'))}">${labelProfiles.map(renderProfileOption).join('')}</optgroup>
    <optgroup label="${escapeHtml(t(language, 'avery.group.badges'))}">${badgeProfiles.map(renderProfileOption).join('')}</optgroup>`;
  const classOptions = classes.map((classRecord) => `
    <option value="${classRecord.public_id}" data-count="${classRecord.active_student_count}">${escapeHtml(classRecord.name)} · ${classRecord.active_student_count}</option>`).join('');
  const studentRows = students.length === 0
    ? `<p class="empty-state mb-0">${escapeHtml(t(language, 'qr.print.selection.none', { participants: participantPlural }))}</p>`
    : students.map((student) => `
      <label class="list-group-item qr-print-participant" data-manual-participant data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.email} ${student.student_code}`.toLocaleLowerCase())}">
        <input class="form-check-input" name="student_ids" type="checkbox" value="${student.public_id}" data-manual-checkbox>
        <span class="compact-identity min-w-0">
          <span class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</span>
          <span class="compact-meta">${escapeHtml(student.email)} · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></span>
        </span>
      </label>`).join('');

  return renderPage(t(language, 'qr.print.title'), `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <p class="eyebrow">${businessTerm(language, 'student', 'plural')}</p>
        <h1>${escapeHtml(t(language, 'qr.print.title'))}</h1>
        <p class="page-description">${escapeHtml(t(language, 'qr.print.description'))}</p>
      </div>
      <a class="btn btn-light" href="/students">${escapeHtml(t(language, 'qr.print.back'))}</a>
    </header>
    ${error ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>` : ''}
    <p class="alert alert-info py-2" role="note"><strong>${escapeHtml(t(language, 'qr.print.actual_size'))}</strong> ${escapeHtml(t(language, 'qr.print.no_fit'))}</p>

    <form class="qr-print-form" method="post" action="/students/qr-print/pdf" data-qr-print-form data-active-participant-count="${students.length}">
      <section class="page-section" aria-labelledby="qr-print-selection-title">
        <div class="section-header">
          <div>
            <h2 id="qr-print-selection-title">${escapeHtml(t(language, 'qr.print.selection.title', { participants: participantPlural }))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'qr.print.selection.help', { memberships: membershipPlural }))}</p>
          </div>
        </div>
        <div class="btn-group qr-print-mode" role="group" aria-label="${escapeHtml(t(language, 'qr.print.selection.mode'))}">
          <input class="btn-check" id="selection-all" name="selection_mode" type="radio" value="all" autocomplete="off" checked>
          <label class="btn btn-outline-secondary" for="selection-all">${escapeHtml(t(language, 'qr.print.selection.all'))}</label>
          <input class="btn-check" id="selection-class" name="selection_mode" type="radio" value="class" autocomplete="off">
          <label class="btn btn-outline-secondary" for="selection-class">${escapeHtml(t(language, 'qr.print.selection.by_activity', { activity: activitySingular }))}</label>
          <input class="btn-check" id="selection-manual" name="selection_mode" type="radio" value="manual" autocomplete="off">
          <label class="btn btn-outline-secondary" for="selection-manual">${escapeHtml(t(language, 'qr.print.selection.manual'))}</label>
        </div>

        <div class="qr-print-dependent mt-3" data-selection-panel="class" hidden>
          <label class="form-label" for="qr-print-class">${businessTerm(language, 'class')}</label>
          <select class="form-select" id="qr-print-class" name="class_id" disabled required>
            <option value="">${escapeHtml(t(language, 'qr.print.selection.choose_activity', { activity: activitySingular }))}</option>
            ${classOptions}
          </select>
          ${classes.length === 0 ? `<p class="help-text mt-2 mb-0">${escapeHtml(t(language, 'qr.print.selection.no_active_mode'))}</p>` : ''}
        </div>

        <div class="qr-print-dependent mt-3" data-selection-panel="manual" hidden>
          <div class="d-flex flex-column flex-sm-row gap-2 align-items-sm-end mb-2">
            <div class="flex-grow-1">
              <label class="form-label" for="qr-print-search">${escapeHtml(t(language, 'qr.print.selection.search', { participants: participantPlural }))}</label>
              <input class="form-control" id="qr-print-search" type="search" autocomplete="off" placeholder="${escapeHtml(t(language, 'qr.print.selection.search_placeholder'))}" data-manual-search disabled>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-outline-secondary" type="button" data-select-all disabled>${escapeHtml(t(language, 'qr.print.selection.select_all'))}</button>
              <button class="btn btn-light" type="button" data-clear-selection disabled>${escapeHtml(t(language, 'action.clear'))}</button>
            </div>
          </div>
          <p class="compact-meta mb-2">${escapeHtml(t(language, 'qr.print.selection.count'))} <span data-selected-count>0</span></p>
          <div class="list-group qr-print-participant-list" data-manual-list>${studentRows}</div>
          <p class="empty-state mt-2 mb-0" data-manual-no-results hidden>${escapeHtml(t(language, 'common.no_results'))}</p>
        </div>
      </section>

      <section class="page-section" aria-labelledby="qr-print-format-title">
        <div class="section-header">
          <div>
            <h2 id="qr-print-format-title">${escapeHtml(t(language, 'qr.print.sheet.title'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'qr.print.sheet.help'))}</p>
          </div>
        </div>
        <div class="row g-3">
          <div class="col-12 col-md-7">
            <label class="form-label" for="qr-print-profile">${escapeHtml(t(language, 'qr.print.profile'))}</label>
            <select class="form-select" id="qr-print-profile" name="profile" data-profile-select required>${profileOptions}</select>
          </div>
          <div class="col-12 col-md-5">
            <label class="form-label" for="first-position">${escapeHtml(t(language, 'qr.print.first_position'))}</label>
            <input class="form-control" id="first-position" name="first_position" type="number" min="1" max="21" value="1" inputmode="numeric" data-first-position required>
          </div>
        </div>
        <div class="mt-3">
          <label class="form-label" for="qr-print-title">${escapeHtml(t(language, 'qr.print.badge_title'))} <span class="text-body-secondary fw-normal">(${escapeHtml(t(language, 'common.optional'))})</span></label>
          <input class="form-control" id="qr-print-title" name="title" type="text" maxlength="${MAX_BADGE_TITLE_LENGTH}" autocomplete="off" aria-describedby="qr-print-title-help">
          <p class="help-text mt-2 mb-0" id="qr-print-title-help">${escapeHtml(t(language, 'qr.print.badge_title_example', { student: getTerm(language, 'student') }))}</p>
        </div>
        <div class="form-check mt-3">
          <input class="form-check-input" id="include-warning" name="include_warning" type="checkbox" value="true" data-warning-option aria-describedby="include-warning-help">
          <label class="form-check-label" for="include-warning">${escapeHtml(t(language, 'qr.print.warning'))}</label>
          <p class="help-text mb-0" id="include-warning-help" data-warning-help>${escapeHtml(t(language, 'qr.print.warning.available'))}</p>
        </div>
        <div class="form-check mt-3" data-activity-option hidden>
          <input class="form-check-input" id="include-activity" name="include_activity" type="checkbox" value="true" disabled>
          <label class="form-check-label" for="include-activity">${escapeHtml(t(language, 'qr.print.activity', { activity: activitySingular }))}</label>
        </div>
        <dl class="qr-print-summary mt-3 mb-0" aria-live="polite">
          <div><dt>${escapeHtml(t(language, 'qr.print.dimensions'))}</dt><dd data-profile-dimensions>—</dd></div>
          <div><dt>${escapeHtml(t(language, 'qr.print.per_sheet'))}</dt><dd data-profile-capacity>—</dd></div>
          <div><dt>${businessTerm(language, 'student', 'plural')}</dt><dd data-participant-count>—</dd></div>
          <div><dt>${escapeHtml(t(language, 'qr.print.sheets_estimated'))}</dt><dd data-sheet-count>—</dd></div>
        </dl>
      </section>

      <div class="page-section form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'qr.print.generate'))}</button>
        <button class="btn btn-outline-secondary" type="submit" formaction="/students/qr-print/calibration" formnovalidate>${escapeHtml(t(language, 'qr.print.calibration'))}</button>
      </div>
    </form>`, { pageClass: 'page--qr-print', language });
}

async function loadSelectedParticipants(selection, language = DEFAULT_LANGUAGE) {
  const selectColumns = `s.public_id, s.first_name, s.last_name, s.student_code, s.qr_token, s.language`;
  if (!selectionModes.has(selection.mode)) {
    throw Object.assign(new Error(t(language, 'qr.print.error.mode')), { code: 'VALIDATION_ERROR' });
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
    return { participants: result.rows, activityName: '', classLanguage: null, logo };
  }

  if (selection.mode === 'class') {
    if (!isValidPublicId(selection.classId)) {
      throw Object.assign(new Error(t(language, 'qr.print.error.selection')), { code: 'VALIDATION_ERROR' });
    }
    const [classResult, participantsResult, logo] = await Promise.all([
      pool.query('SELECT name, language FROM classes WHERE public_id = $1', [selection.classId]),
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
      throw Object.assign(new Error(t(language, 'qr.print.error.selection')), { code: 'VALIDATION_ERROR' });
    }
    return {
      participants: participantsResult.rows,
      activityName: selection.includeActivity ? classResult.rows[0].name : '',
      classLanguage: classResult.rows[0].language,
      logo,
    };
  }

  if (selection.studentIds.length === 0 || selection.studentIds.length > MAX_PARTICIPANTS_PER_PDF
      || selection.studentIds.some((studentId) => !isValidPublicId(studentId))) {
    throw Object.assign(new Error(t(language, 'qr.print.error.choose_active', { student: getTerm(language, 'student') })), { code: 'VALIDATION_ERROR' });
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
    throw Object.assign(new Error(t(language, 'qr.print.error.inactive')), { code: 'VALIDATION_ERROR' });
  }
  return { participants: result.rows, activityName: '', classLanguage: null, logo };
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

async function renderCurrentPage(request, response, error = '', status = 200) {
  try {
    const choices = await loadPrintChoices();
    response.status(status).send(renderPrintPage({ ...choices, error, language: request.uiLanguage }));
  } catch (loadError) {
    console.error('Unable to load QR print choices:', loadError.code || 'DATABASE_ERROR');
    const page = renderMessagePage(t(request.uiLanguage, 'qr.print.error.unavailable.title'), t(request.uiLanguage, 'qr.print.error.unavailable.message'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
}

router.get('/', async (request, response) => renderCurrentPage(request, response));

router.post('/pdf', async (request, response) => {
  const options = normalizePrintOptions(request.body, request.uiLanguage);
  if (options.error) {
    await renderCurrentPage(request, response, options.error, 400);
    return;
  }

  try {
    const selection = normalizeSelection(request.body, request.uiLanguage);
    const { participants, activityName, classLanguage, logo } = await loadSelectedParticipants(selection, request.uiLanguage);
    if (participants.length === 0) {
      await renderCurrentPage(request, response, t(request.uiLanguage, 'qr.print.error.no_match'), 400);
      return;
    }
    if (participants.length > MAX_PARTICIPANTS_PER_PDF) {
      await renderCurrentPage(request, response, t(request.uiLanguage, 'qr.print.error.too_many'), 413);
      return;
    }
    if (selection.includeWarning && !canIncludeQrWarning(options.profile)) {
      await renderCurrentPage(request, response, t(request.uiLanguage, 'qr.print.error.warning'), 400);
      return;
    }
    const design = await getSavedPrintDesign(options.profile.reference);
    const defaultLanguage = resolveParticipantLanguage({
      classLanguage,
      defaultLanguage: request.internationalization.defaultLanguage,
    });
    const pdf = await createParticipantQrSheetPdf({
      profile: options.profile,
      participants: participants.map((participant) => ({
        ...participant,
        effectiveLanguage: resolveParticipantLanguage({
          participantLanguage: participant.language,
          classLanguage,
          defaultLanguage,
        }),
      })),
      firstPosition: options.firstPosition,
      activityName,
      includeWarning: selection.includeWarning,
      title: selection.title,
      logo,
      design,
      defaultLanguage,
      terminology: request.terminology,
    });
    sendPdf(response, pdf, `attendance-log-qr-${options.profile.reference.toLowerCase()}.pdf`);
  } catch (error) {
    if (error.code === 'VALIDATION_ERROR') {
      await renderCurrentPage(request, response, error.message, 400);
      return;
    }
    console.error('Unable to generate participant QR sheet:', error.code || error.name || 'PDF_ERROR');
    const page = renderMessagePage(t(request.uiLanguage, 'qr.print.error.pdf.title'), t(request.uiLanguage, 'qr.print.error.pdf.message'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.post('/calibration', async (request, response) => {
  const profile = getAveryProfile(request.body.profile);
  if (!profile) {
    await renderCurrentPage(request, response, t(request.uiLanguage, 'qr.print.error.profile'), 400);
    return;
  }
  try {
    const pdf = await createCalibrationSheetPdf(profile, request.uiLanguage);
    sendPdf(response, pdf, `attendance-log-test-${profile.reference.toLowerCase()}.pdf`);
  } catch (error) {
    console.error('Unable to generate Avery calibration sheet:', error.code || error.name || 'PDF_ERROR');
    const page = renderMessagePage(t(request.uiLanguage, 'qr.print.error.calibration.title'), t(request.uiLanguage, 'qr.print.error.calibration.message'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
