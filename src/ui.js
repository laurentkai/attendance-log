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
  return `<nav class="admin-nav" aria-label="Navigation principale">
    <a href="/classes">Classes</a>
    <a href="/students">Élèves</a>
    <a href="/students/import">Importer des élèves</a>
    <form method="post" action="/logout">
      <button class="link-button" type="submit">Déconnexion</button>
    </form>
  </nav>`;
}

function renderPage(title, content, { authenticated = true } = {}) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} · Attendance Log</title>
    <link rel="stylesheet" href="/css/styles.css">
    <script src="/js/classes.js" defer></script>
  </head>
  <body>
    <main class="page">
      ${authenticated ? renderNavigation() : ''}
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
      <header class="page-header">
        <h1>${escapeHtml(title)}</h1>
      </header>
      <p class="message message-error">${escapeHtml(message)}</p>`),
  };
}

module.exports = { escapeHtml, renderPage, renderMessagePage };
