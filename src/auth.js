const express = require('express');
const { normalizeEmail, normalizeUsername, validateEmail } = require('./admin-users');
const { authenticateBreakGlass } = require('./break-glass-auth');
const { pool } = require('./db/client');
const { getOtpRequestAvailability, requestOtp, verifyOtp } = require('./otp-auth');
const { hasPermission } = require('./permissions');
const { escapeHtml, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();
const SESSION_ABSOLUTE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const OTP_REQUEST_NOTICE = 'Si cette adresse correspond à un compte actif, un code de connexion a été demandé. S’il n’arrive pas, réessayez après le délai indiqué.';

function wantsJson(request) { return request.accepts(['html', 'json']) === 'json'; }

function authPage(title, content) {
  return renderPage(title, `<div class="container-sm py-4 py-md-5" style="max-width: 32rem">
    <div class="mb-4 text-center"><p class="eyebrow">Administration</p><h1 class="h2">${escapeHtml(title)}</h1></div>
    ${content}
  </div>`, { authenticated: false, pageClass: 'auth-page' });
}

function notification(message, type = 'danger') {
  if (!message) return '';
  return `<p class="alert alert-${type}" role="${type === 'danger' ? 'alert' : 'status'}">${escapeHtml(message)}</p>`;
}

function renderLogin({ message = '', type = 'danger', identifier = '' } = {}) {
  return authPage('Connexion', `${notification(message, type)}
    <form class="card card-body app-form" method="post" action="/login">
      <div class="form-field"><label for="identifier">Adresse e-mail ou identifiant</label>
        <input class="form-control" id="identifier" name="identifier" type="text" value="${escapeHtml(identifier)}" autocomplete="username" inputmode="email" spellcheck="false" required autofocus></div>
      <button class="btn btn-primary" type="submit">Continuer</button>
    </form>`);
}

function formatRetryAfter(retryAfterSeconds) {
  const seconds = Math.max(0, Math.ceil(Number(retryAfterSeconds) || 0));
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secondsPart = String(seconds % 60).padStart(2, '0');
  return `${minutesPart}:${secondsPart}`;
}

function renderOtpEntry({ message = '', type = 'success', email = '', retryAfterSeconds = 0 } = {}) {
  const remainingSeconds = Math.max(0, Math.ceil(Number(retryAfterSeconds) || 0));
  const resendDisabled = remainingSeconds > 0;
  const resendLabel = resendDisabled ? `Renvoyer un code dans ${formatRetryAfter(remainingSeconds)}` : 'Renvoyer un code';
  return authPage('Code de connexion', `${notification(message, type)}
    <form class="card card-body app-form" method="post" action="/login/otp/verify">
      <p class="text-body-secondary mb-1">Saisissez le code à 6 chiffres reçu par e-mail.</p>
      ${email ? `<p class="small text-break mb-2"><strong>${escapeHtml(email)}</strong></p>` : ''}
      <div class="form-field"><label for="code">Code de connexion</label>
        <input class="form-control form-control-lg text-center font-monospace" id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required autofocus></div>
      <button class="btn btn-primary" type="submit">Se connecter</button>
    </form>
    <form class="mt-3 text-center" method="post" action="/login/otp/resend" data-otp-resend-form data-retry-after-seconds="${remainingSeconds}">
      <button class="btn btn-link" type="submit" data-otp-resend-button${resendDisabled ? ' disabled' : ''}><span data-otp-resend-label>${resendLabel}</span></button>
      <span class="visually-hidden" role="status" aria-live="polite" data-otp-resend-status></span>
    </form>
    <p class="mb-0 text-center"><a class="link-secondary" href="/login">Utiliser un autre identifiant</a></p>`);
}

function renderPasswordEntry({ message = '', identifier = '' } = {}) {
  return authPage('Mot de passe', `${notification(message)}
    <form class="card card-body app-form" method="post" action="/login/password">
      <p class="small text-body-secondary text-break mb-2">${escapeHtml(identifier)}</p>
      <div class="form-field"><label for="password">Mot de passe</label>
        <input class="form-control" id="password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary" type="submit">Se connecter</button>
    </form>
    <p class="mt-3 mb-0 text-center"><a href="/login">Utiliser un autre identifiant</a></p>`);
}

function regenerateSession(request) { return new Promise((resolve, reject) => request.session.regenerate((error) => (error ? reject(error) : resolve()))); }
function saveSession(request) { return new Promise((resolve, reject) => request.session.save((error) => (error ? reject(error) : resolve()))); }
function destroySession(request) { return new Promise((resolve, reject) => request.session.destroy((error) => (error ? reject(error) : resolve()))); }

async function establishSession(request, user) {
  await regenerateSession(request);
  request.session.adminUserId = String(user.id);
  request.session.role = user.role;
  request.session.sessionVersion = String(user.session_version);
  request.session.authenticatedAt = Date.now();
  await saveSession(request);
}

async function invalidateSession(request, response) {
  await destroySession(request);
  response.clearCookie('attendance_log_session');
}

async function loadAuthenticatedUser(request, response, next) {
  const userId = request.session?.adminUserId;
  if (!userId) return next();
  try {
    const result = await pool.query(
      `SELECT id, name, email, username, account_type, role, session_version FROM admin_users WHERE id = $1 AND active = TRUE`,
      [userId],
    );
    const user = result.rows[0];
    const authenticatedAt = Number(request.session.authenticatedAt);
    const valid = user && Number.isFinite(authenticatedAt)
      && Date.now() - authenticatedAt < SESSION_ABSOLUTE_LIFETIME_MS
      && String(user.session_version) === String(request.session.sessionVersion);
    if (!valid) {
      await invalidateSession(request, response);
      return next();
    }
    request.currentUser = user;
    request.session.role = user.role;
    next();
  } catch (error) {
    console.error('Unable to load authenticated administrator:', error);
    if (wantsJson(request)) return response.status(503).json({ error: 'Impossible de vérifier votre session pour le moment.' });
    const page = renderMessagePage('Session indisponible', 'Impossible de vérifier votre session pour le moment.', 503);
    response.status(page.status).send(page.html);
  }
}

router.get('/login', (request, response) => {
  if (request.currentUser) return response.redirect(303, '/');
  response.send(renderLogin());
});

async function renderOtpFromSession(request, response, { message = '', type = 'success', status = 200 } = {}) {
  const email = normalizeEmail(request.session?.otpEmail);
  if (!email) return response.redirect(303, '/login');
  try {
    const availability = await getOtpRequestAvailability(email, request.ip);
    response.status(status).send(renderOtpEntry({ email, message, type, retryAfterSeconds: availability.retryAfterSeconds }));
  } catch (error) {
    console.error('Unable to load OTP resend availability:', error.code || error.message);
    response.status(503).send(renderOtpEntry({ email, message: 'Impossible de vérifier le délai de renvoi pour le moment.', type: 'danger' }));
  }
}

router.get('/login/otp', async (request, response) => {
  if (request.currentUser) return response.redirect(303, '/');
  const message = request.session?.otpNotice || '';
  const type = request.session?.otpNoticeType || 'success';
  delete request.session.otpNotice;
  delete request.session.otpNoticeType;
  await saveSession(request);
  return renderOtpFromSession(request, response, { message, type });
});

async function startOtpFlow(request, response, email) {
  try {
    const result = await requestOtp(email, request.ip);
    request.session.otpChallengeId = result.challengeId;
    request.session.otpEmail = email;
    request.session.otpNotice = OTP_REQUEST_NOTICE;
    request.session.otpNoticeType = 'info';
    await saveSession(request);
    response.redirect(303, '/login/otp');
  } catch (error) {
    const rateLimited = error.code === 'RATE_LIMITED';
    if (rateLimited) {
      request.session.otpEmail = email;
      request.session.otpNotice = 'Veuillez attendre avant de demander un nouveau code.';
      request.session.otpNoticeType = 'warning';
      await saveSession(request);
      return response.redirect(303, '/login/otp');
    }
    console.error('Unable to request administrator OTP:', error.code || error.message);
    response.status(503).send(renderLogin({ identifier: email, message: 'Impossible de traiter la demande pour le moment.' }));
  }
}

router.post('/login', async (request, response) => {
  const identifier = typeof request.body?.identifier === 'string' ? request.body.identifier.trim() : '';
  const email = normalizeEmail(identifier);
  if (validateEmail(email)) return startOtpFlow(request, response, email);

  request.session.loginIdentifier = normalizeUsername(identifier);
  delete request.session.otpChallengeId;
  delete request.session.otpEmail;
  await saveSession(request);
  response.send(renderPasswordEntry({ identifier }));
});

router.post('/login/otp/resend', async (request, response) => {
  const email = normalizeEmail(request.session?.otpEmail);
  if (!email) return response.redirect(303, '/login');
  try {
    const result = await requestOtp(email, request.ip);
    request.session.otpChallengeId = result.challengeId;
    request.session.otpNotice = OTP_REQUEST_NOTICE;
    request.session.otpNoticeType = 'info';
    await saveSession(request);
    response.redirect(303, '/login/otp');
  } catch (error) {
    const rateLimited = error.code === 'RATE_LIMITED';
    if (rateLimited) {
      request.session.otpNotice = 'Veuillez attendre avant de demander un nouveau code.';
      request.session.otpNoticeType = 'warning';
      await saveSession(request);
      return response.redirect(303, '/login/otp');
    }
    response.status(503).send(renderOtpEntry({ email, type: 'danger', message: 'Impossible d’envoyer un nouveau code pour le moment.' }));
  }
});

router.post('/login/otp/verify', async (request, response) => {
  const challengeId = request.session?.otpChallengeId;
  const email = normalizeEmail(request.session?.otpEmail);
  const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
  if (!challengeId) return response.redirect(303, '/login');
  try {
    const user = await verifyOtp(challengeId, code);
    await establishSession(request, user);
    response.redirect(303, '/');
  } catch (_error) {
    return renderOtpFromSession(request, response, { status: 401, type: 'danger', message: 'Code incorrect ou expiré. Demandez un nouveau code si nécessaire.' });
  }
});

router.post('/login/password', async (request, response) => {
  const username = normalizeUsername(request.session?.loginIdentifier);
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (!username) return response.redirect(303, '/login');
  try {
    const user = await authenticateBreakGlass({ username, password, ip: request.ip });
    await establishSession(request, user);
    response.redirect(303, '/');
  } catch (error) {
    if (!['INVALID_CREDENTIALS', 'RATE_LIMITED'].includes(error.code)) {
      console.error('Unable to authenticate local administrator:', error.code || error.message);
      return response.status(500).send(renderPasswordEntry({ message: 'Impossible de se connecter pour le moment.', identifier: username }));
    }
    response.status(401).send(renderPasswordEntry({ message: 'Identifiant ou mot de passe incorrect. Réessayez plus tard si nécessaire.', identifier: username }));
  }
});

router.post('/logout', requireAuthentication, (request, response) => {
  request.session.destroy((error) => {
    if (error) return response.status(500).send(renderLogin({ message: 'Impossible de se déconnecter pour le moment.' }));
    response.clearCookie('attendance_log_session');
    response.redirect(303, '/login');
  });
});

function requireAuthentication(request, response, next) {
  if (request.currentUser) return next();
  if (wantsJson(request)) return response.status(401).json({ error: 'Votre session a expiré.' });
  response.redirect(303, '/login');
}

function requirePermission(permission) {
  return function permissionMiddleware(request, response, next) {
    if (hasPermission(request.currentUser, permission)) return next();
    if (wantsJson(request)) return response.status(403).json({ error: 'Vous n’avez pas accès à cette fonctionnalité.' });
    const page = renderMessagePage('Accès refusé', 'Vous n’avez pas accès à cette fonctionnalité.', 403);
    response.status(page.status).send(page.html);
  };
}

module.exports = { SESSION_ABSOLUTE_LIFETIME_MS, establishSession, loadAuthenticatedUser, requireAuthentication, requirePermission, router };
