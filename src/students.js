const express = require('express');
const { pool } = require('./db/client');
const {
  insertStudent,
  normalizeStudentValues,
  validateStudentValues,
} = require('./student-data');
const { escapeHtml, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();

function isValidId(id) {
  return /^[1-9]\d*$/.test(id);
}

function getSelectedClassIds(body = {}) {
  const rawClassIds = Array.isArray(body.class_ids)
    ? body.class_ids
    : body.class_ids ? [body.class_ids] : [];

  return [...new Set(rawClassIds.filter((classId) => isValidId(classId)))];
}

async function loadClasses(client = pool) {
  const result = await client.query(
    'SELECT id, name FROM classes ORDER BY LOWER(name), id',
  );
  return result.rows;
}

function classIdsAreValid(classIds, classes) {
  const availableIds = new Set(classes.map((classRecord) => classRecord.id));
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
  error = '',
}) {
  const selectedIds = new Set(selectedClassIds);
  const errorMessage = error
    ? `<p class="message message-error" role="alert">${escapeHtml(error)}</p>`
    : '';
  const classChoices = classes.length === 0
    ? '<p class="muted">Aucune classe disponible.</p>'
    : `<div class="checkbox-list">${classes.map((classRecord) => `
        <label class="checkbox-option">
          <input name="class_ids" type="checkbox" value="${classRecord.id}"${selectedIds.has(classRecord.id) ? ' checked' : ''}>
          <span>${escapeHtml(classRecord.name)}</span>
        </label>`).join('')}</div>`;
  const codeField = editing
    ? `<div>
        <span class="field-label">Code élève</span>
        <strong class="student-code">${escapeHtml(values.student_code)}</strong>
      </div>`
    : '';
  const activeField = editing
    ? `<label class="checkbox-option">
        <input name="active" type="checkbox" value="true"${values.active ? ' checked' : ''}>
        <span>Élève actif</span>
      </label>`
    : '';

  return renderPage(title, `
    <header class="page-header">
      <h1>${escapeHtml(title)}</h1>
    </header>
    ${errorMessage}
    <form class="form-card" method="post" action="${escapeHtml(action)}">
      <label for="first_name">Prénom <span aria-hidden="true">*</span></label>
      <input id="first_name" name="first_name" type="text" value="${escapeHtml(values.firstName || '')}" required autofocus>

      <label for="last_name">Nom <span aria-hidden="true">*</span></label>
      <input id="last_name" name="last_name" type="text" value="${escapeHtml(values.lastName || '')}" required>

      <label for="email">Adresse e-mail <span aria-hidden="true">*</span></label>
      <input id="email" name="email" type="email" value="${escapeHtml(values.email || '')}" required>

      ${codeField}
      <fieldset>
        <legend>Classes</legend>
        ${classChoices}
      </fieldset>
      ${activeField}

      <div class="form-actions">
        <button class="button" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="button button-secondary" href="/students">Annuler</a>
      </div>
    </form>`);
}

async function replaceMemberships(client, studentId, classIds) {
  await client.query('DELETE FROM student_classes WHERE student_id = $1', [studentId]);

  for (const classId of classIds) {
    await client.query(
      'INSERT INTO student_classes (student_id, class_id) VALUES ($1, $2)',
      [studentId, classId],
    );
  }
}

