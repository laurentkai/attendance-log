const { hasPermission, permissions } = require('./permissions');
const { getCurrentRequest, getCurrentUser } = require('./request-context');
const {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  normalizeLanguage,
  t,
} = require('./i18n');
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

function businessTerm(language, concept, form = 'singular') {
  return escapeHtml(getTerm(language, concept, form));
}

function renderLanguageOptions(selectedLanguage, { language, emptyLabel = '', currentLabel = '' } = {}) {
  if (!isSupportedLanguage(language)) {
    const error = new Error('Language options require an explicit supported rendering language.');
    error.code = 'I18N_RENDER_LANGUAGE_REQUIRED';
    throw error;
  }
  const isEmptySelected = !selectedLanguage;
  const withCurrentLabel = (label, selected) => (
    selected && currentLabel ? `${label} — ${currentLabel}` : label
  );
  const empty = emptyLabel
    ? `<option value=""${isEmptySelected ? ' selected' : ''}>${escapeHtml(withCurrentLabel(emptyLabel, isEmptySelected))}</option>`
    : '';
  return `${empty}${SUPPORTED_LANGUAGES.map((value) => (
    `<option value="${value}"${selectedLanguage === value ? ' selected' : ''}>${escapeHtml(withCurrentLabel(t(language, `language.${value}`), selectedLanguage === value))}</option>`
  )).join('')}`;
}

function renderLanguageSelector(request = getCurrentRequest()) {
  const uiLanguage = request?.uiLanguage || DEFAULT_LANGUAGE;
  const savedPreference = request?.currentUser?.ui_language || '';
  const returnTarget = request?.originalUrl || '/';
  const options = [
    ['', t(uiLanguage, 'language.automatic')],
    ['en', t(uiLanguage, 'language.en')],
    ['fr', t(uiLanguage, 'language.fr')],
  ];
  return `<div class="dropdown">
    <button class="btn header-icon-button" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="${escapeHtml(t(uiLanguage, 'settings.interface_language'))}" title="${escapeHtml(t(uiLanguage, 'settings.interface_language'))}">
      <span class="small fw-semibold" translate="no">${uiLanguage.toUpperCase()}</span>
    </button>
    <ul class="dropdown-menu dropdown-menu-end">
      ${options.map(([value, label]) => {
    const current = savedPreference === value;
    return `<li><form method="post" action="/preferences/ui-language"><input name="ui_language" type="hidden" value="${value}"><input name="return_to" type="hidden" value="${escapeHtml(returnTarget)}"><button class="dropdown-item d-flex align-items-center justify-content-between gap-3" type="submit">${escapeHtml(label)}${current ? `<span aria-hidden="true">✓</span><span class="visually-hidden"> — ${escapeHtml(t(uiLanguage, 'language.current'))}</span>` : ''}</button></form></li>`;
  }).join('')}
    </ul>
  </div>`;
}

