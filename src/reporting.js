const express = require('express');
const { pool } = require('./db/client');
const { formatLocalTime, formatPercent, normalizeClockTime } = require('./application-time');
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
const { isValidPublicId } = require('./public-id');
const { createReportingPrivacyContext } = require('./reporting-privacy');
const { formatPunctualityLabel } = require('./punctuality');
const {
  resolveClassReportLanguage,
  resolveGlobalReportLanguage,
  resolveParticipantReportLanguage,
  resolveSessionReportLanguage,
  t,
} = require('./i18n');
const { businessTerm, escapeHtml, renderIcon, renderMetricStrip, renderCollectionTools, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();

router.use((_request, response, next) => {
  response.set('Cache-Control', 'private, no-store, max-age=0');
  next();
});

function canViewPii(request) {
  return request.currentUser?.view_pii === true;
}

function renderPrivacyNotice(request) {
  return canViewPii(request)
    ? ''
    : `<div class="privacy-mode" role="status">${renderIcon('shield')}<p><strong>${escapeHtml(t(request.uiLanguage, 'workspace.private_mode'))}</strong><span>${escapeHtml(t(request.uiLanguage, 'reporting.privacy_hidden'))}</span></p></div>`;
}

function renderPiiRequiredPage(language) {
  return renderMessagePage(
    t(language, 'reporting.pii_required.title'),
    t(language, 'reporting.pii_required.message'),
    403,
    language,
  );
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function formatRate(rate) {
  return rate === null
    ? '—'
    : formatPercent(rate, { minimumFractionDigits: 1 });
}

function getStatusLabel(status, language) {
  try { return t(language, `status.${status}`); } catch (_error) { return status; }
}

function renderBusinessNotFoundPage(concept, language) {
  return renderMessagePage(`${getTerm(language, concept)} — 404`, t(language, 'reporting.not_found'), 404, language);
}

function renderReportingNavigation(active, language) {
  const links = [
    ['overview', '/reporting', t(language, 'reporting.overview')],
    ['courses', '/reporting/courses', getTerm(language, 'class', 'plural')],
    ['sessions', '/reporting/sessions', getTerm(language, 'session', 'plural')],
    ['students', '/reporting/students', getTerm(language, 'student', 'plural')],
  ];
  return `<nav class="nav nav-pills context-tabs" aria-label="${escapeHtml(t(language, 'reporting.navigation'))}">
    ${links.map(([key, href, label]) => `<a class="nav-link${active === key ? ' active' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`).join('')}
  </nav>`;
}

function renderSummary(summary, language) {
  const items = [
    [t(language, 'reporting.closed_sessions', { sessions: getTerm(language, 'session', 'plural') }), summary.closedSessionCount],
    [t(language, 'reporting.attendance_count', { attendance: getTerm(language, 'attendance', 'plural') }), summary.opportunities],
    [t(language, 'reporting.present_count'), summary.present],
    [t(language, 'reporting.absent_count'), summary.absent],
    [t(language, 'reporting.attendance_rate', { attendance: getTerm(language, 'attendance') }), formatRate(summary.attendanceRate)],
  ];
  if (summary.punctualityApplicable) items.push(
    [t(language, 'reporting.on_time'), summary.onTime],
    [t(language, 'reporting.late'), summary.late],
    [t(language, 'reporting.punctuality_rate'), formatRate(summary.punctualityRate)],
  );
  return renderMetricStrip(items, t(language, 'reporting.summary'), summary.punctualityApplicable ? 'report-summary--punctual' : '');
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

function renderDataTable({ label, headers, rows, language }) {
  if (rows.length === 0) {
    return `<p class="empty-state">${escapeHtml(t(language, 'reporting.no_history'))}</p>`;
  }
  return `<div class="table-responsive data-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(label)}">
    <table class="table table-sm table-hover align-middle mb-0 data-table">
      <thead class="table-light"><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  </div>`;
}

function getGlobalFilters(query, language) {
  const classId = typeof query.class_id === 'string' ? query.class_id : '';
  const dateFrom = typeof query.date_from === 'string' ? query.date_from : '';
  const dateTo = typeof query.date_to === 'string' ? query.date_to : '';
  const error = classId && !isValidPublicId(classId)
    ? t(language, 'reporting.invalid.selection')
    : dateFrom && !isValidDate(dateFrom)
    ? t(language, 'reporting.invalid.start_date')
    : dateTo && !isValidDate(dateTo)
    ? t(language, 'reporting.invalid.end_date')
    : dateFrom && dateTo && dateFrom > dateTo
    ? t(language, 'reporting.invalid.date_order')
    : '';

  return {
    classId: classId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    error,
  };
}

router.get('/', async (request, response) => {
  try {
    const language = request.uiLanguage;
    const classes = await getClassesForFilters();
    const filters = getGlobalFilters(request.query, language);
    if (filters.error) {
      const page = renderMessagePage(t(language, 'reporting.invalid_filters'), filters.error, 400, language);
      return response.status(page.status).send(page.html);
    }
    if (filters.classId && !classes.some((course) => course.public_id === filters.classId)) {
      const page = renderBusinessNotFoundPage('class', language);
      return response.status(page.status).send(page.html);
    }
    // The preview is the same global business report as /export, including its
    // output language and privacy-aware dataset, independent of viewer language.
    const outputLanguage = resolveGlobalReportLanguage({ defaultLanguage: request.internationalization.defaultLanguage });
    const privacyContext = await createReportingPrivacyContext(canViewPii(request), outputLanguage, request.terminology);
    const report = await getGlobalReport(filters, privacyContext);
    const exportQuery = new URLSearchParams();
    if (filters.classId) exportQuery.set('class_id', filters.classId);
    if (filters.dateFrom) exportQuery.set('date_from', filters.dateFrom);
    if (filters.dateTo) exportQuery.set('date_to', filters.dateTo);
    response.send(renderPage(t(language, 'shell.reporting'), `
      ${renderReportHeader({
        title: t(language, 'shell.reporting'),
        description: t(language, 'reporting.description', { attendance: getTerm(language, 'attendance', 'plural'), sessions: getTerm(language, 'session', 'plural') }),
      })}
      ${renderReportingNavigation('overview', language)}
      ${renderPrivacyNotice(request)}
      <div class="reporting-overview">
      <section class="page-section reporting-selection" aria-labelledby="global-export-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2">
          <div>
            <h2 id="global-export-title">${escapeHtml(t(language, 'workspace.selection'))}</h2>
            <p class="section-description">${escapeHtml(t(language, 'workspace.preview_help'))}</p>
          </div>
        </div>
        <form class="app-form report-filter-form" method="get" action="/reporting">
          <div class="form-field">
            <label for="report-class">${businessTerm(language, 'class')}</label>
            <select class="form-select" id="report-class" name="class_id">
              <option value="">${escapeHtml(t(language, 'reporting.no_filter'))}</option>
              ${classes.map((course) => `<option value="${course.public_id}"${filters.classId === course.public_id ? ' selected' : ''}>${escapeHtml(course.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="report-date-from">${escapeHtml(t(language, 'reporting.from'))}</label>
            <input class="form-control" id="report-date-from" name="date_from" type="date" value="${escapeHtml(filters.dateFrom || '')}">
          </div>
          <div class="form-field">
            <label for="report-date-to">${escapeHtml(t(language, 'reporting.to'))}</label>
            <input class="form-control" id="report-date-to" name="date_to" type="date" value="${escapeHtml(filters.dateTo || '')}">
          </div>
          <button class="btn btn-outline-secondary" type="submit">${escapeHtml(t(language, 'workspace.preview'))}</button>
        </form>
        <div class="report-preview" lang="${outputLanguage}" data-report-preview>
          <div class="report-preview-heading"><h2>${escapeHtml(t(outputLanguage, 'workspace.report_preview'))}</h2></div>
          ${renderSummary(report.summary, outputLanguage)}
          ${report.summary.closedSessionCount === 0 ? `<p class="empty-state">${escapeHtml(t(outputLanguage, 'reporting.no_history'))}</p>` : ''}
        </div>
        <div class="form-actions report-export-actions"><a class="btn btn-primary" href="/reporting/export?${escapeHtml(exportQuery.toString())}">${renderIcon('download')}${escapeHtml(t(language, 'reporting.export_excel'))}</a>${exportQuery.size ? `<a class="btn btn-light" href="/reporting">${escapeHtml(t(language, 'action.reset'))}</a>` : ''}</div>
      </section>
      <section class="page-section reporting-browse" aria-labelledby="reporting-access-title">
        <div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="reporting-access-title">${escapeHtml(t(language, 'reporting.browse'))}</h2></div></div>
        <div class="list-group compact-list">
          <a class="list-group-item compact-row report-navigation-row" href="/reporting/courses">
            <div class="compact-identity"><p class="compact-title">${escapeHtml(t(language, 'reporting.by_class', { class: businessTerm(language, 'class') }))}</p><p class="compact-meta">${escapeHtml(t(language, 'reporting.by_class_help', { session: businessTerm(language, 'session'), student: businessTerm(language, 'student') }))}</p></div>
          </a>
          <a class="list-group-item compact-row report-navigation-row" href="/reporting/sessions">
            <div class="compact-identity"><p class="compact-title">${escapeHtml(t(language, 'reporting.by_session', { session: businessTerm(language, 'session') }))}</p><p class="compact-meta">${escapeHtml(t(language, 'reporting.by_session_help', { sessions: businessTerm(language, 'session', 'plural') }))}</p></div>
          </a>
          <a class="list-group-item compact-row report-navigation-row" href="/reporting/students">
            <div class="compact-identity"><p class="compact-title">${escapeHtml(t(language, 'reporting.by_student', { student: businessTerm(language, 'student') }))}</p><p class="compact-meta">${escapeHtml(t(language, canViewPii(request) ? 'reporting.by_student_identified_help' : 'reporting.by_student_private_help', canViewPii(request) ? { sessions: businessTerm(language, 'session', 'plural') } : { class: businessTerm(language, 'class') }))}</p></div>
          </a>
        </div>
      </section>
      </div>`, { language }));
  } catch (error) {
    console.error('Unable to load reporting:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.unavailable'), t(request.uiLanguage, 'reporting.error.load'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/courses', async (request, response) => {
  const language = request.uiLanguage;
  try {
    const courses = await getCourseSummaries();
    const content = courses.length === 0
      ? `<p class="empty-state">${escapeHtml(t(language, 'reporting.no_class_data', { classes: businessTerm(language, 'class', 'plural') }))}</p>`
      : `<section data-filterable-list>
          ${renderCollectionTools({ language, id: 'report-course-list', count: courses.length, placeholder: t(language, 'reporting.search_name_placeholder') })}
          <p class="empty-state" data-list-no-results hidden>${escapeHtml(t(language, 'common.no_results'))}</p>
          <div class="list-group compact-list" id="report-course-list" data-list-results>${courses.map((course) => `
            <article class="list-group-item compact-row compact-row-status report-row" data-list-row data-search="${escapeHtml(course.name.toLocaleLowerCase())}">
              <div class="compact-identity"><p class="compact-title"><a href="/reporting/courses/${course.public_id}">${escapeHtml(course.name)}</a></p><p class="compact-meta">${escapeHtml(t(language, 'reporting.summary_closed', { sessions: businessTerm(language, 'session', 'plural'), count: course.closedSessionCount, attendance: businessTerm(language, 'attendance', 'plural'), opportunities: course.opportunities }))}</p></div>
              <div class="compact-status"><strong class="report-rate">${formatRate(course.attendanceRate)}</strong><span class="compact-meta">${escapeHtml(t(language, 'reporting.count_present_absent', { present: course.present, absent: course.absent }))}</span></div>
              <div class="compact-actions"><a class="btn btn-outline-secondary" href="/reporting/courses/${course.public_id}">${escapeHtml(t(language, 'reporting.view_report'))}</a></div>
            </article>`).join('')}</div>
        </section>`;
    response.send(renderPage(t(language, 'reporting.by_class', { class: getTerm(language, 'class') }), `
      ${renderReportHeader({ title: t(language, 'reporting.by_class', { class: getTerm(language, 'class') }), description: t(language, 'reporting.class_description', { sessions: getTerm(language, 'session', 'plural'), class: getTerm(language, 'class') }) })}
      ${renderReportingNavigation('courses', language)}
      ${renderPrivacyNotice(request)}
      ${content}`, { language }));
  } catch (error) {
    console.error('Unable to load course reporting:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.unavailable'), t(request.uiLanguage, 'reporting.error.load_by', { subject: getTerm(language, 'class') }), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/courses/:id/export', async (request, response) => {
  if (!isValidPublicId(request.params.id)) {
    const page = renderBusinessNotFoundPage('class', request.uiLanguage);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const languageResult = await pool.query('SELECT language FROM classes WHERE public_id = $1', [request.params.id]);
    if (languageResult.rowCount === 0) {
      const page = renderBusinessNotFoundPage('class', request.uiLanguage);
      response.status(page.status).send(page.html);
      return;
    }
    const outputLanguage = resolveClassReportLanguage({
      classLanguage: languageResult.rows[0].language,
      defaultLanguage: request.internationalization.defaultLanguage,
    });
    const privacyContext = await createReportingPrivacyContext(canViewPii(request), outputLanguage, request.terminology);
    const report = await getCourseReport(request.params.id, privacyContext);
    if (!report) {
      const page = renderBusinessNotFoundPage('class', request.uiLanguage);
      response.status(page.status).send(page.html);
      return;
    }
    await sendWorkbook(
      response,
      buildCourseWorkbook(report, {
        language: outputLanguage,
        terminology: request.terminology,
      }),
      `${t(outputLanguage, 'reporting.filename.course')}-${safeFilenamePart(report.course.name, 'course')}.xlsx`,
    );
  } catch (error) {
    console.error('Unable to export course reporting:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.export_title'), t(request.uiLanguage, 'reporting.error.export'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/courses/:id', async (request, response) => {
  const language = request.uiLanguage;
  if (!isValidPublicId(request.params.id)) {
    const page = renderBusinessNotFoundPage('class', request.uiLanguage);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const privacyContext = await createReportingPrivacyContext(canViewPii(request), request.uiLanguage, request.terminology);
    const report = await getCourseReport(request.params.id, privacyContext);
    if (!report) {
      const page = renderBusinessNotFoundPage('class', request.uiLanguage);
      response.status(page.status).send(page.html);
      return;
    }
    const sessionRows = report.sessions.map((session) => `<tr>
      <td>${escapeHtml(formatDateForDisplay(session.date))}</td>
      <td><a href="/sessions/${session.public_id}">${escapeHtml(session.title)}</a></td>
      <td>${escapeHtml(session.instructor)}</td>
      <td>${session.start_time ? escapeHtml(normalizeClockTime(session.start_time)) : '—'}</td>
      <td class="numeric">${session.opportunities}</td><td class="numeric">${session.present}</td><td class="numeric">${session.absent}</td><td class="numeric">${formatRate(session.attendanceRate)}</td>
      <td class="numeric">${session.punctualityApplicable ? session.onTime : '—'}</td>
      <td class="numeric">${session.punctualityApplicable ? session.late : '—'}</td>
      <td class="numeric">${session.punctualityApplicable ? formatRate(session.punctualityRate) : '—'}</td>
    </tr>`);
    const studentRows = report.students.map((student) => `<tr>
      <td>${report.canViewPii ? `<a href="/reporting/students/${student.public_id}">${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}</a>` : escapeHtml(student.participant_label)}</td>
      ${report.canViewPii ? `<td><span class="student-code" translate="no">${escapeHtml(student.student_code)}</span></td>` : ''}
      <td class="numeric">${student.closedSessionCount}</td><td class="numeric">${student.present}</td><td class="numeric">${student.absent}</td><td class="numeric">${formatRate(student.attendanceRate)}</td>
    </tr>`);

    response.send(renderPage(t(request.uiLanguage, 'reporting.report_of', { name: report.course.name }), `
      ${renderReportHeader({
        eyebrow: t(request.uiLanguage, 'reporting.by_class', { class: getTerm(language, 'class') }),
        title: report.course.name,
        description: t(request.uiLanguage, 'reporting.official_only', { sessions: getTerm(language, 'session', 'plural') }),
        action: `<div class="context-actions d-flex flex-wrap gap-2"><a class="btn btn-primary" href="/reporting/courses/${report.course.public_id}/export">${escapeHtml(t(request.uiLanguage, 'reporting.export_excel'))}</a><a class="btn btn-light" href="/reporting/courses">${escapeHtml(t(request.uiLanguage, 'reporting.back_list'))}</a></div>`,
      })}
      ${renderReportingNavigation('courses', request.uiLanguage)}
      ${renderPrivacyNotice(request)}
      ${renderSummary(report.summary, request.uiLanguage)}
      <section class="page-section" aria-labelledby="course-session-breakdown"><div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="course-session-breakdown">${escapeHtml(t(request.uiLanguage, 'reporting.by', { subject: businessTerm(language, 'session') }))}</h2></div></div>
        ${renderDataTable({ label: t(request.uiLanguage, 'reporting.detail_by', { subject: getTerm(language, 'session') }), headers: [t(request.uiLanguage, 'common.date'), getTerm(language, 'session'), getTerm(language, 'instructor'), t(request.uiLanguage, 'reporting.start'), t(request.uiLanguage, 'reporting.expected'), t(request.uiLanguage, 'reporting.present_count'), t(request.uiLanguage, 'reporting.absent_count'), t(request.uiLanguage, 'reporting.rate'), t(request.uiLanguage, 'reporting.on_time'), t(request.uiLanguage, 'reporting.delays'), t(request.uiLanguage, 'reporting.punctuality')], rows: sessionRows, language: request.uiLanguage })}
      </section>
      <section class="page-section" aria-labelledby="course-student-breakdown"><div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="course-student-breakdown">${escapeHtml(t(request.uiLanguage, 'reporting.by', { subject: businessTerm(language, 'student') }))}</h2></div></div>
        ${renderDataTable({ label: t(request.uiLanguage, 'reporting.detail_by', { subject: getTerm(language, 'student') }), headers: [getTerm(language, 'student'), ...(report.canViewPii ? [t(request.uiLanguage, 'report.column.code')] : []), getTerm(language, 'session', 'plural'), getTerm(language, 'attendance', 'plural'), t(request.uiLanguage, 'reporting.absences'), t(request.uiLanguage, 'reporting.rate')], rows: studentRows, language: request.uiLanguage })}
      </section>`, { language: request.uiLanguage }));
  } catch (error) {
    console.error('Unable to load course report:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.unavailable'), t(request.uiLanguage, 'reporting.error.report'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/sessions', async (request, response) => {
  const language = request.uiLanguage;
  try {
    const sessions = await getSessionSummaries();
    const content = sessions.length === 0
      ? `<p class="empty-state">${escapeHtml(t(language, 'reporting.no_closed_sessions', { session: businessTerm(language, 'session') }))}</p>`
      : `<section data-filterable-list>
          ${renderCollectionTools({ language, id: 'report-session-list', count: sessions.length, placeholder: t(language, 'reporting.search_session_placeholder', { class: getTerm(language, 'class'), instructor: getTerm(language, 'instructor') }) })}
          <p class="empty-state" data-list-no-results hidden>${escapeHtml(t(language, 'common.no_results'))}</p>
          <div class="list-group compact-list" id="report-session-list" data-list-results>${sessions.map((session) => `
            <article class="list-group-item compact-row compact-row-status session-row collection-row report-row" data-list-row data-search="${escapeHtml(`${session.title} ${session.class_name} ${session.instructor}`.toLocaleLowerCase())}">
              <div class="compact-identity session-identity"><p class="compact-meta session-date">${escapeHtml(formatDateForDisplay(session.date))}</p><p class="compact-title"><a href="/sessions/${session.public_id}">${escapeHtml(session.title)}</a></p><p class="compact-meta">${escapeHtml(session.class_name)} · ${escapeHtml(session.instructor)}</p></div>
              <div class="compact-status"><span class="badge status-badge status-closed">${escapeHtml(t(language, 'reporting.state_closed'))}</span><strong class="report-rate">${formatRate(session.attendanceRate)}</strong><span class="compact-meta">${escapeHtml(t(language, 'reporting.session_counts', { present: session.present, total: session.opportunities }))}${session.punctualityApplicable ? ` · ${escapeHtml(t(language, 'reporting.punctual_counts', { onTime: session.onTime, late: session.late }))}` : ''}</span></div>
              <div class="compact-actions report-direct-actions"><a class="btn btn-light" href="/sessions/${session.public_id}">${escapeHtml(t(language, 'reporting.view_session', { session: getTerm(language, 'session') }))}</a><a class="btn btn-outline-secondary" href="/reporting/sessions/${session.public_id}/export">${renderIcon('download')}${escapeHtml(t(language, 'reporting.export_excel'))}</a></div>
            </article>`).join('')}</div>
        </section>`;
    response.send(renderPage(t(language, 'reporting.by_session', { session: getTerm(language, 'session') }), `
      ${renderReportHeader({ title: t(language, 'reporting.by_session', { session: getTerm(language, 'session') }), description: t(language, 'reporting.sessions_description', { sessions: getTerm(language, 'session', 'plural') }) })}
      ${renderReportingNavigation('sessions', language)}
      ${renderPrivacyNotice(request)}
      ${content}`, { language }));
  } catch (error) {
    console.error('Unable to load session reporting:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.unavailable'), t(request.uiLanguage, 'reporting.error.load_by', { subject: getTerm(language, 'session') }), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/sessions/:id/export', async (request, response) => {
  if (!isValidPublicId(request.params.id)) {
    const page = renderBusinessNotFoundPage('session', request.uiLanguage);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const languageResult = await pool.query(
      `SELECT cs.language, c.language AS class_language
       FROM course_sessions cs INNER JOIN classes c ON c.id = cs.class_id
       WHERE cs.public_id = $1`,
      [request.params.id],
    );
    if (languageResult.rowCount === 0) {
      const page = renderBusinessNotFoundPage('session', request.uiLanguage);
      response.status(page.status).send(page.html);
      return;
    }
    const outputLanguage = resolveSessionReportLanguage({
      sessionLanguage: languageResult.rows[0].language,
      classLanguage: languageResult.rows[0].class_language,
      defaultLanguage: request.internationalization.defaultLanguage,
    });
    const privacyContext = await createReportingPrivacyContext(canViewPii(request), outputLanguage, request.terminology);
    const report = await getSessionReport(request.params.id, privacyContext);
    if (!report) {
      const page = renderBusinessNotFoundPage('session', request.uiLanguage);
      response.status(page.status).send(page.html);
      return;
    }
    if (report.session.state !== 'closed') {
      const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.export_unavailable'), t(request.uiLanguage, 'reporting.closed_required', { session: getTerm(request.uiLanguage, 'session') }), 409, request.uiLanguage);
      response.status(page.status).send(page.html);
      return;
    }
    const date = formatDateForInput(report.session.date);
    await sendWorkbook(
      response,
      buildSessionWorkbook(report, {
        language: outputLanguage,
        terminology: request.terminology,
      }),
      `${t(outputLanguage, 'reporting.filename.session')}-${safeFilenamePart(date, 'date')}-${safeFilenamePart(report.session.title, 'session')}.xlsx`,
    );
  } catch (error) {
    console.error('Unable to export session reporting:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.export_title'), t(request.uiLanguage, 'reporting.error.export'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/students', async (request, response) => {
  const language = request.uiLanguage;
  try {
    const identified = canViewPii(request);
    const privacyContext = await createReportingPrivacyContext(identified, request.uiLanguage, request.terminology);
    const students = await getStudentSummaries(privacyContext);
    const content = students.length === 0
      ? `<p class="empty-state">${escapeHtml(t(language, 'reporting.no_student_history', { students: businessTerm(language, 'student', 'plural') }))}</p>`
      : `<section data-filterable-list>
          ${renderCollectionTools({ language, id: 'report-student-list', count: students.length, placeholder: t(language, identified ? 'reporting.search_identified' : 'reporting.search_private', identified ? {} : { class: getTerm(language, 'class') }) })}
          <p class="empty-state" data-list-no-results hidden>${escapeHtml(t(language, 'common.no_results'))}</p>
          <div class="list-group compact-list" id="report-student-list" data-list-results>${students.map((student) => `
            <article class="list-group-item compact-row compact-row-status student-row report-row" data-list-row data-search="${escapeHtml((identified ? `${student.first_name} ${student.last_name} ${student.student_code}` : `${student.participant_label} ${student.class_name}`).toLocaleLowerCase())}">
              <div class="compact-identity student-identity"><p class="compact-title">${escapeHtml(identified ? `${student.first_name} ${student.last_name}` : student.participant_label)}</p><p class="compact-meta">${identified ? `<span class="student-code" translate="no">${escapeHtml(student.student_code)}</span> · ` : `${escapeHtml(student.class_name)} · `}${escapeHtml(t(language, 'reporting.student_sessions', { count: student.closedSessionCount, sessions: businessTerm(language, 'session', student.closedSessionCount === 1 ? 'singular' : 'plural') }))}</p></div>
              <div class="compact-status"><strong class="report-rate">${formatRate(student.attendanceRate)}</strong><span class="compact-meta">${escapeHtml(t(language, 'reporting.count_present_absent', { present: student.present, absent: student.absent }))}</span></div>
              ${identified ? `<div class="compact-actions"><a class="btn btn-outline-secondary" href="/reporting/students/${student.public_id}">${escapeHtml(t(language, 'reporting.view_report'))}</a></div>` : ''}
            </article>`).join('')}</div>
        </section>`;
    response.send(renderPage(t(language, 'reporting.by_student', { student: getTerm(language, 'student') }), `
      ${renderReportHeader({ title: t(language, 'reporting.by_student', { student: getTerm(language, 'student') }), description: identified ? t(language, 'reporting.students_identified_description', { sessions: getTerm(language, 'session', 'plural') }) : t(language, 'reporting.students_private_description', { class: getTerm(language, 'class') }) })}
      ${renderReportingNavigation('students', language)}
      ${renderPrivacyNotice(request)}
      ${content}`, { language }));
  } catch (error) {
    console.error('Unable to load student reporting:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.unavailable'), t(request.uiLanguage, 'reporting.error.load_by', { subject: getTerm(language, 'student') }), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/students/:id/export', async (request, response) => {
  if (!canViewPii(request)) {
    const page = renderPiiRequiredPage(request.uiLanguage);
    response.status(page.status).send(page.html);
    return;
  }
  if (!isValidPublicId(request.params.id)) {
    const page = renderBusinessNotFoundPage('student', request.uiLanguage);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const report = await getStudentReport(request.params.id);
    if (!report) {
      const page = renderBusinessNotFoundPage('student', request.uiLanguage);
      response.status(page.status).send(page.html);
      return;
    }
    const outputLanguage = resolveParticipantReportLanguage({
      participantLanguage: report.student.language,
      defaultLanguage: request.internationalization.defaultLanguage,
    });
    await sendWorkbook(
      response,
      buildStudentWorkbook(report, {
        language: outputLanguage,
        terminology: request.terminology,
      }),
      `${t(outputLanguage, 'reporting.filename.participant')}-${safeFilenamePart(`${report.student.first_name}-${report.student.last_name}`, 'participant')}.xlsx`,
    );
  } catch (error) {
    console.error('Unable to export student reporting:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.export_title'), t(request.uiLanguage, 'reporting.error.export'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/students/:id', async (request, response) => {
  const language = request.uiLanguage;
  if (!canViewPii(request)) {
    const page = renderPiiRequiredPage(request.uiLanguage);
    response.status(page.status).send(page.html);
    return;
  }
  if (!isValidPublicId(request.params.id)) {
    const page = renderBusinessNotFoundPage('student', request.uiLanguage);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    const report = await getStudentReport(request.params.id);
    if (!report) {
      const page = renderBusinessNotFoundPage('student', request.uiLanguage);
      response.status(page.status).send(page.html);
      return;
    }
    const studentName = `${report.student.first_name} ${report.student.last_name}`;
    const rows = report.details.map((row) => `<tr>
      <td>${escapeHtml(formatDateForDisplay(row.date))}</td><td>${escapeHtml(row.class_name)}</td><td><a href="/sessions/${row.session_public_id}">${escapeHtml(row.title)}</a></td><td>${escapeHtml(row.instructor)}</td><td>${row.start_time ? escapeHtml(normalizeClockTime(row.start_time)) : '—'}</td><td><span class="badge status-badge status-${row.status}">${escapeHtml(getStatusLabel(row.status, request.uiLanguage))}</span></td><td>${row.status === 'present' ? escapeHtml(formatLocalTime(row.checked_in_at) || t(request.uiLanguage, 'reporting.unknown_arrival')) : '—'}</td><td class="numeric">${row.punctuality.available ? row.punctuality.delayMinutes : '—'}</td><td>${escapeHtml(formatPunctualityLabel(row.punctuality, request.uiLanguage))}</td>
    </tr>`);
    response.send(renderPage(t(request.uiLanguage, 'reporting.report_of', { name: studentName }), `
      ${renderReportHeader({
        eyebrow: t(request.uiLanguage, 'reporting.by_student', { student: getTerm(language, 'student') }),
        title: studentName,
        description: t(request.uiLanguage, 'reporting.identification_code', { code: report.student.student_code }),
        action: `<div class="context-actions d-flex flex-wrap gap-2"><a class="btn btn-primary" href="/reporting/students/${report.student.public_id}/export">${escapeHtml(t(request.uiLanguage, 'reporting.export_excel'))}</a><a class="btn btn-light" href="/reporting/students">${escapeHtml(t(request.uiLanguage, 'reporting.back_list'))}</a></div>`,
      })}
      ${renderReportingNavigation('students', request.uiLanguage)}
      ${renderSummary(report.summary, request.uiLanguage)}
      <section class="page-section" aria-labelledby="student-history-title"><div class="section-header d-flex flex-column flex-sm-row align-items-sm-start justify-content-between gap-2"><div><h2 id="student-history-title">${escapeHtml(t(request.uiLanguage, 'reporting.attendance_history', { attendance: businessTerm(language, 'attendance', 'plural') }))}</h2></div></div>
        ${renderDataTable({ label: t(request.uiLanguage, 'reporting.history_for', { name: studentName }), headers: [t(request.uiLanguage, 'common.date'), getTerm(language, 'class'), getTerm(language, 'session'), getTerm(language, 'instructor'), t(request.uiLanguage, 'reporting.start'), t(request.uiLanguage, 'common.status'), t(request.uiLanguage, 'reporting.arrival'), t(request.uiLanguage, 'reporting.delta_minutes'), t(request.uiLanguage, 'reporting.punctuality')], rows, language: request.uiLanguage })}
      </section>`, { language: request.uiLanguage }));
  } catch (error) {
    console.error('Unable to load student report:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.unavailable'), t(request.uiLanguage, 'reporting.error.report'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

router.get('/export', async (request, response) => {
  const filters = getGlobalFilters(request.query, request.uiLanguage);
  if (filters.error) {
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.invalid_filters'), filters.error, 400, request.uiLanguage);
    response.status(page.status).send(page.html);
    return;
  }
  try {
    if (filters.classId) {
      const classes = await getClassesForFilters();
      if (!classes.some((course) => course.public_id === filters.classId)) {
        const page = renderBusinessNotFoundPage('class', request.uiLanguage);
        response.status(page.status).send(page.html);
        return;
      }
    }
    const outputLanguage = resolveGlobalReportLanguage({
      defaultLanguage: request.internationalization.defaultLanguage,
    });
    const privacyContext = await createReportingPrivacyContext(canViewPii(request), outputLanguage, request.terminology);
    const report = await getGlobalReport(filters, privacyContext);
    const parts = [t(outputLanguage, 'reporting.filename.global')];
    if (filters.dateFrom) parts.push(t(outputLanguage, 'reporting.filename.from', { date: filters.dateFrom }));
    if (filters.dateTo) parts.push(t(outputLanguage, 'reporting.filename.until', { date: filters.dateTo }));
    await sendWorkbook(response, buildGlobalWorkbook(report, {
      language: outputLanguage,
      terminology: request.terminology,
    }), `${parts.join('-')}.xlsx`);
  } catch (error) {
    console.error('Unable to export global reporting:', error);
    const page = renderMessagePage(t(request.uiLanguage, 'reporting.error.export_title'), t(request.uiLanguage, 'reporting.error.export'), 500, request.uiLanguage);
    response.status(page.status).send(page.html);
  }
});

module.exports = router;
