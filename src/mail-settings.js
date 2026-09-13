const express = require('express');
const { recordAuditEvent, recordAuditEventSafely } = require('./audit');
const { pool, withTransaction } = require('./db/client');
const {
  isCompleteMailConfiguration,
  migratePlaintextMailPassword,
  sendMail,
} = require('./mail');
const { decryptSecret, encryptSecret } = require('./secrets');
const { DEFAULT_LANGUAGE, t } = require('./i18n');
const { escapeHtml, renderPage, renderSettingsLayout } = require('./ui');

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

function validateConfiguration(values, existingPassword = '', language = DEFAULT_LANGUAGE) {
  if (!values.host) return t(language, 'mail.validation.host');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return t(language, 'mail.validation.port');
  }
  if (!securityModes.has(values.securityMode)) {
    return t(language, 'mail.validation.security');
  }
  if (!emailPattern.test(values.senderEmail)) {
    return t(language, 'mail.validation.sender_email');
  }
  if (!values.senderName) return t(language, 'mail.validation.sender_name');
  if (values.replyTo && !emailPattern.test(values.replyTo)) {
    return t(language, 'mail.validation.reply_to');
  }
  const effectivePassword = values.username ? values.password || existingPassword : '';
  if (values.username && !effectivePassword) {
    return t(language, 'mail.validation.credentials');
  }
  if (values.securityMode === 'none' && values.username) {
    return t(language, 'mail.validation.encryption');
  }
  return '';
}

