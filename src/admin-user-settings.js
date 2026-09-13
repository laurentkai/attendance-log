const express = require('express');
const { recordAuditEvent, recordAuditEventSafely } = require('./audit');
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
const { pool, withTransaction } = require('./db/client');
const { formatDateTime: formatApplicationDateTime } = require('./application-time');
const { isValidPublicId } = require('./public-id');
const { normalizeLanguageOverride, t } = require('./i18n');
const { escapeHtml, renderLanguageOptions, renderMessagePage, renderPage, renderSettingsLayout } = require('./ui');

const router = express.Router();

function formatDateTime(value, language) {
  return value ? formatApplicationDateTime(value, { dateStyle: 'short' }) : t(language, 'status.never');
}
function notification(message, type = 'danger') {
  return message ? `<p class="alert alert-${type}" role="${type === 'success' ? 'status' : 'alert'}">${escapeHtml(message)}</p>` : '';
}
function userNotFoundPage(language) {
  return renderMessagePage(t(language, 'users.error.not_found.title'), t(language, 'users.error.not_found.message'), 404, language);
}
function roleOptions(selectedRole, language) {
  return Object.keys(roleLabels).map((value) => `<option value="${value}"${selectedRole === value ? ' selected' : ''}>${escapeHtml(t(language, `role.${value}`))}</option>`).join('');
}
function normalValues(body = {}) {
  return {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    email: normalizeEmail(body.email),
    role: typeof body.role === 'string' ? body.role : '',
    active: body.active === 'true',
    viewPii: body.view_pii === 'true',
    uiLanguage: normalizeLanguageOverride(body.ui_language),
    account_type: 'otp',
  };
}

function renderUiLanguageField(uiLanguage, language) {
  return `<div class="form-field"><label for="ui-language">${escapeHtml(t(language, 'settings.interface_language'))}</label>
    <select class="form-select" id="ui-language" name="ui_language">
      ${renderLanguageOptions(uiLanguage, {
    language,
    emptyLabel: t(language, 'language.automatic'),
    currentLabel: t(language, 'language.current'),
  })}
    </select>
    <p class="form-text mb-0">${escapeHtml(t(language, 'settings.admin_user.interface_language_help'))}</p>
  </div>`;
}

function renderViewPiiField(viewPii, language) {
  return `<label class="form-check form-switch" for="view-pii">
    <input class="form-check-input" id="view-pii" name="view_pii" type="checkbox" value="true"${viewPii ? ' checked' : ''}>
    <span class="form-check-label">${escapeHtml(t(language, 'users.field.view_pii'))}</span>
    <span class="form-text d-block">${escapeHtml(t(language, 'users.field.view_pii_help'))}</span>
  </label>`;
}