function renderNavigation() {
  const currentUser = getCurrentUser();
  const request = getCurrentRequest();
  const uiLanguage = request?.uiLanguage || DEFAULT_LANGUAGE;
  const canManageClasses = hasPermission(currentUser, permissions.manageClasses);
  const canManageStudents = hasPermission(currentUser, permissions.manageStudents);
  const canViewReporting = hasPermission(currentUser, permissions.viewReporting);
  const canManageSettings = hasPermission(currentUser, permissions.manageSettings);

  return `<nav class="navbar navbar-expand-lg sticky-top app-header" aria-label="${escapeHtml(t(uiLanguage, 'shell.primary_navigation'))}">
    <div class="container-xl app-frame">
      <a class="navbar-brand app-brand" href="/" aria-label="${escapeHtml(t(uiLanguage, 'shell.home_aria'))}">
        <svg class="app-brand-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
          <rect class="app-brand-mark-background" x="1" y="1" width="30" height="30" rx="8"/>
          <path class="app-brand-mark-line" d="M8.5 10.5h4M8.5 16h4M8.5 21.5h4"/>
          <path class="app-brand-mark-check" d="m17 19 2.5 2.5 5-7"/>
        </svg>
        <span class="app-brand-wordmark" translate="no"><span>Attendance</span> <strong>Log</strong></span>
      </a>
      <div class="app-header-actions ms-auto order-lg-3">
        ${renderLanguageSelector(request)}
        ${canManageSettings ? `<a class="btn header-icon-button settings-link" href="/settings/email" data-section="settings" aria-label="${escapeHtml(t(uiLanguage, 'shell.settings'))}" title="${escapeHtml(t(uiLanguage, 'shell.settings'))}">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </a>` : ''}
        <form class="header-action-form" method="post" action="/logout">
          <button class="btn header-icon-button header-logout" type="submit" aria-label="${escapeHtml(t(uiLanguage, 'shell.logout'))}" title="${escapeHtml(t(uiLanguage, 'shell.logout'))}">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M10.5 4H5.75A1.75 1.75 0 0 0 4 5.75v12.5A1.75 1.75 0 0 0 5.75 20h4.75"/>
              <path d="M14.5 8.25 18.25 12l-3.75 3.75M18 12H9"/>
            </svg>
          </button>
        </form>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#primary-navigation" aria-controls="primary-navigation" aria-expanded="false" aria-label="${escapeHtml(t(uiLanguage, 'shell.show_navigation'))}">
          <span class="navbar-toggler-icon" aria-hidden="true"></span>
        </button>
      </div>
      <div class="collapse navbar-collapse" id="primary-navigation">
        <div class="navbar-nav admin-nav">
          <a class="nav-link" href="/" data-section="home">${escapeHtml(t(uiLanguage, 'shell.home'))}</a>
          ${canManageClasses ? `<a class="nav-link" href="/classes" data-section="classes">${businessTerm(uiLanguage, 'class', 'plural')}</a>` : ''}
          ${canManageStudents ? `<a class="nav-link" href="/students" data-section="students">${businessTerm(uiLanguage, 'student', 'plural')}</a>` : ''}
          <a class="nav-link" href="/sessions" data-section="sessions">${businessTerm(uiLanguage, 'session', 'plural')}</a>
          ${canViewReporting ? `<a class="nav-link" href="/reporting" data-section="reporting">${escapeHtml(t(uiLanguage, 'shell.reporting'))}</a>` : ''}
        </div>
      </div>
    </div>
  </nav>`;
}

function renderFooter() {
  const language = getCurrentRequest()?.uiLanguage || DEFAULT_LANGUAGE;
  return `<footer class="app-footer">
    <div class="app-frame gap-2">
      <a class="app-footer-brand" href="/privacy">${escapeHtml(t(language, 'shell.data_protection'))}</a>
      <span class="text-body-tertiary small" aria-hidden="true">·</span>
      <a class="app-footer-brand" href="https://labs.elinaka.lu">
        <img src="https://labs.elinaka.lu/elinaka-labs-icon.png" width="16" height="16" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span>${escapeHtml(t(language, 'shell.powered_by', { name: 'Elinaka Labs' }))}</span>
      </a>
    </div>
  </footer>`;
}

