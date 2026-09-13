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
const auditSettingsRouter = require('./audit-settings');
const { getApplicationTimezone, configureApplicationRegionalSettings } = require('./application-time');
const backupSettingsRouter = require('./backup-settings');
const brandingSettingsRouter = require('./branding-settings');
const { getStoredBackupSecretStatus, startBackupScheduler } = require('./backup');
const classesRouter = require('./classes');
const courseSessionsRouter = require('./course-sessions');
const { formatDateForDisplay } = require('./date-format');
const mailSettingsRouter = require('./mail-settings');
const maintenanceSettingsRouter = require('./maintenance-settings');
const { loadInternationalSettings, initializeInternationalSettings } = require('./international-settings');
const { router: internationalSettingsRouter } = require('./international-settings-router');
const { isSupportedLanguage, languageFromAcceptLanguage, resolveUiLanguage, t, TRANSLATIONS } = require('./i18n');
const { router: languagePreferencesRouter } = require('./language-preferences');
const { isMaintenanceActive, maintenanceMiddleware } = require('./maintenance');
const reportingRouter = require('./reporting');
const { getReportingPseudonymSecretStatus } = require('./reporting-privacy');
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
const studentQrPrintRouter = require('./student-qr-print');
const printDesignSettingsRouter = require('./print-design-settings');
const { router: privacyNoticeRouter } = require('./privacy-notice');
const privacySettingsRouter = require('./privacy-settings');
const studentsRouter = require('./students');
const terminologySettingsRouter = require('./terminology-settings');
const { getTerm, loadTerminology } = require('./terminology');
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
app.get('/i18n/:language.json', (request, response) => {
  if (!isSupportedLanguage(request.params.language)) return response.status(404).end();
  const language = request.params.language.toLowerCase();
  response.set({ 'Cache-Control': 'public, max-age=3600', Vary: 'Accept-Language' });
  response.json(TRANSLATIONS[language]);
});
app.get('/manifest.webmanifest', (request, response) => {
  const requestedLanguage = typeof request.query.language === 'string' && isSupportedLanguage(request.query.language)
    ? request.query.language.toLowerCase()
    : languageFromAcceptLanguage(request.get('accept-language') || '');
  response.set({ 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'application/manifest+json', Vary: 'Accept-Language' });
  response.json({
    id: '/', name: 'Attendance Log', short_name: 'Attendance',
    description: t(requestedLanguage, 'pwa.description'), lang: requestedLanguage, dir: 'ltr',
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f4f7f9', theme_color: '#f4f7f9',
    icons: [
      { src: '/icons/attendance-log-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/attendance-log-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/attendance-log-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});
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
app.use(privacyNoticeRouter);

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
    const [terminology, internationalization] = await Promise.all([
      loadTerminology(),
      loadInternationalSettings(),
    ]);
    request.terminology = terminology;
    request.internationalization = internationalization;
    request.uiLanguage = resolveUiLanguage(
      request.currentUser.ui_language,
      request.get('accept-language') || '',
    );
    configureApplicationRegionalSettings(internationalization);
    next();
  } catch (error) {
    console.error('Unable to load application settings:', error.code || error.message);
    const language = request.uiLanguage || resolveUiLanguage(request.currentUser?.ui_language, request.get('accept-language') || '');
    const page = renderMessagePage(t(language, 'application.settings_unavailable.title'), t(language, 'application.settings_unavailable.message'), 503, language);
    response.status(page.status).send(page.html);
  }
});
app.use('/preferences', languagePreferencesRouter);
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
app.use('/settings/branding', requirePermission(permissions.manageSettings), brandingSettingsRouter);
app.use('/settings/print-design', requirePermission(permissions.manageSettings), printDesignSettingsRouter);
app.use('/settings/privacy', requirePermission(permissions.manageSettings), privacySettingsRouter);
app.use('/settings/maintenance', requirePermission(permissions.manageSettings), maintenanceSettingsRouter);
app.use('/settings/terminology', requirePermission(permissions.manageSettings), terminologySettingsRouter);
app.use('/settings/internationalization', requirePermission(permissions.manageSettings), internationalSettingsRouter);
app.use('/settings/users', requirePermission(permissions.manageUsers), adminUserSettingsRouter);
app.use('/settings/audit', requirePermission(permissions.viewAuditLog), auditSettingsRouter);
app.use('/reporting', requirePermission(permissions.viewReporting), reportingRouter);
app.use('/students/import', requirePermission(permissions.manageStudents), studentImportRouter);
app.use('/students/qr-print', requirePermission(permissions.manageStudents), studentQrPrintRouter);
app.use('/students', requirePermission(permissions.manageStudents), studentsRouter);

app.get('/', async (request, response) => {
  try {
    const language = request.uiLanguage;
    const terms = {
      students: getTerm(language, 'student', 'plural'),
      sessions: getTerm(language, 'session', 'plural'),
      attendance: getTerm(language, 'attendance', 'plural'),
    };
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
              <strong class="compact-count">${escapeHtml(t(language, 'dashboard.present_count', { present: sessionRecord.present_count, total: sessionRecord.total_students }))}</strong>
              <span class="badge status-badge status-open" data-session-state>${escapeHtml(t(language, 'dashboard.state_open'))}</span>
            </div>
            <div class="compact-actions compact-actions--split" aria-label="${escapeHtml(t(language, 'action.actions_for', { name: sessionRecord.title }))}">
              <a class="btn btn-primary" href="/sessions/${sessionRecord.public_id}">${businessTerm(language, 'attendance', 'plural')}</a>
              ${canManageSessions ? `<span class="session-edit-slot">
                <a class="btn btn-light" href="/sessions/${sessionRecord.public_id}/edit" data-session-edit>${escapeHtml(t(language, 'action.edit'))}</a>
                <button class="btn btn-light button-unavailable" type="button" data-session-edit-disabled disabled hidden>${escapeHtml(t(language, 'action.edit'))}</button>
              </span>` : ''}
            </div>
          </article>`).join('')}</div>`;

    response.send(renderPage(t(language, 'shell.home'), `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${escapeHtml(t(language, 'dashboard.title'))}</h1>
          <p class="page-description">${escapeHtml(t(language, 'dashboard.description', { sessions: terms.sessions }))}</p>
        </div>
      </header>
      <nav class="dashboard-actions" aria-label="${escapeHtml(t(language, 'dashboard.quick_access'))}">
        <div class="row g-2 row-cols-1 row-cols-md-2">
          ${canManageClasses ? `<div class="col"><a class="card card-body dashboard-link h-100" href="/classes"><strong>${businessTerm(language, 'class', 'plural')}</strong><span>${escapeHtml(t(language, 'dashboard.manage_students', { students: terms.students }))}</span></a></div>` : ''}
          ${canManageStudents ? `<div class="col"><a class="card card-body dashboard-link h-100" href="/students"><strong>${businessTerm(language, 'student', 'plural')}</strong><span>${escapeHtml(t(language, 'dashboard.student_directory'))}</span></a></div>` : ''}
          <div class="col"><a class="card card-body dashboard-link h-100" href="/sessions"><strong>${businessTerm(language, 'session', 'plural')}</strong><span>${escapeHtml(t(language, canManageSessions ? 'dashboard.plan_attendance' : 'dashboard.record_attendance', { attendance: terms.attendance }))}</span></a></div>
          ${canManageStudents ? `<div class="col"><a class="card card-body dashboard-link h-100" href="/students/import"><strong>${escapeHtml(t(language, 'action.import'))}</strong><span>${escapeHtml(t(language, 'dashboard.import_students', { students: terms.students }))}</span></a></div>` : ''}
        </div>
      </nav>
      <section class="page-section" aria-labelledby="open-sessions-title" data-live-dashboard>
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="open-sessions-title">${escapeHtml(t(language, 'dashboard.open_sessions', { sessions: terms.sessions }))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'dashboard.current_attendance', { attendance: terms.attendance }))}</p>
          </div>
          <a class="btn btn-light" href="/sessions">${escapeHtml(t(language, 'dashboard.view_sessions', { sessions: terms.sessions }))}</a>
        </div>
        ${openSessions}
        <p class="empty-state" data-live-empty-state${result.rows.length > 0 ? ' hidden' : ''}>${escapeHtml(t(language, 'dashboard.no_open_sessions', { sessions: terms.sessions }))}</p>
      </section>`, { language }));
  } catch (error) {
    console.error('Unable to load dashboard:', error);
    const language = request.uiLanguage;
    const page = renderMessagePage(t(language, 'dashboard.unavailable.title'), t(language, 'dashboard.unavailable.message'), 500, language);
    response.status(page.status).send(page.html);
  }
});

app.use((request, response) => {
  const language = request.uiLanguage || resolveUiLanguage(
    request.currentUser?.ui_language,
    request.get('accept-language') || '',
  );
  if (request.accepts(['html', 'json']) === 'json') {
    return response.status(404).json({ error: 'NOT_FOUND' });
  }
  const page = renderMessagePage(
    t(language, 'error.not_found.title'),
    t(language, 'error.not_found.message'),
    404,
    language,
  );
  return response.status(page.status).send(page.html);
});

app.use((error, request, response, _next) => {
  console.error('Unhandled request error:', error?.code || error?.message || 'INTERNAL_ERROR');
  const language = request.uiLanguage || resolveUiLanguage(
    request.currentUser?.ui_language,
    request.get('accept-language') || '',
  );
  if (request.accepts(['html', 'json']) === 'json') {
    return response.status(500).json({ error: 'INTERNAL_ERROR' });
  }
  const page = renderMessagePage(
    t(language, 'error.internal.title'),
    t(language, 'error.internal.message'),
    500,
    language,
  );
  return response.status(page.status).send(page.html);
});

async function start() {
  try {
    await verifyDatabaseConnection();
    await initializeInternationalSettings();
    getApplicationTimezone();
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
        getReportingPseudonymSecretStatus(),
      ]);
      if (secretStatuses.includes('mismatch')) {
        console.warn('WARNING: The active application encryption key does not match stored encrypted data. Encrypted integrations or Reporting pseudonyms may be unavailable until the matching recovery key is restored.');
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

if (require.main === module) start();

module.exports = { app, start };
