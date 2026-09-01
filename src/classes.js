const express = require('express');
const { pool } = require('./db/client');
const { escapeHtml, renderPage } = require('./ui');

const router = express.Router();

function renderMessagePage(title, message, status = 500) {
  return {
    status,
    html: renderPage(title, `
      <header class="page-header">
        <h1>${escapeHtml(title)}</h1>
      </header>
      <p class="message message-error">${escapeHtml(message)}</p>`),
  };
}

function getFormValues(body = {}) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    description: typeof body.description === 'string'
      ? body.description.trim()
      : '',
  };
}

function renderClassForm({ title, action, submitLabel, values, error = '' }) {
  const errorMessage = error
    ? `<p class="message message-error" role="alert">${escapeHtml(error)}</p>`
    : '';

  return renderPage(title, `
    <header class="page-header">
      <h1>${escapeHtml(title)}</h1>
    </header>
    ${errorMessage}
    <form class="form-card" method="post" action="${escapeHtml(action)}">
      <label for="name">Nom <span aria-hidden="true">*</span></label>
      <input id="name" name="name" type="text" value="${escapeHtml(values.name || '')}" required autofocus>

      <label for="description">Description</label>
      <textarea id="description" name="description" rows="5">${escapeHtml(values.description || '')}</textarea>

      <div class="form-actions">
        <button class="button" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="button button-secondary" href="/classes">Annuler</a>
      </div>
    </form>`);
}

function isValidId(id) {
  return /^[1-9]\d*$/.test(id);
}

function getStudentIds(body = {}) {
  const rawStudentIds = Array.isArray(body.student_ids)
    ? body.student_ids
    : body.student_ids ? [body.student_ids] : [];

  return [...new Set(rawStudentIds.filter((studentId) => isValidId(studentId)))];
}

router.get('/', async (request, response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description FROM classes ORDER BY LOWER(name), id',
    );
    const notices = {
      created: 'La classe a été créée.',
      updated: 'La classe a été modifiée.',
      deleted: 'La classe a été supprimée.',
    };
    const notice = notices[request.query.notice]
      ? `<p class="message message-success" role="status">${notices[request.query.notice]}</p>`
      : '';
    const classList = result.rows.length === 0
      ? '<p class="empty-state">Aucune classe pour le moment.</p>'
      : `<div class="card-list">${result.rows.map((classRecord) => `
          <article class="class-card">
            <div>
              <h2>${escapeHtml(classRecord.name)}</h2>
              <p class="class-description">${classRecord.description
                ? escapeHtml(classRecord.description)
                : '<span class="muted">Aucune description</span>'}</p>
            </div>
            <div class="card-actions">
              <a class="button" href="/classes/${classRecord.id}">Gérer les élèves</a>
              <a class="button button-secondary" href="/classes/${classRecord.id}/edit">Modifier</a>
              <form method="post" action="/classes/${classRecord.id}/delete" data-confirm="Supprimer cette classe ?">
                <button class="button button-danger" type="submit">Supprimer</button>
              </form>
            </div>
          </article>`).join('')}</div>`;

    response.send(renderPage('Classes', `
      <header class="page-header">
        <h1>Classes</h1>
        <a class="button" href="/classes/new">Ajouter</a>
      </header>
      ${notice}
      ${classList}`));
  } catch (error) {
    console.error('Unable to list classes:', error);
    const page = renderMessagePage(
      'Classes indisponibles',
      'Impossible de charger les classes pour le moment.',
    );
    response.status(page.status).send(page.html);
  }
});

router.get('/new', (_request, response) => {
  response.send(renderClassForm({
    title: 'Ajouter une classe',
    action: '/classes',
    submitLabel: 'Créer la classe',
    values: { name: '', description: '' },
  }));
});

