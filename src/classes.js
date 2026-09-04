const express = require('express');
const { pool } = require('./db/client');
const { getTerm } = require('./terminology');
const { isValidPublicId } = require('./public-id');
const { businessTerm, escapeHtml, renderPage } = require('./ui');

const router = express.Router();

function renderMessagePage(title, message, status = 500) {
  return {
    status,
    html: renderPage(title, `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${escapeHtml(title)}</h1>
        </div>
      </header>
      <p class="alert alert-danger">${escapeHtml(message)}</p>`),
  };
}

function renderClassNotFoundPage() {
  return renderMessagePage('Fiche introuvable', 'L’élément demandé n’existe pas.', 404);
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
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : '';

  return renderPage(title, `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <h1>${escapeHtml(title)}</h1>
      </div>
    </header>
    ${errorMessage}
    <form class="card card-body app-form" method="post" action="${escapeHtml(action)}">
      <div class="form-field">
        <label for="name">Nom <span aria-hidden="true">*</span></label>
        <input class="form-control" id="name" name="name" type="text" value="${escapeHtml(values.name || '')}" autocomplete="off" required>
      </div>

      <div class="form-field">
        <label for="description">Description</label>
        <textarea class="form-control" id="description" name="description" rows="5" autocomplete="off">${escapeHtml(values.description || '')}</textarea>
      </div>

      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="btn btn-outline-secondary" href="/classes">Annuler</a>
      </div>
    </form>`);
}

function getStudentIds(body = {}) {
  const rawStudentIds = Array.isArray(body.student_ids)
    ? body.student_ids
    : body.student_ids ? [body.student_ids] : [];

  return [...new Set(rawStudentIds.filter((studentId) => isValidPublicId(studentId)))];
}

