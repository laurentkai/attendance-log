const express = require('express');
const {
  createAdminUser,
  hashPassword,
  normalizeEmail,
  roles,
  validateAdminUserInput,
} = require('./admin-users');
const { pool } = require('./db/client');
const {
  escapeHtml,
  renderMessagePage,
  renderPage,
  renderSettingsLayout,
} = require('./ui');

const router = express.Router();

const roleLabels = Object.freeze({
  [roles.administrator]: 'Administrateur',
  [roles.manager]: 'Gestionnaire',
  [roles.attendanceOperator]: 'Opérateur de présence',
});

function isValidId(value) {
  return /^[1-9]\d*$/.test(value);
}

function getValues(body = {}) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    email: normalizeEmail(body.email),
    role: typeof body.role === 'string' ? body.role : '',
    active: body.active === 'true',
    password: typeof body.password === 'string' ? body.password : '',
  };
}

function roleOptions(selectedRole) {
  return Object.entries(roleLabels).map(([value, label]) => (
    `<option value="${value}"${selectedRole === value ? ' selected' : ''}>${label}</option>`
  )).join('');
}

function formatDateTime(value) {
  if (!value) {
    return 'Jamais';
  }
  return new Intl.DateTimeFormat('fr-BE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Brussels',
  }).format(new Date(value));
}

function notification(message, type = 'danger') {
  if (!message) {
    return '';
  }
  return `<p class="alert alert-${type}" role="${type === 'success' ? 'status' : 'alert'}">${escapeHtml(message)}</p>`;
}

function renderCreatePage(values = {}, error = '') {
  return renderPage('Ajouter un utilisateur', renderSettingsLayout({
    activeSection: 'users',
    title: 'Ajouter un utilisateur',
    description: 'Créez un accès et attribuez-lui un rôle.',
    notifications: notification(error),
    status: '<a class="btn btn-light" href="/settings/users">Retour aux utilisateurs</a>',
    content: `<form class="card card-body app-form" method="post" action="/settings/users">
      <div class="form-field">
        <label for="name">Nom <span aria-hidden="true">*</span></label>
        <input class="form-control" id="name" name="name" type="text" value="${escapeHtml(values.name || '')}" autocomplete="name" required>
      </div>
      <div class="form-field">
        <label for="email">Adresse e-mail <span aria-hidden="true">*</span></label>
        <input class="form-control" id="email" name="email" type="email" value="${escapeHtml(values.email || '')}" autocomplete="username" spellcheck="false" required>
      </div>
      <div class="form-field">
        <label for="role">Rôle <span aria-hidden="true">*</span></label>
        <select class="form-select" id="role" name="role" required>${roleOptions(values.role || roles.manager)}</select>
      </div>
      <div class="form-field">
        <label for="password">Mot de passe <span aria-hidden="true">*</span></label>
        <input class="form-control" id="password" name="password" type="password" autocomplete="new-password" minlength="12" required>
        <p class="form-text">12 caractères minimum.</p>
      </div>
      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">Créer l’utilisateur</button>
        <a class="btn btn-outline-secondary" href="/settings/users">Annuler</a>
      </div>
    </form>`,
  }));
}

function renderEditPage(user, error = '') {
  return renderPage(`Modifier ${user.name}`, renderSettingsLayout({
    activeSection: 'users',
    title: 'Modifier un utilisateur',
    description: 'Modifiez son identité, son rôle, son accès ou son mot de passe.',
    notifications: notification(error),
    status: '<a class="btn btn-light" href="/settings/users">Retour aux utilisateurs</a>',
    content: `<form class="card card-body app-form" method="post" action="/settings/users/${user.id}">
      <div class="form-field">
        <label for="name">Nom <span aria-hidden="true">*</span></label>
        <input class="form-control" id="name" name="name" type="text" value="${escapeHtml(user.name)}" autocomplete="name" required>
      </div>
      <div class="form-field">
        <label for="email">Adresse e-mail <span aria-hidden="true">*</span></label>
        <input class="form-control" id="email" name="email" type="email" value="${escapeHtml(user.email)}" autocomplete="username" spellcheck="false" required>
      </div>
      <div class="form-field">
        <label for="role">Rôle <span aria-hidden="true">*</span></label>
        <select class="form-select" id="role" name="role" required>${roleOptions(user.role)}</select>
      </div>
      <label class="form-check form-switch">
        <input class="form-check-input" name="active" type="checkbox" value="true"${user.active ? ' checked' : ''}>
        <span class="form-check-label">Compte actif</span>
      </label>
      <div class="form-field">
        <label for="password">Nouveau mot de passe</label>
        <input class="form-control" id="password" name="password" type="password" autocomplete="new-password" minlength="12">
        <p class="form-text">Laissez vide pour conserver le mot de passe actuel.</p>
      </div>
      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-primary" type="submit">Enregistrer</button>
        <a class="btn btn-outline-secondary" href="/settings/users">Annuler</a>
      </div>
    </form>`,
  }));
}

