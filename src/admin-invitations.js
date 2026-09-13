const { pool } = require('./db/client');
const { DEFAULT_LANGUAGE, isSupportedLanguage, t } = require('./i18n');
const { sendMail } = require('./mail');
const { roles } = require('./permissions');
const { escapeHtml } = require('./ui');

const INVITATION_COOLDOWN_SECONDS = 60;
const roleLabels = Object.freeze({
  [roles.administrator]: true,
  [roles.manager]: true,
  [roles.attendanceOperator]: true,
});

class AdminInvitationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AdminInvitationError';
    this.code = code;
  }
}

function getApplicationLoginUrl(environment = process.env) {
  const configuredValue = typeof environment.APP_BASE_URL === 'string'
    ? environment.APP_BASE_URL.trim()
    : '';
  if (!configuredValue) throw new AdminInvitationError('APPLICATION_URL_NOT_CONFIGURED');

  let baseUrl;
  try {
    baseUrl = new URL(configuredValue);
  } catch (_error) {
    throw new AdminInvitationError('APPLICATION_URL_INVALID');
  }
  if (
    !['http:', 'https:'].includes(baseUrl.protocol)
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash
    || (baseUrl.pathname !== '/' && baseUrl.pathname !== '')
    || (environment.NODE_ENV === 'production' && baseUrl.protocol !== 'https:')
  ) {
    throw new AdminInvitationError('APPLICATION_URL_INVALID');
  }
  return new URL('/login', baseUrl.origin).toString();
}

function createAdminInvitationEmail(user, loginUrl = getApplicationLoginUrl()) {
  if (!user || user.account_type !== 'otp' || !user.active || !user.email) {
    throw new AdminInvitationError('USER_NOT_ELIGIBLE');
  }
  const language = isSupportedLanguage(user.ui_language) ? user.ui_language : DEFAULT_LANGUAGE;
  const roleLabel = t(language, `role.${user.role}`);
  if (!roleLabel) throw new AdminInvitationError('USER_NOT_ELIGIBLE');

  const name = String(user.name || '').trim();
  const escapedRole = escapeHtml(roleLabel);
  const escapedLoginUrl = escapeHtml(loginUrl);
  return {
    to: user.email,
    subject: t(language, 'auth.email.invitation.subject'),
    text: [
      t(language, 'auth.email.invitation.greeting', { name }),
      '',
      t(language, 'auth.email.invitation.assigned'),
      t(language, 'auth.email.invitation.role', { role: roleLabel }),
      '',
      t(language, 'auth.email.invitation.login', { url: loginUrl }),
      '',
      t(language, 'auth.email.invitation.passwordless'),
    ].join('\n'),
    html: `<!doctype html>
<html lang="${language}">
  <body style="margin:0;padding:0;background:#f8fafc;color:#172033;font-family:Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
      <div style="padding:24px;border:1px solid #dbe2ea;border-radius:8px;background:#ffffff;">
        <p style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.3;">Attendance Log</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(t(language, 'auth.email.invitation.greeting', { name }))}</p>
        <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${escapeHtml(t(language, 'auth.email.invitation.assigned'))}</p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.5;"><strong>${escapeHtml(t(language, 'auth.email.invitation.role_label'))}</strong> ${escapedRole}</p>
        <p style="margin:0 0 20px;"><a href="${escapedLoginUrl}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#087f8c;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">${escapeHtml(t(language, 'auth.email.invitation.signin'))}</a></p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.5;">${escapeHtml(t(language, 'auth.email.invitation.steps_intro'))}</p>
        <ol style="margin:0;padding-left:22px;color:#52606d;font-size:15px;line-height:1.6;">
          <li>${escapeHtml(t(language, 'auth.email.invitation.step_email'))}</li>
          <li>${escapeHtml(t(language, 'auth.email.invitation.step_receive'))}</li>
          <li>${escapeHtml(t(language, 'auth.email.invitation.step_enter'))}</li>
        </ol>
      </div>
    </div>
  </body>
</html>`,
  };
}

async function claimInvitationAttempt(userId) {
  const result = await pool.query(
    `UPDATE admin_users
     SET invitation_last_attempt_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND account_type = 'otp'
       AND active = TRUE
       AND (
         invitation_last_attempt_at IS NULL
         OR invitation_last_attempt_at <= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 second')
       )
     RETURNING id, name, email, role, active, account_type, ui_language`,
    [userId, INVITATION_COOLDOWN_SECONDS],
  );
  if (result.rowCount === 1) return result.rows[0];

  const userResult = await pool.query(
    `SELECT account_type, active,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
              invitation_last_attempt_at + ($2 * INTERVAL '1 second') - CURRENT_TIMESTAMP
            ))))::integer AS retry_after_seconds
     FROM admin_users
     WHERE id = $1`,
    [userId, INVITATION_COOLDOWN_SECONDS],
  );
  const user = userResult.rows[0];
  if (!user) throw new AdminInvitationError('USER_NOT_FOUND');
  if (user.account_type !== 'otp') throw new AdminInvitationError('BREAK_GLASS_NOT_ELIGIBLE');
  if (!user.active) throw new AdminInvitationError('USER_INACTIVE');
  const error = new AdminInvitationError('INVITATION_RATE_LIMITED');
  error.retryAfterSeconds = Math.max(1, user.retry_after_seconds || INVITATION_COOLDOWN_SECONDS);
  throw error;
}

async function sendAdminInvitation(userId, { deliver = sendMail, loginUrl } = {}) {
  const resolvedLoginUrl = loginUrl || getApplicationLoginUrl();
  const user = await claimInvitationAttempt(userId);
  const message = createAdminInvitationEmail(user, resolvedLoginUrl);
  await deliver(message);
  await pool.query(
    `UPDATE admin_users
     SET invitation_sent_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [user.id],
  );
  return user;
}

module.exports = {
  AdminInvitationError,
  INVITATION_COOLDOWN_SECONDS,
  createAdminInvitationEmail,
  getApplicationLoginUrl,
  roleLabels,
  sendAdminInvitation,
};