function renderSettingsNavigation(activeSection) {
  const uiLanguage = getCurrentRequest()?.uiLanguage || DEFAULT_LANGUAGE;
  return `<nav class="nav nav-pills settings-navigation" aria-label="${escapeHtml(t(uiLanguage, 'settings.navigation'))}">
    <a class="nav-link${activeSection === 'email' ? ' active' : ''}" href="/settings/email"${activeSection === 'email' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.email'))}</a>
    <a class="nav-link${activeSection === 'security' ? ' active' : ''}" href="/settings/security"${activeSection === 'security' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.security'))}</a>
    <a class="nav-link${activeSection === 'backups' ? ' active' : ''}" href="/settings/backups"${activeSection === 'backups' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.backups'))}</a>
    <a class="nav-link${activeSection === 'branding' ? ' active' : ''}" href="/settings/branding"${activeSection === 'branding' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.branding'))}</a>
    <a class="nav-link${activeSection === 'print-design' ? ' active' : ''}" href="/settings/print-design"${activeSection === 'print-design' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.print_design'))}</a>
    <a class="nav-link${activeSection === 'terminology' ? ' active' : ''}" href="/settings/terminology"${activeSection === 'terminology' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.terminology'))}</a>
    <a class="nav-link${activeSection === 'internationalization' ? ' active' : ''}" href="/settings/internationalization"${activeSection === 'internationalization' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.international.title'))}</a>
    <a class="nav-link${activeSection === 'privacy' ? ' active' : ''}" href="/settings/privacy"${activeSection === 'privacy' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.privacy'))}</a>
    <a class="nav-link${activeSection === 'maintenance' ? ' active' : ''}" href="/settings/maintenance"${activeSection === 'maintenance' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.maintenance'))}</a>
    <a class="nav-link${activeSection === 'users' ? ' active' : ''}" href="/settings/users"${activeSection === 'users' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.users'))}</a>
    <a class="nav-link${activeSection === 'audit' ? ' active' : ''}" href="/settings/audit"${activeSection === 'audit' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'settings.audit'))}</a>
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
      <p class="settings-sidebar-title">${escapeHtml(t(getCurrentRequest()?.uiLanguage || DEFAULT_LANGUAGE, 'settings.sidebar_title'))}</p>
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
  language,
} = {}) {
  const documentLanguage = normalizeLanguage(language || getCurrentRequest()?.uiLanguage) || DEFAULT_LANGUAGE;
  return `<!doctype html>
<html lang="${documentLanguage}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f4f7f9">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Attendance">
    <title>${escapeHtml(title)} · Attendance Log</title>
    <link rel="manifest" href="/manifest.webmanifest?language=${documentLanguage}">
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/attendance-log-192.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">
    <link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css">
    <link rel="stylesheet" href="/css/styles.css">
    <link rel="preload" href="/i18n/${documentLanguage}.json" as="fetch" crossorigin="anonymous">
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js" defer></script>
    <script src="/js/i18n.js" defer></script>
    <script src="/js/otp-resend.js" defer></script>
    <script src="/js/classes.js" defer></script>
    <script src="/js/live-attendance.js" defer></script>
    <script src="/js/student-qr-print.js" defer></script>
    <script src="/js/print-design-alignment.js" defer></script>
    <script src="/js/print-design-editor.js" defer></script>
    <script src="/js/pwa.js" defer></script>
  </head>
  <body class="bg-body-tertiary${authenticated && navigation ? ' app-shell' : ''}" data-term-class="${businessTerm(documentLanguage, 'class')}" data-term-session="${businessTerm(documentLanguage, 'session')}" data-term-attendance="${businessTerm(documentLanguage, 'attendance')}">
    <a class="skip-link visually-hidden-focusable" href="#main-content">${escapeHtml(t(documentLanguage, 'shell.skip_to_content'))}</a>
    ${authenticated && navigation ? renderNavigation() : ''}
    <main class="app-main${navigation ? ' app-frame' : ''}${pageClass ? ` ${escapeHtml(pageClass)}` : ''}" id="main-content" tabindex="-1">
      ${content}
    </main>
    ${authenticated && navigation ? renderFooter() : ''}
  </body>
</html>`;
}

function renderMessagePage(
  title,
  message,
  status = 500,
  language,
) {
  return {
    status,
    html: renderPage(title, `
      <header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
        <div>
          <h1>${escapeHtml(title)}</h1>
        </div>
      </header>
      <p class="alert alert-danger" role="alert">${escapeHtml(message)}</p>`, { language }),
  };
}

module.exports = {
  businessTerm,
  escapeHtml,
  renderPage,
  renderLanguageOptions,
  renderLanguageSelector,
  renderMessagePage,
  renderSettingsLayout,
  renderSettingsNavigation,
};
