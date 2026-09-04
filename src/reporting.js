const express = require('express');
const { formatDateForDisplay, formatDateForInput } = require('./date-format');
const {
  getClassesForFilters,
  getCourseReport,
  getCourseSummaries,
  getGlobalReport,
  getSessionReport,
  getSessionSummaries,
  getStudentReport,
  getStudentSummaries,
} = require('./reporting-data');
const {
  buildCourseWorkbook,
  buildGlobalWorkbook,
  buildSessionWorkbook,
  buildStudentWorkbook,
  safeFilenamePart,
  sendWorkbook,
} = require('./reporting-excel');
const { getTerm } = require('./terminology');
const { businessTerm, escapeHtml, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();

function isValidId(value) {
  return /^[1-9]\d*$/.test(value || '');
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function formatRate(rate) {
  return rate === null
    ? '—'
    : new Intl.NumberFormat('fr-BE', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(rate);
}

function getStatusLabel(status) {
  return { present: 'Présent', absent: 'Absent', pending: 'En attente' }[status] || status;
}

function renderBusinessNotFoundPage(concept) {
  return renderMessagePage(`${getTerm(concept)} introuvable`, 'L’élément demandé n’existe pas.', 404);
}

function renderReportingNavigation(active) {
  const links = [
    ['overview', '/reporting', 'Vue d’ensemble'],
    ['courses', '/reporting/courses', getTerm('class', 'plural')],
    ['sessions', '/reporting/sessions', getTerm('session', 'plural')],
    ['students', '/reporting/students', getTerm('student', 'plural')],
  ];
  return `<nav class="nav nav-pills context-tabs" aria-label="Rubriques du reporting">
    ${links.map(([key, href, label]) => `<a class="nav-link${active === key ? ' active' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
  </nav>`;
}

function renderSummary(summary) {
  return `<dl class="report-summary" aria-label="Synthèse">
    <div><dt>${businessTerm('session', 'plural')} clôturées</dt><dd>${summary.closedSessionCount}</dd></div>
    <div><dt>Nombre de ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}</dt><dd>${summary.opportunities}</dd></div>
    <div><dt>Présents</dt><dd>${summary.present}</dd></div>
    <div><dt>Absents</dt><dd>${summary.absent}</dd></div>
    <div><dt>Taux de ${businessTerm('attendance').toLocaleLowerCase('fr')}</dt><dd>${formatRate(summary.attendanceRate)}</dd></div>
  </dl>`;
}

function renderReportHeader({ eyebrow = '', title, description = '', action = '' }) {
  return `<header class="page-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-3">
    <div>
      ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ''}
    </div>
    ${action}
  </header>`;
}

function renderDataTable({ label, headers, rows }) {
  if (rows.length === 0) {
    return '<p class="empty-state">Aucune donnée historique clôturée.</p>';
  }
  return `<div class="table-responsive data-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(label)}">
    <table class="table table-sm table-hover align-middle mb-0 data-table">
      <thead class="table-light"><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  </div>`;
}

function getGlobalFilters(query) {
  const classId = typeof query.class_id === 'string' ? query.class_id : '';
  const dateFrom = typeof query.date_from === 'string' ? query.date_from : '';
  const dateTo = typeof query.date_to === 'string' ? query.date_to : '';
  const error = classId && !isValidId(classId)
    ? 'La sélection contient une valeur invalide.'
    : dateFrom && !isValidDate(dateFrom)
    ? 'La date de début n’est pas valide.'
    : dateTo && !isValidDate(dateTo)
    ? 'La date de fin n’est pas valide.'
    : dateFrom && dateTo && dateFrom > dateTo
    ? 'La date de début doit précéder la date de fin.'
    : '';

  return {
    classId: classId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    error,
  };
}

router.get('/', async (_request, response) => {
  try {
    const classes = await getClassesForFilters();
    response.send(renderPage('Reporting', `
      ${renderReportHeader({
        title: 'Reporting',
        description: `Consultez et exportez uniquement les ${getTerm('attendance', 'plural').toLocaleLowerCase('fr')} des ${getTerm('session', 'plural').toLocaleLowerCase('fr')} clôturées.`,
      })}
      ${renderReportingNavigation('overview')}
      <section class="page-section" aria-labelledby="reporting-access-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="reporting-access-title">Consulter les rapports</h2></div></div>
        <div class="list-group compact-list">
          <a class="list-group-item compact-row report-navigation-row" href="/reporting/courses">
            <div class="compact-identity"><p class="compact-title">Reporting par ${businessTerm('class').toLocaleLowerCase('fr')}</p><p class="compact-meta">Synthèse par ${businessTerm('session').toLocaleLowerCase('fr')} et par ${businessTerm('student').toLocaleLowerCase('fr')}</p></div>
          </a>
          <a class="list-group-item compact-row report-navigation-row" href="/reporting/sessions">
            <div class="compact-identity"><p class="compact-title">Reporting par ${businessTerm('session').toLocaleLowerCase('fr')}</p><p class="compact-meta">Toutes les ${businessTerm('session', 'plural').toLocaleLowerCase('fr')} clôturées et leurs taux</p></div>
          </a>
          <a class="list-group-item compact-row report-navigation-row" href="/reporting/students">
            <div class="compact-identity"><p class="compact-title">Reporting par ${businessTerm('student').toLocaleLowerCase('fr')}</p><p class="compact-meta">Historique individuel des ${businessTerm('session', 'plural').toLocaleLowerCase('fr')} clôturées</p></div>
          </a>
        </div>
      </section>
      <section class="page-section" aria-labelledby="global-export-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="global-export-title">Export global des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}</h2>
            <p class="section-description">Les dates sont inclusives. Les ${businessTerm('session', 'plural').toLocaleLowerCase('fr')} ouvertes ou planifiées restent exclues.</p>
          </div>
        </div>
        <form class="card card-body app-form report-filter-form" method="get" action="/reporting/export">
          <div class="form-field">
            <label for="report-class">${businessTerm('class')}</label>
            <select class="form-select" id="report-class" name="class_id">
              <option value="">Sans filtre</option>
              ${classes.map((course) => `<option value="${course.id}">${escapeHtml(course.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="report-date-from">Du</label>
            <input class="form-control" id="report-date-from" name="date_from" type="date">
          </div>
          <div class="form-field">
            <label for="report-date-to">Au</label>
            <input class="form-control" id="report-date-to" name="date_to" type="date">
          </div>
          <button class="btn btn-primary" type="submit">Exporter les ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}</button>
        </form>
      </section>`));
  } catch (error) {
    console.error('Unable to load reporting:', error);
    const page = renderMessagePage('Reporting indisponible', 'Impossible de charger le reporting pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/courses', async (_request, response) => {
  try {
    const courses = await getCourseSummaries();
    const content = courses.length === 0
      ? `<p class="empty-state">Aucune donnée disponible pour les ${businessTerm('class', 'plural').toLocaleLowerCase('fr')}.</p>`
      : `<section data-filterable-list>
          <div class="search">
            <label for="report-course-search">Rechercher une ${businessTerm('class').toLocaleLowerCase('fr')}</label>
            <div class="search-controls"><input class="form-control" id="report-course-search" name="course_filter" type="search" autocomplete="off" spellcheck="false" placeholder="Nom…" data-list-search aria-controls="report-course-list"></div>
          </div>
          <p class="empty-state" data-list-no-results hidden>Aucun résultat.</p>
          <div class="list-group compact-list" id="report-course-list" data-list-results>${courses.map((course) => `
            <article class="list-group-item compact-row compact-row-status report-row" data-list-row data-search="${escapeHtml(course.name.toLocaleLowerCase('fr'))}">
              <div class="compact-identity"><p class="compact-title">${escapeHtml(course.name)}</p><p class="compact-meta">${businessTerm('session', 'plural')} clôturées : ${course.closedSessionCount} · ${businessTerm('attendance', 'plural')} : ${course.opportunities}</p></div>
              <div class="compact-status"><strong class="report-rate">${formatRate(course.attendanceRate)}</strong><span class="compact-meta">${course.present} présents · ${course.absent} absents</span></div>
              <div class="compact-actions"><a class="btn btn-outline-secondary" href="/reporting/courses/${course.id}">Voir le rapport</a></div>
            </article>`).join('')}</div>
        </section>`;
    response.send(renderPage(`Reporting par ${getTerm('class').toLocaleLowerCase('fr')}`, `
      ${renderReportHeader({ title: `Reporting par ${getTerm('class').toLocaleLowerCase('fr')}`, description: `Synthèse des ${getTerm('session', 'plural').toLocaleLowerCase('fr')} clôturées pour chaque ${getTerm('class').toLocaleLowerCase('fr')}.` })}
      ${renderReportingNavigation('courses')}
      ${content}`));
  } catch (error) {
    console.error('Unable to load course reporting:', error);
    const page = renderMessagePage('Reporting indisponible', `Impossible de charger le reporting par ${getTerm('class').toLocaleLowerCase('fr')}.`);
    response.status(page.status).send(page.html);
  }
});

router.get('/courses/:id/export', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderBusinessNotFoundPage('class');
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const report = await getCourseReport(request.params.id);
    if (!report) {
      const page = renderBusinessNotFoundPage('class');
      response.status(page.status).send(page.html);
      return;
    }
    await sendWorkbook(
      response,
      buildCourseWorkbook(report),
      `presences-cours-${safeFilenamePart(report.course.name, 'cours')}.xlsx`,
    );
  } catch (error) {
    console.error('Unable to export course reporting:', error);
    const page = renderMessagePage('Export impossible', 'Impossible de générer cet export Excel.');
    response.status(page.status).send(page.html);
  }
});

