const express = require('express');
const { recordAuditEvent } = require('./audit');
const { pool, withTransaction } = require('./db/client');
const { isSupportedLanguage, t } = require('./i18n');

const router = express.Router();
const MAX_RETURN_TARGET_LENGTH = 2048;

function parseUiLanguage(value) {
  if (value === '' || value === 'automatic') return null;
  return isSupportedLanguage(value) ? value.trim().toLowerCase() : undefined;
}

function normalizeReturnTarget(value) {
  const fallback = '/';
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_RETURN_TARGET_LENGTH
    || !candidate.startsWith('/') || candidate.startsWith('//')
    || candidate.includes('\\') || /[\u0000-\u001f\u007f]/.test(candidate)) {
    return fallback;
  }
  try {
    const parsed = new URL(candidate, 'http://attendance-log.local');
    if (parsed.origin !== 'http://attendance-log.local') return fallback;
    return `${parsed.pathname}${parsed.search}`;
  } catch (_error) {
    return fallback;
  }
}

router.post('/ui-language', async (request, response) => {
  const uiLanguage = parseUiLanguage(request.body?.ui_language);
  const returnTarget = normalizeReturnTarget(request.body?.return_to);
  if (uiLanguage === undefined) {
    return response.status(400).send(t(request.uiLanguage, 'validation.invalid_language'));
  }
  try {
    await withTransaction(pool, async (client) => {
      const current = await client.query(
        'SELECT public_id, name, ui_language FROM admin_users WHERE id = $1 FOR UPDATE',
        [request.currentUser.id],
      );
      if (current.rowCount !== 1) {
        const error = new Error('Authenticated user no longer exists');
        error.code = 'USER_NOT_FOUND';
        throw error;
      }
      if (current.rows[0].ui_language === uiLanguage) return;
      await client.query(
        'UPDATE admin_users SET ui_language = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [uiLanguage, request.currentUser.id],
      );
      await recordAuditEvent({
        client,
        category: 'user',
        action: 'user.ui_language.update',
        targetType: 'admin_user',
        targetPublicId: current.rows[0].public_id,
        targetLabel: current.rows[0].name,
        summary: 'User interface language preference updated.',
        beforeData: { ui_language: current.rows[0].ui_language },
        afterData: { ui_language: uiLanguage },
      });
    });
    return response.redirect(303, returnTarget);
  } catch (error) {
    console.error('Unable to save interface language:', error.code || error.message);
    return response.status(500).send(t(request.uiLanguage, 'settings.interface_language.error'));
  }
});

module.exports = { normalizeReturnTarget, parseUiLanguage, router };