router.get('/', async (request, response) => {
  try {
    const result = await pool.query(
      'SELECT public_id, name, description FROM classes ORDER BY LOWER(name), id',
    );
    const notices = {
      created: 'La fiche a été créée.',
      updated: 'La fiche a été mise à jour.',
      deleted: 'La fiche a été supprimée.',
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-success" role="status">${escapeHtml(notices[request.query.notice])}</p>`
      : '';
    const classList = result.rows.length === 0
      ? `<p class="empty-state">Aucune ${businessTerm('class').toLocaleLowerCase('fr')} n’est enregistrée pour le moment.</p>`
      : `<div class="list-group compact-list">${result.rows.map((classRecord) => `
          <article class="list-group-item compact-row class-management-row">
            <div class="compact-identity class-identity">
              <p class="compact-title">${escapeHtml(classRecord.name)}</p>
              <p class="compact-meta class-description">${classRecord.description
                ? escapeHtml(classRecord.description)
                : '<span class="muted">Aucune description</span>'}</p>
            </div>
            <div class="row-action-stack">
              <div class="compact-actions compact-actions--split" aria-label="Gérer ${escapeHtml(classRecord.name)}">
                <a class="btn btn-outline-secondary" href="/classes/${classRecord.public_id}">${businessTerm('student', 'plural')}</a>
                <a class="btn btn-outline-secondary" href="/sessions?class_id=${classRecord.public_id}">${businessTerm('session', 'plural')}</a>
              </div>
              <div class="compact-actions" aria-label="Administration de ${escapeHtml(classRecord.name)}">
                <a class="btn btn-light" href="/classes/${classRecord.public_id}/edit">Modifier</a>
                <form method="post" action="/classes/${classRecord.public_id}/delete" data-confirm="Supprimer cette fiche ?">
                  <button class="btn btn-outline-danger" type="submit">Supprimer</button>
                </form>
              </div>
            </div>
          </article>`).join('')}</div>`;

    response.send(renderPage(getTerm('class', 'plural'), `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${businessTerm('class', 'plural')}</h1>
          <p class="page-description">Accédez directement aux ${businessTerm('student', 'plural').toLocaleLowerCase('fr')} ou aux ${businessTerm('session', 'plural').toLocaleLowerCase('fr')}.</p>
        </div>
        <a class="btn btn-primary" href="/classes/new">Ajouter</a>
      </header>
      ${notice}
      ${classList}`));
  } catch (error) {
    console.error('Unable to list classes:', error);
    const page = renderMessagePage(
      'Liste indisponible',
      'Impossible de charger la liste pour le moment.',
    );
    response.status(page.status).send(page.html);
  }
});

router.get('/new', (_request, response) => {
  response.send(renderClassForm({
    title: `Ajouter une ${getTerm('class').toLocaleLowerCase('fr')}`,
    action: '/classes',
    submitLabel: 'Créer',
    values: { name: '', description: '' },
  }));
});

router.post('/', async (request, response) => {
  const values = getFormValues(request.body);

  if (!values.name) {
    response.status(400).send(renderClassForm({
      title: `Ajouter une ${getTerm('class').toLocaleLowerCase('fr')}`,
      action: '/classes',
      submitLabel: 'Créer',
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
      title: `Ajouter une ${getTerm('class').toLocaleLowerCase('fr')}`,
      action: '/classes',
      submitLabel: 'Créer',
      values,
      error: 'Impossible de créer la fiche pour le moment.',
    }));
  }
});

router.get('/:id', async (request, response) => {
  if (!isValidPublicId(request.params.id)) {
    const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
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
      const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    const classRecord = classResult.rows[0];
    const notices = {
      students_added: 'Les personnes sélectionnées ont été ajoutées.',
      no_students_added: 'Aucun ajout n’a été effectué.',
      student_removed: 'La personne a été retirée.',
      membership_deactivated: `L’${getTerm('membership').toLocaleLowerCase('fr')} a été désactivée.`,
      membership_reactivated: `L’${getTerm('membership').toLocaleLowerCase('fr')} a été réactivée.`,
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-success" role="status">${escapeHtml(notices[request.query.notice])}</p>`
      : '';
    const assignedStudents = assignedResult.rows.length === 0
      ? `<p class="empty-state">Aucune ${businessTerm('membership').toLocaleLowerCase('fr')} n’est enregistrée ici.</p>`
      : `<section data-filterable-list>
          <div class="search">
            <label for="class-roster-search">Rechercher dans les ${businessTerm('membership', 'plural').toLocaleLowerCase('fr')}</label>
            <div class="search-controls">
              <input class="form-control" id="class-roster-search" name="class_roster_filter" type="search" autocomplete="off" spellcheck="false" placeholder="Nom, e-mail ou code…" aria-controls="class-roster-list" data-list-search>
            </div>
          </div>
          <p class="empty-state" role="status" data-list-no-results hidden>Aucun résultat.</p>
          <div class="list-group compact-list" id="class-roster-list" data-list-results>${assignedResult.rows.map((student) => `
          <article class="list-group-item compact-row compact-row-status student-row" data-list-row data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.email} ${student.student_code}`.toLocaleLowerCase('fr'))}">
            <div class="compact-identity student-identity">
              <p class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</p>
              <p class="compact-meta">${escapeHtml(student.email)} · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>
            </div>
            <div class="compact-status">
              <span class="badge status-badge status-${student.membership_active ? 'active' : 'inactive'}">${businessTerm('membership')} : ${student.membership_active ? 'active' : 'inactive'}</span>
            </div>
            <div class="compact-actions" aria-label="Actions pour ${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}">
              <a class="btn btn-light" href="/students/${student.public_id}/edit">Modifier la fiche</a>
              <form method="post" action="/classes/${classRecord.public_id}/students/${student.public_id}/${student.membership_active ? 'deactivate' : 'reactivate'}">
                <button class="btn btn-outline-secondary" type="submit">${student.membership_active ? 'Désactiver' : 'Réactiver'}</button>
              </form>
              ${classRecord.membership_locked ? '' : `<form method="post" action="/classes/${classRecord.public_id}/students/${student.public_id}/remove" data-confirm="Retirer ce ${businessTerm('student').toLocaleLowerCase('fr')} de cette ${businessTerm('class').toLocaleLowerCase('fr')} ?">
                <button class="btn btn-outline-danger" type="submit">Retirer</button>
              </form>`}
            </div>
          </article>`).join('')}</div>
        </section>`;
    const availableStudents = !canSearch
      ? `<p class="empty-state">Saisissez au moins 2 caractères pour rechercher un ${businessTerm('student').toLocaleLowerCase('fr')} actif.</p>`
      : availableResult.rows.length === 0
      ? '<p class="empty-state">Aucun résultat disponible.</p>'
      : `<form class="card card-body app-form" method="post" action="/classes/${classRecord.public_id}/students">
          <fieldset>
            <legend>${businessTerm('student', 'plural')} à ajouter</legend>
            <div class="checkbox-list">${availableResult.rows.map((student) => `
              <label class="checkbox-option">
                <input class="form-check-input" name="student_ids" type="checkbox" value="${student.public_id}">
                <span>${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}<small>${escapeHtml(student.email)}</small></span>
              </label>`).join('')}</div>
          </fieldset>
          <button class="btn btn-primary" type="submit">Ajouter la sélection</button>
        </form>`;

    response.send(renderPage(classRecord.name, `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${escapeHtml(classRecord.name)}</h1>
          <p class="page-description class-description">${classRecord.description
            ? escapeHtml(classRecord.description)
            : '<span class="muted">Aucune description</span>'}</p>
        </div>
        <a class="btn btn-outline-secondary" href="/classes/${classRecord.public_id}/edit">Modifier la fiche</a>
      </header>
      <nav class="nav nav-pills context-tabs" aria-label="Gestion de « ${escapeHtml(classRecord.name)} »">
        <a class="nav-link active" href="/classes/${classRecord.public_id}" aria-current="page">${businessTerm('student', 'plural')}</a>
        <a class="nav-link" href="/sessions?class_id=${classRecord.public_id}">${businessTerm('session', 'plural')}</a>
      </nav>
      ${notice}
      ${classRecord.membership_locked
        ? `<p class="alert alert-warning" role="status">Cette ${businessTerm('class').toLocaleLowerCase('fr')} a déjà commencé. Les ${businessTerm('membership', 'plural').toLocaleLowerCase('fr')} sont conservées pour protéger l’historique. Désactivez une ${businessTerm('membership').toLocaleLowerCase('fr')} pour les prochaines ${businessTerm('session', 'plural').toLocaleLowerCase('fr')}.</p>`
        : ''}
      <section class="page-section">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2>${businessTerm('membership', 'plural')}</h2>
            <p class="section-description">L’état affiché concerne uniquement cette ${businessTerm('class').toLocaleLowerCase('fr')}.</p>
          </div>
          <a class="btn btn-outline-secondary" href="/students/import?class_id=${classRecord.public_id}">Importer</a>
        </div>
        ${assignedStudents}
      </section>
      <section class="page-section">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2>Ajouter des ${businessTerm('student', 'plural').toLocaleLowerCase('fr')}</h2>
          </div>
        </div>
        <form class="search" method="get" action="/classes/${classRecord.public_id}" role="search">
          <label for="membership-search">Rechercher un ${businessTerm('student').toLocaleLowerCase('fr')} actif</label>
          <div class="search-controls">
            <input class="form-control" id="membership-search" name="q" type="search" value="${escapeHtml(searchQuery)}" autocomplete="off" spellcheck="false" placeholder="Nom, e-mail ou code…">
            <button class="btn btn-primary" type="submit">Rechercher</button>
            ${searchQuery ? `<a class="btn btn-outline-secondary" href="/classes/${classRecord.public_id}">Effacer</a>` : ''}
          </div>
        </form>
        ${availableStudents}
      </section>`));
  } catch (error) {
    console.error('Unable to load class memberships:', error);
    const page = renderMessagePage('Fiche indisponible', 'Impossible de charger l’élément demandé pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/students', async (request, response) => {
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  const studentIds = getStudentIds(request.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const classResult = await client.query('SELECT id, public_id FROM classes WHERE public_id = $1 FOR UPDATE', [request.params.id]);
    if (classResult.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    if (studentIds.length === 0) {
      await client.query('ROLLBACK');
      response.redirect(303, `/classes/${request.params.id}?notice=no_students_added`);
      return;
    }

    const result = await client.query(
      `INSERT INTO student_classes (student_id, class_id)
       SELECT s.id, $1
       FROM students s
       WHERE s.active = TRUE AND s.public_id = ANY($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [classResult.rows[0].id, studentIds],
    );
    await client.query('COMMIT');
    response.redirect(
      303,
      `/classes/${request.params.id}?notice=${result.rowCount > 0 ? 'students_added' : 'no_students_added'}`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to add class memberships:', error);
    const page = renderMessagePage('Ajout impossible', 'Impossible d’ajouter la sélection pour le moment.');
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
});

router.post('/:id/students/:studentId/remove', async (request, response) => {
  if (!isValidPublicId(request.params.id) || !isValidPublicId(request.params.studentId)) {
    const page = renderMessagePage('Affectation introuvable', 'Cette affectation n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const classResult = await client.query('SELECT id FROM classes WHERE public_id = $1 FOR UPDATE', [request.params.id]);
    if (classResult.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    const startedResult = await client.query(
      'SELECT 1 FROM course_sessions WHERE class_id = $1 AND started_at IS NOT NULL LIMIT 1',
      [classResult.rows[0].id],
    );
    if (startedResult.rowCount > 0) {
      await client.query('ROLLBACK');
      const page = renderMessagePage(
        'Retrait impossible',
        `Cette ${getTerm('class').toLocaleLowerCase('fr')} a déjà commencé. Désactivez la ${getTerm('membership').toLocaleLowerCase('fr')} pour préserver l’historique.`,
        409,
      );
      response.status(page.status).send(page.html);
      return;
    }
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
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderMessagePage('Affectation introuvable', 'Cette affectation active n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    await client.query('COMMIT');
    response.redirect(303, `/classes/${request.params.id}?notice=student_removed`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to remove class membership:', error);
    const page = renderMessagePage('Retrait impossible', 'Impossible de retirer cette personne pour le moment.');
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
});

async function updateMembershipActivity(request, response, active) {
  if (!isValidPublicId(request.params.id) || !isValidPublicId(request.params.studentId)) {
    const page = renderMessagePage('Affectation introuvable', 'Cette affectation n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const classResult = await client.query('SELECT id FROM classes WHERE public_id = $1 FOR UPDATE', [request.params.id]);
    if (classResult.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
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
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderMessagePage('Affectation introuvable', 'Cette affectation active ne peut pas être modifiée.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    await client.query('COMMIT');
    response.redirect(303, `/classes/${request.params.id}?notice=${active ? 'membership_reactivated' : 'membership_deactivated'}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to update class membership activity:', error);
    const page = renderMessagePage('Modification impossible', 'Impossible de modifier cette affectation pour le moment.');
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
}

router.post('/:id/students/:studentId/deactivate', (request, response) => (
  updateMembershipActivity(request, response, false)
));

router.post('/:id/students/:studentId/reactivate', (request, response) => (
  updateMembershipActivity(request, response, true)
));

router.get('/:id/edit', async (request, response) => {
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, public_id, name, description FROM classes WHERE public_id = $1',
      [request.params.id],
    );

    if (result.rowCount === 0) {
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    response.send(renderClassForm({
      title: `Modifier l’${getTerm('class').toLocaleLowerCase('fr')}`,
      action: `/classes/${result.rows[0].public_id}`,
      submitLabel: 'Enregistrer',
      values: result.rows[0],
    }));
  } catch (error) {
    console.error('Unable to load class:', error);
    const page = renderMessagePage(
      'Fiche indisponible',
      'Impossible de charger l’élément demandé pour le moment.',
    );
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', async (request, response) => {
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  const values = getFormValues(request.body);

  if (!values.name) {
    response.status(400).send(renderClassForm({
      title: `Modifier l’${getTerm('class').toLocaleLowerCase('fr')}`,
      action: `/classes/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      error: 'Le nom est obligatoire.',
    }));
    return;
  }

  try {
    const result = await pool.query(
      'UPDATE classes SET name = $1, description = $2 WHERE public_id = $3 RETURNING id',
      [values.name, values.description || null, request.params.id],
    );

    if (result.rowCount === 0) {
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    response.redirect(303, '/classes?notice=updated');
  } catch (error) {
    console.error('Unable to update class:', error);
    response.status(500).send(renderClassForm({
      title: `Modifier l’${getTerm('class').toLocaleLowerCase('fr')}`,
      action: `/classes/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      error: 'Impossible d’enregistrer les modifications pour le moment.',
    }));
  }
});

router.post('/:id/delete', async (request, response) => {
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      'DELETE FROM classes WHERE public_id = $1 RETURNING id',
      [request.params.id],
    );

    if (result.rowCount === 0) {
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    response.redirect(303, '/classes?notice=deleted');
  } catch (error) {
    if (error.code === '23503') {
      const page = renderMessagePage(
        'Suppression impossible',
        `Cette fiche est liée à une ${getTerm('session').toLocaleLowerCase('fr')} et ne peut pas être supprimée.`,
        409,
      );
      response.status(page.status).send(page.html);
      return;
    }

    console.error('Unable to delete class:', error);
    const page = renderMessagePage(
      'Suppression impossible',
      'Impossible de supprimer la fiche pour le moment.',
    );
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