router.get('/courses/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderBusinessNotFoundPage('class');
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const report = await getCourseReport(request.params.id);
    if (!report) {
      const page = renderBusinessNotFoundPage('class');
      response.status(page.status).send(page.html);
      return;
    }
    const sessionRows = report.sessions.map((session) => `<tr>
      <td>${escapeHtml(formatDateForDisplay(session.date))}</td>
      <td><a href="/sessions/${session.id}">${escapeHtml(session.title)}</a></td>
      <td>${escapeHtml(session.instructor)}</td>
      <td class="numeric">${session.opportunities}</td><td class="numeric">${session.present}</td><td class="numeric">${session.absent}</td><td class="numeric">${formatRate(session.attendanceRate)}</td>
    </tr>`);
    const studentRows = report.students.map((student) => `<tr>
      <td><a href="/reporting/students/${student.id}">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</a></td>
      <td><span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></td>
      <td class="numeric">${student.closedSessionCount}</td><td class="numeric">${student.present}</td><td class="numeric">${student.absent}</td><td class="numeric">${formatRate(student.attendanceRate)}</td>
    </tr>`);

    response.send(renderPage(`Rapport de ${report.course.name}`, `
      ${renderReportHeader({
        eyebrow: `Reporting par ${getTerm('class').toLocaleLowerCase('fr')}`,
        title: report.course.name,
        description: `Données officielles issues uniquement des ${getTerm('session', 'plural').toLocaleLowerCase('fr')} clôturées.`,
        action: `<div class="context-actions d-flex flex-wrap gap-2"><a class="btn btn-primary" href="/reporting/courses/${report.course.id}/export">Exporter en Excel</a><a class="btn btn-light" href="/reporting/courses">Retour à la liste</a></div>`,
      })}
      ${renderReportingNavigation('courses')}
      ${renderSummary(report.summary)}
      <section class="page-section" aria-labelledby="course-session-breakdown"><div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="course-session-breakdown">Par ${businessTerm('session').toLocaleLowerCase('fr')}</h2></div></div>
        ${renderDataTable({ label: `Détail par ${getTerm('session').toLocaleLowerCase('fr')}`, headers: ['Date', getTerm('session'), getTerm('instructor'), 'Attendus', 'Présents', 'Absents', 'Taux'], rows: sessionRows })}
      </section>
      <section class="page-section" aria-labelledby="course-student-breakdown"><div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="course-student-breakdown">Par ${businessTerm('student').toLocaleLowerCase('fr')}</h2></div></div>
        ${renderDataTable({ label: `Détail par ${getTerm('student').toLocaleLowerCase('fr')}`, headers: [getTerm('student'), 'Code', getTerm('session', 'plural'), getTerm('attendance', 'plural'), 'Absences', 'Taux'], rows: studentRows })}
      </section>`));
  } catch (error) {
    console.error('Unable to load course report:', error);
    const page = renderMessagePage('Reporting indisponible', 'Impossible de charger ce rapport pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/sessions', async (_request, response) => {
  try {
    const sessions = await getSessionSummaries();
    const content = sessions.length === 0
      ? `<p class="empty-state">Aucune ${businessTerm('session').toLocaleLowerCase('fr')} clôturée à reporter.</p>`
      : `<section data-filterable-list>
          <div class="search"><label for="report-session-search">Rechercher une ${businessTerm('session').toLocaleLowerCase('fr')}</label><div class="search-controls"><input class="form-control" id="report-session-search" name="session_filter" type="search" autocomplete="off" spellcheck="false" placeholder="Titre, ${businessTerm('class').toLocaleLowerCase('fr')} ou ${businessTerm('instructor').toLocaleLowerCase('fr')}…" data-list-search aria-controls="report-session-list"></div></div>
          <p class="empty-state" data-list-no-results hidden>Aucun résultat.</p>
          <div class="list-group compact-list" id="report-session-list" data-list-results>${sessions.map((session) => `
            <article class="list-group-item compact-row compact-row-status session-row report-row" data-list-row data-search="${escapeHtml(`${session.title} ${session.class_name} ${session.instructor}`.toLocaleLowerCase('fr'))}">
              <div class="compact-identity session-identity"><p class="compact-meta session-date">${escapeHtml(formatDateForDisplay(session.date))}</p><p class="compact-title">${escapeHtml(session.title)}</p><p class="compact-meta">${escapeHtml(session.class_name)} · ${escapeHtml(session.instructor)}</p></div>
              <div class="compact-status"><span class="badge status-badge status-closed">État : clôturé</span><strong class="report-rate">${formatRate(session.attendanceRate)}</strong><span class="compact-meta">${session.present} / ${session.opportunities} présents</span></div>
              <div class="compact-actions compact-actions--split"><a class="btn btn-outline-secondary" href="/sessions/${session.id}">Voir la session</a><a class="btn btn-primary" href="/reporting/sessions/${session.id}/export">Exporter en Excel</a></div>
            </article>`).join('')}</div>
        </section>`;
    response.send(renderPage(`Reporting par ${getTerm('session').toLocaleLowerCase('fr')}`, `
      ${renderReportHeader({ title: `Reporting par ${getTerm('session').toLocaleLowerCase('fr')}`, description: `Résultats officiels des ${getTerm('session', 'plural').toLocaleLowerCase('fr')} clôturées.` })}
      ${renderReportingNavigation('sessions')}
      ${content}`));
  } catch (error) {
    console.error('Unable to load session reporting:', error);
    const page = renderMessagePage('Reporting indisponible', `Impossible de charger le reporting par ${getTerm('session').toLocaleLowerCase('fr')}.`);
    response.status(page.status).send(page.html);
  }
});

router.get('/sessions/:id/export', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderBusinessNotFoundPage('session');
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const report = await getSessionReport(request.params.id);
    if (!report) {
      const page = renderBusinessNotFoundPage('session');
      response.status(page.status).send(page.html);
      return;
    }
    if (report.session.state !== 'closed') {
      const page = renderMessagePage('Export indisponible', `${getTerm('session')} clôturée requise pour un export officiel.`, 409);
      response.status(page.status).send(page.html);
      return;
    }
    const date = formatDateForInput(report.session.date);
    await sendWorkbook(
      response,
      buildSessionWorkbook(report),
      `presences-seance-${safeFilenamePart(date, 'date')}-${safeFilenamePart(report.session.title, 'seance')}.xlsx`,
    );
  } catch (error) {
    console.error('Unable to export session reporting:', error);
    const page = renderMessagePage('Export impossible', 'Impossible de générer cet export Excel.');
    response.status(page.status).send(page.html);
  }
});

