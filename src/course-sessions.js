const express = require('express');
const { requirePermission } = require('./auth');
const { pool } = require('./db/client');
const { formatDateForDisplay, formatDateForInput } = require('./date-format');
const { parseStudentQrPayload } = require('./student-qr');
const { hasPermission, permissions } = require('./permissions');
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

function isValidId(value) {
  return /^[1-9]\d*$/.test(value);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === value;
}

function getFormValues(body = {}) {
  return {
    class_id: typeof body.class_id === 'string' ? body.class_id : '',
    date: typeof body.date === 'string' ? body.date.trim() : '',
    title: typeof body.title === 'string' ? body.title.trim() : '',
    instructor: typeof body.instructor === 'string' ? body.instructor.trim() : '',
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
  };
}

function validateForm(values) {
  if (!isValidId(values.class_id)) {
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
  return '';
}

function renderSessionForm({ title, action, submitLabel, values, classes, error = '', edit = false }) {
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
         <select class="form-select" id="class_id" name="class_id" required>
           <option value="">Sélectionner dans la liste</option>
           ${classes.map((classRecord) => `<option value="${classRecord.id}"${String(classRecord.id) === values.class_id ? ' selected' : ''}>${escapeHtml(classRecord.name)}</option>`).join('')}
         </select>
       </div>`;

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

      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="btn btn-outline-secondary" href="/sessions">Annuler</a>
      </div>
    </form>`);
}

async function getClasses() {
  const result = await pool.query('SELECT id, name FROM classes ORDER BY LOWER(name), id');
  return result.rows;
}