router.get('/', async (request, response) => {
  const showInactive = request.query.status === 'inactive';

  try {
    const result = await pool.query(
      `SELECT s.id, s.first_name, s.last_name, s.email, s.student_code, s.active,
              COALESCE(string_agg(c.name, ', ' ORDER BY LOWER(c.name)), '') AS class_names
       FROM students s
       LEFT JOIN student_classes sc ON sc.student_id = s.id
       LEFT JOIN classes c ON c.id = sc.class_id
       WHERE s.active = $1
       GROUP BY s.id
       ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
      [!showInactive],
    );
    const notices = {
      created: 'L’élève a été créé.',
      updated: 'L’élève a été modifié.',
      deactivated: 'L’élève a été désactivé.',
    };
    const notice = notices[request.query.notice]
      ? `<p class="message message-success" role="status">${notices[request.query.notice]}</p>`
      : '';
    const cards = result.rows.length === 0
      ? `<p class="empty-state">Aucun élève ${showInactive ? 'inactif' : 'actif'}.</p>`
      : `<div class="card-list">${result.rows.map((student) => `
          <article class="student-card">
            <div>
              <h2>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</h2>
              <p><a href="mailto:${escapeHtml(student.email)}">${escapeHtml(student.email)}</a></p>
              <p><strong>Code :</strong> <span class="student-code">${escapeHtml(student.student_code)}</span></p>
              <p><strong>Classes :</strong> ${student.class_names
                ? escapeHtml(student.class_names)
                : '<span class="muted">Aucune</span>'}</p>
            </div>
            <div class="card-actions">
              <a class="button button-secondary" href="/students/${student.id}/edit">Modifier</a>
              ${student.active ? `<form method="post" action="/students/${student.id}/deactivate" data-confirm="Désactiver cet élève ?">
                <button class="button button-danger" type="submit">Désactiver</button>
              </form>` : ''}
            </div>
          </article>`).join('')}</div>`;

    response.send(renderPage('Élèves', `
      <header class="page-header">
        <h1>${showInactive ? 'Élèves inactifs' : 'Élèves'}</h1>
        <a class="button" href="/students/new">Ajouter</a>
      </header>
      <div class="filter-links">
        <a href="${showInactive ? '/students' : '/students?status=inactive'}">${showInactive ? 'Voir les élèves actifs' : 'Voir les élèves inactifs'}</a>
      </div>
      ${notice}
      ${cards}`));
  } catch (error) {
    console.error('Unable to list students:', error);
    const page = renderMessagePage('Élèves indisponibles', 'Impossible de charger les élèves pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/new', async (_request, response) => {
  try {
    const classes = await loadClasses();
    response.send(renderStudentForm({
      title: 'Ajouter un élève',
      action: '/students',
      submitLabel: 'Créer l’élève',
      values: {},
      classes,
      selectedClassIds: [],
    }));
  } catch (error) {
    console.error('Unable to load student form:', error);
    const page = renderMessagePage('Formulaire indisponible', 'Impossible de charger le formulaire pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/', async (request, response) => {
  const values = normalizeStudentValues(request.body);
  const selectedClassIds = getSelectedClassIds(request.body);
  let classes;

  try {
    classes = await loadClasses();
  } catch (error) {
    console.error('Unable to load classes for student creation:', error);
    const page = renderMessagePage('Création impossible', 'Impossible de créer l’élève pour le moment.');
    response.status(page.status).send(page.html);
    return;
  }

  const validationError = validateStudentValues(values)
    || (!classIdsAreValid(selectedClassIds, classes) ? 'Une classe sélectionnée n’est pas valide.' : '');
  if (validationError) {
    response.status(400).send(renderStudentForm({
      title: 'Ajouter un élève',
      action: '/students',
      submitLabel: 'Créer l’élève',
      values,
      classes,
      selectedClassIds,
      error: validationError,
    }));
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const student = await insertStudent(client, values);
    await replaceMemberships(client, student.id, selectedClassIds);
    await client.query('COMMIT');
    response.redirect(303, '/students?notice=created');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to create student:', error);
    const message = error.code === '23505'
      ? 'Un élève utilise déjà cette adresse e-mail.'
      : 'Impossible de créer l’élève pour le moment.';
    response.status(error.code === '23505' ? 409 : 500).send(renderStudentForm({
      title: 'Ajouter un élève',
      action: '/students',
      submitLabel: 'Créer l’élève',
      values,
      classes,
      selectedClassIds,
      error: message,
    }));
  } finally {
    client.release();
  }
});

router.get('/:id/edit', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Élève introuvable', 'Cet élève n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const [studentResult, classes, membershipResult] = await Promise.all([
      pool.query('SELECT id, first_name, last_name, email, student_code, active FROM students WHERE id = $1', [request.params.id]),
      loadClasses(),
      pool.query('SELECT class_id FROM student_classes WHERE student_id = $1', [request.params.id]),
    ]);

    if (studentResult.rowCount === 0) {
      const page = renderMessagePage('Élève introuvable', 'Cet élève n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    const student = studentResult.rows[0];
    response.send(renderStudentForm({
      title: 'Modifier l’élève',
      action: `/students/${student.id}`,
      submitLabel: 'Enregistrer',
      values: {
        firstName: student.first_name,
        lastName: student.last_name,
        email: student.email,
        student_code: student.student_code,
        active: student.active,
      },
      classes,
      selectedClassIds: membershipResult.rows.map((membership) => membership.class_id),
      editing: true,
    }));
  } catch (error) {
    console.error('Unable to load student:', error);
    const page = renderMessagePage('Élève indisponible', 'Impossible de charger cet élève pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Élève introuvable', 'Cet élève n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const values = normalizeStudentValues(request.body);
  values.active = request.body.active === 'true';
  const selectedClassIds = getSelectedClassIds(request.body);
  const classes = await loadClasses();
  const currentResult = await pool.query('SELECT student_code FROM students WHERE id = $1', [request.params.id]);

  if (currentResult.rowCount === 0) {
    const page = renderMessagePage('Élève introuvable', 'Cet élève n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  values.student_code = currentResult.rows[0].student_code;
  const validationError = validateStudentValues(values)
    || (!classIdsAreValid(selectedClassIds, classes) ? 'Une classe sélectionnée n’est pas valide.' : '');
  if (validationError) {
    response.status(400).send(renderStudentForm({
      title: 'Modifier l’élève',
      action: `/students/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      classes,
      selectedClassIds,
      editing: true,
      error: validationError,
    }));
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE students
       SET first_name = $1, last_name = $2, email = $3, active = $4
       WHERE id = $5`,
      [values.firstName, values.lastName, values.email, values.active, request.params.id],
    );
    await replaceMemberships(client, request.params.id, selectedClassIds);
    await client.query('COMMIT');
    response.redirect(
      303,
      values.active
        ? '/students?notice=updated'
        : '/students?status=inactive&notice=updated',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to update student:', error);
    const message = error.code === '23505'
      ? 'Un élève utilise déjà cette adresse e-mail.'
      : 'Impossible de modifier l’élève pour le moment.';
    response.status(error.code === '23505' ? 409 : 500).send(renderStudentForm({
      title: 'Modifier l’élève',
      action: `/students/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      classes,
      selectedClassIds,
      editing: true,
      error: message,
    }));
  } finally {
    client.release();
  }
});

router.post('/:id/deactivate', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Élève introuvable', 'Cet élève n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      'UPDATE students SET active = FALSE WHERE id = $1 AND active = TRUE RETURNING id',
      [request.params.id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage('Élève introuvable', 'Cet élève actif n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, '/students?notice=deactivated');
  } catch (error) {
    console.error('Unable to deactivate student:', error);
    const page = renderMessagePage('Désactivation impossible', 'Impossible de désactiver cet élève pour le moment.');
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