function renderSettingsPage({
  values,
  hasPassword,
  secretReadable = true,
  feedback = null,
  testRecipient = '',
  language = DEFAULT_LANGUAGE,
}) {
  const complete = secretReadable && isCompleteMailConfiguration({
    ...values,
    port: Number(values.port),
    password: hasPassword ? 'stored' : '',
  });
  const feedbackMessage = feedback?.message
    ? `<p class="alert alert-${feedback.type === 'success' ? 'success' : 'danger'}" role="${feedback.type === 'success' ? 'status' : 'alert'}">${escapeHtml(feedback.message)}</p>`
    : '';

  return renderPage(t(language, 'mail.title'), renderSettingsLayout({
    activeSection: 'email',
    title: t(language, 'mail.title'),
    description: t(language, 'mail.description'),
    status: `<span class="badge status-badge status-${complete ? 'active' : 'inactive'}">${t(language, complete ? 'mail.configured' : 'mail.incomplete')}</span>`,
    notifications: feedbackMessage,
    content: `<section class="page-section" aria-label="${escapeHtml(t(language, 'mail.smtp'))}">
        <form class="card card-body app-form" method="post" action="/settings/email" autocomplete="off">
        <div class="form-field">
          <label for="smtp-host">${escapeHtml(t(language, 'mail.host'))} <span aria-hidden="true">*</span></label>
          <input class="form-control" id="smtp-host" name="smtp_host" type="text" value="${escapeHtml(values.host)}" autocomplete="off" spellcheck="false" required>
        </div>
        <div class="form-field">
          <label for="smtp-port">${escapeHtml(t(language, 'mail.port'))} <span aria-hidden="true">*</span></label>
          <input class="form-control" id="smtp-port" name="smtp_port" type="number" min="1" max="65535" inputmode="numeric" value="${escapeHtml(values.port)}" autocomplete="off" required>
        </div>
        <div class="form-field">
          <label for="security-mode">${escapeHtml(t(language, 'mail.security'))} <span aria-hidden="true">*</span></label>
          <select class="form-select" id="security-mode" name="security_mode" required>
            <option value="starttls"${values.securityMode === 'starttls' ? ' selected' : ''}>STARTTLS</option>
            <option value="tls"${values.securityMode === 'tls' ? ' selected' : ''}>${escapeHtml(t(language, 'mail.security.implicit'))}</option>
            <option value="none"${values.securityMode === 'none' ? ' selected' : ''}>${escapeHtml(t(language, 'mail.security.none'))}</option>
          </select>
        </div>
        <div class="form-field">
          <label for="smtp-username">${escapeHtml(t(language, 'mail.username'))}</label>
          <input class="form-control" id="smtp-username" name="smtp_username" type="text" value="${escapeHtml(values.username)}" autocomplete="off" autocapitalize="none" spellcheck="false">
        </div>
        <div class="form-field">
          <label for="smtp-password">${escapeHtml(t(language, 'mail.password'))}</label>
          <input class="form-control" id="smtp-password" name="smtp_password" type="password" value="" autocomplete="new-password"${hasPassword ? ` placeholder="${escapeHtml(t(language, 'mail.password.keep_placeholder'))}"` : ''}>
          <p class="help-text">${escapeHtml(t(language, hasPassword ? 'mail.password.saved_help' : 'mail.password.relay_help'))}</p>
        </div>
        <div class="form-field">
          <label for="sender-email">${escapeHtml(t(language, 'mail.sender_email'))} <span aria-hidden="true">*</span></label>
          <input class="form-control" id="sender-email" name="sender_email" type="email" value="${escapeHtml(values.senderEmail)}" autocomplete="off" autocapitalize="none" spellcheck="false" required>
        </div>
        <div class="form-field">
          <label for="sender-name">${escapeHtml(t(language, 'mail.sender_name'))} <span aria-hidden="true">*</span></label>
          <input class="form-control" id="sender-name" name="sender_name" type="text" value="${escapeHtml(values.senderName)}" autocomplete="off" required>
        </div>
        <div class="form-field">
          <label for="reply-to">Reply-To</label>
          <input class="form-control" id="reply-to" name="reply_to" type="email" value="${escapeHtml(values.replyTo)}" autocomplete="off" autocapitalize="none" spellcheck="false">
        </div>
        <p class="help-text">${escapeHtml(t(language, 'mail.provider_help'))}</p>
        <div class="form-actions d-flex flex-wrap gap-2">
          <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'mail.save'))}</button>
        </div>
        </form>
      </section>

      <section class="page-section" aria-labelledby="test-email-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="test-email-title">${escapeHtml(t(language, 'mail.test.title'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'mail.test.help'))}</p>
          </div>
        </div>
        <form class="card card-body app-form" method="post" action="/settings/email/test" autocomplete="off">
          <div class="form-field">
            <label for="test-recipient">${escapeHtml(t(language, 'mail.test.recipient'))}</label>
            <input class="form-control" id="test-recipient" name="test_recipient" type="email" value="${escapeHtml(testRecipient)}" autocomplete="off" autocapitalize="none" spellcheck="false" required>
          </div>
          <div class="form-actions d-flex flex-wrap gap-2">
            <button class="btn btn-primary" type="submit">${escapeHtml(t(language, 'mail.test.send'))}</button>
          </div>
        </form>
      </section>`,
  }), language);
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
  const configuration = await migratePlaintextMailPassword();
  let secretReadable = true;
  if (configuration?.password) {
    try {
      decryptSecret(configuration.password);
    } catch (_error) {
      secretReadable = false;
    }
  }
  response.send(renderSettingsPage({
    ...options,
    values: publicValues(configuration),
    hasPassword: Boolean(configuration?.password),
    secretReadable,
    feedback: !secretReadable
      ? {
        type: 'error',
        message: t(options.language, 'mail.error.secret_mismatch'),
      }
      : options.feedback,
  }));
}

router.get('/', async (request, response) => {
  const notices = {
    saved: t(request.uiLanguage, 'mail.notice.saved'),
    test_sent: t(request.uiLanguage, 'mail.notice.test_sent'),
  };
  try {
    const notice = notices[request.query.notice] || '';
    await renderCurrentSettings(response, {
      language: request.uiLanguage,
      feedback: notice ? { type: 'success', message: notice } : null,
    });
  } catch (error) {
    console.error('Unable to load mail configuration:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderSettingsPage({
      values: emptyValues(),
      hasPassword: false,
      feedback: {
        type: 'error',
        message: t(request.uiLanguage, 'mail.error.load'),
      },
      language: request.uiLanguage,
    }));
  }
});

