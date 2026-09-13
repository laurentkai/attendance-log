const express = require('express');
const { recordAuditEvent } = require('./audit');
const { pool, withTransaction } = require('./db/client');
const { sendMail } = require('./mail');
const { getEffectiveLogoForStudent } = require('./branding');
const {
  insertStudent,
  normalizeStudentValues,
  validateStudentValues,
} = require('./student-data');
const { createStudentQrEmail } = require('./student-qr-email');
const { createStudentQrPng } = require('./student-qr');
const { isValidPublicId } = require('./public-id');
const { resolveParticipantCommunicationLanguage, t } = require('./i18n');
const { getTerm } = require('./terminology');
const { businessTerm, escapeHtml, renderActionMenu, renderCollectionTools, renderLanguageOptions, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();

function isDuplicateStudentEmailError(error) {
  return error?.code === '23505'
    && error.constraint === 'students_email_case_insensitive_unique';
}

function studentQrMailErrorMessage(code, language) {
  const supportedCode = new Set([
    'NOT_CONFIGURED', 'AUTHENTICATION_FAILED', 'CONNECTION_FAILED', 'TLS_FAILED',
    'SENDER_REJECTED', 'RECIPIENT_REJECTED', 'DELIVERY_FAILED',
  ]).has(code) ? code : 'default';
  return t(language, `students.qr.delivery.${supportedCode}`);
}

function getSelectedClassIds(body = {}) {
  const rawClassIds = Array.isArray(body.class_ids)
    ? body.class_ids
    : body.class_ids ? [body.class_ids] : [];

  return [...new Set(rawClassIds.filter((classId) => isValidPublicId(classId)))];
}

async function loadClasses(client = pool) {
  const result = await client.query(
    'SELECT public_id, name FROM classes ORDER BY LOWER(name), id',
  );
  return result.rows;
}

function classIdsAreValid(classIds, classes) {
  const availableIds = new Set(classes.map((classRecord) => classRecord.public_id));
  return classIds.every((classId) => availableIds.has(classId));
}

function renderStudentForm({
  title,
  action,
  submitLabel,
  values,
  classes,
  selectedClassIds,
  editing = false,
  studentId = '',
  error = '',
  language,
}) {
  const selectedIds = new Set(selectedClassIds);
  const errorMessage = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : '';
  const classChoices = classes.length === 0
    ? `<p class="muted">${escapeHtml(t(language, 'students.form.no_classes'))}</p>`
    : `<div class="checkbox-list">${classes.map((classRecord) => `
        <label class="checkbox-option">
          <input class="form-check-input" name="class_ids" type="checkbox" value="${classRecord.public_id}"${selectedIds.has(classRecord.public_id) ? ' checked' : ''}>
          <span>${escapeHtml(classRecord.name)}</span>
        </label>`).join('')}</div>`;
  const codeField = editing
    ? `<div class="form-field">
        <span class="field-label">${escapeHtml(t(language, 'students.form.identification_code'))}</span>
        <strong class="student-code">${escapeHtml(values.student_code)}</strong>
      </div>`
    : '';
  const activeField = editing
    ? `<label class="checkbox-option">
        <input class="form-check-input" name="active" type="checkbox" value="true"${values.active ? ' checked' : ''}>
        <span>${escapeHtml(t(language, 'students.form.active_status'))}</span>
      </label>`
    : '';

  return renderPage(title, `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <h1>${escapeHtml(title)}</h1>
      </div>
      ${editing ? `<div class="context-actions d-flex flex-wrap gap-2">
        <a class="btn btn-outline-secondary" href="/students/${escapeHtml(studentId)}/qr">${escapeHtml(t(language, 'students.form.show_qr'))}</a>
      </div>` : ''}
    </header>
    ${errorMessage}
    <form class="card card-body app-form" method="post" action="${escapeHtml(action)}">
      <div class="form-grid">
      <div class="form-field">
        <label for="first_name">${escapeHtml(t(language, 'students.form.first_name'))} <span aria-hidden="true">*</span></label>
        <input class="form-control" id="first_name" name="first_name" type="text" value="${escapeHtml(values.firstName || '')}" autocomplete="given-name" required>
      </div>

      <div class="form-field">
        <label for="last_name">${escapeHtml(t(language, 'students.form.last_name'))} <span aria-hidden="true">*</span></label>
        <input class="form-control" id="last_name" name="last_name" type="text" value="${escapeHtml(values.lastName || '')}" autocomplete="family-name" required>
      </div>
      </div>

      <div class="form-field">
        <label for="email">${escapeHtml(t(language, 'students.form.email'))} <span aria-hidden="true">*</span></label>
        <input class="form-control" id="email" name="email" type="email" value="${escapeHtml(values.email || '')}" autocomplete="email" spellcheck="false" required>
      </div>

      <div class="form-field">
        <label for="language">${escapeHtml(t(language, 'students.form.communication_language'))}</label>
        <select class="form-select" id="language" name="language">
          ${renderLanguageOptions(values.language, { language, emptyLabel: t(language, 'students.form.inherit') })}
        </select>
        <p class="form-text mb-0">${escapeHtml(t(language, 'students.form.language_help'))}</p>
      </div>

      ${codeField}
      <fieldset>
        <legend>${businessTerm(language, 'class', 'plural')}</legend>
        ${classChoices}
      </fieldset>
      ${activeField}

      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="btn btn-outline-secondary" href="/students">${escapeHtml(t(language, 'action.cancel'))}</a>
      </div>
    </form>`, { language });
}

async function addMemberships(client, studentId, classIds) {
  for (const classId of classIds) {
    await client.query(
      `INSERT INTO student_classes (student_id, class_id)
       SELECT s.id, c.id
       FROM students s
       CROSS JOIN classes c
       WHERE s.id = $1 AND s.anonymized_at IS NULL AND c.public_id = $2
       ON CONFLICT (student_id, class_id) DO NOTHING`,
      [studentId, classId],
    );
  }
}

function renderStudentQrPage(student, feedback = null, language) {
  const studentName = `${student.first_name} ${student.last_name}`;
  const feedbackMessage = feedback?.message
    ? `<p class="alert alert-${feedback.type === 'success' ? 'success' : 'danger'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';

  return renderPage(t(language, 'students.qr.title', { name: studentName }), `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <p class="eyebrow">${escapeHtml(t(language, 'students.qr.eyebrow'))}</p>
        <h1>${escapeHtml(studentName)}</h1>
        <p class="page-description">${escapeHtml(t(language, 'students.qr.description', { attendance: getTerm(language, 'attendance', 'plural') }))}</p>
      </div>
      <div class="context-actions d-flex flex-wrap gap-2">
        <a class="btn btn-light" href="/students/${student.public_id}/edit">${escapeHtml(t(language, 'students.qr.back_to_record'))}</a>
      </div>
    </header>
    <div class="notification-area" aria-live="polite" aria-atomic="true">
      ${feedbackMessage}
    </div>
    <section class="qr-display" aria-labelledby="student-qr-title">
      <div class="compact-identity student-identity">
        <h2 class="compact-title" id="student-qr-title">${escapeHtml(studentName)}</h2>
        <p class="compact-meta">${escapeHtml(t(language, 'students.qr.code', { code: student.student_code }))}</p>
        <span class="badge status-badge status-${student.active ? 'active' : 'inactive'}">${escapeHtml(t(language, 'students.qr.status', { status: t(language, `status.${student.active ? 'active' : 'inactive'}`) }))}</span>
      </div>
      <img class="student-qr-image" src="/students/${student.public_id}/qr.png" width="512" height="512" fetchpriority="high" alt="${escapeHtml(t(language, 'students.qr.alt', { name: studentName }))}">
      <p class="section-description qr-instruction">${escapeHtml(t(language, 'students.qr.instruction', { attendance: getTerm(language, 'attendance', 'plural') }))}</p>
      <form class="form-actions qr-actions" method="post" action="/students/${student.public_id}/qr/email" data-submit-once>
        <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'students.qr.send'))}</button>
        <a class="btn btn-outline-secondary" href="/students/${student.public_id}/qr.png?download=1" download="participant-${escapeHtml(student.student_code)}-qr.png">${escapeHtml(t(language, 'students.qr.download'))}</a>
      </form>
    </section>`, { language });
}

router.get('/', async (request, response) => {
  const showInactive = request.query.status === 'inactive';
  const language = request.uiLanguage;

  try {
    const result = await pool.query(
      `SELECT s.public_id, s.first_name, s.last_name, s.email, s.student_code, s.active, s.anonymized_at
       FROM students s
       WHERE s.active = $1
       ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
      [!showInactive],
    );
    const notices = {
      created: t(language, 'students.notice.created', { student: getTerm(language, 'student') }),
      updated: t(language, 'students.notice.updated', { student: getTerm(language, 'student') }),
      deactivated: t(language, 'students.notice.deactivated', { student: getTerm(language, 'student') }),
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-success" role="status">${escapeHtml(notices[request.query.notice])}</p>`
      : '';
    const cards = result.rows.length === 0
      ? `<p class="empty-state">${escapeHtml(t(language, `students.directory.empty_${showInactive ? 'inactive' : 'active'}`, { students: getTerm(language, 'student', 'plural') }))}</p>`
      : `<section data-filterable-list>
          ${renderCollectionTools({ language, id: 'student-list', placeholder: t(language, 'students.directory.search_placeholder'), count: result.rows.length })}
          <p class="empty-state" role="status" data-list-no-results hidden>${escapeHtml(t(language, 'common.no_results'))}</p>
          <div class="list-group compact-list" id="student-list" data-list-results>${result.rows.map((student) => `
          <article class="list-group-item compact-row compact-row-status collection-row student-row" data-list-row data-search="${escapeHtml((student.anonymized_at ? `${student.first_name} ${student.last_name}` : `${student.first_name} ${student.last_name} ${student.email} ${student.student_code}`).toLocaleLowerCase())}">
            <div class="compact-identity student-identity">
              <p class="compact-title">${student.anonymized_at ? `${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}` : `<a href="/students/${student.public_id}/edit">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</a>`}</p>
              ${student.anonymized_at
                ? `<p class="compact-meta">${escapeHtml(t(language, 'students.directory.identity_removed'))}</p>`
                : `<p class="compact-meta"><a href="mailto:${escapeHtml(student.email)}">${escapeHtml(student.email)}</a> · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>`}
            </div>
            <div class="compact-status">
              <span class="badge status-badge status-${student.active ? 'active' : 'inactive'}">${escapeHtml(t(language, 'students.qr.status', { status: t(language, `status.${student.anonymized_at ? 'anonymized' : student.active ? 'active' : 'inactive'}`) }))}</span>
            </div>
            <div class="compact-actions" aria-label="${escapeHtml(t(language, 'students.directory.actions_for', { name: `${student.first_name} ${student.last_name}` }))}">
              ${student.anonymized_at ? '' : renderActionMenu(t(language, 'action.actions_for', { name: `${student.first_name} ${student.last_name}` }), `
                <a class="dropdown-item" href="/students/${student.public_id}/edit">${escapeHtml(t(language, 'action.edit'))}</a>
                <a class="dropdown-item" href="/students/${student.public_id}/qr">${escapeHtml(t(language, 'students.form.show_qr'))}</a>
                ${student.active ? `<div class="dropdown-divider"></div><form method="post" action="/students/${student.public_id}/deactivate" data-confirm="${escapeHtml(t(language, 'students.confirm.deactivate'))}">
                  <button class="dropdown-item text-danger" type="submit">${escapeHtml(t(language, 'action.deactivate'))}</button>
                </form>` : ''}`)}
            </div>
          </article>`).join('')}</div>
        </section>`;

    response.send(renderPage(getTerm(language, 'student', 'plural'), `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${businessTerm(language, 'student', 'plural')}</h1>
          <p class="page-description">${escapeHtml(t(language, `students.directory.description_${showInactive ? 'inactive' : 'active'}`, { students: getTerm(language, 'student', 'plural') }))}</p>
        </div>
        <div class="context-actions d-flex flex-wrap gap-2">
          <a class="btn btn-primary" href="/students/new">${escapeHtml(t(language, 'action.add'))}</a>
          <a class="btn btn-outline-secondary" href="/students/import">${escapeHtml(t(language, 'action.import'))}</a>
          <a class="btn btn-outline-secondary" href="/students/qr-print">${escapeHtml(t(language, 'students.directory.print_qr'))}</a>
        </div>
      </header>
      <nav class="nav nav-pills view-switch" aria-label="${escapeHtml(t(language, 'students.directory.filter_aria', { students: getTerm(language, 'student', 'plural') }))}">
        <a class="nav-link${showInactive ? '' : ' active'}" href="/students"${showInactive ? '' : ' aria-current="page"'}>${escapeHtml(t(language, 'status.active'))}</a>
        <a class="nav-link${showInactive ? ' active' : ''}" href="/students?status=inactive"${showInactive ? ' aria-current="page"' : ''}>${escapeHtml(t(language, 'status.inactive'))}</a>
      </nav>
      ${notice}
      ${cards}`, { language }));
  } catch (error) {
    console.error('Unable to list students:', error);
    const page = renderMessagePage(t(language, 'students.error.directory_unavailable.title'), t(language, 'students.error.directory_unavailable.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

router.get('/new', async (request, response) => {
  const language = request.uiLanguage;
  try {
    const classes = await loadClasses();
    response.send(renderStudentForm({
      title: t(language, 'students.form.add_title', { student: getTerm(language, 'student') }),
      action: '/students',
      submitLabel: t(language, 'students.form.create'),
      values: {},
      classes,
      selectedClassIds: [],
      language,
    }));
  } catch (error) {
    console.error('Unable to load student form:', error);
    const page = renderMessagePage(t(language, 'students.error.form_unavailable.title'), t(language, 'students.error.form_unavailable.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

router.post('/', async (request, response) => {
  const language = request.uiLanguage;
  const values = normalizeStudentValues(request.body);
  const selectedClassIds = getSelectedClassIds(request.body);
  let classes;

  try {
    classes = await loadClasses();
  } catch (error) {
    console.error('Unable to load classes for student creation:', error);
    const page = renderMessagePage(t(language, 'students.error.create.title', { student: getTerm(language, 'student') }), t(language, 'students.error.create.message'), 503, language);
    response.status(page.status).send(page.html);
    return;
  }

  const validationError = validateStudentValues(values, language)
    || (!classIdsAreValid(selectedClassIds, classes) ? t(language, 'students.error.invalid_selection') : '');
  if (validationError) {
    response.status(400).send(renderStudentForm({
      title: t(language, 'students.form.add_title', { student: getTerm(language, 'student') }),
      action: '/students',
      submitLabel: t(language, 'students.form.create'),
      values,
      classes,
      selectedClassIds,
      error: validationError,
      language,
    }));
    return;
  }

  try {
    await withTransaction(pool, async (client) => {
      if (selectedClassIds.length > 0) {
        await client.query(
          'SELECT id FROM classes WHERE public_id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [selectedClassIds],
        );
      }
      const student = await insertStudent(client, values);
      await addMemberships(client, student.id, selectedClassIds);
      await recordAuditEvent({
        client, category: 'student', action: 'student.create', targetType: 'student',
        targetPublicId: student.public_id, targetLabel: `${values.firstName} ${values.lastName}`,
        summary: 'Fiche participant créée.',
        afterData: { name: `${values.firstName} ${values.lastName}`, email: values.email, active: true, language: values.language },
        metadata: { counts: { memberships: selectedClassIds.length } },
      });
    });
    response.redirect(303, '/students?notice=created');
  } catch (error) {
    const duplicateEmail = isDuplicateStudentEmailError(error);
    if (!duplicateEmail) console.error('Unable to create student:', error);
    const message = duplicateEmail
      ? t(language, 'students.error.duplicate_email')
      : t(language, 'students.error.create.message');
    response.status(duplicateEmail ? 409 : 500).send(renderStudentForm({
      title: t(language, 'students.form.add_title', { student: getTerm(language, 'student') }),
      action: '/students',
      submitLabel: t(language, 'students.form.create'),
      values,
      classes,
      selectedClassIds,
      error: message,
      language,
    }));
  }
});

router.get('/:id/qr.png', async (request, response) => {
  if (!isValidPublicId(request.params.id)) {
    response.status(404).end();
    return;
  }

  try {
    const result = await pool.query(
      'SELECT qr_token, student_code FROM students WHERE public_id = $1 AND anonymized_at IS NULL',
      [request.params.id],
    );
    if (result.rowCount === 0) {
      response.status(404).end();
      return;
    }

    const png = await createStudentQrPng(result.rows[0].qr_token);
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.query.download === '1') {
      response.attachment(`eleve-${result.rows[0].student_code}-qr.png`);
    }
    response.send(png);
  } catch (error) {
    console.error('Unable to render student QR code:', error);
    response.status(500).end();
  }
});

router.get('/:id/qr', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, public_id, first_name, last_name, email, student_code, qr_token, active, language
       FROM students
       WHERE public_id = $1 AND anonymized_at IS NULL`,
      [request.params.id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
      response.status(page.status).send(page.html);
      return;
    }

    const feedback = request.query.notice === 'qr_sent'
      ? { type: 'success', message: t(language, 'students.qr.sent', { email: result.rows[0].email }) }
      : null;
    response.send(renderStudentQrPage(result.rows[0], feedback, language));
  } catch (error) {
    console.error('Unable to load student QR page:', error);
    const page = renderMessagePage(t(language, 'students.error.qr_unavailable.title'), t(language, 'students.error.qr_unavailable.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/qr/email', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
    response.status(page.status).send(page.html);
    return;
  }

  let student;
  try {
    const result = await pool.query(
      `SELECT id, public_id, first_name, last_name, email, student_code, qr_token, active, language
       FROM students
       WHERE public_id = $1 AND anonymized_at IS NULL`,
      [request.params.id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
      response.status(page.status).send(page.html);
      return;
    }
    student = result.rows[0];
  } catch (error) {
    console.error('Unable to load student for QR email:', error.code || 'DATABASE_ERROR');
    const page = renderMessagePage(t(language, 'students.error.send.title'), t(language, 'students.error.load_for_email'), 503, language);
    response.status(page.status).send(page.html);
    return;
  }

  if (!student.email) {
    response.status(400).send(renderStudentQrPage(student, {
      type: 'error',
      message: t(language, 'students.qr.no_email'),
    }, language));
    return;
  }
  if (!student.qr_token) {
    response.status(409).send(renderStudentQrPage(student, {
      type: 'error',
      message: t(language, 'students.qr.unavailable_person'),
    }, language));
    return;
  }

  let message;
  try {
    const [qrPng, logo] = await Promise.all([
      createStudentQrPng(student.qr_token),
      getEffectiveLogoForStudent(student.id),
    ]);
    message = createStudentQrEmail(student, qrPng, logo, resolveParticipantCommunicationLanguage({
      participantLanguage: student.language,
      defaultLanguage: request.internationalization.defaultLanguage,
    }), request.terminology);
  } catch (error) {
    console.error('Unable to generate student QR email:', error.code || error.name || 'QR_ERROR');
    response.status(500).send(renderStudentQrPage(student, {
      type: 'error',
      message: t(language, 'students.qr.generate_failed'),
    }, language));
    return;
  }

  try {
    await sendMail({
      to: student.email,
      ...message,
    });
    response.redirect(303, `/students/${student.public_id}/qr?notice=qr_sent`);
  } catch (error) {
    console.error('Unable to send student QR email:', error.code || 'DELIVERY_FAILED');
    response.status(error.code === 'NOT_CONFIGURED' ? 409 : 502).send(renderStudentQrPage(student, {
      type: 'error',
      message: studentQrMailErrorMessage(error.code, language),
    }, language));
  }
});

router.get('/:id/edit', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const [studentResult, classes, membershipResult] = await Promise.all([
      pool.query('SELECT id, public_id, first_name, last_name, email, student_code, active, anonymized_at, language FROM students WHERE public_id = $1', [request.params.id]),
      loadClasses(),
      pool.query('SELECT c.public_id FROM student_classes sc INNER JOIN classes c ON c.id = sc.class_id WHERE sc.student_id = (SELECT id FROM students WHERE public_id = $1)', [request.params.id]),
    ]);

    if (studentResult.rowCount === 0) {
      const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
      response.status(page.status).send(page.html);
      return;
    }

    const student = studentResult.rows[0];
    if (student.anonymized_at) {
      const page = renderMessagePage(t(language, 'students.error.edit_anonymized.title', { student: getTerm(language, 'student') }), t(language, 'students.error.edit_anonymized.message', { student: getTerm(language, 'student') }), 409, language);
      response.status(page.status).send(page.html);
      return;
    }
    response.send(renderStudentForm({
      title: t(language, 'students.form.edit_title', { student: getTerm(language, 'student') }),
      action: `/students/${student.public_id}`,
      submitLabel: t(language, 'action.save'),
      values: {
        firstName: student.first_name,
        lastName: student.last_name,
        email: student.email,
        student_code: student.student_code,
        active: student.active,
        language: student.language,
      },
      classes,
      selectedClassIds: membershipResult.rows.map((membership) => membership.public_id),
      editing: true,
      studentId: student.public_id,
      language,
    }));
  } catch (error) {
    console.error('Unable to load student:', error);
    const page = renderMessagePage(t(language, 'students.error.record_unavailable.title'), t(language, 'students.error.record_unavailable.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
    response.status(page.status).send(page.html);
    return;
  }

  const values = normalizeStudentValues(request.body);
  values.active = request.body.active === 'true';
  const selectedClassIds = getSelectedClassIds(request.body);
  const classes = await loadClasses();
  const currentResult = await pool.query('SELECT id, public_id, first_name, last_name, email, active, student_code, anonymized_at, language FROM students WHERE public_id = $1', [request.params.id]);

  if (currentResult.rowCount === 0) {
    const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
    response.status(page.status).send(page.html);
    return;
  }
  if (currentResult.rows[0].anonymized_at) {
    const page = renderMessagePage(t(language, 'students.error.edit_anonymized.title', { student: getTerm(language, 'student') }), t(language, 'students.error.edit_anonymized.message', { student: getTerm(language, 'student') }), 409, language);
    response.status(page.status).send(page.html);
    return;
  }

  values.student_code = currentResult.rows[0].student_code;
  const validationError = validateStudentValues(values, language)
    || (!classIdsAreValid(selectedClassIds, classes) ? t(language, 'students.error.invalid_selection') : '');
  if (validationError) {
    response.status(400).send(renderStudentForm({
      title: t(language, 'students.form.edit_title', { student: getTerm(language, 'student') }),
      action: `/students/${request.params.id}`,
      submitLabel: t(language, 'action.save'),
      values,
      classes,
      selectedClassIds,
      editing: true,
      studentId: request.params.id,
      error: validationError,
      language,
    }));
    return;
  }

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const membershipResult = await client.query(
        'SELECT c.public_id FROM student_classes sc INNER JOIN classes c ON c.id = sc.class_id WHERE sc.student_id = $1 ORDER BY c.id',
        [currentResult.rows[0].id],
      );
      const selectedIds = new Set(selectedClassIds);
      const removedClassIds = membershipResult.rows
        .map((membership) => membership.public_id)
        .filter((classId) => !selectedIds.has(classId));
      const affectedClassIds = [...new Set([
        ...selectedClassIds,
        ...membershipResult.rows.map((membership) => membership.public_id),
      ])];
      if (affectedClassIds.length > 0) {
        await client.query(
          'SELECT id FROM classes WHERE public_id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [affectedClassIds],
        );
      }
      if (removedClassIds.length > 0) {
        const protectedResult = await client.query(
          `SELECT c.name
           FROM classes c
           WHERE c.public_id = ANY($1::uuid[])
             AND EXISTS (
               SELECT 1 FROM course_sessions cs
               WHERE cs.class_id = c.id AND cs.started_at IS NOT NULL
             )
           ORDER BY LOWER(c.name)
           LIMIT 1`,
          [removedClassIds],
        );
        if (protectedResult.rowCount > 0) return { protectedClassName: protectedResult.rows[0].name };
      }
      const studentUpdate = await client.query(
        `UPDATE students
         SET first_name = $1, last_name = $2, email = $3, active = $4, language = $5
         WHERE id = $6 AND anonymized_at IS NULL`,
        [values.firstName, values.lastName, values.email, values.active, values.language, currentResult.rows[0].id],
      );
      if (studentUpdate.rowCount === 0) return { anonymized: true };
      if (removedClassIds.length > 0) {
        await client.query(
          `DELETE FROM student_classes
           WHERE student_id = $1 AND class_id IN (SELECT id FROM classes WHERE public_id = ANY($2::uuid[]))`,
          [currentResult.rows[0].id, removedClassIds],
        );
      }
      await addMemberships(client, currentResult.rows[0].id, selectedClassIds);
      const current = currentResult.rows[0];
      await recordAuditEvent({
        client, category: 'student', action: !current.active && values.active ? 'student.reactivate' : current.active && !values.active ? 'student.deactivate' : 'student.update', targetType: 'student',
        targetPublicId: current.public_id, targetLabel: `${values.firstName} ${values.lastName}`,
        summary: 'Fiche participant mise à jour.',
        beforeData: { name: `${current.first_name} ${current.last_name}`, email: current.email, active: current.active, language: current.language },
        afterData: { name: `${values.firstName} ${values.lastName}`, email: values.email, active: values.active, language: values.language },
        metadata: { counts: { memberships: selectedClassIds.length } },
      });
      return {};
    });
    if (outcome.protectedClassName) {
      response.status(409).send(renderStudentForm({
        title: t(language, 'students.form.edit_title', { student: getTerm(language, 'student') }),
        action: `/students/${request.params.id}`,
        submitLabel: t(language, 'action.save'),
        values,
        classes,
        selectedClassIds,
        editing: true,
        studentId: request.params.id,
        error: t(language, 'students.error.remove_started_class', { className: outcome.protectedClassName, classes: getTerm(language, 'class', 'plural') }),
        language,
      }));
      return;
    }
    if (outcome.anonymized) {
      const page = renderMessagePage(t(language, 'students.error.edit_anonymized.title', { student: getTerm(language, 'student') }), t(language, 'students.error.edit_anonymized.message', { student: getTerm(language, 'student') }), 409, language);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(
      303,
      values.active
        ? '/students?notice=updated'
        : '/students?status=inactive&notice=updated',
    );
  } catch (error) {
    const duplicateEmail = isDuplicateStudentEmailError(error);
    if (!duplicateEmail) console.error('Unable to update student:', error);
    const message = duplicateEmail
      ? t(language, 'students.error.duplicate_email')
      : t(language, 'students.error.update.message');
    response.status(duplicateEmail ? 409 : 500).send(renderStudentForm({
      title: t(language, 'students.form.edit_title', { student: getTerm(language, 'student') }),
      action: `/students/${request.params.id}`,
      submitLabel: t(language, 'action.save'),
      values,
      classes,
      selectedClassIds,
      editing: true,
      studentId: request.params.id,
      error: message,
      language,
    }));
  }
});

router.post('/:id/deactivate', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found.message'), 404, language);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const changed = await withTransaction(pool, async (client) => {
      await client.query(
        `SELECT c.id
         FROM classes c
         INNER JOIN student_classes sc ON sc.class_id = c.id
         WHERE sc.student_id = (SELECT id FROM students WHERE public_id = $1)
         ORDER BY c.id
         FOR UPDATE`,
        [request.params.id],
      );
      const result = await client.query(
        'UPDATE students SET active = FALSE WHERE public_id = $1 AND active = TRUE RETURNING public_id, first_name, last_name',
        [request.params.id],
      );
      if (result.rowCount > 0) {
        const student = result.rows[0];
        await recordAuditEvent({
          client, category: 'student', action: 'student.deactivate', targetType: 'student',
          targetPublicId: student.public_id, targetLabel: `${student.first_name} ${student.last_name}`,
          summary: 'Fiche participant désactivée.', beforeData: { active: true }, afterData: { active: false },
        });
      }
      return result.rowCount > 0;
    });
    if (!changed) {
      const page = renderMessagePage(t(language, 'students.error.not_found.title', { student: getTerm(language, 'student') }), t(language, 'students.error.not_found_active'), 404, language);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, '/students?notice=deactivated');
  } catch (error) {
    console.error('Unable to deactivate student:', error);
    const page = renderMessagePage(t(language, 'students.error.deactivate.title', { student: getTerm(language, 'student') }), t(language, 'students.error.deactivate.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
