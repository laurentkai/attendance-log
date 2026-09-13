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
const { getApplicationLocale } = require('./application-time');
const { formatDateForDisplay, formatDateForInput } = require('./date-format');

const settingsGroups = [
  ['workspace', [['internationalization', 'international.title'], ['terminology', 'terminology'], ['branding', 'branding'], ['print-design', 'print_design']]],
  ['access', [['users', 'users'], ['security', 'security'], ['privacy', 'privacy'], ['audit', 'audit']]],
  ['operations', [['email', 'email'], ['backups', 'backups'], ['maintenance', 'maintenance']]],
];

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

function renderIcon(name) {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    sessions: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h3"/>',
    classes: '<path d="m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
    students: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
    reporting: '<path d="M4 3v18h17M9 16v-4m5 4V7m5 9V4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.more}</svg>`;
}

// Session dates are calendar values, not instants. UTC prevents day shifting.
function renderDateMarker(value) {
  const iso = formatDateForInput(value);
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  const part = (options) => escapeHtml(new Intl.DateTimeFormat(getApplicationLocale(), { ...options, timeZone: 'UTC' }).format(date));
  return `<time class="date-marker" datetime="${iso}"><span class="visually-hidden">${escapeHtml(formatDateForDisplay(value))}</span><span class="date-marker-day" aria-hidden="true">${part({ day: '2-digit' })}</span><span class="date-marker-month" aria-hidden="true">${part({ month: 'short' })}</span></time>`;
}

function renderAttendanceProgress(present, total, language) {
  const maximum = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0;
  const value = Math.min(maximum, Number.isFinite(Number(present)) ? Math.max(0, Number(present)) : 0);
  return `<progress class="attendance-progress" data-attendance-progress value="${value}" max="${maximum || 1}" aria-label="${escapeHtml(t(language, 'dashboard.present_count', { present: value, total: maximum }))}"></progress>`;
}

function renderMetricStrip(items, label, modifier = '') {
  return `<dl class="report-summary${modifier ? ` ${escapeHtml(modifier)}` : ''}" aria-label="${escapeHtml(label)}">${items.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
}

// Trusted renderer fragments only; labels and paths are escaped at their call sites.
function renderActionMenu(label, content) {
  return `<div class="dropdown row-menu">
    <button class="btn btn-light row-menu-toggle" type="button" data-bs-toggle="dropdown" data-bs-boundary="viewport" aria-expanded="false" aria-label="${escapeHtml(label)}">${renderIcon('more')}</button>
    <div class="dropdown-menu dropdown-menu-end">${content}</div>
  </div>`;
}

function renderCollectionTools({ language, id, placeholder = '', count = 0 }) {
  return `<div class="collection-toolbar">
    <div class="search search-with-icon mb-0">${renderIcon('search')}<label class="visually-hidden" for="${id}-search">${escapeHtml(t(language, 'action.search'))}</label>
      <input class="form-control" id="${id}-search" name="filter" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(placeholder || t(language, 'workspace.search'))}" data-list-search aria-controls="${id}"></div>
    <label class="collection-sort"><span class="visually-hidden">${escapeHtml(t(language, 'workspace.sort'))}</span><select class="form-select" data-list-sort><option value="original">${escapeHtml(t(language, 'workspace.default_order'))}</option><option value="name">${escapeHtml(t(language, 'workspace.name_order'))}</option></select></label>
    <span class="collection-count" role="status" data-list-count>${escapeHtml(t(language, 'workspace.result_count', { count }))}</span>
  </div>`;
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
  const path = request?.originalUrl?.split('?')[0] || request?.path || '/';
  const activeSection = path === '/' ? 'home' : path.split('/')[1];
  const destinations = [
    ['home', '/', t(uiLanguage, 'shell.home'), true],
    ['sessions', '/sessions', getTerm(uiLanguage, 'session', 'plural'), true],
    ['students', '/students', getTerm(uiLanguage, 'student', 'plural'), canManageStudents],
    ['classes', '/classes', getTerm(uiLanguage, 'class', 'plural'), canManageClasses],
    ['reporting', '/reporting', t(uiLanguage, 'shell.reporting'), canViewReporting],
  ];

  return `<header class="navbar sticky-top app-header">
    <div class="app-frame">
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
        ${canManageSettings ? `<a class="btn header-icon-button settings-link" href="/settings" data-section="settings"${activeSection === 'settings' ? ' aria-current="page"' : ''} aria-label="${escapeHtml(t(uiLanguage, 'shell.settings'))}" title="${escapeHtml(t(uiLanguage, 'shell.settings'))}">
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
        <button class="navbar-toggler d-lg-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#primary-navigation" aria-controls="primary-navigation" aria-label="${escapeHtml(t(uiLanguage, 'shell.show_navigation'))}">
          <span class="navbar-toggler-icon" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </header>
  <aside class="offcanvas-lg offcanvas-start app-sidebar" tabindex="-1" id="primary-navigation" aria-labelledby="navigation-title">
    <div class="offcanvas-header"><h2 class="offcanvas-title" id="navigation-title">${escapeHtml(t(uiLanguage, 'shell.primary_navigation'))}</h2><button class="btn-close" type="button" data-bs-dismiss="offcanvas" data-bs-target="#primary-navigation" aria-label="${escapeHtml(t(uiLanguage, 'action.close'))}"></button></div>
    <div class="offcanvas-body">
      <nav class="nav flex-column admin-nav" aria-label="${escapeHtml(t(uiLanguage, 'shell.primary_navigation'))}">
        ${destinations.filter(([, , , allowed]) => allowed).map(([key, href, label]) => `<a class="nav-link" href="${href}" data-section="${key}"${activeSection === key ? ' aria-current="page"' : ''}>${renderIcon(key)}${escapeHtml(label)}</a>`).join('')}
      </nav>
      <div class="workspace-identity"><span class="workspace-identity-mark" aria-hidden="true">${escapeHtml((currentUser?.name || 'A').slice(0, 1).toUpperCase())}</span><span>${escapeHtml(currentUser?.name || t(uiLanguage, 'app.name'))}</span></div>
    </div>
  </aside>`;
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
  const groups = settingsGroups;
  const active = groups.flatMap(([, entries]) => entries).find(([key]) => key === activeSection);
  return `<button class="btn btn-outline-secondary settings-mobile-toggle d-lg-none" type="button" data-bs-toggle="collapse" data-bs-target="#settings-navigation-panel" aria-expanded="false" aria-controls="settings-navigation-panel">${escapeHtml(t(uiLanguage, 'settings.sidebar_title'))} / ${escapeHtml(t(uiLanguage, active ? `settings.${active[1]}` : 'workspace.settings_overview'))}<span aria-hidden="true">⌄</span></button>
  <div class="collapse d-lg-block" id="settings-navigation-panel">
    <label class="visually-hidden" for="settings-search">${escapeHtml(t(uiLanguage, 'workspace.search_settings'))}</label>
    <input class="form-control settings-search" id="settings-search" type="search" name="settings_filter" autocomplete="off" placeholder="${escapeHtml(t(uiLanguage, 'workspace.search_settings'))}" data-settings-search>
    <nav class="nav settings-navigation" aria-label="${escapeHtml(t(uiLanguage, 'settings.navigation'))}">
      <a class="nav-link settings-overview-link${activeSection === 'overview' ? ' active' : ''}" href="/settings"${activeSection === 'overview' ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, 'workspace.settings_overview'))}</a>
      ${groups.map(([group, entries]) => `<div class="settings-nav-group" data-settings-group><p class="settings-group-label">${escapeHtml(t(uiLanguage, `workspace.settings_${group}`))}</p>${entries.map(([key, label]) => `<a class="nav-link${activeSection === key ? ' active' : ''}" href="/settings/${key}"${activeSection === key ? ' aria-current="page"' : ''}>${escapeHtml(t(uiLanguage, `settings.${label}`))}</a>`).join('')}</div>`).join('')}
    </nav>
    <p class="small text-body-secondary" role="status" data-settings-empty hidden>${escapeHtml(t(uiLanguage, 'common.no_results'))}</p>
  </div>`;
}

