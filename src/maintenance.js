const { languageFromAcceptLanguage, t } = require('./i18n');

let active = false;

function enterMaintenance() {
  if (active) return false;
  active = true;
  return true;
}

function exitMaintenance() {
  active = false;
}

function isMaintenanceActive() {
  return active;
}

function maintenanceMiddleware(request, response, next) {
  if (!active) return next();
  if (request.accepts(['html', 'json']) === 'json') {
    return response.status(503).json({ error: 'maintenance' });
  }
  const language = languageFromAcceptLanguage(request.get('accept-language') || '');
  response.set('Retry-After', '10');
  return response.status(503).send(`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t(language, 'maintenance.public.title')} · Attendance Log</title><body><main><h1>${t(language, 'maintenance.public.title')}</h1><p>${t(language, 'maintenance.public.message')}</p></main></body></html>`);
}

module.exports = {
  enterMaintenance,
  exitMaintenance,
  isMaintenanceActive,
  maintenanceMiddleware,
};
