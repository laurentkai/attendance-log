const express = require('express');
const { escapeHtml, renderPage } = require('./ui');

const privacyNotice = Object.freeze({
  title: 'Protection des données',
  controller: 'ASBL Nouveaux Horizons',
  contactEmail: 'contact@nouveauxhorizons.be',
  introduction: 'Cette notice explique comment les données personnelles peuvent être utilisées dans Attendance Log pour organiser les formations et suivre les présences.',
  sections: Object.freeze([
    {
      id: 'responsable',
      title: 'Responsable du traitement',
      paragraphs: ['Le responsable du traitement est ASBL Nouveaux Horizons. Pour toute question relative à vos données personnelles ou pour exercer vos droits, contactez-nous à l’adresse ci-dessous.'],
      contact: true,
    },
    {
      id: 'donnees',
      title: 'Données concernées',
      paragraphs: ['Selon les activités et fonctionnalités utilisées, Attendance Log peut traiter les catégories de données suivantes :'],
      bullets: [
        'prénom et nom ;',
        'adresse e-mail ;',
        'inscriptions aux activités ou aux cours ;',
        'statut de présence ;',
        'heure d’arrivée lorsqu’une heure de début est configurée pour la séance ;',
        'informations de ponctualité calculées à partir de l’heure d’arrivée ;',
        'code participant ;',
        'identifiant QR individuel utilisé pour la prise de présence.',
      ],
    },
    {
      id: 'administration',
      title: 'Gestion administrative des élèves et des inscriptions',
      paragraphs: [
        'Les données d’identification et de contact sont utilisées pour gérer les inscriptions et organiser les formations ou services auxquels le participant s’est inscrit.',
        'La base juridique est l’article 6, paragraphe 1, point b), du RGPD : le traitement est nécessaire à l’exécution de la relation liée à l’inscription et à la fourniture de la formation.',
      ],
    },
    {
      id: 'presences',
      title: 'Gestion des présences et statistiques de fréquentation et de ponctualité',
      paragraphs: [
        'Les présences et, lorsqu’elles sont utilisées, les heures d’arrivée permettent de suivre la participation, d’assurer la bonne organisation des formations, de produire des statistiques de fréquentation et de ponctualité et d’améliorer l’organisation des activités.',
        'La base juridique est l’article 6, paragraphe 1, point f), du RGPD : les intérêts légitimes de Nouveaux Horizons à organiser ses formations et à en comprendre la fréquentation.',
        'Les informations de ponctualité ne servent pas à prendre une décision automatisée concernant un participant, à créer un profil comportemental ni à imposer automatiquement une sanction.',
      ],
    },
    {
      id: 'acces',
      title: 'Accès et minimisation',
      paragraphs: [
        'L’accès aux données personnelles est limité selon les responsabilités de chaque utilisateur. Les personnes chargées de la prise de présence reçoivent uniquement les informations opérationnelles nécessaires, telles que le nom et le code participant.',
        'Lorsque l’identité réelle n’est pas nécessaire à l’analyse, les rapports peuvent présenter des participants sous une forme pseudonymisée. Certains flux opérationnels autorisés restent toutefois identifiés lorsqu’ils nécessitent l’identité du participant.',
      ],
    },
    {
      id: 'conservation',
      title: 'Durée de conservation',
      paragraphs: [
        'L’identité personnelle est conservée tant qu’elle est nécessaire à la participation et aux inscriptions actives.',
        'Lorsque le participant est inactif et qu’aucune inscription active ne subsiste, son identité est conservée pendant un maximum de 12 mois après sa dernière activité significative. Une fois ce délai atteint, elle peut être anonymisée de manière irréversible.',
        'Cette anonymisation n’est pas automatique : elle est actuellement déclenchée manuellement par un administrateur autorisé, uniquement lorsque toutes les conditions d’éligibilité sont remplies.',
        'Les faits historiques de présence et les statistiques peuvent ensuite être conservés sous une forme anonyme, sans l’ancienne identité du participant.',
      ],
    },
    {
      id: 'sauvegardes',
      title: 'Sauvegardes',
      paragraphs: [
        'Des sauvegardes antérieures peuvent temporairement contenir des données personnelles qui ont depuis été anonymisées dans la base active. Ces archives ne sont pas réécrites rétroactivement : elles sont soumises à une durée de conservation et à une rotation limitées, puis expirent conformément à la politique de sauvegarde applicable.',
      ],
    },
    {
      id: 'prestataires',
      title: 'Destinataires et prestataires techniques',
      paragraphs: [
        'Les données sont accessibles aux utilisateurs autorisés de Nouveaux Horizons selon leurs responsabilités. Lorsque ces services sont configurés, elles peuvent également être traitées par les prestataires techniques nécessaires au fonctionnement d’Attendance Log, notamment le prestataire d’envoi d’e-mails et le prestataire de stockage sécurisé des sauvegardes.',
        'Les prestataires effectivement utilisés et leurs lieux de traitement dépendent de la configuration retenue par Nouveaux Horizons.',
      ],
    },
    {
      id: 'droits',
      title: 'Vos droits',
      paragraphs: [
        'Selon les conditions prévues par le RGPD, vous pouvez demander l’accès à vos données, leur rectification ou leur effacement, la limitation de leur traitement, ou vous opposer à certains traitements.',
        'Lorsque le traitement repose sur un intérêt légitime, vous pouvez vous y opposer pour des raisons tenant à votre situation particulière. Chaque demande est examinée selon les conditions applicables ; elle ne conduit donc pas automatiquement à l’effacement de toutes les informations.',
        'Attendance Log fournit à Nouveaux Horizons des outils techniques pour exporter les données concernant un participant, rectifier son identité et anonymiser irréversiblement l’identité d’un participant devenu éligible.',
      ],
      contact: true,
    },
    {
      id: 'reclamation',
      title: 'Contact et réclamation',
      paragraphs: [
        'Pour toute question ou demande, contactez Nouveaux Horizons à l’adresse ci-dessous. Vous pouvez également introduire une réclamation auprès de l’autorité de contrôle compétente, notamment l’Autorité de protection des données en Belgique.',
      ],
      contact: true,
    },
  ]),
});

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
        <p class="mb-0">Dernière mise à jour : 12 septembre 2026.</p>
      </footer>
    </article>
  </div>`, { authenticated: false, pageClass: 'public-privacy-page' });
}

function privacyNoticeHandler(_request, response) {
  response.set('Cache-Control', 'public, max-age=300');
  response.send(renderPrivacyNoticePage());
}

const router = express.Router();
router.get('/privacy', privacyNoticeHandler);

module.exports = {
  privacyNotice,
  privacyNoticeHandler,
  renderPrivacyNoticePage,
  router,
};
