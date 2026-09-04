const express = require('express');
const {
  createAdminUser,
  hashPassword,
  normalizeEmail,
  normalizeUsername,
  roles,
  validateAdminUserInput,
  validateName,
  validatePassword,
  validateUsername,
} = require('./admin-users');
const {
  roleLabels,
  sendAdminInvitation,
} = require('./admin-invitations');
const { pool } = require('./db/client');
const { escapeHtml, renderMessagePage, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();

function isValidId(value) { return /^[1-9]\d*$/.test(value); }
function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat('fr-BE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(new Date(value)) : 'Jamais';
}
function notification(message, type = 'danger') {
  return message ? `<p class="alert alert-${type}" role="${type === 'success' ? 'status' : 'alert'}">${escapeHtml(message)}</p>` : '';
}
function roleOptions(selectedRole) {
  return Object.entries(roleLabels).map(([value, label]) => `<option value="${value}"${selectedRole === value ? ' selected' : ''}>${label}</option>`).join('');
}
function normalValues(body = {}) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    email: normalizeEmail(body.email),
    role: typeof body.role === 'string' ? body.role : '',
    active: body.active === 'true',
    account_type: 'otp',
  };
}

function renderUserActions(user, currentUser) {
  const emergency = user.account_type === 'break_glass';
  const editUrl = `/settings/users/${user.id}/edit`;
  const normalActions = [
    `<li><a class="dropdown-item" href="${editUrl}">Modifier</a></li>`,
  ];
  if (emergency) {
    normalActions.push(`<li><a class="dropdown-item" href="${editUrl}#password">Changer le mot de passe</a></li>`);
  } else if (user.active) {
    normalActions.push(`<li><form method="post" action="/settings/users/${user.id}/invitation"><button class="dropdown-item" type="submit">Renvoyer l’invitation</button></form></li>`);
  }

  const securityActions = [
    `<li><form method="post" action="/settings/users/${user.id}/revoke-sessions"><button class="dropdown-item" type="submit">Révoquer toutes les sessions</button></form></li>`,
  ];
  if (!emergency) {
    securityActions.push(`<li><a class="dropdown-item" href="${editUrl}#account-active">${user.active ? 'Désactiver…' : 'Réactiver…'}</a></li>`);
  }

  const destructiveAction = !emergency && String(user.id) !== String(currentUser.id)
    ? `<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-danger" href="/settings/users/${user.id}/delete">Supprimer</a></li>`
    : '';
  const triggerId = `user-actions-${user.id}`;

  return `<div class="dropdown user-actions-dropdown">
    <button class="btn btn-sm btn-light user-actions-trigger" id="${triggerId}" type="button" data-bs-toggle="dropdown" data-bs-boundary="viewport" data-user-actions-toggle aria-expanded="false" aria-label="Actions pour ${escapeHtml(user.name)}">
      <span class="user-actions-ellipsis" aria-hidden="true">⋯</span>
    </button>
    <ul class="dropdown-menu dropdown-menu-end user-actions-menu" aria-labelledby="${triggerId}">
      ${normalActions.join('')}
      <li><hr class="dropdown-divider"></li>
      ${securityActions.join('')}
      ${destructiveAction}
    </ul>
  </div>`;
}

function renderCreatePage(values = {}, error = '') {
  return renderPage('Ajouter un utilisateur', renderSettingsLayout({
    activeSection: 'users', title: 'Ajouter un utilisateur',
    description: 'Créez un compte qui se connectera avec un code reçu par e-mail.',
    notifications: notification(error), status: '<a class="btn btn-light" href="/settings/users">Retour aux utilisateurs</a>',
    content: `<form class="card card-body app-form" method="post" action="/settings/users">
      <div class="form-field"><label for="name">Nom</label><input class="form-control" id="name" name="name" type="text" value="${escapeHtml(values.name || '')}" autocomplete="name" required></div>
      <div class="form-field"><label for="email">Adresse e-mail</label><input class="form-control" id="email" name="email" type="email" value="${escapeHtml(values.email || '')}" autocomplete="email" spellcheck="false" required></div>
      <div class="form-field"><label for="role">Rôle</label><select class="form-select" id="role" name="role" required>${roleOptions(values.role || roles.manager)}</select></div>
      <p class="form-text">La connexion se fera sans mot de passe, avec un code envoyé à cette adresse.</p>
      <div class="form-actions d-flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">Créer l’utilisateur</button><a class="btn btn-outline-secondary" href="/settings/users">Annuler</a></div>
    </form>`,
  }));
}