router.post('/', async (request, response) => {
  const values = getFormValues(request.body);
  let current = null;
  try {
    current = await migratePlaintextMailPassword();
    const validationError = validateConfiguration(values, current?.password || '', request.uiLanguage);
    if (validationError) {
      response.status(400).send(renderSettingsPage({
        values,
        hasPassword: Boolean(current?.password),
        feedback: { type: 'error', message: validationError },
        language: request.uiLanguage,
      }));
      return;
    }

    const password = values.username
      ? values.password ? encryptSecret(values.password) : current?.password || null
      : null;
    await withTransaction(pool, async (client) => {
      const beforeResult = await client.query('SELECT smtp_host, smtp_port, security_mode, smtp_username, sender_email, sender_name, reply_to FROM mail_configuration WHERE id = 1');
      await client.query(
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
      const current = beforeResult.rows[0] || {};
      await recordAuditEvent({
        client, category: 'mail', action: 'mail.configuration.update', summary: 'Configuration e-mail mise à jour.',
        beforeData: current,
        afterData: { smtp_host: values.host, smtp_port: Number(values.port), security_mode: values.securityMode, smtp_username: values.username || null, sender_email: values.senderEmail, sender_name: values.senderName, reply_to: values.replyTo || null },
        metadata: { credential_change: Boolean(values.password) },
      });
    });
    response.redirect(303, '/settings/email?notice=saved');
  } catch (error) {
    console.error('Unable to save mail configuration:', error.code || 'DATABASE_ERROR');
    response.status(500).send(renderSettingsPage({
      values,
      hasPassword: Boolean(current?.password),
      feedback: {
        type: 'error',
        message: t(request.uiLanguage, 'mail.error.save'),
      },
      language: request.uiLanguage,
    }));
  }
});

function testMailErrorMessage(code, language = DEFAULT_LANGUAGE) {
  const key = `mail.test.error.${code}`;
  try {
    return t(language, key);
  } catch (_error) {
    return code === 'SECRET_KEY_MISMATCH'
      ? t(language, 'mail.error.secret_mismatch')
      : t(language, 'mail.test.error.default');
  }
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
          message: t(request.uiLanguage, 'mail.validation.recipient'),
        },
        language: request.uiLanguage,
      });
    } catch (error) {
      console.error('Unable to load mail configuration:', error.code || 'DATABASE_ERROR');
      response.status(500).send(renderSettingsPage({
        values: emptyValues(),
        hasPassword: false,
        testRecipient,
        feedback: {
          type: 'error',
          message: t(request.uiLanguage, 'mail.error.load'),
        },
        language: request.uiLanguage,
      }));
    }
    return;
  }

  try {
    await sendMail({
      to: testRecipient,
      subject: t(request.uiLanguage, 'mail.test.subject'),
      text: t(request.uiLanguage, 'mail.test.body'),
      html: `<p>${escapeHtml(t(request.uiLanguage, 'mail.test.body'))}</p>`,
    });
    await recordAuditEventSafely({ category: 'mail', action: 'mail.test', summary: 'Test de la configuration e-mail réussi.' });
    response.redirect(303, '/settings/email?notice=test_sent');
  } catch (error) {
    await recordAuditEventSafely({ category: 'mail', action: 'mail.test', result: 'failed', summary: 'Échec du test de la configuration e-mail.', metadata: { error_code: error.code || 'DELIVERY_FAILED' } });
    console.error('Unable to send test email:', error.code || 'DELIVERY_FAILED');
    try {
      await renderCurrentSettings(response.status(error.code === 'NOT_CONFIGURED' ? 400 : 502), {
        testRecipient,
        feedback: { type: 'error', message: testMailErrorMessage(error.code, request.uiLanguage) },
        language: request.uiLanguage,
      });
    } catch (loadError) {
      console.error('Unable to load mail configuration:', loadError.code || 'DATABASE_ERROR');
      response.status(500).send(renderSettingsPage({
        values: emptyValues(),
        hasPassword: false,
        testRecipient,
        feedback: { type: 'error', message: testMailErrorMessage(error.code, request.uiLanguage) },
        language: request.uiLanguage,
      }));
    }
  }
});

module.exports = router;
