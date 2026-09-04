const express = require('express');
const { pool } = require('./db/client');
const { sendMail } = require('./mail');
const {
  insertStudent,
  normalizeStudentValues,
  validateStudentValues,
} = require('./student-data');
const { createStudentQrEmail } = require('./student-qr-email');
const { createStudentQrPng } = require('./student-qr');
const { getTerm } = require('./terminology');
const { businessTerm, escapeHtml, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();

function studentQrMailErrorMessage(code) {
  return {
    NOT_CONFIGURED: 'La configuration e-mail est incomplète. Configurez-la avant d’envoyer un QR.',
    AUTHENTICATION_FAILED: 'L’authentification SMTP a échoué. Vérifiez la configuration e-mail.',
    CONNECTION_FAILED: 'Impossible de joindre le serveur SMTP. Vérifiez la configuration e-mail.',
    TLS_FAILED: 'La connexion sécurisée au serveur SMTP a échoué. Vérifiez la configuration e-mail.',
    SENDER_REJECTED: 'Le serveur SMTP a refusé l’adresse d’expéditeur configurée.',
    RECIPIENT_REJECTED: 'Le serveur SMTP a refusé l’adresse e-mail destinataire.',
    DELIVERY_FAILED: 'Le serveur SMTP n’a pas accepté l’e-mail contenant le QR.',
  }[code] || 'Le QR n’a pas pu être envoyé par e-mail pour le moment.';
}

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
  studentId = '',
  error = '',
}) {
  const selectedIds = new Set(selectedClassIds);
  const errorMessage = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : '';
  const classChoices = classes.length === 0
    ? '<p class="muted">Aucun choix disponible.</p>'
    : `<div class="checkbox-list">${classes.map((classRecord) => `
        <label class="checkbox-option">
          <input class="form-check-input" name="class_ids" type="checkbox" value="${classRecord.id}"${selectedIds.has(classRecord.id) ? ' checked' : ''}>
          <span>${escapeHtml(classRecord.name)}</span>
        </label>`).join('')}</div>`;
  const codeField = editing
    ? `<div class="form-field">
        <span class="field-label">Code d’identification</span>
        <strong class="student-code">${escapeHtml(values.student_code)}</strong>
      </div>`
    : '';
  const activeField = editing
    ? `<label class="checkbox-option">
        <input class="form-check-input" name="active" type="checkbox" value="true"${values.active ? ' checked' : ''}>
        <span>Statut global actif</span>
      </label>`
    : '';

  return renderPage(title, `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <h1>${escapeHtml(title)}</h1>
      </div>
      ${editing ? `<div class="context-actions d-flex flex-wrap gap-2">
        <a class="btn btn-outline-secondary" href="/students/${escapeHtml(studentId)}/qr">Afficher le QR</a>
      </div>` : ''}
    </header>
    ${errorMessage}
    <form class="card card-body app-form" method="post" action="${escapeHtml(action)}">
      <div class="form-field">
        <label for="first_name">Prénom <span aria-hidden="true">*</span></label>
        <input class="form-control" id="first_name" name="first_name" type="text" value="${escapeHtml(values.firstName || '')}" autocomplete="given-name" required>
      </div>

      <div class="form-field">
        <label for="last_name">Nom <span aria-hidden="true">*</span></label>
        <input class="form-control" id="last_name" name="last_name" type="text" value="${escapeHtml(values.lastName || '')}" autocomplete="family-name" required>
      </div>

      <div class="form-field">
        <label for="email">Adresse e-mail <span aria-hidden="true">*</span></label>
        <input class="form-control" id="email" name="email" type="email" value="${escapeHtml(values.email || '')}" autocomplete="email" spellcheck="false" required>
      </div>

      ${codeField}
      <fieldset>
        <legend>${businessTerm('class', 'plural')}</legend>
        ${classChoices}
      </fieldset>
      ${activeField}

      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="btn btn-outline-secondary" href="/students">Annuler</a>
      </div>
    </form>`);
}

async function addMemberships(client, studentId, classIds) {
  for (const classId of classIds) {
    await client.query(
      `INSERT INTO student_classes (student_id, class_id)
       VALUES ($1, $2)
       ON CONFLICT (student_id, class_id) DO NOTHING`,
      [studentId, classId],
    );
  }
}