function renderSettingsOverview(language) {
  return renderSettingsLayout({
    activeSection: 'overview', title: t(language, 'shell.settings'),
    description: t(language, 'workspace.settings_intro'),
    content: `<div class="settings-directory">${settingsGroups.map(([group, entries]) => `<section class="settings-directory-group" aria-labelledby="directory-${group}"><div class="settings-directory-heading"><h2 id="directory-${group}">${escapeHtml(t(language, `workspace.settings_${group}`))}</h2><p>${escapeHtml(t(language, `workspace.settings_${group}_help`))}</p></div><div class="settings-directory-links">${entries.map(([key, label]) => `<a class="settings-directory-link" href="/settings/${key}"><span><strong>${escapeHtml(t(language, `settings.${label}`))}</strong><span>${escapeHtml(t(language, `workspace.setting_${key}`))}</span></span>${renderIcon('arrow')}</a>`).join('')}</div></section>`).join('')}</div>`,
  });
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
    <meta name="theme-color" content="#f4f7f8">
    ${authenticated ? '<meta name="robots" content="noindex, nofollow">' : ''}
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
    <link rel="preload" href="/fonts/plex/IBMPlexSans-SemiBold.woff2" as="font" type="font/woff2" crossorigin>
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
  const actionLanguage = normalizeLanguage(language || getCurrentRequest()?.uiLanguage) || DEFAULT_LANGUAGE;
  return {
    status,
    html: renderPage(title, `<section class="error-panel">
      <span class="error-code" aria-hidden="true">${escapeHtml(status)}</span>
      <div><h1>${escapeHtml(title)}</h1>
        <p class="error-description" role="alert">${escapeHtml(message)}</p>
        <div class="form-actions">${status !== 403 && status !== 404 ? `<a class="btn btn-outline-secondary" href="">${escapeHtml(t(actionLanguage, 'workspace.retry'))}</a>` : ''}<a class="btn btn-light" href="/">${escapeHtml(t(actionLanguage, 'shell.home'))}</a></div>
      </div></section>`, { language }),
  };
}

module.exports = {
  renderIcon,
  renderDateMarker,
  renderAttendanceProgress,
  renderMetricStrip,
  renderSettingsOverview,
  renderActionMenu,
  renderCollectionTools,
  businessTerm,
  escapeHtml,
  renderPage,
  renderLanguageOptions,
  renderLanguageSelector,
  renderMessagePage,
  renderSettingsLayout,
  renderSettingsNavigation,
};
