const crypto = require('node:crypto');
const express = require('express');
const { escapeHtml, renderPage } = require('./ui');

const router = express.Router();

function secureEqual(firstValue, secondValue) {
  const firstHash = crypto.createHash('sha256').update(firstValue).digest();
  const secondHash = crypto.createHash('sha256').update(secondValue).digest();
  return crypto.timingSafeEqual(firstHash, secondHash);
}

function renderLogin(error = '') {
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
        <label for="username">Identifiant</label>
        <input class="form-control" id="username" name="username" type="text" autocomplete="username" required autofocus>
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

router.get('/login', (request, response) => {
  if (request.session.authenticated) {
    response.redirect(303, '/');
    return;
  }

  response.send(renderLogin());
});

router.post('/login', async (request, response) => {
  const username = typeof request.body.username === 'string' ? request.body.username : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  const validCredentials = secureEqual(username, process.env.ADMIN_USERNAME)
    && secureEqual(password, process.env.ADMIN_PASSWORD);

  if (!validCredentials) {
    response.status(401).send(renderLogin('Identifiant ou mot de passe incorrect.'));
    return;
  }

  try {
    await regenerateSession(request);
    request.session.authenticated = true;
    await saveSession(request);
    response.redirect(303, '/');
  } catch (error) {
    console.error('Unable to create admin session:', error);
    response.status(500).send(renderLogin('Impossible de se connecter pour le moment.'));
  }
});

router.post('/logout', requireAuthentication, (request, response) => {
  request.session.destroy((error) => {
    if (error) {
      console.error('Unable to destroy admin session:', error);
      response.status(500).send(renderLogin('Impossible de se déconnecter pour le moment.'));
      return;
    }

    response.clearCookie('attendance_log_session');
    response.redirect(303, '/login');
  });
});

function requireAuthentication(request, response, next) {
  if (request.session.authenticated) {
    next();
    return;
  }

  if (request.accepts(['html', 'json']) === 'json') {
    response.status(401).json({ error: 'Votre session a expiré.' });
    return;
  }

  response.redirect(303, '/login');
}

module.exports = { router, requireAuthentication };
