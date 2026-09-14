const express = require('express');
const multer = require('multer');
const { recordAuditEvent } = require('./audit');
const {
  getClassLogo,
  logoUpload,
  normalizeLogoUpload,
  removeClassLogo,
  saveClassLogo,
} = require('./branding');
const { pool, withTransaction } = require('./db/client');
const { getTerm } = require('./terminology');
const { normalizeLanguageOverride, t } = require('./i18n');
const { isValidPublicId } = require('./public-id');
const { TOLERANCE_VALUES, isValidTolerance } = require('./punctuality');
const {
  loadClassSummaryConfiguration,
  loadSummaryAdminOptions,
  parseSummaryRecipientInput,
  renderSummaryConfigurationFields,
  saveClassSummaryConfiguration,
  summaryConfigurationChanged,
  summaryConfigurationSnapshot,
} = require('./session-summary-config');
const { businessTerm, escapeHtml, renderActionMenu, renderCollectionTools, renderLanguageOptions, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();

function renderClassNotFoundPage(language) {
  return renderMessagePage(
    t(language, 'classes.error.not_found.title', { class: getTerm(language, 'class') }),
    t(language, 'classes.error.not_found.message'), 404, language,
  );
}

function getFormValues(body = {}) {
  let summaryConfiguration;
  let summaryConfigurationError = false;
  try {
    summaryConfiguration = parseSummaryRecipientInput(body, { attachmentScope: 'class' });
  } catch (_error) {
    summaryConfigurationError = true;
    const rawAdminIds = Array.isArray(body.summary_admin_user_ids)
      ? body.summary_admin_user_ids : body.summary_admin_user_ids ? [body.summary_admin_user_ids] : [];
    summaryConfiguration = {
      adminRecipientIds: rawAdminIds.filter(isValidPublicId),
      externalRecipients: [typeof body.summary_external_recipients === 'string'
        ? body.summary_external_recipients.slice(0, 12750) : ''].filter(Boolean),
      attachXlsx: body.summary_attach_xlsx === 'on',
    };
  }
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    description: typeof body.description === 'string'
      ? body.description.trim()
      : '',
    punctuality_tolerance_minutes: Number.parseInt(body.punctuality_tolerance_minutes || '5', 10),
    language: normalizeLanguageOverride(body.language),
    ...summaryConfiguration,
    summaryConfigurationError,
  };
}

function renderClassForm({
  title,
  action,
  submitLabel,
  values,
  classId = '',
  hasLogo = false,
  logoNotice = '',
  error = '',
  adminUsers = [],
  language,
}) {
  const classTerms = { class: getTerm(language, 'class') };
  const errorMessage = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : '';

  const logoMessages = {
    saved: ['success', t(language, 'classes.logo.notice.saved', classTerms)],
    removed: ['success', t(language, 'classes.logo.notice.removed', classTerms)],
    invalid: ['danger', t(language, 'classes.logo.notice.invalid')],
    failed: ['danger', t(language, 'classes.logo.notice.failed')],
  };
  const logoFeedback = logoMessages[logoNotice];
  const logoSection = classId ? `<section class="page-section mt-4" aria-labelledby="activity-logo-title">
    <div class="section-header">
      <div>
        <h2 id="activity-logo-title">${escapeHtml(t(language, 'classes.logo.title', { class: getTerm(language, 'class') }))}</h2>
        <p class="section-description">${escapeHtml(t(language, 'classes.logo.help', classTerms))}</p>
      </div>
    </div>
    ${logoFeedback ? `<p class="alert alert-${logoFeedback[0]}" role="${logoFeedback[0] === 'success' ? 'status' : 'alert'}">${escapeHtml(logoFeedback[1])}</p>` : ''}
    <div class="card card-body app-form">
      ${hasLogo ? `<div class="branding-logo-preview">
        <img src="/classes/${escapeHtml(classId)}/logo" width="240" height="96" alt="${escapeHtml(t(language, 'classes.logo.current_alt', classTerms))}">
      </div>` : `<p class="empty-state mb-0">${escapeHtml(t(language, 'classes.logo.none', classTerms))}</p>`}
      <form class="app-form" method="post" action="/classes/${escapeHtml(classId)}/logo" enctype="multipart/form-data">
        <div class="form-field">
          <label for="activity-logo">${escapeHtml(t(language, hasLogo ? 'classes.logo.replace' : 'classes.logo.choose'))}</label>
          <input class="form-control" id="activity-logo" name="logo" type="file" accept="image/png,image/jpeg" required>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${escapeHtml(t(language, hasLogo ? 'classes.logo.replace' : 'action.save'))}</button></div>
      </form>
      ${hasLogo ? `<form method="post" action="/classes/${escapeHtml(classId)}/logo/remove" data-confirm="${escapeHtml(t(language, 'classes.logo.confirm_remove', classTerms))}">
        <button class="btn btn-outline-danger" type="submit">${escapeHtml(t(language, 'classes.logo.remove'))}</button>
      </form>` : ''}
    </div>
  </section>` : '';

  return renderPage(title, `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <h1>${escapeHtml(title)}</h1>
      </div>
    </header>
    ${errorMessage}
    <form class="card card-body app-form" method="post" action="${escapeHtml(action)}">
      <div class="form-field">
        <label for="name">${escapeHtml(t(language, 'common.name'))} <span aria-hidden="true">*</span></label>
        <input class="form-control" id="name" name="name" type="text" value="${escapeHtml(values.name || '')}" autocomplete="off" required>
      </div>

      <div class="form-field">
        <label for="description">${escapeHtml(t(language, 'common.description'))}</label>
        <textarea class="form-control" id="description" name="description" rows="5" autocomplete="off">${escapeHtml(values.description || '')}</textarea>
      </div>

      <details class="form-disclosure"${error ? ' open' : ''}>
        <summary>${escapeHtml(t(language, 'workspace.configuration'))}</summary>
        <div class="form-disclosure-content">
      <div class="form-field">
        <label for="language">${escapeHtml(t(language, 'classes.form.generated_language'))}</label>
        <select class="form-select" id="language" name="language">
          ${renderLanguageOptions(values.language, { language, emptyLabel: t(language, 'classes.form.inherit_installation') })}
        </select>
      </div>

      <div class="form-field">
        <label for="punctuality-tolerance">${escapeHtml(t(language, 'classes.form.tolerance'))}</label>
        <select class="form-select" id="punctuality-tolerance" name="punctuality_tolerance_minutes" required>
          ${TOLERANCE_VALUES.map((minutes) => `<option value="${minutes}"${Number(values.punctuality_tolerance_minutes) === minutes ? ' selected' : ''}>${escapeHtml(t(language, 'punctuality.tolerance_option', { minutes }))}</option>`).join('')}
        </select>
        <p class="form-text mb-0">${escapeHtml(t(language, 'classes.form.tolerance_help', { class: getTerm(language, 'class'), sessions: getTerm(language, 'session', 'plural') }))}</p>
      </div>

      ${renderSummaryConfigurationFields({ adminUsers, values, scope: 'class', language })}
        </div>
      </details>

      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="btn btn-outline-secondary" href="/classes">${escapeHtml(t(language, 'action.cancel'))}</a>
      </div>
    </form>
    ${logoSection}`, { language });
}

