const express = require('express');
const { pool } = require('./db/client');
const {
  isCompleteMailConfiguration,
  loadMailConfiguration,
  sendMail,
} = require('./mail');
const { escapeHtml, renderPage } = require('./ui');

const router = express.Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const securityModes = new Set(['starttls', 'tls', 'none']);

function emptyValues() {
  return {
    host: '',
    port: '587',
    securityMode: 'starttls',
    username: '',
    senderEmail: '',
    senderName: '',
    replyTo: '',
  };
}

function getFormValues(body = {}) {
  return {
    host: typeof body.smtp_host === 'string' ? body.smtp_host.trim() : '',
    port: typeof body.smtp_port === 'string' ? body.smtp_port.trim() : '',
    securityMode: typeof body.security_mode === 'string' ? body.security_mode : '',
    username: typeof body.smtp_username === 'string' ? body.smtp_username.trim() : '',
    password: typeof body.smtp_password === 'string' ? body.smtp_password : '',
    senderEmail: typeof body.sender_email === 'string' ? body.sender_email.trim().toLowerCase() : '',
    senderName: typeof body.sender_name === 'string' ? body.sender_name.trim() : '',
    replyTo: typeof body.reply_to === 'string' ? body.reply_to.trim().toLowerCase() : '',
  };
}

function validateConfiguration(values, existingPassword = '') {
  if (!values.host) return 'Le serveur SMTP est obligatoire.';
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 'Le port SMTP doit être un nombre compris entre 1 et 65535.';
  }
  if (!securityModes.has(values.securityMode)) {
    return 'Le mode de sécurité SMTP sélectionné n’est pas pris en charge.';
  }
  if (!emailPattern.test(values.senderEmail)) {
    return 'L’adresse d’expéditeur n’est pas valide.';
  }
  if (!values.senderName) return 'Le nom d’expéditeur est obligatoire.';
  if (values.replyTo && !emailPattern.test(values.replyTo)) {
    return 'L’adresse Reply-To n’est pas valide.';
  }
  const effectivePassword = values.password || existingPassword;
  if (Boolean(values.username) !== Boolean(effectivePassword)) {
    return 'Renseignez à la fois le nom d’utilisateur et le mot de passe SMTP, ou laissez les deux vides pour un relais sans authentification.';
  }
  return '';
}