function renderStudentQrPage(student, feedback = null) {
  const studentName = `${student.first_name} ${student.last_name}`;
  const feedbackMessage = feedback?.message
    ? `<p class="alert alert-${feedback.type === 'success' ? 'success' : 'danger'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';

  return renderPage(`QR de ${studentName}`, `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <p class="eyebrow">QR personnel</p>
        <h1>${escapeHtml(studentName)}</h1>
        <p class="page-description">Ce QR permet d’identifier la personne pendant l’enregistrement des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}.</p>
      </div>
      <div class="context-actions d-flex flex-wrap gap-2">
        <a class="btn btn-light" href="/students/${student.id}/edit">Retour à la fiche</a>
      </div>
    </header>
    <div class="notification-area" aria-live="polite" aria-atomic="true">
      ${feedbackMessage}
    </div>
    <section class="qr-display" aria-labelledby="student-qr-title">
      <div class="compact-identity student-identity">
        <h2 class="compact-title" id="student-qr-title">${escapeHtml(studentName)}</h2>
        <p class="compact-meta">Code d’identification · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>
        <span class="badge status-badge status-${student.active ? 'active' : 'inactive'}">Statut : ${student.active ? 'actif' : 'inactif'}</span>
      </div>
      <img class="student-qr-image" src="/students/${student.id}/qr.png" width="512" height="512" fetchpriority="high" alt="QR personnel de ${escapeHtml(studentName)}">
      <p class="section-description qr-instruction">Présentez ce QR lors de l’enregistrement des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}, directement sur l’écran ou en version imprimée.</p>
      <form class="form-actions qr-actions" method="post" action="/students/${student.id}/qr/email" data-submit-once>
        <button class="btn btn-primary" type="submit">Envoyer le QR</button>
        <a class="btn btn-outline-secondary" href="/students/${student.id}/qr.png?download=1" download="eleve-${escapeHtml(student.student_code)}-qr.png">Télécharger le QR</a>
      </form>
    </section>`);
}

router.get('/', async (request, response) => {
  const showInactive = request.query.status === 'inactive';

  try {
    const result = await pool.query(
      `SELECT s.id, s.first_name, s.last_name, s.email, s.student_code, s.active
       FROM students s
       WHERE s.active = $1
       ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id`,
      [!showInactive],
    );
    const notices = {
      created: 'La fiche a été créée.',
      updated: 'La fiche a été mise à jour.',
      deactivated: 'La fiche a été désactivée.',
    };
    const notice = notices[request.query.notice]
      ? `<p class="alert alert-success" role="status">${escapeHtml(notices[request.query.notice])}</p>`
      : '';
    const cards = result.rows.length === 0
      ? `<p class="empty-state">Aucun résultat dans les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')} ${showInactive ? 'inactifs' : 'actifs'}.</p>`
      : `<section data-filterable-list>
          <div class="search">
            <label for="student-search">Rechercher dans le répertoire</label>
            <div class="search-controls">
              <input class="form-control" id="student-search" name="student_filter" type="search" autocomplete="off" spellcheck="false" placeholder="Nom, e-mail ou code…" aria-controls="student-list" data-list-search>
            </div>
          </div>
          <p class="empty-state" role="status" data-list-no-results hidden>Aucun résultat.</p>
          <div class="list-group compact-list" id="student-list" data-list-results>${result.rows.map((student) => `
          <article class="list-group-item compact-row compact-row-status student-row" data-list-row data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.email} ${student.student_code}`.toLocaleLowerCase('fr'))}">
            <div class="compact-identity student-identity">
              <p class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</p>
              <p class="compact-meta"><a href="mailto:${escapeHtml(student.email)}">${escapeHtml(student.email)}</a> · <span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></p>
            </div>
            <div class="compact-status">
              <span class="badge status-badge status-${student.active ? 'active' : 'inactive'}">Statut : ${student.active ? 'actif' : 'inactif'}</span>
            </div>
            <div class="compact-actions" aria-label="Actions pour ${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}">
              <a class="btn btn-light" href="/students/${student.id}/edit">Modifier</a>
              ${student.active ? `<form method="post" action="/students/${student.id}/deactivate" data-confirm="Désactiver cette fiche ?">
                <button class="btn btn-outline-danger" type="submit">Désactiver</button>
              </form>` : ''}
            </div>
          </article>`).join('')}</div>
        </section>`;

    response.send(renderPage(getTerm('student', 'plural'), `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${businessTerm('student', 'plural')}</h1>
          <p class="page-description">${showInactive ? `Répertoire des ${businessTerm('student', 'plural').toLocaleLowerCase('fr')} inactifs.` : `Répertoire des ${businessTerm('student', 'plural').toLocaleLowerCase('fr')} actifs.`}</p>
        </div>
        <div class="context-actions d-flex flex-wrap gap-2">
          <a class="btn btn-primary" href="/students/new">Ajouter</a>
          <a class="btn btn-outline-secondary" href="/students/import">Importer</a>
        </div>
      </header>
      <nav class="nav nav-pills view-switch" aria-label="Filtrer les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')} par ${businessTerm('class').toLocaleLowerCase('fr')}">
        <a class="nav-link${showInactive ? '' : ' active'}" href="/students"${showInactive ? '' : ' aria-current="page"'}>Actifs</a>
        <a class="nav-link${showInactive ? ' active' : ''}" href="/students?status=inactive"${showInactive ? ' aria-current="page"' : ''}>Inactifs</a>
      </nav>
      ${notice}
      ${cards}`));
  } catch (error) {
    console.error('Unable to list students:', error);
    const page = renderMessagePage('Répertoire indisponible', 'Impossible de charger le répertoire pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/new', async (_request, response) => {
  try {
    const classes = await loadClasses();
    response.send(renderStudentForm({
      title: `Ajouter un ${getTerm('student').toLocaleLowerCase('fr')}`,
      action: '/students',
      submitLabel: 'Créer',
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
    const page = renderMessagePage('Création impossible', 'Impossible de créer la fiche pour le moment.');
    response.status(page.status).send(page.html);
    return;
  }

  const validationError = validateStudentValues(values)
    || (!classIdsAreValid(selectedClassIds, classes) ? 'La sélection contient une valeur invalide.' : '');
  if (validationError) {
    response.status(400).send(renderStudentForm({
      title: `Ajouter un ${getTerm('student').toLocaleLowerCase('fr')}`,
      action: '/students',
      submitLabel: 'Créer',
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
    if (selectedClassIds.length > 0) {
      await client.query(
        'SELECT id FROM classes WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
        [selectedClassIds],
      );
    }
    const student = await insertStudent(client, values);
    await addMemberships(client, student.id, selectedClassIds);
    await client.query('COMMIT');
    response.redirect(303, '/students?notice=created');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to create student:', error);
    const message = error.code === '23505'
      ? 'Cette adresse e-mail est déjà utilisée.'
      : 'Impossible de créer la fiche pour le moment.';
    response.status(error.code === '23505' ? 409 : 500).send(renderStudentForm({
      title: `Ajouter un ${getTerm('student').toLocaleLowerCase('fr')}`,
      action: '/students',
      submitLabel: 'Créer',
      values,
      classes,
      selectedClassIds,
      error: message,
    }));
  } finally {
    client.release();
  }
});

router.get('/:id/qr.png', async (request, response) => {
  if (!isValidId(request.params.id)) {
    response.status(404).end();
    return;
  }

  try {
    const result = await pool.query(
      'SELECT qr_token, student_code FROM students WHERE id = $1',
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
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, student_code, qr_token, active
       FROM students
       WHERE id = $1`,
      [request.params.id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    const feedback = request.query.notice === 'qr_sent'
      ? { type: 'success', message: `Le QR a été envoyé à ${result.rows[0].email}.` }
      : null;
    response.send(renderStudentQrPage(result.rows[0], feedback));
  } catch (error) {
    console.error('Unable to load student QR page:', error);
    const page = renderMessagePage('QR indisponible', 'Impossible de charger ce QR pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/qr/email', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  let student;
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, student_code, qr_token, active
       FROM students
       WHERE id = $1`,
      [request.params.id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    student = result.rows[0];
  } catch (error) {
    console.error('Unable to load student for QR email:', error.code || 'DATABASE_ERROR');
    const page = renderMessagePage('Envoi impossible', 'Impossible de charger la fiche pour le moment.');
    response.status(page.status).send(page.html);
    return;
  }

  if (!student.email) {
    response.status(400).send(renderStudentQrPage(student, {
      type: 'error',
      message: 'Aucune adresse e-mail n’est enregistrée pour cette personne.',
    }));
    return;
  }
  if (!student.qr_token) {
    response.status(409).send(renderStudentQrPage(student, {
      type: 'error',
      message: 'Le QR est indisponible pour cette personne.',
    }));
    return;
  }

  let message;
  try {
    const qrPng = await createStudentQrPng(student.qr_token);
    message = createStudentQrEmail(student, qrPng);
  } catch (error) {
    console.error('Unable to generate student QR email:', error.code || error.name || 'QR_ERROR');
    response.status(500).send(renderStudentQrPage(student, {
      type: 'error',
      message: 'Impossible de générer le QR à envoyer pour le moment.',
    }));
    return;
  }

  try {
    await sendMail({
      to: student.email,
      ...message,
    });
    response.redirect(303, `/students/${student.id}/qr?notice=qr_sent`);
  } catch (error) {
    console.error('Unable to send student QR email:', error.code || 'DELIVERY_FAILED');
    response.status(error.code === 'NOT_CONFIGURED' ? 409 : 502).send(renderStudentQrPage(student, {
      type: 'error',
      message: studentQrMailErrorMessage(error.code),
    }));
  }
});

router.get('/:id/edit', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
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
      const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
      response.status(page.status).send(page.html);
      return;
    }

    const student = studentResult.rows[0];
    response.send(renderStudentForm({
      title: `Modifier le ${getTerm('student').toLocaleLowerCase('fr')}`,
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
      studentId: student.id,
    }));
  } catch (error) {
    console.error('Unable to load student:', error);
    const page = renderMessagePage('Fiche indisponible', 'Impossible de charger la fiche pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const values = normalizeStudentValues(request.body);
  values.active = request.body.active === 'true';
  const selectedClassIds = getSelectedClassIds(request.body);
  const classes = await loadClasses();
  const currentResult = await pool.query('SELECT student_code FROM students WHERE id = $1', [request.params.id]);

  if (currentResult.rowCount === 0) {
    const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  values.student_code = currentResult.rows[0].student_code;
  const validationError = validateStudentValues(values)
    || (!classIdsAreValid(selectedClassIds, classes) ? 'La sélection contient une valeur invalide.' : '');
  if (validationError) {
    response.status(400).send(renderStudentForm({
      title: `Modifier le ${getTerm('student').toLocaleLowerCase('fr')}`,
      action: `/students/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      classes,
      selectedClassIds,
      editing: true,
      studentId: request.params.id,
      error: validationError,
    }));
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const membershipResult = await client.query(
      'SELECT class_id FROM student_classes WHERE student_id = $1 ORDER BY class_id',
      [request.params.id],
    );
    const selectedIds = new Set(selectedClassIds);
    const removedClassIds = membershipResult.rows
      .map((membership) => String(membership.class_id))
      .filter((classId) => !selectedIds.has(classId));
    const affectedClassIds = [...new Set([
      ...selectedClassIds,
      ...membershipResult.rows.map((membership) => String(membership.class_id)),
    ])];
    if (affectedClassIds.length > 0) {
      await client.query(
        'SELECT id FROM classes WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
        [affectedClassIds],
      );
    }
    if (removedClassIds.length > 0) {
      const protectedResult = await client.query(
        `SELECT c.name
         FROM classes c
         WHERE c.id = ANY($1::bigint[])
           AND EXISTS (
             SELECT 1 FROM course_sessions cs
             WHERE cs.class_id = c.id AND cs.started_at IS NOT NULL
           )
         ORDER BY LOWER(c.name)
         LIMIT 1`,
        [removedClassIds],
      );
      if (protectedResult.rowCount > 0) {
        await client.query('ROLLBACK');
        response.status(409).send(renderStudentForm({
          title: `Modifier le ${getTerm('student').toLocaleLowerCase('fr')}`,
          action: `/students/${request.params.id}`,
          submitLabel: 'Enregistrer',
          values,
          classes,
          selectedClassIds,
          editing: true,
          studentId: request.params.id,
          error: `Le retrait de « ${protectedResult.rows[0].name} » est impossible après le démarrage. Gérez son état depuis la rubrique ${getTerm('class', 'plural')}.`,
        }));
        return;
      }
    }
    await client.query(
      `UPDATE students
       SET first_name = $1, last_name = $2, email = $3, active = $4
       WHERE id = $5`,
      [values.firstName, values.lastName, values.email, values.active, request.params.id],
    );
    if (removedClassIds.length > 0) {
      await client.query(
        `DELETE FROM student_classes
         WHERE student_id = $1 AND class_id = ANY($2::bigint[])`,
        [request.params.id, removedClassIds],
      );
    }
    await addMemberships(client, request.params.id, selectedClassIds);
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
      ? 'Cette adresse e-mail est déjà utilisée.'
      : 'Impossible de modifier la fiche pour le moment.';
    response.status(error.code === '23505' ? 409 : 500).send(renderStudentForm({
      title: `Modifier le ${getTerm('student').toLocaleLowerCase('fr')}`,
      action: `/students/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      classes,
      selectedClassIds,
      editing: true,
      studentId: request.params.id,
      error: message,
    }));
  } finally {
    client.release();
  }
});

router.post('/:id/deactivate', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement ne correspond à cette demande.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT c.id
       FROM classes c
       INNER JOIN student_classes sc ON sc.class_id = c.id
       WHERE sc.student_id = $1
       ORDER BY c.id
       FOR UPDATE`,
      [request.params.id],
    );
    const result = await client.query(
      'UPDATE students SET active = FALSE WHERE id = $1 AND active = TRUE RETURNING id',
      [request.params.id],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      const page = renderMessagePage('Fiche introuvable', 'Aucun enregistrement actif ne correspond à cette demande.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    await client.query('COMMIT');
    response.redirect(303, '/students?notice=deactivated');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Unable to deactivate student:', error);
    const page = renderMessagePage('Désactivation impossible', 'Impossible de désactiver la fiche pour le moment.');
    response.status(page.status).send(page.html);
  } finally {
    client.release();
  }
});

module.exports = router;
