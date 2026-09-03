const express = require('express');
const { normalizeEmail, verifyPassword } = require('./admin-users');
const { pool } = require('./db/client');
const { hasPermission } = require('./permissions');
const { escapeHtml, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();
const DUMMY_PASSWORD_HASH = '$2b$12$.hmsAbAYTXzyR7IaFD/CvODU/wPeWQ/Y7LwFZXzLqoqtAnpjlL0WC';

function wantsJson(request) {
  return request.accepts(['html', 'json']) === 'json';
}

function renderLogin(error = '', email = '') {
  const errorMessage = error
    ? `<p class="alert alert-danger" role="alert">${escapeHtml(error)}</p>`
    : '';

  return renderPage('Connexion', `
    <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
      <div>
        <p class="eyebrow">Administration</p>
        <h1>Connexion</h1>
      </div>
    </header>
    ${errorMessage}
    <form class="card card-body app-form" method="post" action="/login">
      <div class="form-field">
        <label for="email">Adresse e-mail</label>
        <input class="form-control" id="email" name="email" type="email" value="${escapeHtml(email)}" autocomplete="username" spellcheck="false" required autofocus>
      </div>
      <div class="form-field">
        <label for="password">Mot de passe</label>
        <input class="form-control" id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn btn-primary" type="submit">Se connecter</button>
    </form>`, { authenticated: false });
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(request) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

async function loadAuthenticatedUser(request, response, next) {
  const userId = request.session?.adminUserId;
  if (!userId) {
    next();
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, role
       FROM admin_users
       WHERE id = $1 AND active = TRUE`,
      [userId],
    );
    if (result.rowCount === 0) {
      await destroySession(request);
      response.clearCookie('attendance_log_session');
      next();
      return;
    }

    request.currentUser = result.rows[0];
    request.session.role = request.currentUser.role;
    next();
  } catch (error) {
    console.error('Unable to load authenticated administrator:', error);
    if (wantsJson(request)) {
      response.status(503).json({ error: 'Impossible de vérifier votre session pour le moment.' });
      return;
    }
    const page = renderMessagePage(
      'Session indisponible',
      'Impossible de vérifier votre session pour le moment.',
      503,
    );
    response.status(page.status).send(page.html);
  }
}

router.get('/login', (request, response) => {
  if (request.currentUser) {
    response.redirect(303, '/');
    return;
  }
  response.send(renderLogin());
});

router.post('/login', async (request, response) => {
  const email = normalizeEmail(request.body.email);
  const password = typeof request.body.password === 'string' ? request.body.password : '';

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, role
       FROM admin_users
       WHERE LOWER(email) = LOWER($1) AND active = TRUE`,
      [email],
    );
    const user = result.rows[0];
    const validPassword = await verifyPassword(
      password,
      user?.password_hash || DUMMY_PASSWORD_HASH,
    );
    if (!user || !validPassword) {
      response.status(401).send(renderLogin('Adresse e-mail ou mot de passe incorrect.', email));
      return;
    }

    const loginResult = await pool.query(
      `UPDATE admin_users
       SET last_login_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND active = TRUE
       RETURNING id, role`,
      [user.id],
    );
    if (loginResult.rowCount === 0) {
      response.status(401).send(renderLogin('Adresse e-mail ou mot de passe incorrect.', email));
      return;
    }

    await regenerateSession(request);
    request.session.adminUserId = String(user.id);
    request.session.role = user.role;
    await saveSession(request);
    response.redirect(303, '/');
  } catch (error) {
    console.error('Unable to create administrator session:', error);
    response.status(500).send(renderLogin('Impossible de se connecter pour le moment.', email));
  }
});

router.post('/logout', requireAuthentication, (request, response) => {
  request.session.destroy((error) => {
    if (error) {
      console.error('Unable to destroy administrator session:', error);
      response.status(500).send(renderLogin('Impossible de se déconnecter pour le moment.'));
      return;
    }
    response.clearCookie('attendance_log_session');
    response.redirect(303, '/login');
  });
});

function requireAuthentication(request, response, next) {
  if (request.currentUser) {
    next();
    return;
  }
  if (wantsJson(request)) {
    response.status(401).json({ error: 'Votre session a expiré.' });
    return;
  }
  response.redirect(303, '/login');
}

function requirePermission(permission) {
  return function permissionMiddleware(request, response, next) {
    if (hasPermission(request.currentUser, permission)) {
      next();
      return;
    }
    if (wantsJson(request)) {
      response.status(403).json({ error: 'Vous n’avez pas accès à cette fonctionnalité.' });
      return;
    }
    const page = renderMessagePage(
      'Accès refusé',
      'Vous n’avez pas accès à cette fonctionnalité.',
      403,
    );
    response.status(page.status).send(page.html);
  };
}

module.exports = {
  loadAuthenticatedUser,
  requireAuthentication,
  requirePermission,
  router,
};