router.post('/', async (request, response) => {
  const values = getFormValues(request.body);

  if (!values.name) {
    response.status(400).send(renderClassForm({
      title: 'Ajouter une classe',
      action: '/classes',
      submitLabel: 'Créer la classe',
      values,
      error: 'Le nom est obligatoire.',
    }));
    return;
  }

  try {
    await pool.query(
      'INSERT INTO classes (name, description) VALUES ($1, $2)',
      [values.name, values.description || null],
    );
    response.redirect(303, '/classes?notice=created');
  } catch (error) {
    console.error('Unable to create class:', error);
    response.status(500).send(renderClassForm({
      title: 'Ajouter une classe',
      action: '/classes',
      submitLabel: 'Créer la classe',
      values,
      error: 'Impossible de créer la classe pour le moment.',
    }));
  }
});

router.get('/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const [classResult, assignedResult, availableResult] = await Promise.all([
      pool.query('SELECT id, name, description FROM classes WHERE id = $1', [request.params.id]),
      pool.query(
        `SELECT s.id, s.first_name, s.last_name, s.email, s.student_code
         FROM students s
         INNER JOIN student_classes sc ON sc.student_id = s.id
         WHERE sc.class_id = $1 AND s.active = TRUE
         ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
        [request.params.id],
      ),
      pool.query(
        `SELECT s.id, s.first_name, s.last_name, s.email
         FROM students s
         WHERE s.active = TRUE
           AND NOT EXISTS (
             SELECT 1 FROM student_classes sc
             WHERE sc.student_id = s.id AND sc.class_id = $1
           )
         ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
        [request.params.id],
      ),
    ]);

    if (classResult.rowCount === 0) {
      const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    const classRecord = classResult.rows[0];
    const notices = {
      students_added: 'Les élèves sélectionnés ont été ajoutés.',
      no_students_added: 'Aucune nouvelle affectation n’a été ajoutée.',
      student_removed: 'L’élève a été retiré de la classe.',
    };
    const notice = notices[request.query.notice]
      ? `<p class="message message-success" role="status">${notices[request.query.notice]}</p>`
      : '';
    const assignedStudents = assignedResult.rows.length === 0
      ? '<p class="empty-state">Aucun élève actif dans cette classe.</p>'
      : `<div class="card-list">${assignedResult.rows.map((student) => `
          <article class="student-card">
            <div>
              <h2>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</h2>
              <p>${escapeHtml(student.email)}</p>
              <p><strong>Code :</strong> <span class="student-code">${escapeHtml(student.student_code)}</span></p>
            </div>
            <div class="card-actions">
              <a class="button button-secondary" href="/students/${student.id}/edit">Modifier</a>
              <form method="post" action="/classes/${classRecord.id}/students/${student.id}/remove" data-confirm="Retirer cet élève de la classe ?">
                <button class="button button-danger" type="submit">Retirer de la classe</button>
              </form>
            </div>
          </article>`).join('')}</div>`;
    const availableStudents = availableResult.rows.length === 0
      ? '<p class="muted">Aucun autre élève actif disponible.</p>'
      : `<form class="form-card" method="post" action="/classes/${classRecord.id}/students">
          <fieldset>
            <legend>Élèves à ajouter</legend>
            <div class="checkbox-list">${availableResult.rows.map((student) => `
              <label class="checkbox-option">
                <input name="student_ids" type="checkbox" value="${student.id}">
                <span>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}<small>${escapeHtml(student.email)}</small></span>
              </label>`).join('')}</div>
          </fieldset>
          <button class="button" type="submit">Ajouter les élèves sélectionnés</button>
        </form>`;

    response.send(renderPage(classRecord.name, `
      <header class="page-header">
        <div>
          <h1>${escapeHtml(classRecord.name)}</h1>
          <p class="class-description">${classRecord.description
            ? escapeHtml(classRecord.description)
            : '<span class="muted">Aucune description</span>'}</p>
        </div>
        <div class="context-actions">
          <a class="button button-secondary" href="/classes/${classRecord.id}/edit">Modifier la classe</a>
          <a class="button" href="/students/import?class_id=${classRecord.id}">Importer dans cette classe</a>
        </div>
      </header>
      ${notice}
      <section class="page-section">
        <h2>Élèves actifs affectés</h2>
        ${assignedStudents}
      </section>
      <section class="page-section">
        <h2>Ajouter des élèves existants</h2>
        ${availableStudents}
      </section>`));
  } catch (error) {
    console.error('Unable to load class memberships:', error);
    const page = renderMessagePage('Classe indisponible', 'Impossible de charger cette classe pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/students', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const studentIds = getStudentIds(request.body);

  try {
    const classResult = await pool.query('SELECT id FROM classes WHERE id = $1', [request.params.id]);
    if (classResult.rowCount === 0) {
      const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    if (studentIds.length === 0) {
      response.redirect(303, `/classes/${request.params.id}?notice=no_students_added`);
      return;
    }

    const result = await pool.query(
      `INSERT INTO student_classes (student_id, class_id)
       SELECT s.id, $1
       FROM students s
       WHERE s.active = TRUE AND s.id = ANY($2::bigint[])
       ON CONFLICT DO NOTHING`,
      [request.params.id, studentIds],
    );
    response.redirect(
      303,
      `/classes/${request.params.id}?notice=${result.rowCount > 0 ? 'students_added' : 'no_students_added'}`,
    );
  } catch (error) {
    console.error('Unable to add class memberships:', error);
    const page = renderMessagePage('Affectation impossible', 'Impossible d’ajouter les élèves à cette classe pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/students/:studentId/remove', async (request, response) => {
  if (!isValidId(request.params.id) || !isValidId(request.params.studentId)) {
    const page = renderMessagePage('Affectation introuvable', 'Cette affectation n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      `DELETE FROM student_classes sc
       USING students s
       WHERE sc.class_id = $1
         AND sc.student_id = $2
         AND s.id = sc.student_id
         AND s.active = TRUE
       RETURNING sc.student_id`,
      [request.params.id, request.params.studentId],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage('Affectation introuvable', 'Cette affectation active n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/classes/${request.params.id}?notice=student_removed`);
  } catch (error) {
    console.error('Unable to remove class membership:', error);
    const page = renderMessagePage('Retrait impossible', 'Impossible de retirer cet élève de la classe pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/:id/edit', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, name, description FROM classes WHERE id = $1',
      [request.params.id],
    );

    if (result.rowCount === 0) {
      const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    response.send(renderClassForm({
      title: 'Modifier la classe',
      action: `/classes/${result.rows[0].id}`,
      submitLabel: 'Enregistrer',
      values: result.rows[0],
    }));
  } catch (error) {
    console.error('Unable to load class:', error);
    const page = renderMessagePage(
      'Classe indisponible',
      'Impossible de charger cette classe pour le moment.',
    );
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const values = getFormValues(request.body);

  if (!values.name) {
    response.status(400).send(renderClassForm({
      title: 'Modifier la classe',
      action: `/classes/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      error: 'Le nom est obligatoire.',
    }));
    return;
  }

  try {
    const result = await pool.query(
      'UPDATE classes SET name = $1, description = $2 WHERE id = $3 RETURNING id',
      [values.name, values.description || null, request.params.id],
    );

    if (result.rowCount === 0) {
      const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    response.redirect(303, '/classes?notice=updated');
  } catch (error) {
    console.error('Unable to update class:', error);
    response.status(500).send(renderClassForm({
      title: 'Modifier la classe',
      action: `/classes/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      error: 'Impossible de modifier la classe pour le moment.',
    }));
  }
});

router.post('/:id/delete', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      'DELETE FROM classes WHERE id = $1 RETURNING id',
      [request.params.id],
    );

    if (result.rowCount === 0) {
      const page = renderMessagePage('Classe introuvable', 'Cette classe n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    response.redirect(303, '/classes?notice=deleted');
  } catch (error) {
    if (error.code === '23503') {
      const page = renderMessagePage(
        'Suppression impossible',
        'Cette classe est liée à une session de cours et ne peut pas être supprimée.',
        409,
      );
      response.status(page.status).send(page.html);
      return;
    }

    console.error('Unable to delete class:', error);
    const page = renderMessagePage(
      'Suppression impossible',
      'Impossible de supprimer cette classe pour le moment.',
    );
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
