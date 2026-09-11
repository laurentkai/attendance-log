const express = require('express');
const { formatLocalTime, getApplicationTimezone, normalizeClockTime } = require('./application-time');
const { recordAuditEvent } = require('./audit');
const { requirePermission } = require('./auth');
const { pool, withTransaction } = require('./db/client');
const { formatDateForDisplay, formatDateForInput } = require('./date-format');
const { parseStudentQrPayload } = require('./student-qr');
const { hasPermission, permissions } = require('./permissions');
const { isValidPublicId } = require('./public-id');
const { TOLERANCE_VALUES, calculatePunctuality, isValidTolerance } = require('./punctuality');
const {
  loadSessionSummaryConfiguration,
  loadSummaryAdminOptions,
  parseSummaryRecipientInput,
  renderSummaryConfigurationFields,
  saveSessionSummaryConfiguration,
  summaryConfigurationChanged,
  summaryConfigurationSnapshot,
} = require('./session-summary-config');
const { sendSessionSummary } = require('./session-summary');
const { recordStudentActivity } = require('./student-activity');
const { getTerm } = require('./terminology');
const { businessTerm, escapeHtml, renderPage, renderMessagePage } = require('./ui');

const router = express.Router();
const requireAttendanceManagement = requirePermission(permissions.manageAttendance);
const requireSessionManagement = requirePermission(permissions.manageSessions);

function renderSessionNotFoundPage() {
  return renderMessagePage(`${getTerm('session')} introuvable`, 'L’élément demandé n’existe pas.', 404);
}

function renderSessionReadOnlyPage() {
  return renderMessagePage(
    `${getTerm('session')} en lecture seule`,
    'Réouverture requise avant modification.',
    409,
  );
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === value;
}