function renderUserActions(user, currentUser, language) {
  const emergency = user.account_type === 'break_glass';
  const editUrl = `/settings/users/${user.public_id}/edit`;
  const normalActions = [
    `<li><a class="dropdown-item" href="${editUrl}">${escapeHtml(t(language, 'action.edit'))}</a></li>`,
  ];
  if (emergency) {
    normalActions.push(`<li><a class="dropdown-item" href="${editUrl}#password">${escapeHtml(t(language, 'users.action.change_password'))}</a></li>`);
  } else if (user.active) {
    normalActions.push(`<li><form method="post" action="/settings/users/${user.public_id}/invitation"><button class="dropdown-item" type="submit">${escapeHtml(t(language, 'users.action.resend_invitation'))}</button></form></li>`);
  }

  const securityActions = [
    `<li><form method="post" action="/settings/users/${user.public_id}/revoke-sessions"><button class="dropdown-item" type="submit">${escapeHtml(t(language, 'users.action.revoke_sessions'))}</button></form></li>`,
  ];
  if (!emergency) {
    securityActions.push(`<li><a class="dropdown-item" href="${editUrl}#account-active">${escapeHtml(t(language, user.active ? 'action.deactivate' : 'action.reactivate'))}…</a></li>`);
  }

  const destructiveAction = !emergency && String(user.id) !== String(currentUser.id)
    ? `<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-danger" href="/settings/users/${user.public_id}/delete">${escapeHtml(t(language, 'action.delete'))}</a></li>`
    : '';
  const triggerId = `user-actions-${user.public_id}`;

  return `<div class="dropdown user-actions-dropdown">
    <button class="btn btn-sm btn-light user-actions-trigger" id="${triggerId}" type="button" data-bs-toggle="dropdown" data-bs-boundary="viewport" data-user-actions-toggle aria-expanded="false" aria-label="${escapeHtml(t(language, 'action.actions_for', { name: user.name }))}">
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

function renderCreatePage(values = {}, error = '', language) {
  return renderPage(t(language, 'users.create.title'), renderSettingsLayout({
    activeSection: 'users', title: t(language, 'users.create.title'),
    description: t(language, 'users.create.description'),
    notifications: notification(error), status: `<a class="btn btn-light" href="/settings/users">${escapeHtml(t(language, 'users.back'))}</a>`,
    content: `<form class="card card-body app-form" method="post" action="/settings/users">
      <div class="form-field"><label for="name">${escapeHtml(t(language, 'users.field.name'))}</label><input class="form-control" id="name" name="name" type="text" value="${escapeHtml(values.name || '')}" autocomplete="name" required></div>
      <div class="form-field"><label for="email">${escapeHtml(t(language, 'users.field.email'))}</label><input class="form-control" id="email" name="email" type="email" value="${escapeHtml(values.email || '')}" autocomplete="email" spellcheck="false" required></div>
      <div class="form-field"><label for="role">${escapeHtml(t(language, 'users.field.role'))}</label><select class="form-select" id="role" name="role" required>${roleOptions(values.role || roles.manager, language)}</select></div>
      ${renderViewPiiField(values.viewPii !== false, language)}
      ${renderUiLanguageField(values.uiLanguage ?? null, language)}
      <p class="form-text">${escapeHtml(t(language, 'users.login_help'))}</p>
      <div class="form-actions d-flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'users.create.submit'))}</button><a class="btn btn-outline-secondary" href="/settings/users">${escapeHtml(t(language, 'action.cancel'))}</a></div>
    </form>`,
  }, language), { language });
}

function renderEditPage(user, error = '', language) {
  const emergency = user.account_type === 'break_glass';
  const fields = emergency ? `
    <div class="alert alert-warning mb-0" role="status"><strong>${escapeHtml(t(language, 'users.break_glass.notice_title'))}</strong> ${escapeHtml(t(language, 'users.break_glass.notice'))}</div>
    <div class="form-field"><label for="name">${escapeHtml(t(language, 'users.field.name'))}</label><input class="form-control" id="name" name="name" type="text" value="${escapeHtml(user.name)}" autocomplete="name" required></div>
    <div class="form-field"><label for="username">${escapeHtml(t(language, 'users.field.username'))}</label><input class="form-control" id="username" name="username" type="text" value="${escapeHtml(user.username)}" autocomplete="username" required></div>
    <div class="form-field"><label for="password">${escapeHtml(t(language, 'users.field.new_password'))}</label><input class="form-control" id="password" name="password" type="password" autocomplete="new-password" minlength="12"><p class="form-text">${escapeHtml(t(language, 'users.field.password_help'))}</p></div>` : `
    <div class="form-field"><label for="name">${escapeHtml(t(language, 'users.field.name'))}</label><input class="form-control" id="name" name="name" type="text" value="${escapeHtml(user.name)}" autocomplete="name" required></div>
    <div class="form-field"><label for="email">${escapeHtml(t(language, 'users.field.email'))}</label><input class="form-control" id="email" name="email" type="email" value="${escapeHtml(user.email)}" autocomplete="email" spellcheck="false" required></div>
    <div class="form-field"><label for="role">${escapeHtml(t(language, 'users.field.role'))}</label><select class="form-select" id="role" name="role" required>${roleOptions(user.role, language)}</select></div>
    <label class="form-check form-switch" for="account-active"><input class="form-check-input" id="account-active" name="active" type="checkbox" value="true"${user.active ? ' checked' : ''}><span class="form-check-label">${escapeHtml(t(language, 'users.field.active'))}</span></label>`;

  return renderPage(t(language, 'users.edit.page_title', { name: user.name }), renderSettingsLayout({
    activeSection: 'users', title: t(language, emergency ? 'users.break_glass.title' : 'users.edit.title'),
    description: t(language, emergency ? 'users.break_glass.description' : 'users.edit.description'),
    notifications: notification(error), status: `<a class="btn btn-light" href="/settings/users">${escapeHtml(t(language, 'users.back'))}</a>`,
    content: `<form class="card card-body app-form" method="post" action="/settings/users/${user.public_id}">${fields}
      ${renderViewPiiField(user.view_pii !== false, language)}
      ${renderUiLanguageField(user.ui_language ?? user.uiLanguage, language)}
      <div class="form-actions d-flex flex-wrap gap-2"><button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'action.save'))}</button><a class="btn btn-outline-secondary" href="/settings/users">${escapeHtml(t(language, 'action.cancel'))}</a></div>
    </form>${emergency ? '' : `<section class="mt-4 border-top pt-3" aria-labelledby="delete-user-title">
      <h2 class="h6" id="delete-user-title">${escapeHtml(t(language, 'users.action.delete_account'))}</h2>
      <p class="text-body-secondary">${escapeHtml(t(language, 'users.delete.help'))}</p>
      <a class="btn btn-sm btn-outline-danger" href="/settings/users/${user.public_id}/delete">${escapeHtml(t(language, 'action.delete'))}</a>
    </section>`}`,
  }, language), { language });
}

function renderDeletePage(user, error = '', language) {
  return renderPage(t(language, 'users.delete.page_title', { name: user.name }), renderSettingsLayout({
    activeSection: 'users',
    title: t(language, 'users.delete.title'),
    description: t(language, 'users.delete.description'),
    notifications: notification(error),
    status: `<a class="btn btn-light" href="/settings/users/${user.public_id}/edit">${escapeHtml(t(language, 'action.cancel'))}</a>`,
    content: `<form class="card card-body app-form border-danger-subtle" method="post" action="/settings/users/${user.public_id}/delete">
      <div><strong>${escapeHtml(user.name)}</strong><br><span class="text-body-secondary text-break">${escapeHtml(user.email)}</span></div>
      <label class="form-check">
        <input class="form-check-input" name="confirm_delete" type="checkbox" value="true" required>
        <span class="form-check-label">${escapeHtml(t(language, 'users.delete.confirm'))}</span>
      </label>
      <div class="form-actions d-flex flex-wrap gap-2">
        <button class="btn btn-danger" type="submit">${escapeHtml(t(language, 'users.delete.submit'))}</button>
        <a class="btn btn-outline-secondary" href="/settings/users/${user.public_id}/edit">${escapeHtml(t(language, 'action.cancel'))}</a>
      </div>
    </form>`,
  }, language), { language });
}

async function findUser(publicId) {
  const result = await pool.query('SELECT id, public_id, name, email, username, account_type, role, active, view_pii, ui_language FROM admin_users WHERE public_id = $1', [publicId]);
  return result.rows[0] || null;
}

router.get('/', async (request, response) => {
  const language = request.uiLanguage;
  try {
    const result = await pool.query(
      `SELECT id, public_id, name, email, username, account_type, role, active, view_pii, ui_language, last_login_at FROM admin_users
       ORDER BY account_type = 'break_glass' DESC, active DESC, LOWER(name), id`,
    );
    const notices = {
      created_invited: { message: t(language, 'users.notice.created_invited'), type: 'success' },
      created_invitation_failed: { message: t(language, 'users.notice.created_invitation_failed'), type: 'warning' },
      invitation_sent: { message: t(language, 'users.notice.invitation_sent'), type: 'success' },
      invitation_rate_limited: { message: t(language, 'users.notice.invitation_rate_limited'), type: 'warning' },
      invitation_failed: { message: t(language, 'users.notice.invitation_failed'), type: 'danger' },
      invitation_inactive: { message: t(language, 'users.notice.invitation_inactive'), type: 'warning' },
      updated: { message: t(language, 'users.notice.updated'), type: 'success' },
      revoked: { message: t(language, 'users.notice.revoked'), type: 'success' },
      deleted: { message: t(language, 'users.notice.deleted'), type: 'success' },
    };
    const feedback = notices[request.query.notice];
    const rows = result.rows.map((user) => `<tr>
      <td><strong>${escapeHtml(user.name)}</strong>${user.account_type === 'break_glass' ? ` <span class="badge text-bg-warning">${escapeHtml(t(language, 'users.table.local_emergency'))}</span>` : ''}<br><span class="text-body-secondary text-break">${escapeHtml(user.email || user.username)}</span></td>
      <td>${escapeHtml(t(language, `role.${user.role}`))}<span class="d-block small text-body-secondary">${escapeHtml(t(language, user.view_pii ? 'users.table.pii_visible' : 'users.table.pii_hidden'))}</span></td><td><span class="badge ${user.active ? 'text-bg-success' : 'text-bg-secondary'}">${escapeHtml(t(language, `status.${user.active ? 'active' : 'inactive'}`))}</span></td>
      <td>${escapeHtml(formatDateTime(user.last_login_at, language))}</td>
      <td class="user-actions-cell">${renderUserActions(user, request.currentUser, language)}</td>
    </tr>`).join('');
    response.send(renderPage(t(language, 'users.title'), renderSettingsLayout({
      activeSection: 'users', title: t(language, 'users.title'), description: t(language, 'users.description'),
      status: `<a class="btn btn-primary" href="/settings/users/new">${escapeHtml(t(language, 'users.add'))}</a>`,
      notifications: feedback ? notification(feedback.message, feedback.type) : '',
      content: `<div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr><th>${escapeHtml(t(language, 'users.table.user'))}</th><th>${escapeHtml(t(language, 'users.table.role'))}</th><th>${escapeHtml(t(language, 'users.table.state'))}</th><th>${escapeHtml(t(language, 'users.table.last_login'))}</th><th><span class="visually-hidden">${escapeHtml(t(language, 'action.details'))}</span></th></tr></thead><tbody>${rows}</tbody></table></div>`,
      after: '<script src="/js/user-actions-dropdown.js" defer></script>',
    }, language), { language }));
  } catch (error) {
    console.error('Unable to list administrator users:', error);
    const page = renderMessagePage(t(language, 'users.error.list.title'), t(language, 'users.error.list.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});

router.get('/new', (request, response) => response.send(renderCreatePage({}, '', request.uiLanguage)));
router.post('/', async (request, response) => {
  const values = normalValues(request.body);
  try {
    const user = await withTransaction(pool, async (client) => {
      const created = await createAdminUser(values, client, request.uiLanguage);
      await recordAuditEvent({
        client, category: 'user', action: 'user.create', targetType: 'admin_user',
        targetPublicId: created.public_id, targetLabel: created.name, summary: 'Compte utilisateur créé.',
        afterData: { name: created.name, email: created.email, role: created.role, active: created.active, view_pii: created.view_pii, ui_language: created.ui_language },
      });
      return created;
    });
    try {
      await sendAdminInvitation(user.id);
      await recordAuditEventSafely({
        category: 'user', action: 'user.invitation.send', targetType: 'admin_user',
        targetPublicId: user.public_id, targetLabel: user.name, summary: 'Invitation utilisateur envoyée.',
      });
      response.redirect(303, '/settings/users?notice=created_invited');
    } catch (invitationError) {
      await recordAuditEventSafely({
        category: 'user', action: 'user.invitation.send', targetType: 'admin_user',
        targetPublicId: user.public_id, targetLabel: user.name, result: 'failed',
        summary: 'Échec de l’envoi de l’invitation utilisateur.', metadata: { error_code: invitationError.code || 'DELIVERY_FAILED' },
      });
      console.warn('Administrator account created but invitation delivery failed:', invitationError.code || 'DELIVERY_FAILED');
      response.redirect(303, '/settings/users?notice=created_invitation_failed');
    }
  } catch (error) {
    const known = ['VALIDATION_ERROR', 'EMAIL_EXISTS'].includes(error.code);
    if (!known) console.error('Unable to create administrator user:', error);
    response.status(known ? 400 : 500).send(renderCreatePage(values, known ? error.message : t(request.uiLanguage, 'users.error.create'), request.uiLanguage));
  }
});

router.post('/:id/invitation', async (request, response) => {
  if (!isValidPublicId(request.params.id)) return response.status(404).send(userNotFoundPage(request.uiLanguage).html);
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).send(userNotFoundPage(request.uiLanguage).html);
    await sendAdminInvitation(user.id);
    await recordAuditEventSafely({
      category: 'user', action: 'user.invitation.resend', targetType: 'admin_user',
      targetPublicId: user.public_id, targetLabel: user.name, summary: 'Invitation utilisateur renvoyée.',
    });
    response.redirect(303, '/settings/users?notice=invitation_sent');
  } catch (error) {
    if (isValidPublicId(request.params.id)) {
      const user = await findUser(request.params.id).catch(() => null);
      if (user) await recordAuditEventSafely({
        category: 'user', action: 'user.invitation.resend', targetType: 'admin_user',
        targetPublicId: user.public_id, targetLabel: user.name, result: error.code === 'INVITATION_RATE_LIMITED' || error.code === 'USER_INACTIVE' ? 'denied' : 'failed',
        summary: 'Invitation utilisateur non envoyée.', metadata: { reason: error.code || 'DELIVERY_FAILED' },
      });
    }
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
  if (!isValidPublicId(request.params.id)) return response.status(404).send(userNotFoundPage(request.uiLanguage).html);
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).send(userNotFoundPage(request.uiLanguage).html);
    response.send(renderEditPage(user, '', request.uiLanguage));
  } catch (error) {
    console.error('Unable to load administrator user:', error);
    response.status(500).send(renderMessagePage(t(request.uiLanguage, 'users.error.unavailable.title'), t(request.uiLanguage, 'users.error.load'), 500, request.uiLanguage).html);
  }
});

router.get('/:id/delete', async (request, response) => {
  if (!isValidPublicId(request.params.id)) return response.status(404).send(userNotFoundPage(request.uiLanguage).html);
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).send(userNotFoundPage(request.uiLanguage).html);
    if (user.account_type === 'break_glass') return response.status(403).send(renderMessagePage(t(request.uiLanguage, 'users.error.delete_forbidden.title'), t(request.uiLanguage, 'users.error.break_glass_delete'), 403, request.uiLanguage).html);
    if (String(user.id) === String(request.currentUser.id)) return response.status(409).send(renderMessagePage(t(request.uiLanguage, 'users.error.delete_forbidden.title'), t(request.uiLanguage, 'users.error.self_delete'), 409, request.uiLanguage).html);
    response.send(renderDeletePage(user, '', request.uiLanguage));
  } catch (error) {
    console.error('Unable to prepare administrator deletion:', error);
    response.status(500).send(renderMessagePage(t(request.uiLanguage, 'users.error.delete_unavailable.title'), t(request.uiLanguage, 'users.error.delete_prepare'), 500, request.uiLanguage).html);
  }
});

router.post('/:id', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) return response.status(404).send(userNotFoundPage(language).html);
  try {
    const outcome = await withTransaction(pool, async (client) => {
      const activeAdmins = await client.query("SELECT id FROM admin_users WHERE role = 'administrator' AND active = TRUE ORDER BY id FOR UPDATE");
      const targetResult = await client.query('SELECT * FROM admin_users WHERE public_id = $1 FOR UPDATE', [request.params.id]);
      if (targetResult.rowCount === 0) return { status: 404 };

      const target = targetResult.rows[0];
      if (target.account_type === 'break_glass') {
        const name = typeof request.body.name === 'string' ? request.body.name.trim() : '';
        const username = normalizeUsername(request.body.username);
        const password = typeof request.body.password === 'string' ? request.body.password : '';
        const validationError = !validateName(name) ? t(language, 'users.validation.name') : !validateUsername(username) ? t(language, 'users.validation.username') : validatePassword(password, { required: false, language });
        const viewPii = request.body.view_pii === 'true';
        const uiLanguage = normalizeLanguageOverride(request.body.ui_language);
        const edited = { ...target, name, username, view_pii: viewPii, ui_language: uiLanguage };
        const completeValidationError = validationError || (uiLanguage === undefined ? t(language, 'users.error.invalid_ui_language') : '');
        if (completeValidationError) return { status: 400, edited, validationError: completeValidationError };

        const passwordHash = password ? await hashPassword(password) : null;
        await client.query(
          `UPDATE admin_users SET name = $1, username = $2,
             password_hash = COALESCE($3, password_hash), view_pii = $4, ui_language = $5,
             session_version = session_version + CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END,
             updated_at = CURRENT_TIMESTAMP WHERE id = $6`,
          [name, username, passwordHash, viewPii, uiLanguage, target.id],
        );
        await recordAuditEvent({
          client, category: 'user', action: password ? 'user.break_glass.password_change' : 'user.edit', targetType: 'admin_user',
          targetPublicId: target.public_id, targetLabel: name, summary: password ? 'Mot de passe du compte d’urgence modifié.' : 'Compte d’urgence modifié.',
          beforeData: { name: target.name, username: target.username, view_pii: target.view_pii, ui_language: target.ui_language },
          afterData: { name, username, view_pii: viewPii, ui_language: uiLanguage },
          metadata: password ? { changed_fields: ['password'] } : null,
        });
        return { status: 303 };
      }

      const values = normalValues(request.body);
      const edited = { ...target, ...values, view_pii: values.viewPii, ui_language: values.uiLanguage };
      const validationError = validateAdminUserInput(values, language)
        || (values.uiLanguage === undefined ? t(language, 'users.error.invalid_ui_language') : '');
      if (validationError) return { status: 400, edited, validationError };
      const removesLastAdmin = target.role === roles.administrator && target.active
        && (!values.active || values.role !== roles.administrator) && activeAdmins.rowCount === 1;
      if (removesLastAdmin) {
        await recordAuditEvent({
          client, category: 'user', action: 'user.edit', targetType: 'admin_user',
          targetPublicId: target.public_id, targetLabel: target.name, result: 'denied',
          summary: 'Modification refusée pour protéger le dernier administrateur actif.', metadata: { reason: 'LAST_ACTIVE_ADMINISTRATOR' },
        });
        return { status: 409, edited, validationError: t(language, 'users.error.last_admin_change') };
      }
      await client.query(
        `UPDATE admin_users SET name = $1, email = $2, role = $3, active = $4, view_pii = $5, ui_language = $6,
           session_version = session_version + CASE WHEN active AND NOT $4 THEN 1 ELSE 0 END,
           updated_at = CURRENT_TIMESTAMP WHERE id = $7`,
        [values.name, values.email, values.role, values.active, values.viewPii, values.uiLanguage, target.id],
      );
      await recordAuditEvent({
        client, category: 'user', action: target.active !== values.active ? (values.active ? 'user.activate' : 'user.deactivate') : target.role !== values.role ? 'user.role_change' : 'user.edit',
        targetType: 'admin_user', targetPublicId: target.public_id, targetLabel: values.name, summary: 'Compte utilisateur modifié.',
        beforeData: { name: target.name, email: target.email, role: target.role, active: target.active, view_pii: target.view_pii, ui_language: target.ui_language },
        afterData: { name: values.name, email: values.email, role: values.role, active: values.active, view_pii: values.viewPii, ui_language: values.uiLanguage },
      });
      return { status: 303 };
    });
    if (outcome.status === 404) return response.status(404).send(userNotFoundPage(language).html);
    if (outcome.status !== 303) return response.status(outcome.status).send(renderEditPage(outcome.edited, outcome.validationError, request.uiLanguage));
    response.redirect(303, '/settings/users?notice=updated');
  } catch (error) {
    const duplicate = error.code === '23505';
    if (!duplicate) console.error('Unable to update administrator user:', error);
    const user = await findUser(request.params.id).catch(() => null);
    response.status(duplicate ? 400 : 500).send(user ? renderEditPage(user, duplicate ? t(language, 'users.error.duplicate') : t(language, 'users.error.update'), language) : renderMessagePage(t(language, 'users.error.unavailable.title'), t(language, 'users.error.update'), 500, language).html);
  }
});

router.post('/:id/revoke-sessions', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) return response.status(404).send(userNotFoundPage(language).html);
  try {
    const result = await withTransaction(pool, async (client) => {
      const updated = await client.query('UPDATE admin_users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE public_id = $1 RETURNING id, public_id, name', [request.params.id]);
      if (updated.rowCount > 0) await recordAuditEvent({
        client, category: 'user', action: 'user.sessions.revoke', targetType: 'admin_user',
        targetPublicId: updated.rows[0].public_id, targetLabel: updated.rows[0].name,
        summary: 'Toutes les sessions du compte ont été révoquées.',
      });
      return updated;
    });
    if (result.rowCount === 0) return response.status(404).send(userNotFoundPage(language).html);
    if (String(request.currentUser.id) === String(result.rows[0].id)) {
      request.session.destroy((error) => {
        if (error) return response.status(500).send(renderMessagePage(t(language, 'auth.session_unavailable.title'), t(language, 'users.error.revoked_relogin'), 500, language).html);
        response.clearCookie('attendance_log_session');
        response.redirect(303, '/login');
      });
      return;
    }
    response.redirect(303, '/settings/users?notice=revoked');
  } catch (error) {
    console.error('Unable to revoke administrator sessions:', error);
    response.status(500).send(renderMessagePage(t(language, 'users.error.revoke.title'), t(language, 'users.error.revoke.message'), 500, language).html);
  }
});

router.post('/:id/delete', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) return response.status(404).send(userNotFoundPage(language).html);
  const user = await findUser(request.params.id).catch(() => null);
  if (!user) return response.status(404).send(userNotFoundPage(language).html);
  if (request.body?.confirm_delete !== 'true') return response.status(400).send(renderDeletePage(user, t(language, 'users.error.delete_confirm'), language));

  try {
    const outcome = await withTransaction(pool, async (client) => {
      const activeAdmins = await client.query("SELECT id FROM admin_users WHERE role = 'administrator' AND active = TRUE ORDER BY id FOR UPDATE");
      const targetResult = await client.query('SELECT id, public_id, name, email, account_type, role, active, view_pii FROM admin_users WHERE public_id = $1 FOR UPDATE', [request.params.id]);
      if (targetResult.rowCount === 0) return { status: 404 };
      const target = targetResult.rows[0];
      if (target.account_type === 'break_glass') {
        await recordAuditEvent({ client, category: 'user', action: 'user.delete', targetType: 'admin_user', targetPublicId: target.public_id, targetLabel: target.name, result: 'denied', summary: 'Suppression du compte d’urgence refusée.', metadata: { reason: 'BREAK_GLASS_PROTECTED' } });
        return { status: 403 };
      }
      if (String(target.id) === String(request.currentUser.id)) {
        await recordAuditEvent({ client, category: 'user', action: 'user.delete', targetType: 'admin_user', targetPublicId: target.public_id, targetLabel: target.name, result: 'denied', summary: 'Auto-suppression du compte connecté refusée.', metadata: { reason: 'SELF_DELETE_PROTECTED' } });
        return { status: 409, self: true };
      }
      if (target.role === roles.administrator && target.active && activeAdmins.rowCount === 1) {
        await recordAuditEvent({ client, category: 'user', action: 'user.delete', targetType: 'admin_user', targetPublicId: target.public_id, targetLabel: target.name, result: 'denied', summary: 'Suppression refusée pour protéger le dernier administrateur actif.', metadata: { reason: 'LAST_ACTIVE_ADMINISTRATOR' } });
        return { status: 409, lastAdmin: true };
      }
      await client.query("DELETE FROM admin_users WHERE id = $1 AND account_type = 'otp'", [target.id]);
      await recordAuditEvent({
        client, category: 'user', action: 'user.delete', targetType: 'admin_user',
        targetPublicId: target.public_id, targetLabel: target.name, summary: 'Compte utilisateur supprimé.',
        beforeData: { name: target.name, email: target.email, role: target.role, active: target.active, view_pii: target.view_pii },
      });
      return { status: 303 };
    });
    if (outcome.status === 404) return response.status(404).send(userNotFoundPage(language).html);
    if (outcome.status === 403) return response.status(403).send(renderMessagePage(t(language, 'users.error.delete_forbidden.title'), t(language, 'users.error.break_glass_delete'), 403, language).html);
    if (outcome.self) return response.status(409).send(renderMessagePage(t(language, 'users.error.delete_forbidden.title'), t(language, 'users.error.self_delete'), 409, language).html);
    if (outcome.lastAdmin) return response.status(409).send(renderDeletePage(user, t(language, 'users.error.last_admin'), language));
    response.redirect(303, '/settings/users?notice=deleted');
  } catch (error) {
    console.error('Unable to delete administrator user:', error);
    response.status(500).send(renderDeletePage(user, t(language, 'users.error.update'), language));
  }
});

module.exports = router;
module.exports.renderUiLanguageField = renderUiLanguageField;
