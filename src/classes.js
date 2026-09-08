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
}) {
  const errorMessage = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : '';

  const logoMessages = {
    saved: ['success', 'Le logo de cette activité a été enregistré.'],
    removed: ['success', 'Le logo propre à cette activité a été supprimé. Le logo de l’installation sera utilisé.'],
    invalid: ['danger', 'Choisissez une image PNG ou JPEG valide de 2 Mo maximum.'],
    failed: ['danger', 'Impossible d’enregistrer le logo pour le moment.'],
  };
  const logoFeedback = logoMessages[logoNotice];
  const logoSection = classId ? `<section class="page-section mt-4" aria-labelledby="activity-logo-title">
    <div class="section-header">
      <div>
        <h2 id="activity-logo-title">Logo de l’${businessTerm('class').toLocaleLowerCase('fr')}</h2>
        <p class="section-description">Ce logo remplace celui de l’installation pour les badges et e-mails QR liés à cette activité.</p>
      </div>
    </div>
    ${logoFeedback ? `<p class="alert alert-${logoFeedback[0]}" role="${logoFeedback[0] === 'success' ? 'status' : 'alert'}">${escapeHtml(logoFeedback[1])}</p>` : ''}
    <div class="card card-body app-form">
      ${hasLogo ? `<div class="branding-logo-preview">
        <img src="/classes/${escapeHtml(classId)}/logo" width="240" height="96" alt="Logo actuel de cette activité">
      </div>` : '<p class="empty-state mb-0">Aucun logo propre n’est configuré. Le logo de l’installation est utilisé par défaut.</p>'}
      <form class="app-form" method="post" action="/classes/${escapeHtml(classId)}/logo" enctype="multipart/form-data">
        <div class="form-field">
          <label for="activity-logo">${hasLogo ? 'Remplacer le logo' : 'Choisir un logo'}</label>
          <input class="form-control" id="activity-logo" name="logo" type="file" accept="image/png,image/jpeg" required>
        </div>
        <div class="form-actions"><button class="btn btn-primary" type="submit">${hasLogo ? 'Remplacer' : 'Enregistrer'}</button></div>
      </form>
      ${hasLogo ? `<form method="post" action="/classes/${escapeHtml(classId)}/logo/remove" data-confirm="Supprimer le logo propre à cette activité ?">
        <button class="btn btn-outline-danger" type="submit">Supprimer le logo</button>
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
        <label for="name">Nom <span aria-hidden="true">*</span></label>
        <input class="form-control" id="name" name="name" type="text" value="${escapeHtml(values.name || '')}" autocomplete="off" required>
      </div>

      <div class="form-field">
        <label for="description">Description</label>
        <textarea class="form-control" id="description" name="description" rows="5" autocomplete="off">${escapeHtml(values.description || '')}</textarea>
      </div>

      <div class="form-field">
        <label for="punctuality-tolerance">Tolérance de ponctualité</label>
        <select class="form-select" id="punctuality-tolerance" name="punctuality_tolerance_minutes" required>
          ${TOLERANCE_VALUES.map((minutes) => `<option value="${minutes}"${Number(values.punctuality_tolerance_minutes) === minutes ? ' selected' : ''}>+${minutes} minutes</option>`).join('')}
        </select>
        <p class="form-text mb-0">Cette valeur s’applique aux sessions qui héritent du réglage de l’activité.</p>
      </div>

      ${renderSummaryConfigurationFields({ adminUsers, values, scope: 'class' })}

      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button>
        <a class="btn btn-outline-secondary" href="/classes">Annuler</a>
      </div>
    </form>
    ${logoSection}`);
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

router.get('/new', async (_request, response) => {
  try {
    response.send(renderClassForm({
      title: `Ajouter une ${getTerm('class').toLocaleLowerCase('fr')}`,
      action: '/classes',
      submitLabel: 'Créer',
      values: {
        name: '', description: '', punctuality_tolerance_minutes: 5,
        adminRecipientIds: [], externalRecipients: [], attachXlsx: false,
      },
      adminUsers: await loadSummaryAdminOptions(),
    }));
  } catch (error) {
    console.error('Unable to load class form:', error.code || error.message);
    const page = renderMessagePage('Formulaire indisponible', 'Impossible de charger le formulaire pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/', async (request, response) => {
  const values = getFormValues(request.body);

  if (!values.name || !isValidTolerance(values.punctuality_tolerance_minutes) || values.summaryConfigurationError) {
    response.status(400).send(renderClassForm({
      title: `Ajouter une ${getTerm('class').toLocaleLowerCase('fr')}`,
      action: '/classes',
      submitLabel: 'Créer',
      values,
      error: !values.name
        ? 'Le nom est obligatoire.'
        : values.summaryConfigurationError
          ? 'Vérifiez les destinataires du résumé automatique.'
          : 'Sélectionnez une tolérance de ponctualité valide.',
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
    }));
    return;
  }

  try {
    await withTransaction(pool, async (client) => {
      const result = await client.query(
        `INSERT INTO classes (name, description, punctuality_tolerance_minutes)
         VALUES ($1, $2, $3) RETURNING id, public_id`,
        [values.name, values.description || null, values.punctuality_tolerance_minutes],
      );
      await saveClassSummaryConfiguration(client, result.rows[0].id, values);
      await recordAuditEvent({
        client, category: 'class', action: 'class.create', targetType: 'class',
        targetPublicId: result.rows[0].public_id, targetLabel: values.name,
        summary: 'Activité créée.', afterData: {
          name: values.name,
          description: values.description || null,
          punctuality_tolerance_minutes: values.punctuality_tolerance_minutes,
          ...summaryConfigurationSnapshot(values, 'class'),
        },
      });
    });
    response.redirect(303, '/classes?notice=created');
  } catch (error) {
    if (error.code === 'SUMMARY_RECIPIENTS_INVALID') {
      response.status(400).send(renderClassForm({
        title: `Ajouter une ${getTerm('class').toLocaleLowerCase('fr')}`,
        action: '/classes', submitLabel: 'Créer', values,
        adminUsers: await loadSummaryAdminOptions().catch(() => []),
        error: 'Vérifiez les destinataires du résumé automatique.',
      }));
      return;
    }
    console.error('Unable to create class:', error);
    response.status(500).send(renderClassForm({
      title: `Ajouter une ${getTerm('class').toLocaleLowerCase('fr')}`,
      action: '/classes',
      submitLabel: 'Créer',
      values,
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
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

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const classResult = await client.query('SELECT id, public_id, name FROM classes WHERE public_id = $1 FOR UPDATE', [request.params.id]);
      if (classResult.rowCount === 0) return { status: 'not_found' };
      if (studentIds.length === 0) return { status: 'empty' };

      const result = await client.query(
        `INSERT INTO student_classes (student_id, class_id)
         SELECT s.id, $1
         FROM students s
         WHERE s.active = TRUE AND s.public_id = ANY($2::uuid[])
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
      const page = renderClassNotFoundPage();
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
    const page = renderMessagePage('Ajout impossible', 'Impossible d’ajouter la sélection pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id/students/:studentId/remove', async (request, response) => {
  if (!isValidPublicId(request.params.id) || !isValidPublicId(request.params.studentId)) {
    const page = renderMessagePage('Affectation introuvable', 'Cette affectation n’existe pas.', 404);
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
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome.status === 'started') {
      const page = renderMessagePage(
        'Retrait impossible',
        `Cette ${getTerm('class').toLocaleLowerCase('fr')} a déjà commencé. Désactivez la ${getTerm('membership').toLocaleLowerCase('fr')} pour préserver l’historique.`,
        409,
      );
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome.status === 'membership_not_found') {
      const page = renderMessagePage('Affectation introuvable', 'Cette affectation active n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/classes/${request.params.id}?notice=student_removed`);
  } catch (error) {
    console.error('Unable to remove class membership:', error);
    const page = renderMessagePage('Retrait impossible', 'Impossible de retirer cette personne pour le moment.');
    response.status(page.status).send(page.html);
  }
});

async function updateMembershipActivity(request, response, active) {
  if (!isValidPublicId(request.params.id) || !isValidPublicId(request.params.studentId)) {
    const page = renderMessagePage('Affectation introuvable', 'Cette affectation n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const classResult = await client.query('SELECT id, public_id, name FROM classes WHERE public_id = $1 FOR UPDATE', [request.params.id]);
      if (classResult.rowCount === 0) return { status: 'class_not_found' };
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
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
    if (outcome.status === 'membership_not_found') {
      const page = renderMessagePage('Affectation introuvable', 'Cette affectation active ne peut pas être modifiée.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    response.redirect(303, `/classes/${request.params.id}?notice=${active ? 'membership_reactivated' : 'membership_deactivated'}`);
  } catch (error) {
    console.error('Unable to update class membership activity:', error);
    const page = renderMessagePage('Modification impossible', 'Impossible de modifier cette affectation pour le moment.');
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
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, public_id, name, description, punctuality_tolerance_minutes,
              (logo_data IS NOT NULL) AS has_logo
       FROM classes WHERE public_id = $1`,
      [request.params.id],
    );

    if (result.rowCount === 0) {
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    const [summaryConfiguration, adminUsers] = await Promise.all([
      loadClassSummaryConfiguration(result.rows[0].id),
      loadSummaryAdminOptions(),
    ]);
    response.send(renderClassForm({
      title: `Modifier l’${getTerm('class').toLocaleLowerCase('fr')}`,
      action: `/classes/${result.rows[0].public_id}`,
      submitLabel: 'Enregistrer',
      values: { ...result.rows[0], ...summaryConfiguration },
      classId: result.rows[0].public_id,
      hasLogo: result.rows[0].has_logo,
      logoNotice: typeof request.query.logo_notice === 'string' ? request.query.logo_notice : '',
      adminUsers,
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
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage();
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
        const page = renderClassNotFoundPage();
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
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage();
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
      const page = renderClassNotFoundPage();
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
  if (!isValidPublicId(request.params.id)) {
    const page = renderClassNotFoundPage();
    response.status(page.status).send(page.html);
    return;
  }

  const values = getFormValues(request.body);
  let currentLogo;
  try {
    currentLogo = await getClassLogo(request.params.id);
    if (currentLogo === undefined) {
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }
  } catch (error) {
    console.error('Unable to load activity branding before update:', error.code || 'DATABASE_ERROR');
    const page = renderMessagePage('Fiche indisponible', 'Impossible de charger l’élément demandé pour le moment.');
    response.status(page.status).send(page.html);
    return;
  }

  if (!values.name || !isValidTolerance(values.punctuality_tolerance_minutes) || values.summaryConfigurationError) {
    response.status(400).send(renderClassForm({
      title: `Modifier l’${getTerm('class').toLocaleLowerCase('fr')}`,
      action: `/classes/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      classId: request.params.id,
      hasLogo: Boolean(currentLogo),
      error: !values.name
        ? 'Le nom est obligatoire.'
        : values.summaryConfigurationError
          ? 'Vérifiez les destinataires du résumé automatique.'
          : 'Sélectionnez une tolérance de ponctualité valide.',
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
    }));
    return;
  }

  try {
    const result = await withTransaction(pool, async (client) => {
      const current = await client.query(
        `SELECT id, public_id, name, description, punctuality_tolerance_minutes
         FROM classes WHERE public_id = $1 FOR UPDATE`,
        [request.params.id],
      );
      if (current.rowCount === 0) return current;
      const previousSummary = await loadClassSummaryConfiguration(current.rows[0].id, client);
      const updated = await client.query(
        `UPDATE classes
         SET name = $1, description = $2, punctuality_tolerance_minutes = $3
         WHERE public_id = $4 RETURNING id`,
        [values.name, values.description || null, values.punctuality_tolerance_minutes, request.params.id],
      );
      await saveClassSummaryConfiguration(client, current.rows[0].id, values);
      await recordAuditEvent({
        client, category: 'class', action: 'class.update', targetType: 'class',
        targetPublicId: request.params.id, targetLabel: values.name, summary: 'Activité mise à jour.',
        beforeData: {
          name: current.rows[0].name,
          description: current.rows[0].description,
          punctuality_tolerance_minutes: current.rows[0].punctuality_tolerance_minutes,
        },
        afterData: {
          name: values.name,
          description: values.description || null,
          punctuality_tolerance_minutes: values.punctuality_tolerance_minutes,
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
      const page = renderClassNotFoundPage();
      response.status(page.status).send(page.html);
      return;
    }

    response.redirect(303, '/classes?notice=updated');
  } catch (error) {
    if (error.code === 'SUMMARY_RECIPIENTS_INVALID') {
      response.status(400).send(renderClassForm({
        title: `Modifier l’${getTerm('class').toLocaleLowerCase('fr')}`,
        action: `/classes/${request.params.id}`, submitLabel: 'Enregistrer', values,
        classId: request.params.id, hasLogo: Boolean(currentLogo),
        adminUsers: await loadSummaryAdminOptions().catch(() => []),
        error: 'Vérifiez les destinataires du résumé automatique.',
      }));
      return;
    }
    console.error('Unable to update class:', error);
    response.status(500).send(renderClassForm({
      title: `Modifier l’${getTerm('class').toLocaleLowerCase('fr')}`,
      action: `/classes/${request.params.id}`,
      submitLabel: 'Enregistrer',
      values,
      classId: request.params.id,
      hasLogo: Boolean(currentLogo),
      adminUsers: await loadSummaryAdminOptions().catch(() => []),
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
