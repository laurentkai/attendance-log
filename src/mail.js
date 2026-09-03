const nodemailer = require('nodemailer');
const { pool } = require('./db/client');
const {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} = require('./secrets');

const connectionTimeout = 10000;
const socketTimeout = 15000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class MailError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MailError';
    this.code = code;
  }
}

function normalizeConfiguration(row) {
  if (!row) return null;
  return {
    host: row.smtp_host,
    port: row.smtp_port,
    securityMode: row.security_mode,
    username: row.smtp_username || '',
    password: row.smtp_password || '',
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    replyTo: row.reply_to || '',
  };
}

async function loadStoredMailConfiguration() {
  const result = await pool.query(
    `SELECT smtp_host, smtp_port, security_mode, smtp_username, smtp_password,
            sender_email, sender_name, reply_to
     FROM mail_configuration
     WHERE id = 1`,
  );
  return normalizeConfiguration(result.rows[0]);
}

async function migratePlaintextMailPassword() {
  const configuration = await loadStoredMailConfiguration();
  if (!configuration?.password || isEncryptedSecret(configuration.password)) {
    return configuration;
  }

  const encryptedPassword = encryptSecret(configuration.password);
  const result = await pool.query(
    `UPDATE mail_configuration
     SET smtp_password = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1 AND smtp_password = $2`,
    [encryptedPassword, configuration.password],
  );
  if (result.rowCount === 1) {
    return { ...configuration, password: encryptedPassword };
  }
  const currentConfiguration = await loadStoredMailConfiguration();
  if (currentConfiguration?.password && !isEncryptedSecret(currentConfiguration.password)) {
    throw new MailError('SECRET_STORAGE_FAILED');
  }
  return currentConfiguration;
}

async function loadMailConfiguration() {
  const configuration = await migratePlaintextMailPassword();
  if (!configuration?.password) return configuration;
  return {
    ...configuration,
    password: decryptSecret(configuration.password),
  };
}

async function getStoredMailSecretStatus() {
  const configuration = await loadStoredMailConfiguration();
  if (!configuration?.password || !isEncryptedSecret(configuration.password)) {
    return 'available';
  }
  try {
    decryptSecret(configuration.password);
    return 'available';
  } catch (error) {
    if (['SECRET_KEY_MISMATCH', 'INVALID_ENVELOPE'].includes(error?.code)) {
      return 'mismatch';
    }
    throw error;
  }
}

function isCompleteMailConfiguration(configuration) {
  if (!configuration) return false;
  const authIsComplete = Boolean(configuration.username) === Boolean(configuration.password);
  return Boolean(
    configuration.host
    && Number.isInteger(configuration.port)
    && configuration.port >= 1
    && configuration.port <= 65535
    && ['starttls', 'tls', 'none'].includes(configuration.securityMode)
    && emailPattern.test(configuration.senderEmail)
    && configuration.senderName
    && (!configuration.replyTo || emailPattern.test(configuration.replyTo))
    && authIsComplete
  );
}

function createTransportOptions(configuration) {
  const options = {
    host: configuration.host,
    port: configuration.port,
    secure: configuration.securityMode === 'tls',
    requireTLS: configuration.securityMode === 'starttls',
    ignoreTLS: configuration.securityMode === 'none',
    connectionTimeout,
    greetingTimeout: connectionTimeout,
    socketTimeout,
  };

  if (configuration.username && configuration.password) {
    options.auth = {
      user: configuration.username,
      pass: configuration.password,
    };
  }

  return options;
}

function normalizeMailError(error) {
  if (error instanceof MailError) return error;
  if (['SECRET_KEY_MISMATCH', 'INVALID_ENVELOPE'].includes(error?.code)) {
    return new MailError('SECRET_KEY_MISMATCH');
  }
  if (error?.code === 'SECRET_STORAGE_FAILED') return new MailError('SECRET_STORAGE_FAILED');
  if (error?.code === 'EAUTH' || error?.responseCode === 535) {
    return new MailError('AUTHENTICATION_FAILED');
  }
  if (error?.command === 'MAIL FROM') {
    return new MailError('SENDER_REJECTED');
  }
  if (error?.command === 'RCPT TO' || error?.code === 'EENVELOPE') {
    return new MailError('RECIPIENT_REJECTED');
  }
  if (
    error?.code === 'ETLS'
    || /TLS|SSL|certificate|self[- ]signed/i.test(error?.message || '')
  ) {
    return new MailError('TLS_FAILED');
  }
  if (['ECONNECTION', 'ECONNREFUSED', 'ESOCKET', 'ETIMEDOUT'].includes(error?.code)) {
    return new MailError('CONNECTION_FAILED');
  }
  return new MailError('DELIVERY_FAILED');
}

async function sendMail({ to, subject, text, html, attachments }) {
  let configuration;
  try {
    configuration = await loadMailConfiguration();
  } catch (error) {
    throw normalizeMailError(error);
  }
  if (!isCompleteMailConfiguration(configuration)) {
    throw new MailError('NOT_CONFIGURED');
  }

  const transporter = nodemailer.createTransport(createTransportOptions(configuration));
  try {
    const result = await transporter.sendMail({
      from: {
        address: configuration.senderEmail,
        name: configuration.senderName,
      },
      to,
      replyTo: configuration.replyTo || undefined,
      subject,
      text,
      html,
      attachments: Array.isArray(attachments) && attachments.length > 0
        ? attachments
        : undefined,
    });
    if (!Array.isArray(result.accepted) || result.accepted.length === 0) {
      throw new MailError('RECIPIENT_REJECTED');
    }
    return result;
  } catch (error) {
    throw normalizeMailError(error);
  } finally {
    transporter.close();
  }
}

module.exports = {
  MailError,
  createTransportOptions,
  getStoredMailSecretStatus,
  isCompleteMailConfiguration,
  loadMailConfiguration,
  loadStoredMailConfiguration,
  migratePlaintextMailPassword,
  normalizeMailError,
  sendMail,
};