router.get('/students', async (_request, response) => {
  try {
    const students = await getStudentSummaries();
    const content = students.length === 0
      ? `<p class="empty-state">Aucune donnée historique clôturée pour les ${businessTerm('student', 'plural').toLocaleLowerCase('fr')}.</p>`
      : `<section data-filterable-list>
          <div class="search"><label for="report-student-search">Rechercher un ${businessTerm('student').toLocaleLowerCase('fr')}</label><div class="search-controls"><input class="form-control" id="report-student-search" name="student_filter" type="search" autocomplete="off" spellcheck="false" placeholder="Nom ou code…" data-list-search aria-controls="report-student-list"></div></div>
          <p class="empty-state" data-list-no-results hidden>Aucun résultat.</p>
          <div class="list-group compact-list" id="report-student-list" data-list-results>${students.map((student) => `
            <article class="list-group-item compact-row compact-row-status student-row report-row" data-list-row data-search="${escapeHtml(`${student.first_name} ${student.last_name} ${student.student_code}`.toLocaleLowerCase('fr'))}">
              <div class="compact-identity student-identity"><p class="compact-title">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</p><p class="compact-meta"><span class="student-code" translate="no">${escapeHtml(student.student_code)}</span> · ${student.closedSessionCount} ${businessTerm('session', student.closedSessionCount === 1 ? 'singular' : 'plural').toLocaleLowerCase('fr')} clôturée${student.closedSessionCount > 1 ? 's' : ''}</p></div>
              <div class="compact-status"><strong class="report-rate">${formatRate(student.attendanceRate)}</strong><span class="compact-meta">${student.present} présents · ${student.absent} absents</span></div>
              <div class="compact-actions"><a class="btn btn-outline-secondary" href="/reporting/students/${student.id}">Voir le rapport</a></div>
            </article>`).join('')}</div>
        </section>`;
    response.send(renderPage(`Reporting par ${getTerm('student').toLocaleLowerCase('fr')}`, `
      ${renderReportHeader({ title: `Reporting par ${getTerm('student').toLocaleLowerCase('fr')}`, description: `Historique individuel des ${getTerm('session', 'plural').toLocaleLowerCase('fr')} clôturées.` })}
      ${renderReportingNavigation('students')}
      ${content}`));
  } catch (error) {
    console.error('Unable to load student reporting:', error);
    const page = renderMessagePage('Reporting indisponible', `Impossible de charger le reporting par ${getTerm('student').toLocaleLowerCase('fr')}.`);
    response.status(page.status).send(page.html);
  }
});

