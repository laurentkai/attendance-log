const express = require('express');
const { pool } = require('./db/client');
const { escapeHtml, renderPage, renderMessagePage } = require('./ui');

const router = express.Router();
const frenchDateFormatter = new Intl.DateTimeFormat('fr-BE', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

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

function formatDateForInput(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return '';
}

function formatDateForDisplay(value) {
  const dateValue = formatDateForInput(value);
  return dateValue
    ? frenchDateFormatter.format(new Date(`${dateValue}T00:00:00Z`))
    : '';
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
    return 'La classe est obligatoire.';
  }
  if (!isValidDate(values.date)) {
    return 'La date est obligatoire et doit être valide.';
  }
  if (!values.title) {
    return 'Le titre est obligatoire.';
  }
  if (!values.instructor) {
    return 'Le nom du formateur est obligatoire.';
  }
  return '';
}

function renderSessionForm({ title, action, submitLabel, values, classes, error = '', edit = false }) {
  const errorMessage = error
    ? `<p class="message message-error" role="alert">${escapeHtml(error)}</p>`
    : '';
  const classField = edit
    ? `<p><strong>Classe :</strong> ${escapeHtml(values.class_name)}</p>
       <input name="class_id" type="hidden" value="${escapeHtml(values.class_id)}">`
    : `<label for="class_id">Classe <span aria-hidden="true">*</span></label>
       <select id="class_id" name="class_id" required>
         <option value="">Sélectionner une classe</option>
         ${classes.map((classRecord) => `<option value="${classRecord.id}"${String(classRecord.id) === values.class_id ? ' selected' : ''}>${escapeHtml(classRecord.name)}</option>`).join('')}
       </select>`;

  return renderPage(title, `
    <header class="page-header">
      <h1>${escapeHtml(title)}</h1>
    </header>
    ${errorMessage}
    <form class="form-card" method="post" action="${escapeHtml(action)}">
      ${classField}

      <label for="date">Date <span aria-hidden="true">*</span></label>
      <input id="date" name="date" type="date" value="${escapeHtml(formatDateForInput(values.date))}" required>

      <label for="title">Titre <span aria-hidden="true">*</span></label>
      <input id="title" name="title" type="text" value="${escapeHtml(values.title)}" required>

      <label for="instructor">Formateur <span aria-hidden="true">*</span></label>
      <input id="instructor" name="instructor" type="text" value="${escapeHtml(values.instructor)}" required>

      <label for="notes">Notes</label>
      <textarea id="notes" name="notes" rows="5">${escapeHtml(values.notes ?? '')}</textarea>

      <div class="form-actions">
        <button class="button" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="button button-secondary" href="/sessions">Annuler</a>
      </div>
    </form>`);
}

async function getClasses() {
  const result = await pool.query('SELECT id, name FROM classes ORDER BY LOWER(name), id');
  return result.rows;
}

