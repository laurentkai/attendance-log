require('dotenv').config({ quiet: true });

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { pool, verifyDatabaseConnection } = require('./db/client');
const {
  loadAuthenticatedUser,
  requireAuthentication,
  requirePermission,
  router: authRouter,
} = require('./auth');
const adminUserSettingsRouter = require('./admin-user-settings');
const backupSettingsRouter = require('./backup-settings');
const { getStoredBackupSecretStatus, startBackupScheduler } = require('./backup');
const classesRouter = require('./classes');
const courseSessionsRouter = require('./course-sessions');
const { formatDateForDisplay } = require('./date-format');
const mailSettingsRouter = require('./mail-settings');
const maintenanceSettingsRouter = require('./maintenance-settings');
const { isMaintenanceActive, maintenanceMiddleware } = require('./maintenance');
const reportingRouter = require('./reporting');
const { cleanupStaleRestoreWorkspaces } = require('./restore');
const securitySettingsRouter = require('./security-settings');
const {
  getStoredMailSecretStatus,
  migratePlaintextMailPassword,
} = require('./mail');
const { initializeSecrets } = require('./secrets');
const { initializeInstanceIdentity } = require('./instance');
const { hasPermission, permissions } = require('./permissions');
const { requestContextMiddleware } = require('./request-context');
const studentImportRouter = require('./student-import');
const studentsRouter = require('./students');
const terminologySettingsRouter = require('./terminology-settings');
const { loadTerminology } = require('./terminology');
const {
  businessTerm,
  escapeHtml,
  renderMessagePage,
  renderPage,
} = require('./ui');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

for (const variableName of ['SESSION_SECRET']) {
  if (!process.env[variableName]) {
    throw new Error(`${variableName} is required`);
  }
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters');
}

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(express.urlencoded({ extended: false }));
app.get('/service-worker.js', (_request, response) => {
  response.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Service-Worker-Allowed': '/',
  });
  response.sendFile(path.join(__dirname, '..', 'public', 'service-worker.js'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/bootstrap', express.static(path.join(
  __dirname,
  '..',
  'node_modules',
  'bootstrap',
  'dist',
)));