function renderEditPage(user, error = '') {
  const emergency = user.account_type === 'break_glass';
  const fields = emergency ? `
    <div class="alert alert-warning mb-0" role="status"><strong>Compte local d’urgence.</strong> Il reste administrateur actif et ne dépend pas de la messagerie.</div>
    <div class="form-field"><label for="name">Nom</label><input class="form-control" id="name" name="name" type="text" value="${escapeHtml(user.name)}" autocomplete="name" required></div>
    <div class="form-field"><label for="username">Nom d’utilisateur local</label><input class="form-control" id="username" name="username" type="text" value="${escapeHtml(user.username)}" autocomplete="username" required></div>
    <div class="form-field"><label for="password">Nouveau mot de passe</label><input class="form-control" id="password" name="password" type="password" autocomplete="new-password" minlength="12"><p class="form-text">Laissez vide pour conserver le mot de passe. Un changement révoque toutes les sessions de ce compte.</p></div>` : `
    <div class="form-field"><label for="name">Nom</label><input class="form-control" id="name" name="name" type="text" value="${escapeHtml(user.name)}" autocomplete="name" required></div>
    <div class="form-field"><label for="email">Adresse e-mail</label><input class="form-control" id="email" name="email" type="email" value="${escapeHtml(user.email)}" autocomplete="email" spellcheck="false" required></div>
    <div class="form-field"><label for="role">Rôle</label><select class="form-select" id="role" name="role" required>${roleOptions(user.role)}</select></div>
    <label class="form-check form-switch" for="account-active"><input class="form-check-input" id="account-active" name="active" type="checkbox" value="true"${user.active ? ' checked' : ''}><span class="form-check-label">Compte actif</span></label>`;

  return renderPage(`Modifier ${user.name}`, renderSettingsLayout({
    activeSection: 'users', title: emergency ? 'Compte d’urgence' : 'Modifier un utilisateur',
    description: emergency ? 'Gérez l’identité locale et le mot de passe de secours.' : 'Modifiez son identité, son rôle ou son accès.',
    notifications: notification(error), status: '<a class="btn btn-light" href="/settings/users">Retour aux utilisateurs</a>',
    content: `<form class="card card-body app-form" method="post" action="/settings/users/${user.id}">${fields}
      <div class="form-actions d-flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">Enregistrer</button><a class="btn btn-outline-secondary" href="/settings/users">Annuler</a></div>
    </form>${emergency ? '' : `<section class="mt-4 border-top pt-3" aria-labelledby="delete-user-title">
      <h2 class="h6" id="delete-user-title">Supprimer le compte</h2>
      <p class="text-body-secondary">La suppression révoque immédiatement tous les accès de cet utilisateur.</p>
      <a class="btn btn-sm btn-outline-danger" href="/settings/users/${user.id}/delete">Supprimer</a>
    </section>`}`,
  }));
}