router.get('/', async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, active, created_at, updated_at, last_login_at
       FROM admin_users
       ORDER BY active DESC, LOWER(name), id`,
    );
    const notices = {
      created: 'L’utilisateur a été créé.',
      updated: 'L’utilisateur a été modifié.',
    };
    const rows = result.rows.map((user) => `<tr>
      <td><strong>${escapeHtml(user.name)}</strong><br><span class="text-body-secondary text-break">${escapeHtml(user.email)}</span></td>
      <td>${escapeHtml(roleLabels[user.role])}</td>
      <td><span class="badge ${user.active ? 'text-bg-success' : 'text-bg-secondary'}">${user.active ? 'Actif' : 'Inactif'}</span></td>
      <td>${escapeHtml(formatDateTime(user.last_login_at))}</td>
      <td class="text-end"><a class="btn btn-sm btn-outline-secondary" href="/settings/users/${user.id}/edit">Modifier</a></td>
    </tr>`).join('');

    response.send(renderPage('Utilisateurs', renderSettingsLayout({
      activeSection: 'users',
      title: 'Utilisateurs',
      description: 'Gérez les comptes administratifs et leurs accès.',
      status: '<a class="btn btn-primary" href="/settings/users/new">Ajouter un utilisateur</a>',
      notifications: notification(notices[request.query.notice], 'success'),
      content: result.rowCount === 0
        ? '<p class="empty-state">Aucun utilisateur.</p>'
        : `<div class="table-responsive"><table class="table table-hover align-middle mb-0">
          <thead><tr><th scope="col">Utilisateur</th><th scope="col">Rôle</th><th scope="col">État</th><th scope="col">Dernière connexion</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`,
    })));
  } catch (error) {
    console.error('Unable to list administrator users:', error);
    const page = renderMessagePage('Utilisateurs indisponibles', 'Impossible de charger les utilisateurs pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/new', (_request, response) => {
  response.send(renderCreatePage());
});

router.post('/', async (request, response) => {
  const values = getValues(request.body);
  try {
    await createAdminUser(values);
    response.redirect(303, '/settings/users?notice=created');
  } catch (error) {
    const knownError = ['VALIDATION_ERROR', 'EMAIL_EXISTS'].includes(error.code);
    if (!knownError) {
      console.error('Unable to create administrator user:', error);
    }
    response.status(knownError ? 400 : 500).send(renderCreatePage(
      values,
      knownError ? error.message : 'Impossible de créer l’utilisateur pour le moment.',
    ));
  }
});

router.get('/:id/edit', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, active FROM admin_users WHERE id = $1',
      [request.params.id],
    );
    if (result.rowCount === 0) {
      const page = renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404);
      response.status(page.status).send(page.html);
      return;
    }
    response.send(renderEditPage(result.rows[0]));
  } catch (error) {
    console.error('Unable to load administrator user:', error);
    const page = renderMessagePage('Utilisateur indisponible', 'Impossible de charger cet utilisateur pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.post('/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    response.status(404).send(renderEditPage({ id: '', ...getValues(request.body) }, 'Cet utilisateur n’existe pas.'));
    return;
  }

  const values = getValues(request.body);
  const validationError = validateAdminUserInput(values, { passwordRequired: false });
  if (validationError) {
    response.status(400).send(renderEditPage({ id: request.params.id, ...values }, validationError));
    return;
  }

  let passwordHash = null;
  if (values.password) {
    passwordHash = await hashPassword(values.password);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeAdministrators = await client.query(
      `SELECT id FROM admin_users
       WHERE role = 'administrator' AND active = TRUE
       ORDER BY id
       FOR UPDATE`,
    );
    const targetResult = await client.query(
      'SELECT id, role, active FROM admin_users WHERE id = $1 FOR UPDATE',
      [request.params.id],
    );
    if (targetResult.rowCount === 0) {
      await client.query('ROLLBACK');
      response.status(404).send(renderEditPage({ id: request.params.id, ...values }, 'Cet utilisateur n’existe pas.'));
      return;
    }

    const target = targetResult.rows[0];
    const removesActiveAdministrator = target.role === roles.administrator
      && target.active
      && (!values.active || values.role !== roles.administrator);
    if (removesActiveAdministrator && activeAdministrators.rowCount === 1) {
      await client.query('ROLLBACK');
      response.status(409).send(renderEditPage(
        { id: request.params.id, ...values },
        'Le dernier administrateur actif ne peut pas être désactivé ni changer de rôle.',
      ));
      return;
    }

    try {
      await client.query(
        `UPDATE admin_users
         SET name = $1,
             email = $2,
             role = $3,
             active = $4,
             password_hash = COALESCE($5, password_hash),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [values.name, values.email, values.role, values.active, passwordHash, request.params.id],
      );
    } catch (error) {
      if (error.code === '23505') {
        const duplicateError = new Error('Un compte utilise déjà cette adresse e-mail.');
        duplicateError.code = 'EMAIL_EXISTS';
        throw duplicateError;
      }
      throw error;
    }
    await client.query('COMMIT');

    if (String(request.currentUser.id) === String(request.params.id)) {
      if (!values.active) {
        request.session.destroy((error) => {
          if (error) {
            console.error('Unable to invalidate deactivated administrator session:', error);
            const page = renderMessagePage('Session indisponible', 'Le compte a été désactivé. Reconnectez-vous.', 500);
            response.status(page.status).send(page.html);
            return;
          }
          response.clearCookie('attendance_log_session');
          response.redirect(303, '/login');
        });
        return;
      }
      request.session.role = values.role;
      if (values.role !== roles.administrator) {
        response.redirect(303, '/');
        return;
      }
    }
    response.redirect(303, '/settings/users?notice=updated');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const knownError = error.code === 'EMAIL_EXISTS';
    if (!knownError) {
      console.error('Unable to update administrator user:', error);
    }
    response.status(knownError ? 400 : 500).send(renderEditPage(
      { id: request.params.id, ...values },
      knownError ? error.message : 'Impossible de modifier l’utilisateur pour le moment.',
    ));
  } finally {
    client.release();
  }
});

module.exports = router;
