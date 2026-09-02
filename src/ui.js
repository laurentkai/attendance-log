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

function renderNavigation() {
  return `<header class="app-header">
    <div class="app-header-bar">
      <span class="app-brand">Attendance Log</span>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation">
        <span class="menu-icon" aria-hidden="true"><span></span><span></span><span></span></span>
        <span>Menu</span>
      </button>
    </div>
    <nav class="admin-nav" id="primary-navigation" aria-label="Navigation principale">
      <a href="/" data-section="home">Accueil</a>
      <a href="/classes" data-section="classes">Classes</a>
      <a href="/students" data-section="students">Élèves</a>
      <a href="/sessions" data-section="sessions">Séances</a>
      <a href="/students/import" data-section="import">Importer</a>
      <a href="/settings/email" data-section="email">E-mail</a>
      <form method="post" action="/logout">
        <button class="nav-logout" type="submit">Déconnexion</button>
      </form>
    </nav>
  </header>`;
}

function renderPage(title, content, { authenticated = true } = {}) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f8fafc">
    <title>${escapeHtml(title)} · Attendance Log</title>
    <link rel="stylesheet" href="/css/styles.css">
    <script src="/js/classes.js" defer></script>
    <script src="/js/live-attendance.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#main-content">Aller au contenu</a>
    <main class="page">
      ${authenticated ? renderNavigation() : ''}
      <div id="main-content" tabindex="-1">
        ${content}
      </div>
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
      <header class="page-header">
        <div>
          <h1>${escapeHtml(title)}</h1>
        </div>
      </header>
      <p class="message message-error">${escapeHtml(message)}</p>`),
  };
}

module.exports = { escapeHtml, renderPage, renderMessagePage };
