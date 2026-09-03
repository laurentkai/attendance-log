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
  response.set('Retry-After', '10');
  return response.status(503).send(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance · Attendance Log</title><body><main><h1>Restauration en cours</h1><p>Attendance Log sera de nouveau disponible dans quelques instants.</p></main></body></html>`);
}

module.exports = {
  enterMaintenance,
  exitMaintenance,
  isMaintenanceActive,
  maintenanceMiddleware,
};