function getStudentIds(body = {}) {
  const rawStudentIds = Array.isArray(body.student_ids)
    ? body.student_ids
    : body.student_ids ? [body.student_ids] : [];

  return [...new Set(rawStudentIds.filter((studentId) => isValidPublicId(studentId)))];
}

router.get('/', async (request, response) => {
  const language = request.uiLanguage;
  try {
    const result = await pool.query(
      'SELECT public_id, name, description FROM classes ORDER BY LOWER(name), id',
    );
    const notices = {
      created: t(language, 'classes.notice.created', { class: getTerm(language, 'class') }),
      updated: t(language, 'classes.notice.updated', { class: getTerm(language, 'class') }),
      deleted: t(language, 'classes.notice.deleted', { class: getTerm(language, 'class') }),
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-success" role="status">${escapeHtml(notices[request.query.notice])}</p>`
      : '';
    const classList = result.rows.length === 0
      ? `<p class="empty-state">${escapeHtml(t(language, 'classes.list.empty', { class: getTerm(language, 'class') }))}</p>`
      : `<section data-filterable-list>${renderCollectionTools({ language, id: 'class-list', count: result.rows.length })}
        <p class="empty-state" role="status" data-list-no-results hidden>${escapeHtml(t(language, 'common.no_results'))}</p>
        <div class="list-group compact-list" id="class-list" data-list-results>${result.rows.map((classRecord) => `
          <article class="list-group-item compact-row collection-row class-management-row" data-list-row data-search="${escapeHtml(`${classRecord.name} ${classRecord.description || ''}`)}">
            <div class="compact-identity class-identity">
              <p class="compact-title"><a href="/classes/${classRecord.public_id}">${escapeHtml(classRecord.name)}</a></p>
              <p class="compact-meta class-description">${classRecord.description
                ? escapeHtml(classRecord.description)
                : `<span class="muted">${escapeHtml(t(language, 'common.no_description'))}</span>`}</p>
            </div>
            <div class="compact-actions">
              <a class="btn btn-light" href="/sessions?class_id=${classRecord.public_id}">${businessTerm(language, 'session', 'plural')}</a>
              ${renderActionMenu(t(language, 'classes.list.admin_aria', { name: classRecord.name }), `
                <a class="dropdown-item" href="/classes/${classRecord.public_id}">${businessTerm(language, 'student', 'plural')}</a>
                <a class="dropdown-item" href="/sessions?class_id=${classRecord.public_id}">${businessTerm(language, 'session', 'plural')}</a>
                <a class="dropdown-item" href="/classes/${classRecord.public_id}/edit">${escapeHtml(t(language, 'action.edit'))}</a>
                <div class="dropdown-divider"></div>
                <form method="post" action="/classes/${classRecord.public_id}/delete" data-confirm="${escapeHtml(t(language, 'classes.confirm.delete', { class: getTerm(language, 'class') }))}">
                  <button class="dropdown-item text-danger" type="submit">${escapeHtml(t(language, 'action.delete'))}</button>
                </form>`)}
            </div>
          </article>`).join('')}</div></section>`;

    response.send(renderPage(getTerm(language, 'class', 'plural'), `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${businessTerm(language, 'class', 'plural')}</h1>
          <p class="page-description">${escapeHtml(t(language, 'classes.list.description', { students: getTerm(language, 'student', 'plural'), sessions: getTerm(language, 'session', 'plural') }))}</p>
        </div>
        <a class="btn btn-primary" href="/classes/new">${escapeHtml(t(language, 'action.add'))}</a>
      </header>
      ${notice}
      ${classList}`, { language }));
  } catch (error) {
    console.error('Unable to list classes:', error);
    const page = renderMessagePage(
      t(language, 'classes.error.list.title'),
      t(language, 'classes.error.list.message'),
      503,
      language,
    );
    response.status(page.status).send(page.html);
  }
});

router.get('/new', async (request, response) => {
  const language = request.uiLanguage;
  try {
    response.send(renderClassForm({
      title: t(language, 'classes.form.add_title', { class: getTerm(language, 'class') }),
      action: '/classes',
      submitLabel: t(language, 'classes.form.create'),
      values: {
        name: '', description: '', punctuality_tolerance_minutes: 5,
        adminRecipientIds: [], externalRecipients: [], attachXlsx: false,
      },
      adminUsers: await loadSummaryAdminOptions(),
      language,
    }));
  } catch (error) {
    console.error('Unable to load class form:', error.code || error.message);
    const page = renderMessagePage(t(language, 'classes.error.form.title'), t(language, 'classes.error.form.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

router.post('/', async (request, response) => {
  const language = request.uiLanguage;
  const values = getFormValues(request.body);

  if (!values.name || values.language === undefined || !isValidTolerance(values.punctuality_tolerance_minutes) || values.summaryConfigurationError) {
    response.status(400).send(renderClassForm({
      title: t(language, 'classes.form.add_title', { class: getTerm(language, 'class') }),
      action: '/classes',
      submitLabel: t(language, 'classes.form.create'),
      values,
      error: !values.name
        ? t(language, 'classes.error.invalid_name')
        : values.language === undefined
          ? t(language, 'classes.error.invalid_language')
        : values.summaryConfigurationError
          ? t(language, 'classes.error.invalid_summary')
          : t(language, 'classes.error.invalid_tolerance'),
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
      language,
    }));
    return;
  }

  try {
    await withTransaction(pool, async (client) => {
      const result = await client.query(
        `INSERT INTO classes (name, description, punctuality_tolerance_minutes, language)
         VALUES ($1, $2, $3, $4) RETURNING id, public_id`,
        [values.name, values.description || null, values.punctuality_tolerance_minutes, values.language],
      );
      await saveClassSummaryConfiguration(client, result.rows[0].id, values);
      await recordAuditEvent({
        client, category: 'class', action: 'class.create', targetType: 'class',
        targetPublicId: result.rows[0].public_id, targetLabel: values.name,
        summary: 'Activité créée.', afterData: {
          name: values.name,
          description: values.description || null,
          punctuality_tolerance_minutes: values.punctuality_tolerance_minutes,
          language: values.language,
          ...summaryConfigurationSnapshot(values, 'class'),
        },
      });
    });
    response.redirect(303, '/classes?notice=created');
  } catch (error) {
    if (error.code === 'SUMMARY_RECIPIENTS_INVALID') {
      response.status(400).send(renderClassForm({
        title: t(language, 'classes.form.add_title', { class: getTerm(language, 'class') }),
        action: '/classes', submitLabel: t(language, 'classes.form.create'), values,
        adminUsers: await loadSummaryAdminOptions().catch(() => []),
        error: t(language, 'classes.error.invalid_summary'),
        language,
      }));
      return;
    }
    console.error('Unable to create class:', error);
    response.status(500).send(renderClassForm({
      title: t(language, 'classes.form.add_title', { class: getTerm(language, 'class') }),
      action: '/classes',
      submitLabel: t(language, 'classes.form.create'),
      values,
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
      error: t(language, 'classes.error.create', { class: getTerm(language, 'class') }),
      language,
    }));
  }
});

router.get('/:id', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage(language);
    response.status(page.status).send(page.html);
    return;
  }

  const searchQuery = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : '';
  const canSearch = searchQuery.length >= 2;

  try {
    const [classResult, assignedResult, availableResult] = await Promise.all([
      pool.query(
        `SELECT c.id, c.public_id, c.name, c.description,
                EXISTS (
                  SELECT 1 FROM course_sessions cs
                  WHERE cs.class_id = c.id AND cs.started_at IS NOT NULL
                ) AS membership_locked
         FROM classes c
         WHERE c.public_id = $1`,
        [request.params.id],
      ),
      pool.query(
        `SELECT s.id, s.public_id, s.first_name, s.last_name, s.email, s.student_code,
                sc.active AS membership_active
         FROM students s
         INNER JOIN student_classes sc ON sc.student_id = s.id
         WHERE sc.class_id = (SELECT id FROM classes WHERE public_id = $1) AND s.active = TRUE
         ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
        [request.params.id],
      ),
      canSearch ? pool.query(
        `SELECT s.public_id, s.first_name, s.last_name, s.email
         FROM students s
         WHERE s.active = TRUE
           AND NOT EXISTS (
             SELECT 1 FROM student_classes sc
             WHERE sc.student_id = s.id AND sc.class_id = (SELECT id FROM classes WHERE public_id = $1)
           )
           AND (s.first_name ILIKE $2
             OR s.last_name ILIKE $2
             OR s.email ILIKE $2
             OR s.student_code ILIKE $2)
         ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
        [request.params.id, `%${searchQuery}%`],
      ) : Promise.resolve({ rows: [] }),
    ]);

    if (classResult.rowCount === 0) {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }

    const classRecord = classResult.rows[0];
    const notices = {
      students_added: t(language, 'classes.roster.notice.students_added', { students: getTerm(language, 'student', 'plural') }),
      no_students_added: t(language, 'classes.roster.notice.no_students_added', { student: getTerm(language, 'student') }),
      student_removed: t(language, 'classes.roster.notice.student_removed', { student: getTerm(language, 'student') }),
      membership_deactivated: t(language, 'classes.roster.notice.membership_deactivated', { membership: getTerm(language, 'membership') }),
      membership_reactivated: t(language, 'classes.roster.notice.membership_reactivated', { membership: getTerm(language, 'membership') }),
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-success" role="status">${escapeHtml(notices[request.query.notice])}</p>`
      : '';
    const assignedStudents = assignedResult.rows.length === 0
      ? `<p class="empty-state">${escapeHtml(t(language, 'classes.roster.empty', { membership: getTerm(language, 'membership') }))}</p>`
      : `<section data-filterable-list>
          ${renderCollectionTools({ language, id: 'class-roster-list', placeholder: t(language, 'students.directory.search_placeholder'), count: assignedResult.rows.length })}
          <p class="empty-state" role="status" data-list-no-results hidden>${escapeHtml(t(language, 'common.no_results'))}</p>
          <div class="list-group compact-list" id="class-roster-list" data-list-results>${assignedResult.rows.map((student) => `
          <article class="list-group-item compact-row compact-row-status collection-row student-row" data-list-row data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.email} ${student.student_code}`.toLocaleLowerCase())}">
            <div class="compact-identity student-identity">
              <p class="compact-title"><a href="/students/${student.public_id}/edit">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</a></p>
              <p class="compact-meta">${escapeHtml(student.email)} · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>
            </div>
            <div class="compact-status">
              <span class="badge status-badge status-${student.membership_active ? 'active' : 'inactive'}">${escapeHtml(t(language, 'classes.roster.membership_status', { membership: getTerm(language, 'membership'), status: t(language, `status.${student.membership_active ? 'active' : 'inactive'}`) }))}</span>
            </div>
            <div class="compact-actions" aria-label="${escapeHtml(t(language, 'students.directory.actions_for', { name: `${student.first_name} ${student.last_name}` }))}">
              ${renderActionMenu(t(language, 'students.directory.actions_for', { name: `${student.first_name} ${student.last_name}` }), `
              <a class="dropdown-item" href="/students/${student.public_id}/edit">${escapeHtml(t(language, 'classes.roster.edit_record'))}</a>
              <form method="post" action="/classes/${classRecord.public_id}/students/${student.public_id}/${student.membership_active ? 'deactivate' : 'reactivate'}">
                <button class="dropdown-item" type="submit">${escapeHtml(t(language, student.membership_active ? 'action.deactivate' : 'action.reactivate'))}</button>
              </form>
              ${classRecord.membership_locked ? '' : `<form method="post" action="/classes/${classRecord.public_id}/students/${student.public_id}/remove" data-confirm="${escapeHtml(t(language, 'classes.roster.confirm_remove', { student: getTerm(language, 'student'), class: getTerm(language, 'class') }))}">
                <button class="dropdown-item text-danger" type="submit">${escapeHtml(t(language, 'action.remove'))}</button>
              </form>`}`)}
            </div>
          </article>`).join('')}</div>
        </section>`;
    const availableStudents = !canSearch
      ? `<p class="empty-state">${escapeHtml(t(language, 'classes.roster.search_hint', { student: getTerm(language, 'student') }))}</p>`
      : availableResult.rows.length === 0
      ? `<p class="empty-state">${escapeHtml(t(language, 'classes.roster.no_available'))}</p>`
      : `<form class="card card-body app-form" method="post" action="/classes/${classRecord.public_id}/students">
          <fieldset>
            <legend>${escapeHtml(t(language, 'classes.roster.add_legend', { students: getTerm(language, 'student', 'plural') }))}</legend>
            <div class="checkbox-list">${availableResult.rows.map((student) => `
              <label class="checkbox-option">
                <input class="form-check-input" name="student_ids" type="checkbox" value="${student.public_id}">
                <span>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}<small>${escapeHtml(student.email)}</small></span>
              </label>`).join('')}</div>
          </fieldset>
          <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'classes.roster.add_selection'))}</button>
        </form>`;

    response.send(renderPage(classRecord.name, `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${escapeHtml(classRecord.name)}</h1>
          <p class="page-description class-description">${classRecord.description
            ? escapeHtml(classRecord.description)
            : `<span class="muted">${escapeHtml(t(language, 'common.no_description'))}</span>`}</p>
        </div>
        <a class="btn btn-outline-secondary" href="/classes/${classRecord.public_id}/edit">${escapeHtml(t(language, 'classes.roster.edit_record'))}</a>
      </header>
      <nav class="nav nav-pills context-tabs" aria-label="${escapeHtml(t(language, 'classes.roster.context_aria', { name: classRecord.name }))}">
        <a class="nav-link active" href="/classes/${classRecord.public_id}" aria-current="page">${businessTerm(language, 'student', 'plural')}</a>
        <a class="nav-link" href="/sessions?class_id=${classRecord.public_id}">${businessTerm(language, 'session', 'plural')}</a>
      </nav>
      ${notice}
      ${classRecord.membership_locked
        ? `<p class="alert alert-warning" role="status">${escapeHtml(t(language, 'classes.roster.history_warning', { class: getTerm(language, 'class'), memberships: getTerm(language, 'membership', 'plural'), membership: getTerm(language, 'membership'), sessions: getTerm(language, 'session', 'plural') }))}</p>`
        : ''}
      <section class="page-section">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2>${businessTerm(language, 'membership', 'plural')}</h2>
            <p class="section-description">${escapeHtml(t(language, 'classes.roster.status_help', { class: getTerm(language, 'class') }))}</p>
          </div>
          <a class="btn btn-outline-secondary" href="/students/import?class_id=${classRecord.public_id}">${escapeHtml(t(language, 'action.import'))}</a>
        </div>
        ${assignedStudents}
      </section>
      <section class="page-section">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2>${escapeHtml(t(language, 'classes.roster.add_title', { students: getTerm(language, 'student', 'plural') }))}</h2>
          </div>
        </div>
        <form class="search" method="get" action="/classes/${classRecord.public_id}" role="search">
          <label for="membership-search">${escapeHtml(t(language, 'classes.roster.search_active', { student: getTerm(language, 'student') }))}</label>
          <div class="search-controls">
            <input class="form-control" id="membership-search" name="q" type="search" value="${escapeHtml(searchQuery)}" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t(language, 'students.directory.search_placeholder'))}">
            <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'action.search'))}</button>
            ${searchQuery ? `<a class="btn btn-outline-secondary" href="/classes/${classRecord.public_id}">${escapeHtml(t(language, 'action.clear'))}</a>` : ''}
          </div>
        </form>
        ${availableStudents}
      </section>`, { language }));
  } catch (error) {
    console.error('Unable to load class memberships:', error);
    const page = renderMessagePage(t(language, 'classes.error.item_unavailable.title'), t(language, 'classes.error.item_unavailable.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/students', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage(language);
    response.status(page.status).send(page.html);
    return;
  }

  const studentIds = getStudentIds(request.body);

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const classResult = await client.query('SELECT id, public_id, name FROM classes WHERE public_id = $1 FOR UPDATE', [request.params.id]);
      if (classResult.rowCount === 0) return { status: 'not_found' };
      if (studentIds.length === 0) return { status: 'empty' };

      await client.query(
        `SELECT id
         FROM students
         WHERE public_id = ANY($1::uuid[]) AND active = TRUE AND anonymized_at IS NULL
         ORDER BY id
         FOR UPDATE`,
        [studentIds],
      );

      const result = await client.query(
        `INSERT INTO student_classes (student_id, class_id)
         SELECT s.id, $1
         FROM students s
         WHERE s.active = TRUE AND s.anonymized_at IS NULL AND s.public_id = ANY($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [classResult.rows[0].id, studentIds],
      );
      if (result.rowCount > 0) await recordAuditEvent({
        client, category: 'class', action: 'membership.add', targetType: 'class',
        targetPublicId: classResult.rows[0].public_id, targetLabel: classResult.rows[0].name,
        summary: 'Participants ajoutés à l’activité.', metadata: { counts: { memberships: result.rowCount } },
      });
      return { status: result.rowCount > 0 ? 'added' : 'empty' };
    });
    if (outcome.status === 'not_found') {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome.status === 'empty') {
      response.redirect(303, `/classes/${request.params.id}?notice=no_students_added`);
      return;
    }
    response.redirect(303, `/classes/${request.params.id}?notice=students_added`);
  } catch (error) {
    console.error('Unable to add class memberships:', error);
    const page = renderMessagePage(t(language, 'classes.error.add.title', { students: getTerm(language, 'student', 'plural') }), t(language, 'classes.error.add.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/students/:studentId/remove', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id) || !isValidPublicId(request.params.studentId)) {
    const page = renderMessagePage(t(language, 'classes.error.membership_not_found.title'), t(language, 'classes.error.membership_missing'), 404, language);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const classResult = await client.query('SELECT id, public_id, name FROM classes WHERE public_id = $1 FOR UPDATE', [request.params.id]);
      if (classResult.rowCount === 0) return { status: 'class_not_found' };
      const startedResult = await client.query(
        'SELECT 1 FROM course_sessions WHERE class_id = $1 AND started_at IS NOT NULL LIMIT 1',
        [classResult.rows[0].id],
      );
      if (startedResult.rowCount > 0) return { status: 'started' };
      const result = await client.query(
        `DELETE FROM student_classes sc
         USING students s
         WHERE sc.class_id = $1
           AND s.public_id = $2
           AND s.id = sc.student_id
           AND s.active = TRUE
         RETURNING sc.student_id`,
        [classResult.rows[0].id, request.params.studentId],
      );
      if (result.rowCount > 0) await recordAuditEvent({
        client, category: 'class', action: 'membership.remove', targetType: 'class',
        targetPublicId: classResult.rows[0].public_id, targetLabel: classResult.rows[0].name,
        summary: 'Participant retiré de l’activité.', metadata: { counts: { memberships: 1 } },
      });
      return { status: result.rowCount > 0 ? 'removed' : 'membership_not_found' };
    });
    if (outcome.status === 'class_not_found') {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome.status === 'started') {
      const page = renderMessagePage(
        t(language, 'classes.error.remove.title', { student: getTerm(language, 'student') }),
        t(language, 'classes.error.started_remove', { class: getTerm(language, 'class'), membership: getTerm(language, 'membership') }),
        409,
        language,
      );
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome.status === 'membership_not_found') {
      const page = renderMessagePage(t(language, 'classes.error.membership_not_found.title'), t(language, 'classes.error.membership_active_missing'), 404, language);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/classes/${request.params.id}?notice=student_removed`);
  } catch (error) {
    console.error('Unable to remove class membership:', error);
    const page = renderMessagePage(t(language, 'classes.error.remove.title', { student: getTerm(language, 'student') }), t(language, 'classes.error.remove.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

async function updateMembershipActivity(request, response, active) {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id) || !isValidPublicId(request.params.studentId)) {
    const page = renderMessagePage(t(language, 'classes.error.membership_not_found.title'), t(language, 'classes.error.membership_missing'), 404, language);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const classResult = await client.query('SELECT id, public_id, name FROM classes WHERE public_id = $1 FOR UPDATE', [request.params.id]);
      if (classResult.rowCount === 0) return { status: 'class_not_found' };
      const studentResult = await client.query(
        `SELECT id
         FROM students
         WHERE public_id = $1 AND active = TRUE AND anonymized_at IS NULL
         FOR UPDATE`,
        [request.params.studentId],
      );
      if (studentResult.rowCount === 0) return { status: 'membership_not_found' };
      const result = await client.query(
        `UPDATE student_classes sc
         SET active = $3
         FROM students s
         WHERE sc.class_id = $1
           AND s.public_id = $2
           AND s.id = sc.student_id
           AND s.active = TRUE
         RETURNING sc.student_id`,
        [classResult.rows[0].id, request.params.studentId, active],
      );
      if (result.rowCount > 0) await recordAuditEvent({
        client, category: 'class', action: active ? 'membership.reactivate' : 'membership.deactivate', targetType: 'class',
        targetPublicId: classResult.rows[0].public_id, targetLabel: classResult.rows[0].name,
        summary: active ? 'Inscription réactivée.' : 'Inscription désactivée.',
        beforeData: { active: !active }, afterData: { active }, metadata: { counts: { memberships: 1 } },
      });
      return { status: result.rowCount > 0 ? 'updated' : 'membership_not_found' };
    });
    if (outcome.status === 'class_not_found') {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome.status === 'membership_not_found') {
      const page = renderMessagePage(t(language, 'classes.error.membership_not_found.title'), t(language, 'classes.error.membership_not_found.message'), 404, language);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/classes/${request.params.id}?notice=${active ? 'membership_reactivated' : 'membership_deactivated'}`);
  } catch (error) {
    console.error('Unable to update class membership activity:', error);
    const page = renderMessagePage(t(language, 'classes.error.membership_update.title'), t(language, 'classes.error.membership_update.message'), 503, language);
    response.status(page.status).send(page.html);
  }
}