async function loadRoster(session) {
  if (session.closed_at) {
    return pool.query(
      `SELECT s.id, s.first_name, s.last_name, s.email, s.student_code, ar.status
       FROM attendance_records ar
       INNER JOIN students s ON s.id = ar.student_id
       WHERE ar.session_id = $1
       ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
      [session.id],
    );
  }

  return pool.query(
    `SELECT s.id, s.first_name, s.last_name, s.email, s.student_code,
            COALESCE(ar.status, 'pending') AS status
     FROM student_classes sc
     INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
     LEFT JOIN attendance_records ar
       ON ar.session_id = $2 AND ar.student_id = s.id
     WHERE sc.class_id = $1 AND sc.active = TRUE
     ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
    [session.class_id, session.id],
  );
}

function lockEligibleStudent(client, sessionId, studentId) {
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
    `SELECT status
     FROM attendance_records
     WHERE session_id = $1 AND student_id = $2
     FOR UPDATE`,
    [sessionId, studentId],
  );
  const previousStatus = currentResult.rows[0]?.status || 'pending';
  if (previousStatus === 'present') {
    return {
      allowed: true,
      changed: false,
      status: 'present',
      studentId: String(studentId),
    };
  }

  const updateResult = await client.query(
    `INSERT INTO attendance_records (session_id, student_id, status)
     VALUES ($1, $2, 'present')
     ON CONFLICT (session_id, student_id)
     DO UPDATE SET status = 'present', updated_at = CURRENT_TIMESTAMP
     RETURNING ROUND(EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint::text AS version`,
    [sessionId, studentId],
  );

  return {
    allowed: true,
    changed: true,
    status: 'present',
    studentId: String(studentId),
    previousStatus,
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

router.get('/', async (request, response) => {
  const searchQuery = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : '';
  const searchPattern = `%${searchQuery}%`;
  const classId = isValidId(request.query.class_id || '') ? request.query.class_id : '';

  try {
    const [result, classResult] = await Promise.all([
      pool.query(
        `SELECT cs.id, cs.date, cs.title, cs.instructor, cs.state, c.name AS class_name
         FROM course_sessions cs
         INNER JOIN classes c ON c.id = cs.class_id
         WHERE ($1::bigint IS NULL OR cs.class_id = $1)
           AND ($2 = ''
            OR cs.title ILIKE $3
            OR c.name ILIKE $3
            OR cs.instructor ILIKE $3)
         ORDER BY cs.date DESC, LOWER(cs.title), cs.id DESC`,
        [classId || null, searchQuery, searchPattern],
      ),
      classId
        ? pool.query('SELECT id, name FROM classes WHERE id = $1', [classId])
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
          <article class="list-group-item compact-row compact-row-status session-row"${session.state === 'open' ? ` data-live-session-card data-session-id="${session.id}"` : ''}>
            <div class="compact-identity session-identity">
              <p class="compact-meta session-date">${escapeHtml(formatDateForDisplay(session.date))}</p>
              <p class="compact-title">${escapeHtml(session.title)}</p>
              <p class="compact-meta">${escapeHtml(session.class_name)} · ${escapeHtml(session.instructor)}</p>
            </div>
            <div class="compact-status">
              <span class="badge status-badge status-${session.state}" data-session-state>${getStateLabel(session.state)}</span>
            </div>
            <div class="compact-actions compact-actions--split" aria-label="Actions disponibles pour « ${escapeHtml(session.title)} »">
              <a class="btn btn-primary" href="/sessions/${session.id}">${session.state === 'scheduled' ? `Voir la ${businessTerm('session').toLocaleLowerCase('fr')}` : businessTerm('attendance', 'plural')}</a>
              ${canManageSessions ? `<span class="session-edit-slot">
                <a class="btn btn-light" href="/sessions/${session.id}/edit" data-session-edit${session.state === 'closed' ? ' hidden' : ''}>Modifier</a>
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
        ${canManageSessions ? `<a class="btn btn-primary" href="/sessions/new${classRecord ? `?class_id=${classRecord.id}` : ''}">Ajouter</a>` : ''}
      </header>
      ${classRecord && canManageSessions ? `<nav class="nav nav-pills context-tabs" aria-label="Gestion de « ${escapeHtml(classRecord.name)} »">
        <a class="nav-link" href="/classes/${classRecord.id}">${businessTerm('student', 'plural')}</a>
        <a class="nav-link active" href="/sessions?class_id=${classRecord.id}" aria-current="page">${businessTerm('session', 'plural')}</a>
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
    const classes = await getClasses();
    response.send(renderSessionForm({
      title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
      action: '/sessions',
      submitLabel: 'Créer',
      values: {
        class_id: isValidId(request.query.class_id || '') ? request.query.class_id : '',
        date: '',
        title: '',
        instructor: '',
        notes: '',
      },
      classes,
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
      const classes = await getClasses();
      response.status(400).send(renderSessionForm({
        title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
        action: '/sessions',
        submitLabel: 'Créer',
        values,
        classes,
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
    const result = await pool.query(
      `INSERT INTO course_sessions (class_id, date, title, instructor, notes)
       SELECT c.id, $2, $3, $4, $5
       FROM classes c
       WHERE c.id = $1
       RETURNING id`,
      [values.class_id, values.date, values.title, values.instructor, values.notes || null],
    );
    if (result.rowCount === 0) {
      const classes = await getClasses();
      response.status(400).send(renderSessionForm({
        title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
        action: '/sessions',
        submitLabel: 'Créer',
        values,
        classes,
        error: 'La sélection ne correspond à aucune activité.',
      }));
      return;
    }
    response.redirect(303, `/sessions/${result.rows[0].id}?notice=created`);
  } catch (error) {
    console.error('Unable to create course session:', error);
    const classes = await getClasses().catch(() => []);
    response.status(500).send(renderSessionForm({
      title: `Créer une ${getTerm('session').toLocaleLowerCase('fr')}`,
      action: '/sessions',
      submitLabel: 'Créer',
      values,
      classes,
      error: `Impossible de créer la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`,
    }));
  }
});

router.get('/:id/edit', requireSessionManagement, async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT cs.id, cs.class_id, cs.date, cs.title, cs.instructor, cs.notes, cs.state,
              c.name AS class_name
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.params.id],
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

    response.send(renderSessionForm({
      title: `Modifier la ${getTerm('session').toLocaleLowerCase('fr')}`,
      action: `/sessions/${result.rows[0].id}`,
      submitLabel: 'Enregistrer',
      values: result.rows[0],
      classes: [],
      edit: true,
    }));
  } catch (error) {
    console.error('Unable to load course session:', error);
    const page = renderMessagePage(`${getTerm('session')} indisponible`, 'Impossible de charger l’élément demandé pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', requireSessionManagement, async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const stateResult = await pool.query('SELECT state FROM course_sessions WHERE id = $1', [request.params.id]);
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
    const classResult = await pool.query('SELECT name FROM classes WHERE id = $1', [values.class_id]).catch(() => ({ rows: [] }));
    response.status(400).send(renderSessionForm({
      title: `Modifier la ${getTerm('session').toLocaleLowerCase('fr')}`,
      action: `/sessions/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values: { ...values, class_name: classResult.rows[0]?.name || '' },
      classes: [],
      error: validationError,
      edit: true,
    }));
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE course_sessions
       SET date = $1, title = $2, instructor = $3, notes = $4
       WHERE id = $5 AND class_id = $6 AND state IN ('scheduled', 'open')
       RETURNING id`,
      [values.date, values.title, values.instructor, values.notes || null, request.params.id, values.class_id],
    );
    if (result.rowCount === 0) {
      const sessionResult = await pool.query('SELECT state FROM course_sessions WHERE id = $1', [request.params.id]);
      const page = sessionResult.rows[0]?.state === 'closed'
        ? renderSessionReadOnlyPage()
        : renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/sessions/${request.params.id}?notice=updated`);
  } catch (error) {
    console.error('Unable to update course session:', error);
    const page = renderMessagePage('Modification impossible', `Impossible de modifier la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
  }
});

router.get('/:id/status', async (request, response) => {
  if (!isValidId(request.params.id)) {
    response.status(404).json({ error: `${getTerm('session')} introuvable.` });
    return;
  }

  try {
    const sessionResult = await pool.query(
      'SELECT id, class_id, state, closed_at FROM course_sessions WHERE id = $1',
      [request.params.id],
    );
    if (sessionResult.rowCount === 0) {
      response.status(404).json({ error: `${getTerm('session')} introuvable.` });
      return;
    }
    const session = sessionResult.rows[0];
    const rosterResult = await loadRoster(session);
    response.set('Cache-Control', 'no-store');
    response.json({
      id: String(session.id),
      state: session.state,
      present: rosterResult.rows.filter((student) => student.status === 'present').length,
      total: rosterResult.rowCount,
      roster: rosterResult.rows.map((student) => ({
        studentId: String(student.id),
        status: student.status,
      })),
    });
  } catch (error) {
    console.error('Unable to load live course session status:', error);
    response.status(500).json({ error: 'Impossible de charger l’état demandé.' });
  }
});

router.get('/:id/quick-attendance', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const sessionResult = await pool.query(
      `SELECT cs.id, cs.class_id, cs.date, cs.title, cs.state, cs.closed_at,
              c.name AS class_name
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.params.id],
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
            <a class="quick-close" href="/sessions/${session.id}" aria-label="Fermer le mode rapide"><span aria-hidden="true">×</span></a>
          </header>
          <p class="alert alert-warning">${session.state === 'closed'
            ? `La ${businessTerm('session').toLocaleLowerCase('fr')} est clôturée. Réouvrez-la avant de reprendre les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.`
            : `Ouvrez la ${businessTerm('session').toLocaleLowerCase('fr')} avant de prendre les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.`}</p>
        </div>`, { navigation: false, pageClass: 'page--quick-attendance' }));
      return;
    }

    const eligibleStudents = rosterResult.rows.filter((student) => student.status !== 'present');
    const studentRows = eligibleStudents.map((student) => `
      <article class="list-group-item compact-row student-row quick-attendance-row" data-quick-student data-student-id="${student.id}" data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.email} ${student.student_code}`.toLocaleLowerCase('fr'))}">
        <div class="compact-identity student-identity">
          <p class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</p>
          <p class="compact-meta">${escapeHtml(student.email)} · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>
        </div>
        <div class="compact-actions">
          <form method="post" action="/sessions/${session.id}/quick-attendance/${student.id}" data-quick-present-form>
            <button class="btn btn-primary" type="submit">Présent</button>
          </form>
        </div>
      </article>`).join('');

    response.send(renderPage(`Mode rapide des ${getTerm('attendance', 'plural').toLocaleLowerCase('fr')}`, `
      <div class="quick-attendance" data-quick-attendance data-session-id="${session.id}">
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
            <a class="quick-close" href="/sessions/${session.id}" aria-label="Fermer le mode rapide"><span aria-hidden="true">×</span></a>
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
              <input class="form-control" id="quick-attendance-search" name="quick_attendance_filter" type="search" placeholder="Nom, e-mail ou code…" autocomplete="off" autocapitalize="none" enterkeyhint="search" spellcheck="false" aria-controls="quick-attendance-results" data-quick-search>
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
  if (!isValidId(request.params.id)) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const sessionResult = await pool.query(
      `SELECT cs.id, cs.class_id, cs.date, cs.title, cs.instructor, cs.notes, cs.state,
              cs.closed_at,
              c.name AS class_name
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.params.id],
    );
    if (sessionResult.rowCount === 0) {
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    const session = sessionResult.rows[0];
    const studentsResult = await loadRoster(session);

    const presentCount = studentsResult.rows.filter((student) => student.status === 'present').length;
    const notices = {
      created: `La ${getTerm('session').toLocaleLowerCase('fr')} a été créée.`,
      updated: `La ${getTerm('session').toLocaleLowerCase('fr')} a été mise à jour.`,
      attendance_updated: `La ${getTerm('attendance').toLocaleLowerCase('fr')} a été mise à jour.`,
      closed: `La ${getTerm('session').toLocaleLowerCase('fr')} a été clôturée.`,
      opened: `La ${getTerm('session').toLocaleLowerCase('fr')} est ouverte.`,
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-success" role="status">${escapeHtml(notices[request.query.notice])}</p>`
      : '';
    const studentList = studentsResult.rows.length === 0
      ? `<p class="empty-state">${session.state === 'closed'
        ? `Aucun ${businessTerm('student').toLocaleLowerCase('fr')} n’est enregistré pour cette ${businessTerm('session').toLocaleLowerCase('fr')}.`
        : session.state === 'open'
        ? `Aucun ${businessTerm('student').toLocaleLowerCase('fr')} actif n’est disponible dans cette ${businessTerm('class').toLocaleLowerCase('fr')}.`
        : `Aucun ${businessTerm('student').toLocaleLowerCase('fr')} actif n’est disponible dans cette ${businessTerm('class').toLocaleLowerCase('fr')}. La ${businessTerm('session').toLocaleLowerCase('fr')} n’a pas encore commencé.`}</p>`
      : `<div class="list-group compact-list" id="attendance-roster" data-attendance-roster>${studentsResult.rows.map((student) => `
          <article class="list-group-item compact-row compact-row-status student-row" data-student-id="${student.id}" data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.email} ${student.student_code}`.toLocaleLowerCase('fr'))}">
            <div class="compact-identity student-identity">
              <p class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</p>
              <p class="compact-meta">${escapeHtml(student.email)} · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>
            </div>
            <div class="compact-status">
              <span class="badge status-badge status-${student.status}" data-attendance-status>${{
                pending: 'En attente',
                present: 'Présent',
                absent: 'Absent',
              }[student.status]}</span>
            </div>
            <div class="compact-actions compact-actions--attendance" data-attendance-actions${session.state === 'open' ? '' : ' hidden'}>
              ${session.state === 'open' ? `<form class="compact-actions compact-actions--split" method="post" action="/sessions/${session.id}/attendance/${student.id}" data-attendance-form>
                <button class="btn btn-primary" name="status" type="submit" value="present">Présent</button>
                <button class="btn btn-outline-danger" name="status" type="submit" value="absent">Absent</button>
              </form>` : ''}
            </div>
          </article>`).join('')}</div>`;

    const canManageSessions = hasPermission(request.currentUser, permissions.manageSessions);
    response.send(renderPage(session.title, `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <p class="eyebrow">${escapeHtml(session.class_name)}</p>
          <h1>${escapeHtml(session.title)}</h1>
          <p class="page-description">${escapeHtml(formatDateForDisplay(session.date))} · ${escapeHtml(session.instructor)}</p>
          ${session.notes ? `<p class="page-description session-notes">${escapeHtml(session.notes)}</p>` : ''}
        </div>
        <div class="context-actions d-flex flex-wrap gap-2">
          <a class="btn btn-primary" href="/sessions/${session.id}/quick-attendance" data-quick-attendance-link${session.state === 'open' ? '' : ' hidden'}>Mode rapide</a>
          ${canManageSessions ? `<form method="post" action="/sessions/${session.id}/open" data-session-open${session.state === 'open' ? ' hidden' : ''}><button class="btn btn-primary" type="submit">${session.state === 'scheduled' ? 'Ouvrir' : 'Réouvrir'}</button></form>
          <a class="btn btn-outline-secondary" href="/sessions/${session.id}/edit" data-session-edit${session.state === 'closed' ? ' hidden' : ''}>Modifier</a>
          <form method="post" action="/sessions/${session.id}/close" data-session-close data-confirm="Clôturer la ${businessTerm('session').toLocaleLowerCase('fr')} ? Les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')} en attente seront marqués absents."${session.state === 'open' ? '' : ' hidden'}><button class="btn btn-danger" type="submit">Clôturer</button></form>` : ''}
        </div>
      </header>
      ${notice}
      ${session.state === 'closed' ? `<p class="alert alert-warning">La ${businessTerm('session').toLocaleLowerCase('fr')} est clôturée et en lecture seule. ${canManageSessions ? `Réouvrez-la pour modifier ses informations ou les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.` : 'Réouverture par un gestionnaire requise avant toute correction.'}</p>` : ''}
      <section class="card card-body summary-card attendance-summary" aria-label="Résumé des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}" aria-live="polite"${session.state === 'open' ? ` data-live-session data-session-id="${session.id}"` : ''}>
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
            <input class="form-control" id="attendance-search" name="attendance_filter" type="search" placeholder="Nom, e-mail ou code…" autocomplete="off" spellcheck="false" aria-controls="attendance-roster" data-attendance-search>
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
  if (!isValidId(request.params.id)) {
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
      `SELECT id, first_name, last_name
       FROM students
       WHERE qr_token = $1::uuid`,
      [qrToken],
    );
    if (studentResult.rowCount === 0) {
      response.status(404).json({ outcome: 'unknown', message: 'QR non reconnu.' });
      return;
    }

    const student = studentResult.rows[0];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await markStudentPresent(client, request.params.id, student.id);
      if (!result.allowed) {
        const sessionResult = await client.query(
          'SELECT state FROM course_sessions WHERE id = $1',
          [request.params.id],
        );
        await client.query('ROLLBACK');
        if (sessionResult.rowCount === 0) {
          response.status(404).json({ outcome: 'unknown', message: `${getTerm('session')} introuvable.` });
          return;
        }
        if (sessionResult.rows[0].state !== 'open') {
          response.status(409).json({
            outcome: 'session_unavailable',
            message: `La ${getTerm('session').toLocaleLowerCase('fr')} n’est pas ouverte.`,
          });
          return;
        }
        response.status(409).json({
          outcome: 'ineligible',
          message: `Cette personne ne peut pas être enregistrée dans cette ${getTerm('session').toLocaleLowerCase('fr')}.`,
        });
        return;
      }

      await client.query('COMMIT');
      const { allowed: _allowed, ...attendanceResult } = result;
      response.set('Cache-Control', 'no-store');
      response.json({
        ...attendanceResult,
        outcome: result.changed ? 'present' : 'already_present',
        message: result.changed
          ? `${student.first_name} ${student.last_name} — présent`
          : `${student.first_name} ${student.last_name} est déjà présent`,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Unable to update attendance from QR:', error);
    response.status(500).json({
      outcome: 'error',
      message: 'Impossible de traiter ce QR pour le moment.',
    });
  }
});

router.post('/:id/quick-attendance/:studentId', requireAttendanceManagement, async (request, response) => {
  if (!isValidId(request.params.id) || !isValidId(request.params.studentId)) {
    response.status(404).json({ error: 'Enregistrement introuvable.' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await markStudentPresent(
      client,
      request.params.id,
      request.params.studentId,
    );
    if (!result.allowed) {
      await client.query('ROLLBACK');
      response.status(409).json({
        error: `La ${getTerm('session').toLocaleLowerCase('fr')} doit être ouverte et la personne doit être active et admissible.`,
      });
      return;
    }

    await client.query('COMMIT');
    const { allowed: _allowed, ...attendanceResult } = result;
    response.set('Cache-Control', 'no-store');
    response.json(attendanceResult);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to update quick attendance:', error);
    response.status(500).json({ error: `Impossible d’enregistrer la ${getTerm('attendance').toLocaleLowerCase('fr')}.` });
  } finally {
    client.release();
  }
});

router.post('/:id/quick-attendance/:studentId/undo', requireAttendanceManagement, async (request, response) => {
  if (!isValidId(request.params.id) || !isValidId(request.params.studentId)) {
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const allowedResult = await lockEligibleStudent(
      client,
      request.params.id,
      request.params.studentId,
    );
    if (allowedResult.rowCount === 0) {
      await client.query('ROLLBACK');
      response.status(409).json({ error: 'Cette action ne peut plus être annulée.' });
      return;
    }

    const updateResult = await client.query(
      `UPDATE attendance_records
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $2
         AND student_id = $3
         AND status = 'present'
         AND ROUND(EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint = $4::bigint
       RETURNING status`,
      [previousStatus, request.params.id, request.params.studentId, expectedVersion],
    );
    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      response.status(409).json({
        error: 'Cet enregistrement a été modifié depuis cette action. Annulation ignorée.',
      });
      return;
    }

    await client.query('COMMIT');
    response.set('Cache-Control', 'no-store');
    response.json({
      studentId: request.params.studentId,
      status: previousStatus,
      undone: true,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to undo quick attendance:', error);
    response.status(500).json({ error: 'Impossible d’annuler cette action.' });
  } finally {
    client.release();
  }
});

router.post('/:id/attendance/:studentId', requireAttendanceManagement, async (request, response) => {
  if (!isValidId(request.params.id) || !isValidId(request.params.studentId)) {
    const page = renderMessagePage('Enregistrement introuvable', 'La valeur demandée ne peut pas être modifiée.', 404);
    response.status(page.status).send(page.html);
    return;
  }
  if (!['present', 'absent'].includes(request.body.status)) {
    const page = renderMessagePage('Statut invalide', 'Le statut demandé est invalide.', 400);
    response.status(page.status).send(page.html);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const allowedResult = await lockEligibleStudent(
      client,
      request.params.id,
      request.params.studentId,
    );
    if (allowedResult.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderMessagePage(
        'Modification impossible',
        `La ${getTerm('session').toLocaleLowerCase('fr')} doit être ouverte et la personne doit être active et admissible.`,
        409,
      );
      response.status(page.status).send(page.html);
      return;
    }

    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, student_id)
       DO UPDATE SET status = EXCLUDED.status, updated_at = CURRENT_TIMESTAMP`,
      [request.params.id, request.params.studentId, request.body.status],
    );
    await client.query('COMMIT');
    response.redirect(303, `/sessions/${request.params.id}?notice=attendance_updated`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to update attendance:', error);
    const page = renderMessagePage('Modification impossible', `Impossible de mettre à jour la ${getTerm('attendance').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
});

router.post('/:id/close', requireSessionManagement, async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessionResult = await client.query(
      'SELECT id, class_id, state, closed_at FROM course_sessions WHERE id = $1 FOR UPDATE',
      [request.params.id],
    );
    if (sessionResult.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    if (sessionResult.rows[0].state !== 'open') {
      await client.query('ROLLBACK');
      const page = renderMessagePage('Clôture impossible', `La ${getTerm('session').toLocaleLowerCase('fr')} doit être ouverte.`, 409);
      response.status(page.status).send(page.html);
      return;
    }
    await client.query(
      'SELECT id FROM classes WHERE id = $1 FOR UPDATE',
      [sessionResult.rows[0].class_id],
    );

    if (sessionResult.rows[0].closed_at) {
      await client.query(
        `UPDATE attendance_records
         SET status = 'absent', updated_at = CURRENT_TIMESTAMP
         WHERE session_id = $1 AND status = 'pending'`,
        [request.params.id],
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
        [request.params.id, sessionResult.rows[0].class_id],
      );
    }
    await client.query(
      `UPDATE course_sessions
       SET state = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)
       WHERE id = $1`,
      [request.params.id],
    );
    await client.query('COMMIT');
    response.redirect(303, `/sessions/${request.params.id}?notice=closed`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to close course session:', error);
    const page = renderMessagePage('Clôture impossible', `Impossible de clôturer la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
});

router.post('/:id/open', requireSessionManagement, async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderSessionNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessionResult = await client.query(
      'SELECT id, class_id, state FROM course_sessions WHERE id = $1 FOR UPDATE',
      [request.params.id],
    );
    if (sessionResult.rowCount > 0) {
      await client.query('SELECT id FROM classes WHERE id = $1 FOR UPDATE', [sessionResult.rows[0].class_id]);
    }
    const result = await client.query(
      `UPDATE course_sessions
       SET state = 'open', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
       WHERE id = $1 AND state IN ('scheduled', 'closed')
       RETURNING id`,
      [request.params.id],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      if (sessionResult.rowCount > 0) {
        const page = renderMessagePage('Ouverture impossible', `La ${getTerm('session').toLocaleLowerCase('fr')} est déjà ouverte.`, 409);
        response.status(page.status).send(page.html);
        return;
      }
      const page = renderSessionNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    await client.query('COMMIT');
    response.redirect(303, `/sessions/${request.params.id}?notice=opened`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to open course session:', error);
    const page = renderMessagePage('Ouverture impossible', `Impossible d’ouvrir la ${getTerm('session').toLocaleLowerCase('fr')} pour le moment.`);
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
});

module.exports = router;