app.get('/health', async (_request, response) => {
  if (isMaintenanceActive()) {
    return response.status(503).json({ status: 'maintenance', database: 'restoring' });
  }
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (_error) {
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.use(maintenanceMiddleware);

const PostgreSqlSessionStore = connectPgSimple(session);
app.use(session({
  name: 'attendance_log_session',
  secret: process.env.SESSION_SECRET,
  resave: false,
  rolling: true,
  saveUninitialized: false,
  store: new PostgreSqlSessionStore({ pool, tableName: 'user_sessions' }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

app.use(requestContextMiddleware);
app.use(loadAuthenticatedUser);
app.use(authRouter);
app.use(requireAuthentication);
app.use(async (request, response, next) => {
  try {
    request.terminology = await loadTerminology();
    next();
  } catch (error) {
    console.error('Unable to load application terminology:', error.code || error.message);
    const page = renderMessagePage('Application indisponible', 'Impossible de charger la configuration pour le moment.', 503);
    response.status(page.status).send(page.html);
  }
});
app.get('/settings', requirePermission(permissions.manageSettings), (_request, response) => response.redirect(303, '/settings/email'));
app.get('/vendor/qr-scanner/qr-scanner.min.js', (_request, response) => {
  response.sendFile(path.join(
    __dirname,
    '..',
    'node_modules',
    'qr-scanner',
    'qr-scanner.min.js',
  ));
});
app.get('/vendor/qr-scanner/qr-scanner-worker.min.js', (_request, response) => {
  response.sendFile(path.join(
    __dirname,
    '..',
    'node_modules',
    'qr-scanner',
    'qr-scanner-worker.min.js',
  ));
});
app.use('/classes', requirePermission(permissions.manageClasses), classesRouter);
app.use('/sessions', requirePermission(permissions.viewSessions), courseSessionsRouter);
app.use('/settings/email', requirePermission(permissions.manageSettings), mailSettingsRouter);
app.use('/settings/security', requirePermission(permissions.manageSettings), securitySettingsRouter);
app.use('/settings/backups', requirePermission(permissions.manageSettings), backupSettingsRouter);
app.use('/settings/maintenance', requirePermission(permissions.manageSettings), maintenanceSettingsRouter);
app.use('/settings/terminology', requirePermission(permissions.manageSettings), terminologySettingsRouter);
app.use('/settings/users', requirePermission(permissions.manageUsers), adminUserSettingsRouter);
app.use('/reporting', requirePermission(permissions.viewReporting), reportingRouter);
app.use('/students/import', requirePermission(permissions.manageStudents), studentImportRouter);
app.use('/students', requirePermission(permissions.manageStudents), studentsRouter);

app.get('/', async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT cs.public_id, cs.date, cs.title, cs.instructor, c.name AS class_name,
              COUNT(roster.student_id)::integer AS total_students,
              COUNT(ar.student_id) FILTER (WHERE ar.status = 'present')::integer AS present_count
       FROM course_sessions cs
       INNER JOIN classes c ON c.id = cs.class_id
       LEFT JOIN LATERAL (
         SELECT s.id AS student_id
         FROM student_classes sc
         INNER JOIN students s ON s.id = sc.student_id AND s.active = TRUE
         WHERE cs.closed_at IS NULL AND sc.class_id = cs.class_id AND sc.active = TRUE
         UNION ALL
         SELECT historical.student_id
         FROM attendance_records historical
         WHERE cs.closed_at IS NOT NULL AND historical.session_id = cs.id
       ) roster ON TRUE
       LEFT JOIN attendance_records ar
         ON ar.session_id = cs.id AND ar.student_id = roster.student_id
       WHERE cs.state = 'open'
       GROUP BY cs.id, c.name
       ORDER BY cs.date, LOWER(cs.title), cs.id`,
    );
    const canManageSessions = hasPermission(request.currentUser, permissions.manageSessions);
    const canManageClasses = hasPermission(request.currentUser, permissions.manageClasses);
    const canManageStudents = hasPermission(request.currentUser, permissions.manageStudents);
    const openSessions = result.rows.length === 0
      ? ''
      : `<div class="list-group compact-list" data-live-session-list>${result.rows.map((sessionRecord) => `
          <article class="list-group-item compact-row compact-row-status session-row" data-live-session-card data-session-id="${sessionRecord.public_id}">
            <div class="compact-identity session-identity">
              <p class="compact-meta session-date">${escapeHtml(formatDateForDisplay(sessionRecord.date))}</p>
              <p class="compact-title">${escapeHtml(sessionRecord.title)}</p>
              <p class="compact-meta">${escapeHtml(sessionRecord.class_name)} · ${escapeHtml(sessionRecord.instructor)}</p>
            </div>
            <div class="compact-status">
              <strong class="compact-count"><span data-present-count>${sessionRecord.present_count}</span> / <span data-total-count>${sessionRecord.total_students}</span> présents</strong>
              <span class="badge status-badge status-open" data-session-state>État : ouvert</span>
            </div>
            <div class="compact-actions compact-actions--split" aria-label="Actions disponibles pour « ${escapeHtml(sessionRecord.title)} »">
              <a class="btn btn-primary" href="/sessions/${sessionRecord.public_id}">${businessTerm('attendance', 'plural')}</a>
              ${canManageSessions ? `<span class="session-edit-slot">
                <a class="btn btn-light" href="/sessions/${sessionRecord.public_id}/edit" data-session-edit>Modifier</a>
                <button class="btn btn-light button-unavailable" type="button" data-session-edit-disabled disabled hidden>Modifier</button>
              </span>` : ''}
            </div>
          </article>`).join('')}</div>`;

    response.send(renderPage('Accueil', `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>Tableau de bord</h1>
          <p class="page-description">Accédez aux tâches courantes et aux ${businessTerm('session', 'plural').toLocaleLowerCase('fr')} actuellement ouvertes.</p>
        </div>
      </header>
      <nav class="dashboard-actions" aria-label="Accès rapides">
        <div class="row g-2 row-cols-1 row-cols-md-2">
          ${canManageClasses ? `<div class="col"><a class="card card-body dashboard-link h-100" href="/classes"><strong>${businessTerm('class', 'plural')}</strong><span>Gérer les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')}</span></a></div>` : ''}
          ${canManageStudents ? `<div class="col"><a class="card card-body dashboard-link h-100" href="/students"><strong>${businessTerm('student', 'plural')}</strong><span>Consulter le répertoire actif</span></a></div>` : ''}
          <div class="col"><a class="card card-body dashboard-link h-100" href="/sessions"><strong>${businessTerm('session', 'plural')}</strong><span>${canManageSessions ? `Planifier et enregistrer les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}` : `Enregistrer les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}`}</span></a></div>
          ${canManageStudents ? `<div class="col"><a class="card card-body dashboard-link h-100" href="/students/import"><strong>Importer</strong><span>${businessTerm('student', 'plural')} depuis un fichier CSV</span></a></div>` : ''}
        </div>
      </nav>
      <section class="page-section" aria-labelledby="open-sessions-title" data-live-dashboard>
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="open-sessions-title">${businessTerm('session', 'plural')} ouvertes</h2>
            <p class="section-description">Suivi des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')} en cours.</p>
          </div>
          <a class="btn btn-light" href="/sessions">Consulter les ${businessTerm('session', 'plural').toLocaleLowerCase('fr')}</a>
        </div>
        ${openSessions}
        <p class="empty-state" data-live-empty-state${result.rows.length > 0 ? ' hidden' : ''}>Aucun élément ouvert pour le moment. Consultez la rubrique ${businessTerm('session', 'plural')}.</p>
      </section>`));
  } catch (error) {
    console.error('Unable to load dashboard:', error);
    const page = renderMessagePage('Accueil indisponible', 'Impossible de charger le tableau de bord pour le moment.');
    response.status(page.status).send(page.html);
  }
});

async function start() {
  try {
    await verifyDatabaseConnection();
    await cleanupStaleRestoreWorkspaces();
    await initializeInstanceIdentity();
    const keyInfo = await initializeSecrets();
    if (process.env.NODE_ENV === 'production' && keyInfo.source === 'persistent-file') {
      console.warn('Application encryption key is stored in persistent application storage. Losing that storage makes encrypted provider secrets unrecoverable; export and securely store the recovery key.');
    }
    try {
      await migratePlaintextMailPassword();
    } catch (error) {
      console.error('Unable to protect the stored SMTP credential:', error.code || 'MIGRATION_FAILED');
    }
    try {
      const secretStatuses = await Promise.all([
        getStoredMailSecretStatus(),
        getStoredBackupSecretStatus(),
      ]);
      if (secretStatuses.includes('mismatch')) {
        console.warn('WARNING: The active application encryption key does not match stored encrypted data. Provider secrets are unavailable until the matching recovery key is restored.');
      }
    } catch (error) {
      console.warn('Unable to verify stored encrypted data at startup:', error.code || 'PREFLIGHT_FAILED');
    }
    app.listen(port, '0.0.0.0', () => {
      console.log(`Attendance Log listening on port ${port}`);
      startBackupScheduler();
    });
  } catch (error) {
    console.error('Unable to start Attendance Log:', error.code || error.message);
    await pool.end();
    process.exit(1);
  }
}

start();