router.post('/:id/students/:studentId/deactivate', (request, response) => (
  updateMembershipActivity(request, response, false)
));

router.post('/:id/students/:studentId/reactivate', (request, response) => (
  updateMembershipActivity(request, response, true)
));

router.get('/:id/edit', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage(language);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, public_id, name, description, punctuality_tolerance_minutes, language,
              (logo_data IS NOT NULL) AS has_logo
       FROM classes WHERE public_id = $1`,
      [request.params.id],
    );

    if (result.rowCount === 0) {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }

    const [summaryConfiguration, adminUsers] = await Promise.all([
      loadClassSummaryConfiguration(result.rows[0].id),
      loadSummaryAdminOptions(),
    ]);
    response.send(renderClassForm({
      title: t(language, 'classes.form.edit_title', { class: getTerm(language, 'class') }),
      action: `/classes/${result.rows[0].public_id}`,
      submitLabel: t(language, 'action.save'),
      values: { ...result.rows[0], ...summaryConfiguration },
      classId: result.rows[0].public_id,
      hasLogo: result.rows[0].has_logo,
      logoNotice: typeof request.query.logo_notice === 'string' ? request.query.logo_notice : '',
      adminUsers,
      language,
    }));
  } catch (error) {
    console.error('Unable to load class:', error);
    const page = renderMessagePage(
      t(language, 'classes.error.item_unavailable.title'),
      t(language, 'classes.error.item_unavailable.message'),
      503,
      language,
    );
    response.status(page.status).send(page.html);
  }
});

router.get('/:id/logo', async (request, response) => {
  if (!isValidPublicId(request.params.id)) return response.status(404).end();
  try {
    const logo = await getClassLogo(request.params.id);
    if (!logo) return response.status(404).end();
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': logo.mimeType,
      'X-Content-Type-Options': 'nosniff',
    });
    return response.send(logo.data);
  } catch (error) {
    console.error('Unable to render activity logo:', error.code || 'DATABASE_ERROR');
    return response.status(500).end();
  }
});

router.post('/:id/logo', (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage(language);
    response.status(page.status).send(page.html);
    return;
  }
  logoUpload.single('logo')(request, response, async (uploadError) => {
    if (uploadError instanceof multer.MulterError || uploadError || !request.file) {
      response.redirect(303, `/classes/${request.params.id}/edit?logo_notice=invalid`);
      return;
    }
    try {
      const logo = await normalizeLogoUpload(request.file);
      const saved = await withTransaction(pool, async (client) => {
        const current = await getClassLogo(request.params.id, client);
        if (current === undefined) return false;
        await saveClassLogo(request.params.id, logo, client);
        const classResult = await client.query('SELECT name FROM classes WHERE public_id = $1', [request.params.id]);
        await recordAuditEvent({
          client, category: 'branding', action: current ? 'class.logo.replace' : 'class.logo.add', targetType: 'class',
          targetPublicId: request.params.id, targetLabel: classResult.rows[0].name,
          summary: current ? 'Logo de l’activité remplacé.' : 'Logo de l’activité ajouté.',
          metadata: { logo_change: current ? 'replaced' : 'added' },
        });
        return true;
      });
      if (!saved) {
        const page = renderClassNotFoundPage(language);
        response.status(page.status).send(page.html);
        return;
      }
      response.redirect(303, `/classes/${request.params.id}/edit?logo_notice=saved`);
    } catch (error) {
      if (['INVALID_LOGO', 'LOGO_TOO_LARGE'].includes(error.code)) {
        response.redirect(303, `/classes/${request.params.id}/edit?logo_notice=invalid`);
        return;
      }
      console.error('Unable to save activity logo:', error.code || 'DATABASE_ERROR');
      response.redirect(303, `/classes/${request.params.id}/edit?logo_notice=failed`);
    }
  });
});

router.post('/:id/logo/remove', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage(language);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const removed = await withTransaction(pool, async (client) => {
      const current = await getClassLogo(request.params.id, client);
      if (current === undefined) return false;
      await removeClassLogo(request.params.id, client);
      const classResult = await client.query('SELECT name FROM classes WHERE public_id = $1', [request.params.id]);
      await recordAuditEvent({
        client, category: 'branding', action: 'class.logo.remove', targetType: 'class',
        targetPublicId: request.params.id, targetLabel: classResult.rows[0].name,
        summary: 'Logo de l’activité supprimé.', metadata: { logo_change: 'removed' },
      });
      return true;
    });
    if (!removed) {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/classes/${request.params.id}/edit?logo_notice=removed`);
  } catch (error) {
    console.error('Unable to remove activity logo:', error.code || 'DATABASE_ERROR');
    response.redirect(303, `/classes/${request.params.id}/edit?logo_notice=failed`);
  }
});