router.get('/', async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT cs.id, cs.date, cs.title, cs.instructor, cs.state, c.name AS class_name
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       ORDER BY cs.date DESC, LOWER(cs.title), cs.id DESC`,
    );
    const notices = {
      created: 'La séance a été créée.',
      updated: 'La séance a été modifiée.',
    };
    const notice = notices[request.query.notice]
      ? `<p class="message message-success" role="status">${notices[request.query.notice]}</p>`
      : '';
    const sessions = result.rows.length === 0
      ? '<p class="empty-state">Aucune séance pour le moment.</p>'
      : `<div class="card-list">${result.rows.map((session) => `
          <article class="session-card">
            <div>
              <p class="session-date">${escapeHtml(formatDateForDisplay(session.date))}</p>
              <h2>${escapeHtml(session.title)}</h2>
              <p>${escapeHtml(session.class_name)} · ${escapeHtml(session.instructor)}</p>
              <span class="status-badge status-${session.state}">${session.state === 'open' ? 'Ouverte' : 'Clôturée'}</span>
            </div>
            <div class="card-actions">
              <a class="button" href="/sessions/${session.id}">Gérer les présences</a>
              <a class="button button-secondary" href="/sessions/${session.id}/edit">Modifier</a>
            </div>
          </article>`).join('')}</div>`;

    response.send(renderPage('Séances', `
      <header class="page-header">
        <h1>Séances</h1>
        <a class="button" href="/sessions/new">Ajouter</a>
      </header>
      ${notice}
      ${sessions}`));
  } catch (error) {
    console.error('Unable to list course sessions:', error);
    const page = renderMessagePage('Séances indisponibles', 'Impossible de charger les séances pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/new', async (request, response) => {
  try {
    const classes = await getClasses();
    response.send(renderSessionForm({
      title: 'Ajouter une séance',
      action: '/sessions',
      submitLabel: 'Créer la séance',
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

router.post('/', async (request, response) => {
  const values = getFormValues(request.body);
  const validationError = validateForm(values);

  if (validationError) {
    try {
      const classes = await getClasses();
      response.status(400).send(renderSessionForm({
        title: 'Ajouter une séance',
        action: '/sessions',
        submitLabel: 'Créer la séance',
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
        title: 'Ajouter une séance',
        action: '/sessions',
        submitLabel: 'Créer la séance',
        values,
        classes,
        error: 'La classe sélectionnée n’existe pas.',
      }));
      return;
    }
    response.redirect(303, `/sessions/${result.rows[0].id}?notice=created`);
  } catch (error) {
    console.error('Unable to create course session:', error);
    const classes = await getClasses().catch(() => []);
    response.status(500).send(renderSessionForm({
      title: 'Ajouter une séance',
      action: '/sessions',
      submitLabel: 'Créer la séance',
      values,
      classes,
      error: 'Impossible de créer la séance pour le moment.',
    }));
  }
});

router.get('/:id/edit', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT cs.id, cs.class_id, cs.date, cs.title, cs.instructor, cs.notes,
              c.name AS class_name
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.params.id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    response.send(renderSessionForm({
      title: 'Modifier la séance',
      action: `/sessions/${result.rows[0].id}`,
      submitLabel: 'Enregistrer',
      values: result.rows[0],
      classes: [],
      edit: true,
    }));
  } catch (error) {
    console.error('Unable to load course session:', error);
    const page = renderMessagePage('Séance indisponible', 'Impossible de charger cette séance pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const values = getFormValues(request.body);
  const validationError = validateForm(values);
  if (validationError) {
    const classResult = await pool.query('SELECT name FROM classes WHERE id = $1', [values.class_id]).catch(() => ({ rows: [] }));
    response.status(400).send(renderSessionForm({
      title: 'Modifier la séance',
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
       WHERE id = $5 AND class_id = $6
       RETURNING id`,
      [values.date, values.title, values.instructor, values.notes || null, request.params.id, values.class_id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/sessions/${request.params.id}?notice=updated`);
  } catch (error) {
    console.error('Unable to update course session:', error);
    const page = renderMessagePage('Modification impossible', 'Impossible de modifier cette séance pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const sessionResult = await pool.query(
      `SELECT cs.id, cs.class_id, cs.date, cs.title, cs.instructor, cs.notes, cs.state,
              c.name AS class_name
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.id = $1`,
      [request.params.id],
    );
    if (sessionResult.rowCount === 0) {
      const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    const session = sessionResult.rows[0];
    const studentsResult = session.state === 'closed'
      ? await pool.query(
        `SELECT s.id, s.first_name, s.last_name, ar.status
         FROM attendance_records ar
         INNER JOIN students s ON s.id = ar.student_id
         WHERE ar.session_id = $1
         ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
        [request.params.id],
      )
      : await pool.query(
        `SELECT s.id, s.first_name, s.last_name,
                COALESCE(ar.status, 'pending') AS status
         FROM student_classes sc
         INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
         LEFT JOIN attendance_records ar
           ON ar.session_id = $2 AND ar.student_id = s.id
         WHERE sc.class_id = $1
         ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
        [session.class_id, request.params.id],
      );

    const presentCount = studentsResult.rows.filter((student) => student.status === 'present').length;
    const notices = {
      created: 'La séance a été créée.',
      updated: 'La séance a été modifiée.',
      attendance_updated: 'La présence a été mise à jour.',
      closed: 'La séance a été clôturée.',
      opened: 'La séance est ouverte.',
    };
    const notice = notices[request.query.notice]
      ? `<p class="message message-success" role="status">${notices[request.query.notice]}</p>`
      : '';
    const studentList = studentsResult.rows.length === 0
      ? `<p class="empty-state">${session.state === 'open'
        ? 'Aucun élève actif dans cette classe.'
        : 'Aucun élève enregistré pour cette séance.'}</p>`
      : `<div class="card-list">${studentsResult.rows.map((student) => `
          <article class="attendance-card">
            <div>
              <h2>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</h2>
              <span class="status-badge status-${student.status}">${{
                pending: 'En attente',
                present: 'Présent',
                absent: 'Absent',
              }[student.status]}</span>
            </div>
            ${session.state === 'open' ? `<form class="attendance-actions" method="post" action="/sessions/${session.id}/attendance/${student.id}">
              <button class="button" name="status" type="submit" value="present">Présent</button>
              <button class="button button-danger" name="status" type="submit" value="absent">Absent</button>
            </form>` : ''}
          </article>`).join('')}</div>`;

    response.send(renderPage(session.title, `
      <header class="page-header">
        <div>
          <p class="eyebrow">${escapeHtml(session.class_name)}</p>
          <h1>${escapeHtml(session.title)}</h1>
          <p>${escapeHtml(formatDateForDisplay(session.date))} · ${escapeHtml(session.instructor)}</p>
          ${session.notes ? `<p class="session-notes">${escapeHtml(session.notes)}</p>` : ''}
        </div>
        <div class="context-actions">
          <a class="button button-secondary" href="/sessions/${session.id}/edit">Modifier</a>
          ${session.state === 'open'
            ? `<form method="post" action="/sessions/${session.id}/close" data-confirm="Clôturer cette séance et marquer les élèves en attente comme absents ?"><button class="button button-danger" type="submit">Clôturer</button></form>`
            : `<form method="post" action="/sessions/${session.id}/open"><button class="button" type="submit">Rouvrir</button></form>`}
        </div>
      </header>
      ${notice}
      <section class="summary-card" aria-label="Résumé des présences">
        <strong>${presentCount} / ${studentsResult.rows.length} présents</strong>
        <span class="status-badge status-${session.state}">${session.state === 'open' ? 'Séance ouverte' : 'Séance clôturée'}</span>
      </section>
      <section class="page-section">
        <h2>Élèves</h2>
        ${studentList}
      </section>`));
  } catch (error) {
    console.error('Unable to load course session attendance:', error);
    const page = renderMessagePage('Séance indisponible', 'Impossible de charger cette séance pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/attendance/:studentId', async (request, response) => {
  if (!isValidId(request.params.id) || !isValidId(request.params.studentId)) {
    const page = renderMessagePage('Présence introuvable', 'Cette présence ne peut pas être modifiée.', 404);
    response.status(page.status).send(page.html);
    return;
  }
  if (!['present', 'absent'].includes(request.body.status)) {
    const page = renderMessagePage('Statut invalide', 'Le statut de présence est invalide.', 400);
    response.status(page.status).send(page.html);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const allowedResult = await client.query(
      `SELECT cs.id
       FROM course_sessions cs
       WHERE cs.id = $1
         AND cs.state = 'open'
         AND EXISTS (
           SELECT 1
           FROM student_classes sc
           INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
           WHERE sc.class_id = cs.class_id AND s.id = $2
         )
       FOR UPDATE`,
      [request.params.id, request.params.studentId],
    );
    if (allowedResult.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderMessagePage(
        'Modification impossible',
        'La séance doit être ouverte et l’élève doit être actif dans cette classe.',
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
    const page = renderMessagePage('Modification impossible', 'Impossible de mettre à jour cette présence pour le moment.');
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
});

router.post('/:id/close', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessionResult = await client.query(
      'SELECT id, class_id FROM course_sessions WHERE id = $1 FOR UPDATE',
      [request.params.id],
    );
    if (sessionResult.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    await client.query(
      `INSERT INTO attendance_records (session_id, student_id, status)
       SELECT $1, s.id, 'absent'
       FROM student_classes sc
       INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
       WHERE sc.class_id = $2
       ON CONFLICT (session_id, student_id)
       DO UPDATE SET status = 'absent', updated_at = CURRENT_TIMESTAMP
       WHERE attendance_records.status = 'pending'`,
      [request.params.id, sessionResult.rows[0].class_id],
    );
    await client.query("UPDATE course_sessions SET state = 'closed' WHERE id = $1", [request.params.id]);
    await client.query('COMMIT');
    response.redirect(303, `/sessions/${request.params.id}?notice=closed`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to close course session:', error);
    const page = renderMessagePage('Clôture impossible', 'Impossible de clôturer cette séance pour le moment.');
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
});

router.post('/:id/open', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      "UPDATE course_sessions SET state = 'open' WHERE id = $1 RETURNING id",
      [request.params.id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage('Séance introuvable', 'Cette séance n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/sessions/${request.params.id}?notice=opened`);
  } catch (error) {
    console.error('Unable to open course session:', error);
    const page = renderMessagePage('Ouverture impossible', 'Impossible d’ouvrir cette séance pour le moment.');
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
