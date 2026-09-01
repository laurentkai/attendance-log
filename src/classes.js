const express = require('express');
const { pool } = require('./db/client');

const router = express.Router();

const htmlEscapes = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

function renderPage(title, content) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} · Attendance Log</title>
    <link rel="stylesheet" href="/css/styles.css">
    <script src="/js/classes.js" defer></script>
  </head>
  <body>
    <main class="page">
      ${content}
    </main>
  </body>
</html>`;
}

function renderMessagePage(title, message, status = 500) {
  return {
    status,
    html: renderPage(title, `
      <header class="page-header">
        <div>
          <a class="back-link" href="/classes">← Retour aux classes</a>
          <h1>${escapeHtml(title)}</h1>
        </div>
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
      <div>
        <a class="back-link" href="/classes">← Retour aux classes</a>
        <h1>${escapeHtml(title)}</h1>
      </div>
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
              <a class="button button-secondary" href="/classes/${classRecord.id}/edit">Modifier</a>
              <form method="post" action="/classes/${classRecord.id}/delete" data-confirm="Supprimer cette classe ?">
                <button class="button button-danger" type="submit">Supprimer</button>
              </form>
            </div>
          </article>`).join('')}</div>`;

    response.send(renderPage('Classes', `
      <header class="page-header">
        <div>
          <a class="back-link" href="/">← Accueil</a>
          <h1>Classes</h1>
        </div>
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
