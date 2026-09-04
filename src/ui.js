const { hasPermission, permissions } = require('./permissions');
const { getCurrentUser } = require('./request-context');
const { getTerm } = require('./terminology');

const htmlEscapes = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

function businessTerm(concept, form = 'singular') {
  return escapeHtml(getTerm(concept, form));
}

function renderNavigation() {
  const currentUser = getCurrentUser();
  const canManageClasses = hasPermission(currentUser, permissions.manageClasses);
  const canManageStudents = hasPermission(currentUser, permissions.manageStudents);
  const canViewReporting = hasPermission(currentUser, permissions.viewReporting);
  const canManageSettings = hasPermission(currentUser, permissions.manageSettings);

  return `<nav class="navbar navbar-expand-lg app-header" aria-label="Navigation principale">
    <div class="container-xl app-frame">
      <a class="navbar-brand app-brand" href="/" aria-label="Attendance Log — Accueil">
        <svg class="app-brand-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
          <rect class="app-brand-mark-background" x="1" y="1" width="30" height="30" rx="8"/>
          <path class="app-brand-mark-line" d="M8.5 10.5h4M8.5 16h4M8.5 21.5h4"/>
          <path class="app-brand-mark-check" d="m17 19 2.5 2.5 5-7"/>
        </svg>
        <span class="app-brand-wordmark" translate="no"><span>Attendance</span> <strong>Log</strong></span>
      </a>
      <div class="app-header-actions ms-auto order-lg-3">
        ${canManageSettings ? `<a class="btn header-icon-button settings-link" href="/settings/email" data-section="settings" aria-label="Paramètres" title="Paramètres">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </a>` : ''}
        <form class="header-action-form" method="post" action="/logout">
          <button class="btn header-icon-button header-logout" type="submit" aria-label="Se déconnecter" title="Se déconnecter">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M10.5 4H5.75A1.75 1.75 0 0 0 4 5.75v12.5A1.75 1.75 0 0 0 5.75 20h4.75"/>
              <path d="M14.5 8.25 18.25 12l-3.75 3.75M18 12H9"/>
            </svg>
          </button>
        </form>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#primary-navigation" aria-controls="primary-navigation" aria-expanded="false" aria-label="Afficher la navigation">
          <span class="navbar-toggler-icon" aria-hidden="true"></span>
        </button>
      </div>
      <div class="collapse navbar-collapse" id="primary-navigation">
        <div class="navbar-nav admin-nav">
          <a class="nav-link" href="/" data-section="home">Accueil</a>
          ${canManageClasses ? `<a class="nav-link" href="/classes" data-section="classes">${businessTerm('class', 'plural')}</a>` : ''}
          ${canManageStudents ? `<a class="nav-link" href="/students" data-section="students">${businessTerm('student', 'plural')}</a>` : ''}
          <a class="nav-link" href="/sessions" data-section="sessions">${businessTerm('session', 'plural')}</a>
          ${canViewReporting ? '<a class="nav-link" href="/reporting" data-section="reporting">Reporting</a>' : ''}
        </div>
      </div>
    </div>
  </nav>`;
}

function renderSettingsNavigation(activeSection) {
  return `<nav class="nav nav-pills settings-navigation" aria-label="Sections des paramètres">
    <a class="nav-link${activeSection === 'email' ? ' active' : ''}" href="/settings/email"${activeSection === 'email' ? ' aria-current="page"' : ''}>E-mail</a>
    <a class="nav-link${activeSection === 'security' ? ' active' : ''}" href="/settings/security"${activeSection === 'security' ? ' aria-current="page"' : ''}>Sécurité</a>
    <a class="nav-link${activeSection === 'backups' ? ' active' : ''}" href="/settings/backups"${activeSection === 'backups' ? ' aria-current="page"' : ''}>Sauvegardes</a>
    <a class="nav-link${activeSection === 'terminology' ? ' active' : ''}" href="/settings/terminology"${activeSection === 'terminology' ? ' aria-current="page"' : ''}>Terminologie</a>
    <a class="nav-link${activeSection === 'maintenance' ? ' active' : ''}" href="/settings/maintenance"${activeSection === 'maintenance' ? ' aria-current="page"' : ''}>Maintenance</a>
    <a class="nav-link${activeSection === 'users' ? ' active' : ''}" href="/settings/users"${activeSection === 'users' ? ' aria-current="page"' : ''}>Utilisateurs</a>
  </nav>`;
}

function renderSettingsLayout({
  activeSection,
  title,
  description = '',
  status = '',
  notifications = '',
  content = '',
  contentClass = '',
  after = '',
}) {
  return `<div class="settings-layout row g-4">
    <aside class="settings-sidebar col-12 col-lg-3">
      <p class="settings-sidebar-title">Paramètres</p>
      ${renderSettingsNavigation(activeSection)}
    </aside>
    <div class="settings-content col-12 col-lg-9">
      <header class="page-header settings-page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div class="settings-heading">
          <h1>${escapeHtml(title)}</h1>
          ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ''}
        </div>
        ${status ? `<div class="settings-header-meta">${status}</div>` : ''}
      </header>
      <div class="notification-area settings-notifications" aria-live="polite" aria-atomic="true">${notifications}</div>
      <div class="settings-body">
        <div class="settings-sections${contentClass ? ` ${escapeHtml(contentClass)}` : ''}">${content}</div>
      </div>
    </div>
  </div>${after}`;
}

function renderPage(title, content, {
  authenticated = true,
  navigation = authenticated,
  pageClass = '',
} = {}) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f4f7f9">
    <title>${escapeHtml(title)} · Attendance Log</title>
    <link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css">
    <link rel="stylesheet" href="/css/styles.css">
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js" defer></script>
    <script src="/js/otp-resend.js" defer></script>
    <script src="/js/classes.js" defer></script>
    <script src="/js/live-attendance.js" defer></script>
  </head>
  <body class="bg-body-tertiary" data-term-session="${businessTerm('session')}" data-term-attendance="${businessTerm('attendance')}">
    <a class="skip-link visually-hidden-focusable" href="#main-content">Aller au contenu</a>
    ${authenticated && navigation ? renderNavigation() : ''}
    <main class="app-main${navigation ? ' app-frame' : ''}${pageClass ? ` ${escapeHtml(pageClass)}` : ''}" id="main-content" tabindex="-1">
      ${content}
    </main>
  </body>
</html>`;
}

function renderMessagePage(
  title,
  message,
  status = 500,
) {
  return {
    status,
    html: renderPage(title, `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${escapeHtml(title)}</h1>
        </div>
      </header>
      <p class="alert alert-danger" role="alert">${escapeHtml(message)}</p>`),
  };
}

module.exports = {
  businessTerm,
  escapeHtml,
  renderPage,
  renderMessagePage,
  renderSettingsLayout,
  renderSettingsNavigation,
};
