const express = require('express');
const { languageFromAcceptLanguage, t } = require('./i18n');
const { escapeHtml, renderPage } = require('./ui');

const sectionDefinitions = Object.freeze([
  { id: 'controller', keys: ['controller.text'], contact: true },
  { id: 'data', keys: ['data.intro'], bullets: ['data.name', 'data.email', 'data.memberships', 'data.attendance', 'data.arrival', 'data.punctuality', 'data.code', 'data.qr'] },
  { id: 'administration', keys: ['administration.purpose', 'administration.basis'] },
  { id: 'attendance', keys: ['attendance.purpose', 'attendance.basis', 'attendance.no_profiling'] },
  { id: 'access', keys: ['access.minimum', 'access.pseudonym'] },
  { id: 'retention', keys: ['retention.active', 'retention.rule', 'retention.manual', 'retention.statistics'] },
  { id: 'backups', keys: ['backups.text'] },
  { id: 'providers', keys: ['providers.access', 'providers.location'] },
  { id: 'rights', keys: ['rights.list', 'rights.object', 'rights.tools'], contact: true },
  { id: 'complaint', keys: ['complaint.text'], contact: true },
]);

function buildPrivacyNotice(language) {
  return Object.freeze({
  language,
  title: t(language, 'privacy.notice.title'),
  controller: 'ASBL Nouveaux Horizons',
  contactEmail: 'contact@nouveauxhorizons.be',
  introduction: t(language, 'privacy.notice.introduction'),
  sections: Object.freeze(sectionDefinitions.map((section) => Object.freeze({
    id: section.id,
    title: t(language, `privacy.notice.${section.id}.title`),
    paragraphs: section.keys.map((key) => t(language, `privacy.notice.${key}`)),
    bullets: section.bullets?.map((key) => t(language, `privacy.notice.${key}`)),
    contact: section.contact,
  }))),
  updated: t(language, 'privacy.notice.updated'),
});
}

const privacyNotice = buildPrivacyNotice('en');

function renderContact(email) {
  const safeEmail = escapeHtml(email);
  return `<p><a href="mailto:${safeEmail}">${safeEmail}</a></p>`;
}

function renderPrivacyNoticePage(content = privacyNotice) {
  const sections = content.sections.map((section) => `<section class="mb-4" aria-labelledby="privacy-${escapeHtml(section.id)}">
    <h2 class="h4" id="privacy-${escapeHtml(section.id)}">${escapeHtml(section.title)}</h2>
    ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
    ${section.bullets ? `<ul>${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
    ${section.contact ? renderContact(content.contactEmail) : ''}
  </section>`).join('');

  return renderPage(content.title, `<div class="container-md py-4 py-md-5">
    <article class="mx-auto" style="max-width: 48rem">
      <header class="border-bottom pb-3 mb-4">
        <a class="text-decoration-none fw-semibold" href="/login" translate="no">Attendance Log</a>
        <p class="eyebrow mt-3 mb-1">${escapeHtml(content.controller)}</p>
        <h1>${escapeHtml(content.title)}</h1>
        <p class="lead text-body-secondary mb-0">${escapeHtml(content.introduction)}</p>
      </header>
      ${sections}
      <footer class="border-top pt-3 text-body-secondary small">
        <p class="mb-0">${escapeHtml(content.updated)}</p>
      </footer>
    </article>
  </div>`, { authenticated: false, pageClass: 'public-privacy-page', language: content.language });
}

function privacyNoticeHandler(request, response) {
  const language = languageFromAcceptLanguage(request?.get?.('accept-language') || '');
  response.set('Cache-Control', 'public, max-age=300');
  response.send(renderPrivacyNoticePage(buildPrivacyNotice(language)));
}

const router = express.Router();
router.get('/privacy', privacyNoticeHandler);

module.exports = {
  privacyNotice,
  buildPrivacyNotice,
  privacyNoticeHandler,
  renderPrivacyNoticePage,
  router,
};