function timestampForAudit(value) {
  if (!value) return null;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function getFormValues(body = {}) {
  const rawStartTime = typeof body.start_time === 'string' ? body.start_time.trim() : '';
  let summaryConfiguration;
  let summaryConfigurationError = false;
  try {
    summaryConfiguration = parseSummaryRecipientInput(body, { attachmentScope: 'session' });
  } catch (_error) {
    summaryConfigurationError = true;
    const rawAdminIds = Array.isArray(body.summary_admin_user_ids)
      ? body.summary_admin_user_ids : body.summary_admin_user_ids ? [body.summary_admin_user_ids] : [];
    summaryConfiguration = {
      adminRecipientIds: rawAdminIds.filter(isValidPublicId),
      externalRecipients: [typeof body.summary_external_recipients === 'string'
        ? body.summary_external_recipients.slice(0, 12750) : ''].filter(Boolean),
      attachXlsxOverride: null,
    };
  }
  return {
    class_id: typeof body.class_id === 'string' ? body.class_id : '',
    date: typeof body.date === 'string' ? body.date.trim() : '',
    title: typeof body.title === 'string' ? body.title.trim() : '',
    instructor: typeof body.instructor === 'string' ? body.instructor.trim() : '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
    start_time: normalizeClockTime(rawStartTime),
    start_time_invalid: Boolean(rawStartTime && !normalizeClockTime(rawStartTime)),
    punctuality_tolerance_override_minutes: body.punctuality_tolerance_override_minutes === ''
      || body.punctuality_tolerance_override_minutes === undefined
      ? null
      : Number.parseInt(body.punctuality_tolerance_override_minutes, 10),
    ...summaryConfiguration,
    summaryConfigurationError,
  };
}

function validateForm(values) {
  if (!isValidPublicId(values.class_id)) {
    return `Sélectionnez une ${getTerm('class').toLocaleLowerCase('fr')}.`;
  }
  if (!isValidDate(values.date)) {
    return 'La date est obligatoire et doit être valide.';
  }
  if (!values.title) {
    return 'Le titre est obligatoire.';
  }
  if (!values.instructor) {
    return `Le nom du ${getTerm('instructor').toLocaleLowerCase('fr')} est obligatoire.`;
  }
  if (values.start_time_invalid) {
    return 'L’heure de début doit être une heure valide.';
  }
  if (values.punctuality_tolerance_override_minutes !== null
    && !isValidTolerance(values.punctuality_tolerance_override_minutes)) {
    return 'Sélectionnez une tolérance de ponctualité valide.';
  }
  if (values.summaryConfigurationError) {
    return 'Vérifiez les destinataires et le réglage Excel du résumé automatique.';
  }
  return '';
}

function renderSessionForm({ title, action, submitLabel, values, classes, adminUsers = [], error = '', edit = false }) {
  const errorMessage = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : '';
  const classField = edit
    ? `<div class="form-field">
         <p><strong>${businessTerm('class')} :</strong> ${escapeHtml(values.class_name)}</p>
         <input name="class_id" type="hidden" value="${escapeHtml(values.class_id)}">
       </div>`
    : `<div class="form-field">
         <label for="class_id">${businessTerm('class')} <span aria-hidden="true">*</span></label>
         <select class="form-select" id="class_id" name="class_id" required data-session-class>
           <option value="">Sélectionner dans la liste</option>
           ${classes.map((classRecord) => `<option value="${classRecord.public_id}" data-punctuality-tolerance="${classRecord.punctuality_tolerance_minutes}" data-summary-attach-xlsx="${classRecord.summary_attach_xlsx ? 'true' : 'false'}"${classRecord.public_id === values.class_id ? ' selected' : ''}>${escapeHtml(classRecord.name)}</option>`).join('')}
         </select>
       </div>`;
  const inheritedTolerance = Number(values.class_punctuality_tolerance_minutes)
    || classes.find((classRecord) => classRecord.public_id === values.class_id)?.punctuality_tolerance_minutes
    || 5;
  const inheritedAttachXlsx = typeof values.class_summary_attach_xlsx === 'boolean'
    ? values.class_summary_attach_xlsx
    : Boolean(classes.find((classRecord) => classRecord.public_id === values.class_id)?.summary_attach_xlsx);

  return renderPage(title, `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <h1>${escapeHtml(title)}</h1>
      </div>
    </header>
    ${errorMessage}
    <form class="card card-body app-form" method="post" action="${escapeHtml(action)}">
      ${classField}

      <div class="form-field">
        <label for="date">Date <span aria-hidden="true">*</span></label>
        <input class="form-control" id="date" name="date" type="date" value="${escapeHtml(formatDateForInput(values.date))}" required>
      </div>

      <div class="form-field">
        <label for="start-time">Heure de début</label>
        <input class="form-control" id="start-time" name="start_time" type="time" value="${escapeHtml(normalizeClockTime(values.start_time || ''))}" autocomplete="off">
        <p class="form-text mb-0">Facultative. Sans heure de début, aucune ponctualité n’est calculée.</p>
      </div>

      <div class="form-field">
        <label for="session-punctuality-tolerance">Tolérance de ponctualité</label>
        <select class="form-select" id="session-punctuality-tolerance" name="punctuality_tolerance_override_minutes" data-session-tolerance>
          <option value="" data-inherit-option>Hériter de l’activité (+${inheritedTolerance} min)</option>
          ${TOLERANCE_VALUES.map((minutes) => `<option value="${minutes}"${Number(values.punctuality_tolerance_override_minutes) === minutes ? ' selected' : ''}>+${minutes} minutes</option>`).join('')}
        </select>
      </div>

      <div class="form-field">
        <label for="title">Titre <span aria-hidden="true">*</span></label>
        <input class="form-control" id="title" name="title" type="text" value="${escapeHtml(values.title)}" autocomplete="off" required>
      </div>

      <div class="form-field">
        <label for="instructor">${businessTerm('instructor')} <span aria-hidden="true">*</span></label>
        <input class="form-control" id="instructor" name="instructor" type="text" value="${escapeHtml(values.instructor)}" autocomplete="off" required>
      </div>

      <div class="form-field">
        <label for="notes">Notes</label>
        <textarea class="form-control" id="notes" name="notes" rows="5" autocomplete="off">${escapeHtml(values.notes ?? '')}</textarea>
      </div>

      ${renderSummaryConfigurationFields({
        adminUsers, values, scope: 'session', inheritedAttachXlsx,
      })}

      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="btn btn-outline-secondary" href="/sessions">Annuler</a>
      </div>
    </form>`);
}

async function getClasses() {
  const result = await pool.query(
    `SELECT public_id, name, punctuality_tolerance_minutes, summary_attach_xlsx
     FROM classes ORDER BY LOWER(name), id`,
  );
  return result.rows;
}

async function loadRoster(session) {
  if (session.closed_at) {
    return pool.query(
      `SELECT s.id, s.public_id, s.first_name, s.last_name,
              CASE WHEN s.anonymized_at IS NULL THEN s.student_code ELSE '—' END AS student_code,
              ar.status, ar.checked_in_at
       FROM attendance_records ar
       INNER JOIN students s ON s.id = ar.student_id
       WHERE ar.session_id = $1
       ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
      [session.id],
    );
  }

  return pool.query(
    `SELECT s.id, s.public_id, s.first_name, s.last_name,
            CASE WHEN s.anonymized_at IS NULL THEN s.student_code ELSE '—' END AS student_code,
            COALESCE(ar.status, 'pending') AS status, ar.checked_in_at
     FROM student_classes sc
     INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
     LEFT JOIN attendance_records ar
       ON ar.session_id = $2 AND ar.student_id = s.id
     WHERE sc.class_id = $1 AND sc.active = TRUE
     ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
    [session.class_id, session.id],
  );
}

function decorateAttendanceStudent(student, session) {
  const punctuality = calculatePunctuality({
    status: student.status,
    checkedInAt: student.checked_in_at,
    scheduledStartAt: session.scheduled_start_at,
    toleranceMinutes: session.effective_tolerance_minutes,
  });
  return {
    ...student,
    arrival_time: student.status === 'present' ? formatLocalTime(student.checked_in_at) : '',
    punctuality,
  };
}

async function lockEligibleStudent(client, sessionId, studentId) {
  const student = await client.query(
    `SELECT id
     FROM students
     WHERE id = $1 AND anonymized_at IS NULL
     FOR UPDATE`,
    [studentId],
  );
  if (student.rowCount === 0) return student;
  return client.query(
    `SELECT cs.id
     FROM course_sessions cs
     WHERE cs.id = $1
       AND cs.state = 'open'
       AND (
         (cs.closed_at IS NULL AND EXISTS (
           SELECT 1
           FROM student_classes sc
           INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
           WHERE sc.class_id = cs.class_id AND sc.active = TRUE AND s.id = $2
         ))
         OR (cs.closed_at IS NOT NULL AND EXISTS (
           SELECT 1
           FROM attendance_records ar
           WHERE ar.session_id = cs.id AND ar.student_id = $2
         ))
       )
     FOR UPDATE`,
    [sessionId, studentId],
  );
}

async function markStudentPresent(client, sessionId, studentId) {
  const allowedResult = await lockEligibleStudent(client, sessionId, studentId);
  if (allowedResult.rowCount === 0) {
    return { allowed: false };
  }

  const currentResult = await client.query(
    `SELECT status, checked_in_at
     FROM attendance_records
     WHERE session_id = $1 AND student_id = $2
     FOR UPDATE`,
    [sessionId, studentId],
  );
  const previousStatus = currentResult.rows[0]?.status || 'pending';
  const previousCheckedInAt = currentResult.rows[0]?.checked_in_at || null;
  if (previousStatus === 'present') {
    return {
      allowed: true,
      changed: false,
      status: 'present',
      studentId: String(studentId),
    };
  }

  const updateResult = await client.query(
    `INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
     VALUES ($1, $2, 'present', CURRENT_TIMESTAMP)
     ON CONFLICT (session_id, student_id)
     DO UPDATE SET status = 'present', checked_in_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING checked_in_at,
               ROUND(EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint::text AS version`,
    [sessionId, studentId],
  );
  await recordStudentActivity(client, studentId, updateResult.rows[0].checked_in_at);

  return {
    allowed: true,
    changed: true,
    status: 'present',
    studentId: String(studentId),
    previousStatus,
    previousCheckedInAt,
    checkedInAt: updateResult.rows[0].checked_in_at,
    version: updateResult.rows[0].version,
  };
}

function getStateLabel(state) {
  return {
    scheduled: 'État : planifié',
    open: 'État : ouvert',
    closed: 'État : clôturé',
  }[state];
}

router.param('id', async (request, _response, next, value) => {
  request.courseSessionId = null;
  if (!isValidPublicId(value)) return next();
  try {
    const result = await pool.query('SELECT id FROM course_sessions WHERE public_id = $1', [value]);
    request.courseSessionId = result.rows[0]?.id || null;
    return next();
  } catch (error) {
    return next(error);
  }
});

router.param('studentId', async (request, _response, next, value) => {
  request.studentId = null;
  if (!isValidPublicId(value)) return next();
  try {
    const result = await pool.query('SELECT id FROM students WHERE public_id = $1', [value]);
    request.studentId = result.rows[0]?.id || null;
    return next();
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (request, response) => {
  const searchQuery = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : '';
  const searchPattern = `%${searchQuery}%`;
  const classId = isValidPublicId(request.query.class_id || '') ? request.query.class_id : '';

  try {
    const [result, classResult] = await Promise.all([
      pool.query(
        `SELECT cs.public_id, cs.date, cs.start_time, cs.title, cs.instructor, cs.state,
                c.name AS class_name
         FROM course_sessions cs
         INNER JOIN classes c ON c.id = cs.class_id
         WHERE ($1::uuid IS NULL OR c.public_id = $1)
           AND ($2 = ''
            OR cs.title ILIKE $3
            OR c.name ILIKE $3
            OR cs.instructor ILIKE $3)
         ORDER BY cs.date DESC, LOWER(cs.title), cs.id DESC`,
        [classId || null, searchQuery, searchPattern],
      ),
      classId
        ? pool.query('SELECT public_id, name FROM classes WHERE public_id = $1', [classId])
        : Promise.resolve({ rows: [] }),
    ]);
    const classRecord = classResult.rows[0];
    if (classId && !classRecord) {
      const page = renderMessagePage(`${getTerm('class')} introuvable`, 'L’élément demandé n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    const notices = {
      created: 'La session a été créée.',
      updated: 'La session a été mise à jour.',
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-success" role="status">${escapeHtml(notices[request.query.notice])}</p>`
      : '';
    const canManageSessions = hasPermission(request.currentUser, permissions.manageSessions);
    const sessions = result.rows.length === 0
      ? `<p class="empty-state">${searchQuery
        ? 'Aucune session ne correspond à la recherche.'
        : 'Aucune session n’est enregistrée pour le moment.'}</p>`
      : `<div class="list-group compact-list">${result.rows.map((session) => `
          <article class="list-group-item compact-row compact-row-status session-row"${session.state === 'open' ? ` data-live-session-card data-session-id="${session.public_id}"` : ''}>
            <div class="compact-identity session-identity">
              <p class="compact-meta session-date">${escapeHtml(formatDateForDisplay(session.date))}${session.start_time ? ` · ${escapeHtml(normalizeClockTime(session.start_time))}` : ''}</p>
              <p class="compact-title">${escapeHtml(session.title)}</p>
              <p class="compact-meta">${escapeHtml(session.class_name)} · ${escapeHtml(session.instructor)}</p>
            </div>
            <div class="compact-status">
              <span class="badge status-badge status-${session.state}" data-session-state>${getStateLabel(session.state)}</span>
            </div>
            <div class="compact-actions compact-actions--split" aria-label="Actions disponibles pour « ${escapeHtml(session.title)} »">
              <a class="btn btn-primary" href="/sessions/${session.public_id}">${session.state === 'scheduled' ? `Voir la ${businessTerm('session').toLocaleLowerCase('fr')}` : businessTerm('attendance', 'plural')}</a>
              ${canManageSessions ? `<span class="session-edit-slot">
                <a class="btn btn-light" href="/sessions/${session.public_id}/edit" data-session-edit${session.state === 'closed' ? ' hidden' : ''}>Modifier</a>
                <button class="btn btn-light button-unavailable" type="button" data-session-edit-disabled disabled${session.state === 'closed' ? '' : ' hidden'}>Modifier</button>
              </span>` : ''}
            </div>
          </article>`).join('')}</div>`;

    response.send(renderPage(getTerm('session', 'plural'), `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${businessTerm('session', 'plural')}</h1>
          <p class="page-description">${classRecord ? escapeHtml(classRecord.name) : canManageSessions ? `Planifiez et gérez les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.` : `Accédez aux ${businessTerm('session', 'plural').toLocaleLowerCase('fr')} et gérez les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.`}</p>
        </div>
        ${canManageSessions ? `<a class="btn btn-primary" href="/sessions/new${classRecord ? `?class_id=${classRecord.public_id}` : ''}">Ajouter</a>` : ''}
      </header>
      ${classRecord && canManageSessions ? `<nav class="nav nav-pills context-tabs" aria-label="Gestion de « ${escapeHtml(classRecord.name)} »">
        <a class="nav-link" href="/classes/${classRecord.public_id}">${businessTerm('student', 'plural')}</a>
        <a class="nav-link active" href="/sessions?class_id=${classRecord.public_id}" aria-current="page">${businessTerm('session', 'plural')}</a>
      </nav>` : ''}
      <form class="search" method="get" action="/sessions" role="search">
        <label for="session-search">Rechercher une ${businessTerm('session').toLocaleLowerCase('fr')}</label>
        ${classId ? `<input name="class_id" type="hidden" value="${classId}">` : ''}
        <div class="search-controls">
          <input class="form-control" id="session-search" name="q" type="search" value="${escapeHtml(searchQuery)}" autocomplete="off" spellcheck="false" placeholder="Titre, ${businessTerm('class').toLocaleLowerCase('fr')} ou ${businessTerm('instructor').toLocaleLowerCase('fr')}…">
          <button class="btn btn-primary" type="submit">Rechercher</button>
          ${searchQuery ? `<a class="btn btn-outline-secondary" href="/sessions${classId ? `?class_id=${classId}` : ''}">Effacer</a>` : ''}
        </div>
      </form>
      ${notice}
      ${sessions}`));
  } catch (error) {
    console.error('Unable to list course sessions:', error);
    const page = renderMessagePage(`${getTerm('session', 'plural')} indisponibles`, 'Impossible de charger la liste pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/new', requireSessionManagement, async (request, response) => {
  try {
    const [classes, adminUsers] = await Promise.all([getClasses(), loadSummaryAdminOptions()]);
    response.send(renderSessionForm({
      title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
      action: '/sessions',
      submitLabel: 'Créer',
      values: {
        class_id: isValidPublicId(request.query.class_id || '') ? request.query.class_id : '',
        date: '',
        title: '',
        instructor: '',
        notes: '',
        start_time: '',
        punctuality_tolerance_override_minutes: null,
        adminRecipientIds: [],
        externalRecipients: [],
        attachXlsxOverride: null,
      },
      classes,
      adminUsers,
    }));
  } catch (error) {
    console.error('Unable to load the course session form:', error);
    const page = renderMessagePage('Formulaire indisponible', 'Impossible de charger le formulaire pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/', requireSessionManagement, async (request, response) => {
  const values = getFormValues(request.body);
  const validationError = validateForm(values);

  if (validationError) {
    try {
      const [classes, adminUsers] = await Promise.all([getClasses(), loadSummaryAdminOptions()]);
      response.status(400).send(renderSessionForm({
        title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
        action: '/sessions',
        submitLabel: 'Créer',
        values,
        classes,
        adminUsers,
        error: validationError,
      }));
    } catch (error) {
      console.error('Unable to reload the course session form:', error);
      const page = renderMessagePage('Formulaire indisponible', 'Impossible de charger le formulaire pour le moment.');
      response.status(page.status).send(page.html);
    }
    return;
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO course_sessions
           (class_id, date, title, instructor, notes, start_time,
            punctuality_tolerance_override_minutes)
         SELECT c.id, $2, $3, $4, $5, $6, $7
         FROM classes c WHERE c.public_id = $1
         RETURNING id, public_id`,
        [
          values.class_id,
          values.date,
          values.title,
          values.instructor,
          values.notes || null,
          values.start_time || null,
          values.punctuality_tolerance_override_minutes,
        ],
      );
      if (inserted.rowCount > 0) {
        await saveSessionSummaryConfiguration(client, inserted.rows[0].id, values);
      }
      if (inserted.rowCount > 0) await recordAuditEvent({
        client, category: 'session', action: 'session.create', targetType: 'session',
        targetPublicId: inserted.rows[0].public_id, targetLabel: values.title,
        summary: 'Session créée.', afterData: {
          date: values.date,
          title: values.title,
          instructor: values.instructor,
          notes: values.notes || null,
          state: 'scheduled',
          start_time: values.start_time || null,
          punctuality_tolerance_override_minutes: values.punctuality_tolerance_override_minutes,
          ...summaryConfigurationSnapshot(values, 'session'),
        },
      });
      return inserted;
    });
    if (result.rowCount === 0) {
      const [classes, adminUsers] = await Promise.all([getClasses(), loadSummaryAdminOptions()]);
      response.status(400).send(renderSessionForm({
        title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
        action: '/sessions',
        submitLabel: 'Créer',
        values,
        classes,
        adminUsers,
        error: 'La sélection ne correspond à aucune activité.',
      }));
      return;
    }
    response.redirect(303, `/sessions/${result.rows[0].public_id}?notice=created`);
  } catch (error) {
    if (error.code === 'SUMMARY_RECIPIENTS_INVALID') {
      const [classes, adminUsers] = await Promise.all([
        getClasses().catch(() => []), loadSummaryAdminOptions().catch(() => []),
      ]);
      response.status(400).send(renderSessionForm({
        title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
        action: '/sessions', submitLabel: 'Créer', values, classes, adminUsers,
        error: 'Vérifiez les destinataires du résumé automatique.',
      }));
      return;
    }
    console.error('Unable to create course session:', error);
    const [classes, adminUsers] = await Promise.all([
      getClasses().catch(() => []),
      loadSummaryAdminOptions().catch(() => []),
    ]);
    response.status(500).send(renderSessionForm({
      title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
      action: '/sessions',
      submitLabel: 'Créer',
      values,
      classes,
      adminUsers,
      error: `Impossible de créer la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`,
    }));
  }
});

router.get('/:id/edit', requireSessionManagement, async (request, response) => {
  if (!request.courseSessionId) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT cs.id, cs.public_id, c.public_id AS class_id, cs.date, cs.title, cs.instructor,
              cs.notes, cs.state, cs.start_time, cs.punctuality_tolerance_override_minutes,
              c.name AS class_name,
              c.punctuality_tolerance_minutes AS class_punctuality_tolerance_minutes,
              c.summary_attach_xlsx AS class_summary_attach_xlsx
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.courseSessionId],
    );
    if (result.rowCount === 0) {
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    if (result.rows[0].state === 'closed') {
      const page = renderSessionReadOnlyPage();
      response.status(page.status).send(page.html);
      return;
    }

    const [summaryConfiguration, adminUsers] = await Promise.all([
      loadSessionSummaryConfiguration(result.rows[0].id),
      loadSummaryAdminOptions(),
    ]);
    response.send(renderSessionForm({
      title: `Modifier la ${getTerm('session').toLocaleLowerCase('fr')}`,
      action: `/sessions/${result.rows[0].public_id}`,
      submitLabel: 'Enregistrer',
      values: { ...result.rows[0], ...summaryConfiguration },
      classes: [],
      adminUsers,
      edit: true,
    }));
  } catch (error) {
    console.error('Unable to load course session:', error);
    const page = renderMessagePage(`${getTerm('session')} indisponible`, 'Impossible de charger l’élément demandé pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', requireSessionManagement, async (request, response) => {
  if (!request.courseSessionId) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const stateResult = await pool.query('SELECT state FROM course_sessions WHERE id = $1', [request.courseSessionId]);
    if (stateResult.rowCount === 0) {
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    if (stateResult.rows[0].state === 'closed') {
      const page = renderSessionReadOnlyPage();
      response.status(page.status).send(page.html);
      return;
    }
  } catch (error) {
    console.error('Unable to verify course session state:', error);
    const page = renderMessagePage('Modification impossible', `Impossible de vérifier la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
    return;
  }

  const values = getFormValues(request.body);
  const validationError = validateForm(values);
  if (validationError) {
    const classResult = await pool.query(
      `SELECT name, punctuality_tolerance_minutes, summary_attach_xlsx
       FROM classes WHERE public_id = $1`,
      [values.class_id],
    ).catch(() => ({ rows: [] }));
    response.status(400).send(renderSessionForm({
      title: `Modifier la ${getTerm('session').toLocaleLowerCase('fr')}`,
      action: `/sessions/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values: {
        ...values,
        class_name: classResult.rows[0]?.name || '',
        class_punctuality_tolerance_minutes: classResult.rows[0]?.punctuality_tolerance_minutes || 5,
        class_summary_attach_xlsx: classResult.rows[0]?.summary_attach_xlsx || false,
      },
      classes: [],
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
      error: validationError,
      edit: true,
    }));
    return;
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const current = await client.query(
        `SELECT id, public_id, date, title, instructor, notes, state, start_time,
                punctuality_tolerance_override_minutes
         FROM course_sessions WHERE id = $1 FOR UPDATE`,
        [request.courseSessionId],
      );
      if (current.rowCount === 0) return current;
      const previousSummary = await loadSessionSummaryConfiguration(current.rows[0].id, client);
      const updated = await client.query(
        `UPDATE course_sessions
         SET date = $1, title = $2, instructor = $3, notes = $4, start_time = $5,
             punctuality_tolerance_override_minutes = $6
         WHERE id = $7 AND class_id = (SELECT id FROM classes WHERE public_id = $8)
           AND state IN ('scheduled', 'open')
         RETURNING id`,
        [
          values.date,
          values.title,
          values.instructor,
          values.notes || null,
          values.start_time || null,
          values.punctuality_tolerance_override_minutes,
          request.courseSessionId,
          values.class_id,
        ],
      );
      if (updated.rowCount > 0) {
        await saveSessionSummaryConfiguration(client, current.rows[0].id, values);
        await recordAuditEvent({
          client, category: 'session', action: 'session.update', targetType: 'session',
          targetPublicId: current.rows[0].public_id, targetLabel: values.title, summary: 'Session mise à jour.',
          beforeData: {
            date: current.rows[0].date,
            title: current.rows[0].title,
            instructor: current.rows[0].instructor,
            notes: current.rows[0].notes,
            start_time: normalizeClockTime(current.rows[0].start_time || '') || null,
            punctuality_tolerance_override_minutes: current.rows[0].punctuality_tolerance_override_minutes,
          },
          afterData: {
            date: values.date,
            title: values.title,
            instructor: values.instructor,
            notes: values.notes || null,
            start_time: values.start_time || null,
            punctuality_tolerance_override_minutes: values.punctuality_tolerance_override_minutes,
          },
        });
        const beforeSummary = summaryConfigurationSnapshot(previousSummary, 'session');
        const afterSummary = summaryConfigurationSnapshot(values, 'session');
        if (summaryConfigurationChanged(previousSummary, values, 'session')) {
          await recordAuditEvent({
            client, category: 'session', action: 'session.summary.configuration.update', targetType: 'session',
            targetPublicId: current.rows[0].public_id, targetLabel: values.title,
            summary: 'Configuration du résumé automatique mise à jour.',
            beforeData: beforeSummary, afterData: afterSummary,
          });
        }
      }
      return updated;
    });
    if (result.rowCount === 0) {
      const sessionResult = await pool.query('SELECT state FROM course_sessions WHERE id = $1', [request.courseSessionId]);
      const page = sessionResult.rows[0]?.state === 'closed'
        ? renderSessionReadOnlyPage()
        : renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/sessions/${request.params.id}?notice=updated`);
  } catch (error) {
    if (error.code === 'SUMMARY_RECIPIENTS_INVALID') {
      const classResult = await pool.query(
        `SELECT name, punctuality_tolerance_minutes, summary_attach_xlsx
         FROM classes WHERE public_id = $1`,
        [values.class_id],
      ).catch(() => ({ rows: [] }));
      response.status(400).send(renderSessionForm({
        title: `Modifier la ${getTerm('session').toLocaleLowerCase('fr')}`,
        action: `/sessions/${request.params.id}`, submitLabel: 'Enregistrer',
        values: {
          ...values,
          class_name: classResult.rows[0]?.name || '',
          class_punctuality_tolerance_minutes: classResult.rows[0]?.punctuality_tolerance_minutes || 5,
          class_summary_attach_xlsx: classResult.rows[0]?.summary_attach_xlsx || false,
        },
        classes: [], adminUsers: await loadSummaryAdminOptions().catch(() => []),
        error: 'Vérifiez les destinataires du résumé automatique.', edit: true,
      }));
      return;
    }
    console.error('Unable to update course session:', error);
    const page = renderMessagePage('Modification impossible', `Impossible de modifier la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
  }
});

router.get('/:id/status', async (request, response) => {
  if (!request.courseSessionId) {
    response.status(404).json({ error: `${getTerm('session')} introuvable.` });
    return;
  }

  try {
    const sessionResult = await pool.query(
      `SELECT cs.id, cs.public_id, cs.class_id, cs.state, cs.closed_at, cs.start_time,
              COALESCE(cs.punctuality_tolerance_override_minutes,
                       c.punctuality_tolerance_minutes) AS effective_tolerance_minutes,
              CASE WHEN cs.start_time IS NULL THEN NULL
                   ELSE (cs.date + cs.start_time) AT TIME ZONE $2 END AS scheduled_start_at
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.courseSessionId, getApplicationTimezone()],
    );
    if (sessionResult.rowCount === 0) {
      response.status(404).json({ error: `${getTerm('session')} introuvable.` });
      return;
    }
    const session = sessionResult.rows[0];
    const rosterResult = await loadRoster(session);
    const roster = rosterResult.rows.map((student) => decorateAttendanceStudent(student, session));
    response.set('Cache-Control', 'no-store');
    response.json({
      publicId: session.public_id,
      state: session.state,
      present: roster.filter((student) => student.status === 'present').length,
      total: rosterResult.rowCount,
      roster: roster.map((student) => ({
        studentId: student.public_id,
        status: student.status,
        arrivalTime: student.arrival_time || null,
        arrivalLabel: student.status === 'present'
          ? student.arrival_time || 'Heure inconnue'
          : '—',
        punctualityLabel: student.punctuality.label,
        punctualityStatus: student.punctuality.status,
      })),
    });
  } catch (error) {
    console.error('Unable to load live course session status:', error);
    response.status(500).json({ error: 'Impossible de charger l’état demandé.' });
  }
});

router.get('/:id/quick-attendance', async (request, response) => {
  if (!request.courseSessionId) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const sessionResult = await pool.query(
      `SELECT cs.id, cs.public_id, cs.class_id, cs.date, cs.title, cs.state, cs.closed_at,
              c.name AS class_name
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.courseSessionId],
    );
    if (sessionResult.rowCount === 0) {
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    const session = sessionResult.rows[0];
    const rosterResult = await loadRoster(session);
    const presentCount = rosterResult.rows.filter((student) => student.status === 'present').length;
    if (session.state !== 'open') {
      response.status(409).send(renderPage(`Mode rapide des ${getTerm('attendance', 'plural').toLocaleLowerCase('fr')}`, `
        <div class="quick-attendance quick-attendance--unavailable">
          <h1 class="visually-hidden">Mode rapide des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}</h1>
          <header class="quick-topbar">
            <strong class="quick-attendance-count">${presentCount} / ${rosterResult.rowCount} ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}</strong>
            <a class="quick-close" href="/sessions/${session.public_id}" aria-label="Fermer le mode rapide" data-quick-close><span aria-hidden="true">×</span></a>
          </header>
          <p class="alert alert-warning">${session.state === 'closed'
            ? `La ${businessTerm('session').toLocaleLowerCase('fr')} est clôturée. Réouvrez-la avant de reprendre les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.`
            : `Ouvrez la ${businessTerm('session').toLocaleLowerCase('fr')} avant de prendre les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.`}</p>
        </div>`, { navigation: false, pageClass: 'page--quick-attendance' }));
      return;
    }

    const eligibleStudents = rosterResult.rows.filter((student) => student.status !== 'present');
    const studentRows = eligibleStudents.map((student) => `
      <article class="list-group-item compact-row student-row quick-attendance-row" data-quick-student data-student-id="${student.public_id}" data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.student_code}`.toLocaleLowerCase('fr'))}">
        <div class="compact-identity student-identity">
          <p class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</p>
          <p class="compact-meta"><span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>
        </div>
        <div class="compact-actions">
          <form method="post" action="/sessions/${session.public_id}/quick-attendance/${student.public_id}" data-quick-present-form>
            <button class="btn btn-primary" type="submit">Présent</button>
          </form>
        </div>
      </article>`).join('');

    response.send(renderPage(`Mode rapide des ${getTerm('attendance', 'plural').toLocaleLowerCase('fr')}`, `
      <div class="quick-attendance" data-quick-attendance data-session-id="${session.public_id}">
        <h1 class="visually-hidden">Mode rapide des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}</h1>
        <header class="quick-topbar">
          <strong class="quick-attendance-count" aria-label="Nombre de ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}"><span data-present-count>${presentCount}</span> / <span data-total-count>${rosterResult.rowCount}</span> ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}</strong>
          <div class="quick-topbar-actions">
            <button class="btn btn-light quick-undo" type="button" data-quick-undo disabled>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <path d="m9 7-4 4 4 4"/>
                <path d="M5 11h7a5 5 0 0 1 5 5v1"/>
              </svg>
              <span>Annuler</span>
            </button>
            <a class="quick-close" href="/sessions/${session.public_id}" aria-label="Fermer le mode rapide"><span aria-hidden="true">×</span></a>
          </div>
        </header>
        <p class="alert alert-warning" data-quick-readonly hidden>La ${businessTerm('session').toLocaleLowerCase('fr')} est clôturée. Le mode rapide est indisponible.</p>
        <div class="nav nav-pills view-switch quick-mode-switch" role="group" aria-label="Mode de saisie">
          <button class="nav-link active" type="button" aria-pressed="true" aria-controls="quick-manual-mode" data-quick-mode="manual">Recherche</button>
          <button class="nav-link" type="button" aria-pressed="false" aria-controls="quick-qr-mode" data-quick-mode="qr">QR</button>
        </div>
        <section id="quick-manual-mode" class="quick-mode-panel" aria-label="Saisie manuelle" data-quick-mode-panel="manual">
          <div class="search quick-search">
            <label class="visually-hidden" for="quick-attendance-search">Rechercher dans les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')}</label>
            <div class="search-input-action">
              <input class="form-control" id="quick-attendance-search" name="quick_attendance_filter" type="search" placeholder="Nom ou code…" autocomplete="off" autocapitalize="none" enterkeyhint="search" spellcheck="false" aria-controls="quick-attendance-results" data-quick-search>
              <button class="search-clear" type="button" aria-label="Effacer la recherche" data-quick-search-clear hidden><span aria-hidden="true">×</span></button>
            </div>
          </div>
          <span data-quick-feedback-anchor="manual"></span>
          <p class="quick-operational-feedback" role="status" aria-live="polite" aria-atomic="true" data-quick-feedback>&nbsp;</p>
          <div class="quick-results-state" aria-live="polite">
            <p class="quick-attendance-state" data-quick-no-results hidden>Aucun résultat.</p>
            <p class="quick-attendance-state" data-quick-complete${eligibleStudents.length > 0 ? ' hidden' : ''}>Toutes les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')} ont été enregistrées.</p>
          </div>
          <div class="list-group compact-list" id="quick-attendance-results" data-quick-results${eligibleStudents.length === 0 ? ' hidden' : ''}>${studentRows}</div>
        </section>
        <section id="quick-qr-mode" class="quick-mode-panel qr-scanner-panel" aria-label="Scanner un QR" data-quick-mode-panel="qr" data-qr-scanner hidden>
          <div class="qr-video-frame is-inactive" data-qr-view>
            <video data-qr-video muted playsinline aria-label="Aperçu de la caméra pour scanner un QR"></video>
            <span class="qr-scan-guide" aria-hidden="true" data-qr-guide hidden></span>
            <p class="qr-camera-placeholder" data-qr-placeholder>Activation de la caméra…</p>
            <button class="qr-camera-switch" type="button" aria-label="Changer de caméra" data-qr-camera-switch hidden>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <path d="M20 7V3l-2 2a8 8 0 0 0-12.7 2"/>
                <path d="M4 17v4l2-2a8 8 0 0 0 12.7-2"/>
                <rect x="7" y="8" width="10" height="8" rx="2"/>
                <circle cx="12" cy="12" r="2"/>
              </svg>
            </button>
            <span class="qr-scan-result" aria-hidden="true" data-qr-scan-result>
              <svg class="qr-scan-result-icon qr-scan-result-icon--success" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m5 12.5 4.2 4.2L19 7"/>
              </svg>
              <svg class="qr-scan-result-icon qr-scan-result-icon--failure" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m7 7 10 10M17 7 7 17"/>
              </svg>
            </span>
          </div>
          <span data-quick-feedback-anchor="qr"></span>
          <div class="compact-actions qr-scanner-actions">
            <button class="btn btn-outline-secondary" type="button" data-qr-start hidden>Réessayer la caméra</button>
            <button class="btn btn-light" type="button" aria-pressed="true" data-qr-sound>Son activé</button>
          </div>
        </section>
      </div>`, { navigation: false, pageClass: 'page--quick-attendance' }));
  } catch (error) {
    console.error('Unable to load quick attendance:', error);
    const page = renderMessagePage('Mode rapide indisponible', 'Impossible de charger le mode rapide pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/:id', async (request, response) => {
  if (!request.courseSessionId) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const sessionResult = await pool.query(
      `SELECT cs.id, cs.public_id, cs.class_id, cs.date, cs.title, cs.instructor, cs.notes, cs.state,
              cs.closed_at, cs.start_time, cs.punctuality_tolerance_override_minutes,
              c.name AS class_name,
              COALESCE(cs.punctuality_tolerance_override_minutes,
                       c.punctuality_tolerance_minutes) AS effective_tolerance_minutes,
              CASE WHEN cs.start_time IS NULL THEN NULL
                   ELSE (cs.date + cs.start_time) AT TIME ZONE $2 END AS scheduled_start_at
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.courseSessionId, getApplicationTimezone()],
    );
    if (sessionResult.rowCount === 0) {
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    const session = sessionResult.rows[0];
    const studentsResult = await loadRoster(session);
    studentsResult.rows = studentsResult.rows.map((student) => decorateAttendanceStudent(student, session));
    const canManageSessions = hasPermission(request.currentUser, permissions.manageSessions);

    const presentCount = studentsResult.rows.filter((student) => student.status === 'present').length;
    const notices = {
      created: ['success', `La ${getTerm('session').toLocaleLowerCase('fr')} a été créée.`],
      updated: ['success', `La ${getTerm('session').toLocaleLowerCase('fr')} a été mise à jour.`],
      attendance_updated: ['success', `La ${getTerm('attendance').toLocaleLowerCase('fr')} a été mise à jour.`],
      arrival_updated: ['success', 'L’heure d’arrivée a été mise à jour.'],
      closed: ['success', `La ${getTerm('session').toLocaleLowerCase('fr')} a été clôturée.`],
      closed_summary_sent: ['success', `La ${getTerm('session').toLocaleLowerCase('fr')} a été clôturée et le résumé a été envoyé.`],
      closed_summary_failed: ['warning', `La ${getTerm('session').toLocaleLowerCase('fr')} est clôturée, mais le résumé n’a pas pu être envoyé.`],
      summary_resent: ['success', 'Le résumé des présences a été renvoyé.'],
      summary_failed: ['warning', 'Le résumé des présences n’a pas pu être envoyé. Vérifiez la configuration e-mail.'],
      summary_no_recipients: ['warning', 'Aucun destinataire actif n’est configuré pour ce résumé.'],
      opened: ['success', `La ${getTerm('session').toLocaleLowerCase('fr')} est ouverte.`],
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-${notices[request.query.notice][0]}" role="${notices[request.query.notice][0] === 'success' ? 'status' : 'alert'}">${escapeHtml(notices[request.query.notice][1])}</p>`
      : '';
    const studentList = studentsResult.rows.length === 0
      ? `<p class="empty-state">${session.state === 'closed'
        ? `Aucun ${businessTerm('student').toLocaleLowerCase('fr')} n’est enregistré pour cette ${businessTerm('session').toLocaleLowerCase('fr')}.`
        : session.state === 'open'
        ? `Aucun ${businessTerm('student').toLocaleLowerCase('fr')} actif n’est disponible dans cette ${businessTerm('class').toLocaleLowerCase('fr')}.`
        : `Aucun ${businessTerm('student').toLocaleLowerCase('fr')} actif n’est disponible dans cette ${businessTerm('class').toLocaleLowerCase('fr')}. La ${businessTerm('session').toLocaleLowerCase('fr')} n’a pas encore commencé.`}</p>`
      : `<div class="attendance-roster-header" aria-hidden="true">
          <span>${businessTerm('student')}</span><span>${businessTerm('attendance')}</span><span>Arrivée</span><span>Ponctualité</span><span></span>
        </div>
        <div class="list-group compact-list attendance-roster" id="attendance-roster" data-attendance-roster>${studentsResult.rows.map((student) => `
          <article class="list-group-item compact-row compact-row-status student-row" data-student-id="${student.public_id}" data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.student_code}`.toLocaleLowerCase('fr'))}">
            <div class="compact-identity student-identity">
              <p class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</p>
              <p class="compact-meta"><span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>
            </div>
            <div class="compact-status">
              <span class="badge status-badge status-${student.status}" data-attendance-status>${{
                pending: 'En attente',
                present: 'Présent',
                absent: 'Absent',
              }[student.status]}</span>
            </div>
            <div class="attendance-arrival">
              <span class="attendance-field-label">Arrivée</span>
              <span class="attendance-arrival-value" data-attendance-arrival>${student.status === 'present'
                ? escapeHtml(student.arrival_time || 'Heure inconnue')
                : '—'}</span>
              ${canManageSessions ? `<button class="btn btn-link btn-sm attendance-time-edit" type="button"
                data-attendance-time-edit
                data-student-name="${escapeHtml(`${student.first_name} ${student.last_name}`)}"
                data-current-time="${escapeHtml(student.arrival_time)}"
                data-action="/sessions/${session.public_id}/attendance/${student.public_id}/check-in-time"
                data-bs-toggle="modal" data-bs-target="#arrival-time-modal"
                ${session.state === 'open' && student.status === 'present' ? '' : 'hidden'}>Modifier l’heure</button>` : ''}
            </div>
            <div class="attendance-punctuality">
              <span class="attendance-field-label">Ponctualité</span>
              <span class="attendance-punctuality-value${student.punctuality.status ? ` punctuality-${student.punctuality.status}` : ''}" data-attendance-punctuality>${escapeHtml(student.punctuality.label)}</span>
            </div>
            <div class="compact-actions compact-actions--attendance" data-attendance-actions${session.state === 'open' ? '' : ' hidden'}>
              ${session.state === 'open' ? `<form class="compact-actions compact-actions--split" method="post" action="/sessions/${session.public_id}/attendance/${student.public_id}" data-attendance-form>
                <button class="btn btn-primary" name="status" type="submit" value="present">Présent</button>
                <button class="btn btn-outline-danger" name="status" type="submit" value="absent">Absent</button>
              </form>` : ''}
            </div>
          </article>`).join('')}</div>
        <div class="modal fade" id="arrival-time-modal" tabindex="-1" aria-labelledby="arrival-time-modal-title" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <form method="post" data-arrival-time-form>
                <div class="modal-header">
                  <h2 class="modal-title fs-5" id="arrival-time-modal-title">Modifier l’heure d’arrivée</h2>
                  <button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Fermer"></button>
                </div>
                <div class="modal-body">
                  <p class="compact-meta mb-3" data-arrival-time-student></p>
                  <div class="form-field">
                    <label for="arrival-time">Heure d’arrivée</label>
                    <input class="form-control" id="arrival-time" name="checked_in_time" type="time" required data-arrival-time-input>
                    <p class="form-text mb-0">La date reste celle de la session.</p>
                  </div>
                </div>
                <div class="modal-footer">
                  <button class="btn btn-light" type="button" data-bs-dismiss="modal">Annuler</button>
                  <button class="btn btn-primary" type="submit">Enregistrer</button>
                </div>
              </form>
            </div>
          </div>
        </div>`;

    response.send(renderPage(session.title, `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <p class="eyebrow">${escapeHtml(session.class_name)}</p>
          <h1>${escapeHtml(session.title)}</h1>
          <p class="page-description">${escapeHtml(formatDateForDisplay(session.date))}${session.start_time ? ` · ${escapeHtml(normalizeClockTime(session.start_time))}` : ''} · ${escapeHtml(session.instructor)}</p>
          ${session.start_time ? `<p class="compact-meta">Tolérance : +${session.effective_tolerance_minutes} min${session.punctuality_tolerance_override_minutes === null ? ' (activité)' : ''}</p>` : ''}
          ${session.notes ? `<p class="page-description session-notes">${escapeHtml(session.notes)}</p>` : ''}
        </div>
        <div class="context-actions d-flex flex-wrap gap-2">
          <a class="btn btn-primary" href="/sessions/${session.public_id}/quick-attendance" data-quick-attendance-link${session.state === 'open' ? '' : ' hidden'}>Mode rapide</a>
          ${canManageSessions ? `<form method="post" action="/sessions/${session.public_id}/open" data-session-open${session.state === 'open' ? ' hidden' : ''}><button class="btn btn-primary" type="submit">${session.state === 'scheduled' ? 'Ouvrir' : 'Réouvrir'}</button></form>
          <a class="btn btn-outline-secondary" href="/sessions/${session.public_id}/edit" data-session-edit${session.state === 'closed' ? ' hidden' : ''}>Modifier</a>
          <form method="post" action="/sessions/${session.public_id}/resend-summary"${session.state === 'closed' ? '' : ' hidden'}><button class="btn btn-outline-secondary" type="submit">Renvoyer le résumé</button></form>
          <form method="post" action="/sessions/${session.public_id}/close" data-session-close data-confirm="Clôturer la ${businessTerm('session').toLocaleLowerCase('fr')} ? Les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')} en attente seront marqués absents."${session.state === 'open' ? '' : ' hidden'}><button class="btn btn-danger" type="submit">Clôturer</button></form>` : ''}
        </div>
      </header>
      ${notice}
      ${session.state === 'closed' ? `<p class="alert alert-warning">La ${businessTerm('session').toLocaleLowerCase('fr')} est clôturée et en lecture seule. ${canManageSessions ? `Réouvrez-la pour modifier ses informations ou les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.` : 'Réouverture par un gestionnaire requise avant toute correction.'}</p>` : ''}
      <section class="card card-body summary-card attendance-summary" aria-label="Résumé des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}" aria-live="polite"${session.state === 'open' ? ` data-live-session data-session-id="${session.public_id}"` : ''}>
        <strong><span data-present-count>${presentCount}</span> / <span data-total-count>${studentsResult.rows.length}</span> présents</strong>
        <span class="badge status-badge status-${session.state}" data-session-state aria-live="polite">${getStateLabel(session.state)}</span>
      </section>
      <p class="alert alert-warning" data-live-readonly hidden>La ${businessTerm('session').toLocaleLowerCase('fr')} est clôturée. Les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')} sont maintenant en lecture seule.</p>
      <p class="alert alert-danger" data-live-error role="alert" hidden>La mise à jour a échoué. Réessayez.</p>
      <section class="page-section" aria-labelledby="attendance-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="attendance-title">${businessTerm('attendance', 'plural')}</h2>
          </div>
        </div>
        ${studentsResult.rows.length > 0 ? `<div class="search">
          <label for="attendance-search">Rechercher dans les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')}</label>
          <div class="search-controls">
            <input class="form-control" id="attendance-search" name="attendance_filter" type="search" placeholder="Nom ou code…" autocomplete="off" spellcheck="false" aria-controls="attendance-roster" data-attendance-search>
          </div>
          <p class="help-text" role="status" data-attendance-no-results hidden>Aucun résultat.</p>
        </div>` : ''}
        ${studentList}
      </section>`));
  } catch (error) {
    console.error('Unable to load course session attendance:', error);
    const page = renderMessagePage(`${getTerm('session')} indisponible`, 'Impossible de charger l’élément demandé pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/quick-attendance/qr', requireAttendanceManagement, async (request, response) => {
  if (!request.courseSessionId) {
    response.status(404).json({ outcome: 'unknown', message: 'QR non reconnu.' });
    return;
  }

  const qrToken = parseStudentQrPayload(request.body?.payload);
  if (!qrToken) {
    response.status(404).json({ outcome: 'unknown', message: 'QR non reconnu.' });
    return;
  }

  try {
    const studentResult = await pool.query(
      `SELECT id, public_id, first_name, last_name
       FROM students
       WHERE qr_token = $1::uuid AND anonymized_at IS NULL`,
      [qrToken],
    );
    if (studentResult.rowCount === 0) {
      response.status(404).json({ outcome: 'unknown', message: 'QR non reconnu.' });
      return;
    }

    const student = studentResult.rows[0];
    const outcome = await withTransaction(pool, async (client) => {
      const result = await markStudentPresent(client, request.courseSessionId, student.id);
      if (!result.allowed) {
        const sessionResult = await client.query(
          'SELECT state FROM course_sessions WHERE id = $1',
          [request.courseSessionId],
        );
        if (sessionResult.rowCount === 0) return { status: 404, body: { outcome: 'unknown', message: `${getTerm('session')} introuvable.` } };
        if (sessionResult.rows[0].state !== 'open') return {
          status: 409,
          body: {
            outcome: 'session_unavailable',
            message: `La ${getTerm('session').toLocaleLowerCase('fr')} n’est pas ouverte.`,
          },
        };
        return {
          status: 409,
          body: {
            outcome: 'ineligible',
            message: `Cette personne ne peut pas être enregistrée dans cette ${getTerm('session').toLocaleLowerCase('fr')}.`,
          },
        };
      }

      if (result.changed) await recordAuditEvent({
        client, category: 'attendance', action: 'attendance.qr.present', targetType: 'student',
        targetPublicId: student.public_id, targetLabel: `${student.first_name} ${student.last_name}`,
        summary: 'Présence enregistrée par QR.',
        beforeData: { status: result.previousStatus, checked_in_at: timestampForAudit(result.previousCheckedInAt) },
        afterData: { status: 'present', checked_in_at: timestampForAudit(result.checkedInAt) },
        metadata: { source: 'quick_attendance' },
      });

      const {
        allowed: _allowed,
        studentId: _studentId,
        previousCheckedInAt: _previousCheckedInAt,
        checkedInAt: _checkedInAt,
        ...attendanceResult
      } = result;
      return {
        status: 200,
        body: {
          ...attendanceResult,
          studentId: student.public_id,
          outcome: result.changed ? 'present' : 'already_present',
          message: result.changed
            ? `${student.first_name} ${student.last_name} — présent`
            : `${student.first_name} ${student.last_name} — déjà présent`,
        },
      };
    });
    if (outcome.status === 200) response.set('Cache-Control', 'no-store');
    response.status(outcome.status).json(outcome.body);
  } catch (error) {
    console.error('Unable to update attendance from QR:', error);
    response.status(500).json({
      outcome: 'error',
      message: 'Impossible de traiter ce QR pour le moment.',
    });
  }
});

router.post('/:id/quick-attendance/:studentId', requireAttendanceManagement, async (request, response) => {
  if (!request.courseSessionId || !request.studentId) {
    response.status(404).json({ error: 'Enregistrement introuvable.' });
    return;
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const attendance = await markStudentPresent(client, request.courseSessionId, request.studentId);
      if (attendance.changed) {
        const student = await client.query('SELECT first_name, last_name FROM students WHERE id = $1', [request.studentId]);
        await recordAuditEvent({
          client, category: 'attendance', action: 'attendance.quick.present', targetType: 'student',
          targetPublicId: request.params.studentId, targetLabel: student.rowCount ? `${student.rows[0].first_name} ${student.rows[0].last_name}` : null,
          summary: 'Présence enregistrée en mode rapide.',
          beforeData: { status: attendance.previousStatus, checked_in_at: timestampForAudit(attendance.previousCheckedInAt) },
          afterData: { status: 'present', checked_in_at: timestampForAudit(attendance.checkedInAt) },
          metadata: { source: 'quick_attendance' },
        });
      }
      return attendance;
    });
    if (!result.allowed) {
      response.status(409).json({
        error: `La ${getTerm('session').toLocaleLowerCase('fr')} doit être ouverte et la personne doit être active et admissible.`,
      });
      return;
    }

    const {
      allowed: _allowed,
      studentId: _studentId,
      previousCheckedInAt: _previousCheckedInAt,
      checkedInAt: _checkedInAt,
      ...attendanceResult
    } = result;
    response.set('Cache-Control', 'no-store');
    response.json({ ...attendanceResult, studentId: request.params.studentId });
  } catch (error) {
    console.error('Unable to update quick attendance:', error);
    response.status(500).json({ error: `Impossible d’enregistrer la ${getTerm('attendance').toLocaleLowerCase('fr')}.` });
  }
});

router.post('/:id/quick-attendance/:studentId/undo', requireAttendanceManagement, async (request, response) => {
  if (!request.courseSessionId || !request.studentId) {
    response.status(404).json({ error: 'Enregistrement introuvable.' });
    return;
  }
  const previousStatus = typeof request.body.previous_status === 'string'
    ? request.body.previous_status
    : '';
  const expectedVersion = typeof request.body.expected_version === 'string'
    ? request.body.expected_version
    : '';
  if (!['pending', 'absent'].includes(previousStatus) || !/^\d{1,20}$/.test(expectedVersion)) {
    response.status(400).json({ error: 'Action à annuler invalide.' });
    return;
  }

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const allowedResult = await lockEligibleStudent(
        client,
        request.courseSessionId,
        request.studentId,
      );
      if (allowedResult.rowCount === 0) return { status: 'not_allowed' };

      const currentResult = await client.query(
        `SELECT checked_in_at
         FROM attendance_records
         WHERE session_id = $1 AND student_id = $2 AND status = 'present'
         FOR UPDATE`,
        [request.courseSessionId, request.studentId],
      );
      const updateResult = await client.query(
        `UPDATE attendance_records
         SET status = $1, checked_in_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE session_id = $2
           AND student_id = $3
           AND status = 'present'
           AND ROUND(EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint = $4::bigint
         RETURNING status`,
        [previousStatus, request.courseSessionId, request.studentId, expectedVersion],
      );
      if (updateResult.rowCount > 0) {
        const student = await client.query('SELECT first_name, last_name FROM students WHERE id = $1', [request.studentId]);
        await recordAuditEvent({
          client, category: 'attendance', action: 'attendance.undo', targetType: 'student',
          targetPublicId: request.params.studentId, targetLabel: student.rowCount ? `${student.rows[0].first_name} ${student.rows[0].last_name}` : null,
          summary: 'Dernière présence rapide annulée.',
          beforeData: { status: 'present', checked_in_at: timestampForAudit(currentResult.rows[0]?.checked_in_at) },
          afterData: { status: previousStatus, checked_in_at: null },
          metadata: { source: 'quick_attendance' },
        });
      }
      return { status: updateResult.rowCount > 0 ? 'updated' : 'stale' };
    });
    if (outcome.status === 'not_allowed') {
      response.status(409).json({ error: 'Cette action ne peut plus être annulée.' });
      return;
    }
    if (outcome.status === 'stale') {
      response.status(409).json({
        error: 'Cet enregistrement a été modifié depuis cette action. Annulation ignorée.',
      });
      return;
    }

    response.set('Cache-Control', 'no-store');
    response.json({
      studentId: request.params.studentId,
      status: previousStatus,
      undone: true,
    });
  } catch (error) {
    console.error('Unable to undo quick attendance:', error);
    response.status(500).json({ error: 'Impossible d’annuler cette action.' });
  }
});

router.post('/:id/attendance/:studentId', requireAttendanceManagement, async (request, response) => {
  if (!request.courseSessionId || !request.studentId) {
    const page = renderMessagePage('Enregistrement introuvable', 'La valeur demandée ne peut pas être modifiée.', 404);
    response.status(page.status).send(page.html);
    return;
  }
  if (!['present', 'absent'].includes(request.body.status)) {
    const page = renderMessagePage('Statut invalide', 'Le statut demandé est invalide.', 400);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const updated = await withTransaction(pool, async (client) => {
      const allowedResult = await lockEligibleStudent(
        client,
        request.courseSessionId,
        request.studentId,
      );
      if (allowedResult.rowCount === 0) return false;
      const previousResult = await client.query(
        `SELECT status, checked_in_at FROM attendance_records
         WHERE session_id = $1 AND student_id = $2 FOR UPDATE`,
        [request.courseSessionId, request.studentId],
      );
      const previousStatus = previousResult.rows[0]?.status || 'pending';
      const previousCheckedInAt = previousResult.rows[0]?.checked_in_at || null;
      const attendanceResult = await client.query(
        `INSERT INTO attendance_records (session_id, student_id, status, checked_in_at)
         VALUES ($1, $2, $3,
                 CASE WHEN $3 = 'present' THEN CURRENT_TIMESTAMP ELSE NULL END)
         ON CONFLICT (session_id, student_id)
         DO UPDATE SET status = EXCLUDED.status,
                       checked_in_at = CASE
                         WHEN EXCLUDED.status = 'absent' THEN NULL
                         WHEN attendance_records.status = 'present'
                           THEN attendance_records.checked_in_at
                         ELSE CURRENT_TIMESTAMP
                       END,
                       updated_at = CURRENT_TIMESTAMP
         RETURNING checked_in_at`,
        [request.courseSessionId, request.studentId, request.body.status],
      );
      if (previousStatus !== request.body.status) {
        await recordStudentActivity(
          client,
          request.studentId,
          request.body.status === 'present' ? attendanceResult.rows[0].checked_in_at : null,
        );
      }
      const student = await client.query('SELECT first_name, last_name FROM students WHERE id = $1', [request.studentId]);
      await recordAuditEvent({
        client, category: 'attendance', action: 'attendance.manual.update', targetType: 'student',
        targetPublicId: request.params.studentId, targetLabel: student.rowCount ? `${student.rows[0].first_name} ${student.rows[0].last_name}` : null,
        summary: 'Présence modifiée manuellement.',
        beforeData: { status: previousStatus, checked_in_at: timestampForAudit(previousCheckedInAt) },
        afterData: { status: request.body.status, checked_in_at: timestampForAudit(attendanceResult.rows[0].checked_in_at) },
        metadata: { source: 'attendance_page' },
      });
      return true;
    });
    if (!updated) {
      const page = renderMessagePage(
        'Modification impossible',
        `La ${getTerm('session').toLocaleLowerCase('fr')} doit être ouverte et la personne doit être active et admissible.`,
        409,
      );
      response.status(page.status).send(page.html);
      return;
    }

    response.redirect(303, `/sessions/${request.params.id}?notice=attendance_updated`);
  } catch (error) {
    console.error('Unable to update attendance:', error);
    const page = renderMessagePage('Modification impossible', `Impossible de mettre à jour la ${getTerm('attendance').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/attendance/:studentId/check-in-time', requireSessionManagement, async (request, response) => {
  if (!request.courseSessionId || !request.studentId) {
    const page = renderMessagePage('Enregistrement introuvable', 'La valeur demandée ne peut pas être modifiée.', 404);
    response.status(page.status).send(page.html);
    return;
  }
  const checkedInTime = normalizeClockTime(
    typeof request.body.checked_in_time === 'string' ? request.body.checked_in_time.trim() : '',
  );
  if (!checkedInTime) {
    const page = renderMessagePage('Heure invalide', 'Saisissez une heure locale valide.', 400);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const allowed = await lockEligibleStudent(client, request.courseSessionId, request.studentId);
      if (allowed.rowCount === 0) return 'not_allowed';
      const current = await client.query(
        `SELECT ar.checked_in_at, cs.public_id AS session_public_id,
                cs.title, s.public_id AS student_public_id, s.first_name, s.last_name
         FROM attendance_records ar
         INNER JOIN course_sessions cs ON cs.id = ar.session_id
         INNER JOIN students s ON s.id = ar.student_id
         WHERE ar.session_id = $1 AND ar.student_id = $2 AND ar.status = 'present'
         FOR UPDATE OF ar`,
        [request.courseSessionId, request.studentId],
      );
      if (current.rowCount === 0) return 'not_present';
      const updated = await client.query(
        `UPDATE attendance_records
         SET checked_in_at = (
               (SELECT date FROM course_sessions WHERE id = $1) + $3::time
             ) AT TIME ZONE $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE session_id = $1 AND student_id = $2
         RETURNING checked_in_at`,
        [
          request.courseSessionId,
          request.studentId,
          checkedInTime,
          getApplicationTimezone(),
        ],
      );
      await recordStudentActivity(client, request.studentId, updated.rows[0].checked_in_at);
      await recordAuditEvent({
        client,
        category: 'attendance',
        action: 'attendance.check_in_time.update',
        targetType: 'student',
        targetPublicId: current.rows[0].student_public_id,
        targetLabel: `${current.rows[0].first_name} ${current.rows[0].last_name}`,
        summary: 'Heure d’arrivée corrigée manuellement.',
        beforeData: { checked_in_at: timestampForAudit(current.rows[0].checked_in_at) },
        afterData: { checked_in_at: timestampForAudit(updated.rows[0].checked_in_at) },
        metadata: { source: 'attendance_page', session_public_id: current.rows[0].session_public_id },
      });
      return 'updated';
    });
    if (outcome !== 'updated') {
      const page = renderMessagePage(
        'Modification impossible',
        outcome === 'not_present'
          ? 'Une heure d’arrivée ne peut être définie que pour une personne présente.'
          : `La ${getTerm('session').toLocaleLowerCase('fr')} doit être ouverte.`,
        409,
      );
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/sessions/${request.params.id}?notice=arrival_updated`);
  } catch (error) {
    console.error('Unable to correct attendance check-in time:', error);
    const page = renderMessagePage('Modification impossible', 'Impossible de corriger l’heure d’arrivée pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/close', requireSessionManagement, async (request, response) => {
  if (!request.courseSessionId) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const sessionResult = await client.query(
        'SELECT id, public_id, title, class_id, state, closed_at FROM course_sessions WHERE id = $1 FOR UPDATE',
        [request.courseSessionId],
      );
      if (sessionResult.rowCount === 0) return 'not_found';
      if (sessionResult.rows[0].state !== 'open') return 'not_open';
      await client.query(
        'SELECT id FROM classes WHERE id = $1 FOR UPDATE',
        [sessionResult.rows[0].class_id],
      );

      if (sessionResult.rows[0].closed_at) {
        await client.query(
          `UPDATE attendance_records
           SET status = 'absent', updated_at = CURRENT_TIMESTAMP
           WHERE session_id = $1 AND status = 'pending'`,
          [request.courseSessionId],
        );
      } else {
        await client.query(
          `INSERT INTO attendance_records (session_id, student_id, status)
           SELECT $1, s.id, 'absent'
           FROM student_classes sc
           INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
           WHERE sc.class_id = $2 AND sc.active = TRUE
           ON CONFLICT (session_id, student_id)
           DO UPDATE SET status = 'absent', updated_at = CURRENT_TIMESTAMP
           WHERE attendance_records.status = 'pending'`,
          [request.courseSessionId, sessionResult.rows[0].class_id],
        );
      }
      await client.query(
        `UPDATE course_sessions
         SET state = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)
         WHERE id = $1`,
        [request.courseSessionId],
      );
      await recordAuditEvent({
        client, category: 'session', action: 'session.close', targetType: 'session',
        targetPublicId: sessionResult.rows[0].public_id, targetLabel: sessionResult.rows[0].title,
        summary: 'Session clôturée.', beforeData: { state: 'open' }, afterData: { state: 'closed' },
      });
      return 'closed';
    });
    if (outcome === 'not_found') {
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome === 'not_open') {
      const page = renderMessagePage('Clôture impossible', `La ${getTerm('session').toLocaleLowerCase('fr')} doit être ouverte.`, 409);
      response.status(page.status).send(page.html);
      return;
    }
    const delivery = await sendSessionSummary(request.params.id, { source: 'automatic' });
    const notice = delivery.status === 'sent'
      ? 'closed_summary_sent'
      : delivery.status === 'failed' ? 'closed_summary_failed' : 'closed';
    response.redirect(303, `/sessions/${request.params.id}?notice=${notice}`);
  } catch (error) {
    console.error('Unable to close course session:', error);
    const page = renderMessagePage('Clôture impossible', `Impossible de clôturer la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/resend-summary', requireSessionManagement, async (request, response) => {
  if (!request.courseSessionId) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }
  const delivery = await sendSessionSummary(request.params.id, { source: 'manual_resend' });
  if (delivery.status === 'not_found') {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }
  if (delivery.status === 'not_closed') {
    const page = renderMessagePage('Envoi impossible', `La ${getTerm('session').toLocaleLowerCase('fr')} doit être clôturée.`, 409);
    response.status(page.status).send(page.html);
    return;
  }
  const notice = delivery.status === 'sent'
    ? 'summary_resent'
    : delivery.status === 'no_recipients' ? 'summary_no_recipients' : 'summary_failed';
  response.redirect(303, `/sessions/${request.params.id}?notice=${notice}`);
});

router.post('/:id/open', requireSessionManagement, async (request, response) => {
  if (!request.courseSessionId) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const sessionResult = await client.query(
        'SELECT id, public_id, title, class_id, state FROM course_sessions WHERE id = $1 FOR UPDATE',
        [request.courseSessionId],
      );
      if (sessionResult.rowCount > 0) {
        await client.query('SELECT id FROM classes WHERE id = $1 FOR UPDATE', [sessionResult.rows[0].class_id]);
      }
      const result = await client.query(
        `UPDATE course_sessions
         SET state = 'open', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
         WHERE id = $1 AND state IN ('scheduled', 'closed')
         RETURNING id`,
        [request.courseSessionId],
      );
      if (result.rowCount > 0) {
        const previousState = sessionResult.rows[0].state;
        await recordAuditEvent({
          client, category: 'session', action: previousState === 'closed' ? 'session.reopen' : 'session.open', targetType: 'session',
          targetPublicId: sessionResult.rows[0].public_id, targetLabel: sessionResult.rows[0].title,
          summary: previousState === 'closed' ? 'Session rouverte.' : 'Session ouverte.',
          beforeData: { state: previousState }, afterData: { state: 'open' },
        });
        return 'opened';
      }
      return sessionResult.rowCount > 0 ? 'already_open' : 'not_found';
    });
    if (outcome === 'already_open') {
      const page = renderMessagePage('Ouverture impossible', `La ${getTerm('session').toLocaleLowerCase('fr')} est déjà ouverte.`, 409);
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome === 'not_found') {
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/sessions/${request.params.id}?notice=opened`);
  } catch (error) {
    console.error('Unable to open course session:', error);
    const page = renderMessagePage('Ouverture impossible', `Impossible d’ouvrir la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