function renderSettingsPage({
  values,
  hasPassword,
  feedback = null,
  testRecipient = '',
}) {
  const complete = isCompleteMailConfiguration({
    ...values,
    port: Number(values.port),
    password: hasPassword ? 'stored' : '',
  });
  const feedbackMessage = feedback?.message
    ? `<p class="message message-${feedback.type === 'success' ? 'success' : 'error'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';

  return renderPage('Configuration e-mail', `
    <div class="settings-page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Administration</p>
          <h1>Configuration e-mail</h1>
          <p class="page-description">Configurez un fournisseur SMTP standard pour les futurs envois de l’application.</p>
        </div>
        <span class="status-badge status-${complete ? 'active' : 'inactive'}">${complete ? 'E-mail configuré' : 'Configuration e-mail incomplète'}</span>
      </header>
      <div class="notification-area" aria-live="polite" aria-atomic="true">
        ${feedbackMessage}
      </div>
      <form class="form-card" method="post" action="/settings/email" autocomplete="off">
        <div class="form-field">
          <label for="smtp-host">Serveur SMTP <span aria-hidden="true">*</span></label>
          <input id="smtp-host" name="smtp_host" type="text" value="${escapeHtml(values.host)}" autocomplete="off" spellcheck="false" required>
        </div>
        <div class="form-field">
          <label for="smtp-port">Port <span aria-hidden="true">*</span></label>
          <input id="smtp-port" name="smtp_port" type="number" min="1" max="65535" inputmode="numeric" value="${escapeHtml(values.port)}" autocomplete="off" required>
        </div>
        <div class="form-field">
          <label for="security-mode">Sécurité <span aria-hidden="true">*</span></label>
          <select id="security-mode" name="security_mode" required>
            <option value="starttls"${values.securityMode === 'starttls' ? ' selected' : ''}>STARTTLS</option>
            <option value="tls"${values.securityMode === 'tls' ? ' selected' : ''}>TLS implicite / SMTPS</option>
            <option value="none"${values.securityMode === 'none' ? ' selected' : ''}>Aucun chiffrement</option>
          </select>
        </div>
        <div class="form-field">
          <label for="smtp-username">Nom d’utilisateur</label>
          <input id="smtp-username" name="smtp_username" type="text" value="${escapeHtml(values.username)}" autocomplete="off" autocapitalize="none" spellcheck="false">
        </div>
        <div class="form-field">
          <label for="smtp-password">Mot de passe</label>
          <input id="smtp-password" name="smtp_password" type="password" value="" autocomplete="new-password"${hasPassword ? ' placeholder="Laisser vide pour conserver le mot de passe…"' : ''}>
          <p class="help-text">${hasPassword ? 'Un mot de passe est enregistré. Laissez ce champ vide pour le conserver.' : 'Laissez les identifiants vides si votre relais SMTP n’exige pas d’authentification.'}</p>
        </div>
        <div class="form-field">
          <label for="sender-email">Adresse d’expéditeur <span aria-hidden="true">*</span></label>
          <input id="sender-email" name="sender_email" type="email" value="${escapeHtml(values.senderEmail)}" autocomplete="off" autocapitalize="none" spellcheck="false" required>
        </div>
        <div class="form-field">
          <label for="sender-name">Nom d’expéditeur <span aria-hidden="true">*</span></label>
          <input id="sender-name" name="sender_name" type="text" value="${escapeHtml(values.senderName)}" autocomplete="off" required>
        </div>
        <div class="form-field">
          <label for="reply-to">Reply-To</label>
          <input id="reply-to" name="reply_to" type="email" value="${escapeHtml(values.replyTo)}" autocomplete="off" autocapitalize="none" spellcheck="false">
        </div>
        <p class="help-text">Utilisez les paramètres et identifiants SMTP fournis par votre prestataire.</p>
        <div class="form-actions">
          <button class="button" type="submit">Enregistrer la configuration</button>
        </div>
      </form>

      <section class="page-section" aria-labelledby="test-email-title">
        <div class="section-header">
          <div>
            <h2 id="test-email-title">Tester la configuration</h2>
            <p class="section-description">Le test utilise uniquement la configuration enregistrée ci-dessus.</p>
          </div>
        </div>
        <form class="form-card" method="post" action="/settings/email/test" autocomplete="off">
          <div class="form-field">
            <label for="test-recipient">Adresse de destination</label>
            <input id="test-recipient" name="test_recipient" type="email" value="${escapeHtml(testRecipient)}" autocomplete="off" autocapitalize="none" spellcheck="false" required>
          </div>
          <div class="form-actions">
            <button class="button" type="submit">Envoyer un e-mail de test</button>
          </div>
        </form>
      </section>
    </div>`);
}

function publicValues(configuration) {
  if (!configuration) return emptyValues();
  return {
    host: configuration.host,
    port: String(configuration.port),
    securityMode: configuration.securityMode,
    username: configuration.username,
    senderEmail: configuration.senderEmail,
    senderName: configuration.senderName,
    replyTo: configuration.replyTo,
  };
}

async function renderCurrentSettings(response, options = {}) {
  const configuration = await loadMailConfiguration();
  response.send(renderSettingsPage({
    values: publicValues(configuration),
    hasPassword: Boolean(configuration?.password),
    ...options,
  }));
}

router.get('/', async (request, response) => {
  const notices = {
    saved: 'La configuration e-mail a été enregistrée.',
    test_sent: 'L’e-mail de test a été accepté par le serveur SMTP.',
  };
  try {
    const notice = notices[request.query.notice] || '';
    await renderCurrentSettings(response, {
      feedback: notice ? { type: 'success', message: notice } : null,
    });
  } catch (error) {
    console.error('Unable to load mail configuration:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderSettingsPage({
      values: emptyValues(),
      hasPassword: false,
      feedback: {
        type: 'error',
        message: 'Impossible de charger la configuration e-mail pour le moment.',
      },
    }));
  }
});

router.post('/', async (request, response) => {
  const values = getFormValues(request.body);
  let current = null;
  try {
    current = await loadMailConfiguration();
    const validationError = validateConfiguration(values, current?.password || '');
    if (validationError) {
      response.status(400).send(renderSettingsPage({
        values,
        hasPassword: Boolean(current?.password),
        feedback: { type: 'error', message: validationError },
      }));
      return;
    }

    const password = values.password || current?.password || null;
    await pool.query(
      `INSERT INTO mail_configuration (
         id, smtp_host, smtp_port, security_mode, smtp_username, smtp_password,
         sender_email, sender_name, reply_to
       ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host,
         smtp_port = EXCLUDED.smtp_port,
         security_mode = EXCLUDED.security_mode,
         smtp_username = EXCLUDED.smtp_username,
         smtp_password = EXCLUDED.smtp_password,
         sender_email = EXCLUDED.sender_email,
         sender_name = EXCLUDED.sender_name,
         reply_to = EXCLUDED.reply_to,
         updated_at = CURRENT_TIMESTAMP`,
      [
        values.host,
        Number(values.port),
        values.securityMode,
        values.username || null,
        password,
        values.senderEmail,
        values.senderName,
        values.replyTo || null,
      ],
    );
    response.redirect(303, '/settings/email?notice=saved');
  } catch (error) {
    console.error('Unable to save mail configuration:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderSettingsPage({
      values,
      hasPassword: Boolean(current?.password),
      feedback: {
        type: 'error',
        message: 'Impossible d’enregistrer la configuration e-mail pour le moment.',
      },
    }));
  }
});

function testMailErrorMessage(code) {
  return {
    NOT_CONFIGURED: 'Enregistrez une configuration e-mail complète avant d’envoyer un test.',
    AUTHENTICATION_FAILED: 'L’authentification SMTP a échoué. Vérifiez le nom d’utilisateur et le mot de passe.',
    CONNECTION_FAILED: 'Impossible de joindre le serveur SMTP. Vérifiez le serveur, le port et le réseau.',
    TLS_FAILED: 'La négociation TLS a échoué. Vérifiez le mode de sécurité et le certificat du serveur.',
    SENDER_REJECTED: 'Le serveur SMTP a refusé l’adresse d’expéditeur.',
    RECIPIENT_REJECTED: 'Le serveur SMTP a refusé l’adresse de destination.',
    DELIVERY_FAILED: 'Le serveur SMTP n’a pas accepté l’e-mail de test.',
  }[code] || 'L’e-mail de test n’a pas pu être envoyé.';
}

router.post('/test', async (request, response) => {
  const testRecipient = typeof request.body.test_recipient === 'string'
    ? request.body.test_recipient.trim().toLowerCase()
    : '';
  if (!emailPattern.test(testRecipient)) {
    try {
      await renderCurrentSettings(response.status(400), {
        testRecipient,
        feedback: {
          type: 'error',
          message: 'L’adresse de destination n’est pas valide.',
        },
      });
    } catch (error) {
      console.error('Unable to load mail configuration:', error.code || 'DATABASE_ERROR');
      response.status(500).send(renderSettingsPage({
        values: emptyValues(),
        hasPassword: false,
        testRecipient,
        feedback: {
          type: 'error',
          message: 'Impossible de charger la configuration e-mail pour le moment.',
        },
      }));
    }
    return;
  }

  try {
    await sendMail({
      to: testRecipient,
      subject: 'Attendance Log — test e-mail',
      text: 'Cet e-mail confirme que la configuration SMTP d’Attendance Log fonctionne.',
      html: '<p>Cet e-mail confirme que la configuration SMTP d’Attendance Log fonctionne.</p>',
    });
    response.redirect(303, '/settings/email?notice=test_sent');
  } catch (error) {
    console.error('Unable to send test email:', error.code || 'DELIVERY_FAILED');
    try {
      await renderCurrentSettings(response.status(error.code === 'NOT_CONFIGURED' ? 400 : 502), {
        testRecipient,
        feedback: { type: 'error', message: testMailErrorMessage(error.code) },
      });
    } catch (loadError) {
      console.error('Unable to load mail configuration:', loadError.code || 'DATABASE_ERROR');
      response.status(500).send(renderSettingsPage({
        values: emptyValues(),
        hasPassword: false,
        testRecipient,
        feedback: { type: 'error', message: testMailErrorMessage(error.code) },
      }));
    }
  }
});

module.exports = router;