router.post('/:id', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage(language);
    response.status(page.status).send(page.html);
    return;
  }

  const values = getFormValues(request.body);
  let currentLogo;
  try {
    currentLogo = await getClassLogo(request.params.id);
    if (currentLogo === undefined) {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }
  } catch (error) {
    console.error('Unable to load activity branding before update:', error.code || 'DATABASE_ERROR');
    const page = renderMessagePage(t(language, 'classes.error.item_unavailable.title'), t(language, 'classes.error.item_unavailable.message'), 503, language);
    response.status(page.status).send(page.html);
    return;
  }

  if (!values.name || values.language === undefined || !isValidTolerance(values.punctuality_tolerance_minutes) || values.summaryConfigurationError) {
    response.status(400).send(renderClassForm({
      title: t(language, 'classes.form.edit_title', { class: getTerm(language, 'class') }),
      action: `/classes/${request.params.id}`,
      submitLabel: t(language, 'action.save'),
      values,
      classId: request.params.id,
      hasLogo: Boolean(currentLogo),
      error: !values.name
        ? t(language, 'classes.error.invalid_name')
        : values.language === undefined
          ? t(language, 'classes.error.invalid_language')
        : values.summaryConfigurationError
          ? t(language, 'classes.error.invalid_summary')
          : t(language, 'classes.error.invalid_tolerance'),
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
      language,
    }));
    return;
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const current = await client.query(
        `SELECT id, public_id, name, description, punctuality_tolerance_minutes, language
         FROM classes WHERE public_id = $1 FOR UPDATE`,
        [request.params.id],
      );
      if (current.rowCount === 0) return current;
      const previousSummary = await loadClassSummaryConfiguration(current.rows[0].id, client);
      const updated = await client.query(
        `UPDATE classes
         SET name = $1, description = $2, punctuality_tolerance_minutes = $3, language = $4
         WHERE public_id = $5 RETURNING id`,
        [values.name, values.description || null, values.punctuality_tolerance_minutes, values.language, request.params.id],
      );
      await saveClassSummaryConfiguration(client, current.rows[0].id, values);
      await recordAuditEvent({
        client, category: 'class', action: 'class.update', targetType: 'class',
        targetPublicId: request.params.id, targetLabel: values.name, summary: 'Activité mise à jour.',
        beforeData: {
          name: current.rows[0].name,
          description: current.rows[0].description,
          punctuality_tolerance_minutes: current.rows[0].punctuality_tolerance_minutes,
          language: current.rows[0].language,
        },
        afterData: {
          name: values.name,
          description: values.description || null,
          punctuality_tolerance_minutes: values.punctuality_tolerance_minutes,
          language: values.language,
        },
      });
      const beforeSummary = summaryConfigurationSnapshot(previousSummary, 'class');
      const afterSummary = summaryConfigurationSnapshot(values, 'class');
      if (summaryConfigurationChanged(previousSummary, values, 'class')) {
        await recordAuditEvent({
          client, category: 'class', action: 'class.summary.configuration.update', targetType: 'class',
          targetPublicId: request.params.id, targetLabel: values.name,
          summary: 'Configuration du résumé automatique mise à jour.',
          beforeData: beforeSummary, afterData: afterSummary,
        });
      }
      return updated;
    });

    if (result.rowCount === 0) {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }

    response.redirect(303, '/classes?notice=updated');
  } catch (error) {
    if (error.code === 'SUMMARY_RECIPIENTS_INVALID') {
      response.status(400).send(renderClassForm({
        title: t(language, 'classes.form.edit_title', { class: getTerm(language, 'class') }),
        action: `/classes/${request.params.id}`, submitLabel: t(language, 'action.save'), values,
        classId: request.params.id, hasLogo: Boolean(currentLogo),
        adminUsers: await loadSummaryAdminOptions().catch(() => []),
        error: t(language, 'classes.error.invalid_summary'),
        language,
      }));
      return;
    }
    console.error('Unable to update class:', error);
    response.status(500).send(renderClassForm({
      title: t(language, 'classes.form.edit_title', { class: getTerm(language, 'class') }),
      action: `/classes/${request.params.id}`,
      submitLabel: t(language, 'action.save'),
      values,
      classId: request.params.id,
      hasLogo: Boolean(currentLogo),
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
      error: t(language, 'classes.error.update'),
      language,
    }));
  }
});