function renderDeletePage(user, error = '') {
  return renderPage(`Supprimer ${user.name}`, renderSettingsLayout({
    activeSection: 'users',
    title: 'Supprimer un utilisateur',
    description: 'Cette action supprime définitivement le compte et révoque ses sessions.',
    notifications: notification(error),
    status: `<a class="btn btn-light" href="/settings/users/${user.id}/edit">Annuler</a>`,
    content: `<form class="card card-body app-form border-danger-subtle" method="post" action="/settings/users/${user.id}/delete">
      <div><strong>${escapeHtml(user.name)}</strong><br><span class="text-body-secondary text-break">${escapeHtml(user.email)}</span></div>
      <label class="form-check">
        <input class="form-check-input" name="confirm_delete" type="checkbox" value="true" required>
        <span class="form-check-label">Je confirme la suppression définitive de ce compte.</span>
      </label>
      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-danger" type="submit">Supprimer définitivement</button>
        <a class="btn btn-outline-secondary" href="/settings/users/${user.id}/edit">Annuler</a>
      </div>
    </form>`,
  }));
}

async function findUser(id) {
  const result = await pool.query('SELECT id, name, email, username, account_type, role, active FROM admin_users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

router.get('/', async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, username, account_type, role, active, last_login_at FROM admin_users
       ORDER BY account_type = 'break_glass' DESC, active DESC, LOWER(name), id`,
    );
    const notices = {
      created_invited: { message: 'L’utilisateur a été créé et son invitation a été envoyée.', type: 'success' },
      created_invitation_failed: { message: 'L’utilisateur a été créé, mais l’invitation n’a pas pu être envoyée.', type: 'warning' },
      invitation_sent: { message: 'L’invitation a été envoyée.', type: 'success' },
      invitation_rate_limited: { message: 'Veuillez attendre avant de renvoyer cette invitation.', type: 'warning' },
      invitation_failed: { message: 'L’invitation n’a pas pu être envoyée. Vérifiez la configuration e-mail et l’URL de l’application.', type: 'danger' },
      invitation_inactive: { message: 'Réactivez ce compte avant de lui envoyer une invitation.', type: 'warning' },
      updated: { message: 'L’utilisateur a été modifié.', type: 'success' },
      revoked: { message: 'Toutes les sessions de l’utilisateur ont été révoquées.', type: 'success' },
      deleted: { message: 'L’utilisateur a été supprimé.', type: 'success' },
    };
    const feedback = notices[request.query.notice];
    const rows = result.rows.map((user) => `<tr>
      <td><strong>${escapeHtml(user.name)}</strong>${user.account_type === 'break_glass' ? ' <span class="badge text-bg-warning">Urgence locale</span>' : ''}<br><span class="text-body-secondary text-break">${escapeHtml(user.email || user.username)}</span></td>
      <td>${escapeHtml(roleLabels[user.role])}</td><td><span class="badge ${user.active ? 'text-bg-success' : 'text-bg-secondary'}">${user.active ? 'Actif' : 'Inactif'}</span></td>
      <td>${escapeHtml(formatDateTime(user.last_login_at))}</td>
      <td class="user-actions-cell">${renderUserActions(user, request.currentUser)}</td>
    </tr>`).join('');
    response.send(renderPage('Utilisateurs', renderSettingsLayout({
      activeSection: 'users', title: 'Utilisateurs', description: 'Gérez les comptes, leurs rôles et leurs accès.',
      status: '<a class="btn btn-primary" href="/settings/users/new">Ajouter un utilisateur</a>',
      notifications: feedback ? notification(feedback.message, feedback.type) : '',
      content: `<div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>État</th><th>Dernière connexion</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`,
      after: '<script src="/js/user-actions-dropdown.js" defer></script>',
    })));
  } catch (error) {
    console.error('Unable to list administrator users:', error);
    const page = renderMessagePage('Utilisateurs indisponibles', 'Impossible de charger les utilisateurs pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/new', (_request, response) => response.send(renderCreatePage()));
router.post('/', async (request, response) => {
  const values = normalValues(request.body);
  try {
    const user = await createAdminUser(values);
    try {
      await sendAdminInvitation(user.id);
      response.redirect(303, '/settings/users?notice=created_invited');
    } catch (invitationError) {
      console.warn('Administrator account created but invitation delivery failed:', invitationError.code || 'DELIVERY_FAILED');
      response.redirect(303, '/settings/users?notice=created_invitation_failed');
    }
  } catch (error) {
    const known = ['VALIDATION_ERROR', 'EMAIL_EXISTS'].includes(error.code);
    if (!known) console.error('Unable to create administrator user:', error);
    response.status(known ? 400 : 500).send(renderCreatePage(values, known ? error.message : 'Impossible de créer l’utilisateur pour le moment.'));
  }
});

router.post('/:id/invitation', async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
  try {
    await sendAdminInvitation(request.params.id);
    response.redirect(303, '/settings/users?notice=invitation_sent');
  } catch (error) {
    const notice = error.code === 'INVITATION_RATE_LIMITED'
      ? 'invitation_rate_limited'
      : error.code === 'USER_INACTIVE'
        ? 'invitation_inactive'
        : 'invitation_failed';
    if (!['INVITATION_RATE_LIMITED', 'USER_INACTIVE', 'BREAK_GLASS_NOT_ELIGIBLE', 'USER_NOT_FOUND'].includes(error.code)) {
      console.warn('Unable to resend administrator invitation:', error.code || 'DELIVERY_FAILED');
    }
    response.redirect(303, `/settings/users?notice=${notice}`);
  }
});

router.get('/:id/edit', async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
    response.send(renderEditPage(user));
  } catch (error) {
    console.error('Unable to load administrator user:', error);
    response.status(500).send(renderMessagePage('Utilisateur indisponible', 'Impossible de charger cet utilisateur pour le moment.').html);
  }
});

router.get('/:id/delete', async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
    if (user.account_type === 'break_glass') return response.status(403).send(renderMessagePage('Suppression interdite', 'Ce compte ne peut pas être supprimé.', 403).html);
    if (String(user.id) === String(request.currentUser.id)) return response.status(409).send(renderMessagePage('Suppression interdite', 'Vous ne pouvez pas supprimer le compte actuellement connecté.', 409).html);
    response.send(renderDeletePage(user));
  } catch (error) {
    console.error('Unable to prepare administrator deletion:', error);
    response.status(500).send(renderMessagePage('Suppression indisponible', 'Impossible de préparer cette suppression pour le moment.').html);
  }
});

router.post('/:id', async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeAdmins = await client.query("SELECT id FROM admin_users WHERE role = 'administrator' AND active = TRUE ORDER BY id FOR UPDATE");
    const targetResult = await client.query('SELECT * FROM admin_users WHERE id = $1 FOR UPDATE', [request.params.id]);
    if (targetResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
    }
    const target = targetResult.rows[0];
    let edited;
    if (target.account_type === 'break_glass') {
      const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
      const username = normalizeUsername(request.body.username);
      const password = typeof request.body.password === 'string' ? request.body.password : '';
      const validationError = !validateName(name) ? 'Le nom doit contenir entre 2 et 120 caractères.' : !validateUsername(username) ? 'Le nom d’utilisateur est invalide.' : validatePassword(password, { required: false });
      edited = { ...target, name, username };
      if (validationError) {
        await client.query('ROLLBACK');
        return response.status(400).send(renderEditPage(edited, validationError));
      }
      const passwordHash = password ? await hashPassword(password) : null;
      await client.query(
        `UPDATE admin_users SET name = $1, username = $2,
           password_hash = COALESCE($3, password_hash),
           session_version = session_version + CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END,
           updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
        [name, username, passwordHash, target.id],
      );
    } else {
      const values = normalValues(request.body);
      edited = { ...target, ...values };
      const validationError = validateAdminUserInput(values);
      if (validationError) {
        await client.query('ROLLBACK');
        return response.status(400).send(renderEditPage(edited, validationError));
      }
      const removesLastAdmin = target.role === roles.administrator && target.active
        && (!values.active || values.role !== roles.administrator) && activeAdmins.rowCount === 1;
      if (removesLastAdmin) {
        await client.query('ROLLBACK');
        return response.status(409).send(renderEditPage(edited, 'Le dernier administrateur actif ne peut pas être désactivé ni changer de rôle.'));
      }
      await client.query(
        `UPDATE admin_users SET name = $1, email = $2, role = $3, active = $4,
           session_version = session_version + CASE WHEN active AND NOT $4 THEN 1 ELSE 0 END,
           updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
        [values.name, values.email, values.role, values.active, target.id],
      );
    }
    await client.query('COMMIT');
    response.redirect(303, '/settings/users?notice=updated');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const duplicate = error.code === '23505';
    if (!duplicate) console.error('Unable to update administrator user:', error);
    const user = await findUser(request.params.id).catch(() => null);
    response.status(duplicate ? 400 : 500).send(user ? renderEditPage(user, duplicate ? 'Cette identité est déjà utilisée.' : 'Impossible de modifier l’utilisateur pour le moment.') : renderMessagePage('Utilisateur indisponible', 'Impossible de modifier cet utilisateur pour le moment.').html);
  } finally { client.release(); }
});

router.post('/:id/revoke-sessions', async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
  try {
    const result = await pool.query('UPDATE admin_users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id', [request.params.id]);
    if (result.rowCount === 0) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
    if (String(request.currentUser.id) === String(request.params.id)) {
      request.session.destroy((error) => {
        if (error) return response.status(500).send(renderMessagePage('Session indisponible', 'Les sessions ont été révoquées. Reconnectez-vous.', 500).html);
        response.clearCookie('attendance_log_session');
        response.redirect(303, '/login');
      });
      return;
    }
    response.redirect(303, '/settings/users?notice=revoked');
  } catch (error) {
    console.error('Unable to revoke administrator sessions:', error);
    response.status(500).send(renderMessagePage('Révocation indisponible', 'Impossible de révoquer les sessions pour le moment.').html);
  }
});

router.post('/:id/delete', async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
  const user = await findUser(request.params.id).catch(() => null);
  if (!user) return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
  if (request.body?.confirm_delete !== 'true') return response.status(400).send(renderDeletePage(user, 'Confirmez explicitement la suppression du compte.'));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeAdmins = await client.query("SELECT id FROM admin_users WHERE role = 'administrator' AND active = TRUE ORDER BY id FOR UPDATE");
    const targetResult = await client.query('SELECT id, account_type, role, active FROM admin_users WHERE id = $1 FOR UPDATE', [request.params.id]);
    if (targetResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return response.status(404).send(renderMessagePage('Utilisateur introuvable', 'Cet utilisateur n’existe pas.', 404).html);
    }
    const target = targetResult.rows[0];
    if (target.account_type === 'break_glass') {
      await client.query('ROLLBACK');
      return response.status(403).send(renderMessagePage('Suppression interdite', 'Ce compte ne peut pas être supprimé.', 403).html);
    }
    if (String(target.id) === String(request.currentUser.id)) {
      await client.query('ROLLBACK');
      return response.status(409).send(renderMessagePage('Suppression interdite', 'Vous ne pouvez pas supprimer le compte actuellement connecté.', 409).html);
    }
    if (target.role === roles.administrator && target.active && activeAdmins.rowCount === 1) {
      await client.query('ROLLBACK');
      return response.status(409).send(renderDeletePage(user, 'Le dernier administrateur actif ne peut pas être supprimé.'));
    }
    await client.query("DELETE FROM admin_users WHERE id = $1 AND account_type = 'otp'", [target.id]);
    await client.query('COMMIT');
    response.redirect(303, '/settings/users?notice=deleted');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Unable to delete administrator user:', error);
    response.status(500).send(renderDeletePage(user, 'Impossible de supprimer cet utilisateur pour le moment.'));
  } finally {
    client.release();
  }
});

module.exports = router;