router.get('/students/:id/export', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderBusinessNotFoundPage('student');
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const report = await getStudentReport(request.params.id);
    if (!report) {
      const page = renderBusinessNotFoundPage('student');
      response.status(page.status).send(page.html);
      return;
    }
    await sendWorkbook(
      response,
      buildStudentWorkbook(report),
      `presences-${safeFilenamePart(`${report.student.first_name}-${report.student.last_name}`, 'eleve')}.xlsx`,
    );
  } catch (error) {
    console.error('Unable to export student reporting:', error);
    const page = renderMessagePage('Export impossible', 'Impossible de générer cet export Excel.');
    response.status(page.status).send(page.html);
  }
});

router.get('/students/:id', async (request, response) => {
  if (!isValidId(request.params.id)) {
    const page = renderBusinessNotFoundPage('student');
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const report = await getStudentReport(request.params.id);
    if (!report) {
      const page = renderBusinessNotFoundPage('student');
      response.status(page.status).send(page.html);
      return;
    }
    const studentName = `${report.student.first_name} ${report.student.last_name}`;
    const rows = report.details.map((row) => `<tr>
      <td>${escapeHtml(formatDateForDisplay(row.date))}</td><td>${escapeHtml(row.class_name)}</td><td><a href="/sessions/${row.session_id}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.instructor)}</td><td><span class="badge status-badge status-${row.status}">${escapeHtml(getStatusLabel(row.status))}</span></td>
    </tr>`);
    response.send(renderPage(`Rapport de ${studentName}`, `
      ${renderReportHeader({
        eyebrow: `Reporting par ${getTerm('student').toLocaleLowerCase('fr')}`,
        title: studentName,
        description: `Code d’identification · ${report.student.student_code}`,
        action: `<div class="context-actions d-flex flex-wrap gap-2"><a class="btn btn-primary" href="/reporting/students/${report.student.id}/export">Exporter en Excel</a><a class="btn btn-light" href="/reporting/students">Retour à la liste</a></div>`,
      })}
      ${renderReportingNavigation('students')}
      ${renderSummary(report.summary)}
      <section class="page-section" aria-labelledby="student-history-title"><div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="student-history-title">Historique des ${businessTerm('attendance', 'plural').toLocaleLowerCase('fr')}</h2></div></div>
        ${renderDataTable({ label: `Historique de ${studentName}`, headers: ['Date', getTerm('class'), getTerm('session'), getTerm('instructor'), 'Statut'], rows })}
      </section>`));
  } catch (error) {
    console.error('Unable to load student report:', error);
    const page = renderMessagePage('Reporting indisponible', 'Impossible de charger ce rapport pour le moment.');
    response.status(page.status).send(page.html);
  }
});

router.get('/export', async (request, response) => {
  const filters = getGlobalFilters(request.query);
  if (filters.error) {
    const page = renderMessagePage('Filtres invalides', filters.error, 400);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    if (filters.classId) {
      const classes = await getClassesForFilters();
      if (!classes.some((course) => String(course.id) === filters.classId)) {
        const page = renderBusinessNotFoundPage('class');
        response.status(page.status).send(page.html);
        return;
      }
    }
    const report = await getGlobalReport(filters);
    const parts = ['presences'];
    if (filters.dateFrom) parts.push(`depuis-${filters.dateFrom}`);
    if (filters.dateTo) parts.push(`jusqu-au-${filters.dateTo}`);
    await sendWorkbook(response, buildGlobalWorkbook(report), `${parts.join('-')}.xlsx`);
  } catch (error) {
    console.error('Unable to export global reporting:', error);
    const page = renderMessagePage('Export impossible', 'Impossible de générer cet export Excel.');
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