router.post('/:id/delete', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage(language);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const deleted = await client.query(
        'DELETE FROM classes WHERE public_id = $1 RETURNING public_id, name',
        [request.params.id],
      );
      if (deleted.rowCount > 0) await recordAuditEvent({
        client, category: 'class', action: 'class.delete', targetType: 'class',
        targetPublicId: deleted.rows[0].public_id, targetLabel: deleted.rows[0].name,
        summary: 'Activité supprimée.', beforeData: { name: deleted.rows[0].name },
      });
      return deleted;
    });

    if (result.rowCount === 0) {
      const page = renderClassNotFoundPage(language);
      response.status(page.status).send(page.html);
      return;
    }

    response.redirect(303, '/classes?notice=deleted');
  } catch (error) {
    if (error.code === '23503') {
      const page = renderMessagePage(
        t(language, 'classes.error.delete.title', { class: getTerm(language, 'class') }),
        t(language, 'classes.error.delete_started', { session: getTerm(language, 'session') }),
        409,
        language,
      );
      response.status(page.status).send(page.html);
      return;
    }

    console.error('Unable to delete class:', error);
    const page = renderMessagePage(
      t(language, 'classes.error.delete.title', { class: getTerm(language, 'class') }),
      t(language, 'classes.error.delete.message', { class: getTerm(language, 'class') }),
      503,
      language,
    );
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
