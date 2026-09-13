const { recordAuditEventSafely } = require('./audit');
const { getEffectiveLogoForClass } = require('./branding');
const { formatLocalTime, formatPercent, normalizeClockTime } = require('./application-time');
const { pool } = require('./db/client');
const { formatDateForDisplay } = require('./date-format');
const { sendMail } = require('./mail');
const { getSessionReport } = require('./reporting-data');
const { buildSessionWorkbook, safeFilenamePart } = require('./reporting-excel');
const { normalizeEmail } = require('./session-summary-config');
const { getTerm, loadTerminology } = require('./terminology');
const { escapeHtml } = require('./ui');
const { resolveSessionSummaryLanguage, t } = require('./i18n');

const logoContentId = 'session-summary-logo@attendance-log';

function percentage(value) {
  return value === null || value === undefined
    ? '—'
    : formatPercent(value);
}

async function resolveSessionSummaryDelivery(sessionPublicId, client = pool) {
  const sessionResult = await client.query(
    `SELECT cs.id, cs.public_id, cs.state, cs.summary_attach_xlsx_override, cs.language,
            c.id AS class_id, c.public_id AS class_public_id,
            c.summary_attach_xlsx AS class_attach_xlsx, c.language AS class_language,
            settings.default_language
     FROM course_sessions cs
     INNER JOIN classes c ON c.id = cs.class_id
     CROSS JOIN international_settings settings
     WHERE cs.public_id = $1`,
    [sessionPublicId],
  );
  if (sessionResult.rowCount === 0) return null;
  const session = sessionResult.rows[0];
  const result = await client.query(
    `SELECT email FROM (
       SELECT u.email
       FROM class_summary_admin_recipients r
       INNER JOIN admin_users u ON u.id = r.admin_user_id
       WHERE r.class_id = $1 AND u.active = TRUE AND u.account_type = 'otp' AND u.email IS NOT NULL
       UNION ALL
       SELECT email FROM class_summary_external_recipients WHERE class_id = $1
       UNION ALL
       SELECT u.email
       FROM session_summary_admin_recipients r
       INNER JOIN admin_users u ON u.id = r.admin_user_id
       WHERE r.session_id = $2 AND u.active = TRUE AND u.account_type = 'otp' AND u.email IS NOT NULL
       UNION ALL
       SELECT email FROM session_summary_external_recipients WHERE session_id = $2
     ) recipients`,
    [session.class_id, session.id],
  );
  const recipients = [...new Set(result.rows.map((row) => normalizeEmail(row.email)).filter(Boolean))];
  return {
    session,
    recipients,
    attachXlsx: session.summary_attach_xlsx_override === null
      ? session.class_attach_xlsx
      : session.summary_attach_xlsx_override,
  };
}

function attendanceStatus(row, language) {
  return ['present', 'absent', 'pending'].includes(row.status) ? t(language, `status.${row.status}`) : row.status;
}

function punctualityStatus(row, language) {
  if (!row.punctuality?.available) return '—';
  return row.punctuality.status === 'late' ? `+${row.punctuality.delayMinutes} min` : t(language, 'status.on_time');
}

function createSessionSummaryEmail(report, logo = null, language = 'en', terminology) {
  const classTerm = getTerm(language, 'class', 'singular', terminology);
  const sessionTerm = getTerm(language, 'session', 'singular', terminology);
  const studentTerm = getTerm(language, 'student', 'singular', terminology);
  const studentPlural = getTerm(language, 'student', 'plural', terminology);
  const attendancePlural = getTerm(language, 'attendance', 'plural', terminology);
  const date = formatDateForDisplay(report.session.date);
  const startTime = normalizeClockTime(report.session.start_time || '');
  const rowsText = report.details.map((row) => {
    const arrival = row.status === 'present' ? formatLocalTime(row.checked_in_at) || t(language, 'summary.email.arrival_unknown') : '—';
    return t(language, 'summary.email.row', {
      participant: `${row.first_name} ${row.last_name}`,
      status: attendanceStatus(row, language),
      arrival,
      punctuality: punctualityStatus(row, language),
    });
  });
  const punctualityText = report.summary.punctualityApplicable
    ? [
      t(language, 'summary.email.on_time_count', { count: report.summary.onTime }),
      t(language, 'summary.email.late_count', { count: report.summary.late }),
      t(language, 'summary.email.punctuality_rate', { rate: percentage(report.summary.punctualityRate) }),
    ]
    : [];
  const detailRows = report.details.map((row) => {
    const arrival = row.status === 'present' ? formatLocalTime(row.checked_in_at) || t(language, 'common.unknown') : '—';
    return `<tr>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(`${row.first_name} ${row.last_name}`)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(attendanceStatus(row, language))}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(arrival)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(punctualityStatus(row, language))}</td>
    </tr>`;
  }).join('');

  return {
    subject: t(language, 'summary.email.subject', { attendance: attendancePlural, session: report.session.title }),
    text: [
      'Attendance Log', '',
      t(language, 'summary.email.for_session', { attendance: attendancePlural, session: report.session.title }),
      `${classTerm} : ${report.session.class_name}`,
      `${sessionTerm} : ${report.session.title}`,
      t(language, 'summary.email.date', { date }),
      ...(startTime ? [t(language, 'summary.email.start_time', { time: startTime })] : []),
      '',
      t(language, 'summary.email.participant_count', { participants: studentPlural, count: report.summary.opportunities }),
      t(language, 'summary.email.present_count', { count: report.summary.present }),
      t(language, 'summary.email.absent_count', { count: report.summary.absent }),
      ...punctualityText,
      '',
      ...rowsText,
    ].join('\n'),
    html: `<!doctype html>
<html lang="${language}"><body style="margin:0;padding:0;background:#f8fafc;color:#172033;font-family:Arial,sans-serif;">
  <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
    <div style="padding:24px;border:1px solid #dbe2ea;border-radius:8px;background:#ffffff;">
      ${logo?.data ? `<div style="margin:0 0 16px;"><img src="cid:${logoContentId}" width="200" height="72" alt="${escapeHtml(t(language, 'summary.email.organization_logo'))}" style="display:block;width:auto;max-width:200px;height:auto;max-height:72px;"></div>` : ''}
      <p style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.3;">Attendance Log</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;">${escapeHtml(t(language, 'summary.email.title', { attendance: attendancePlural }))}</h1>
      <p style="margin:0 0 4px;"><strong>${escapeHtml(classTerm)} :</strong> ${escapeHtml(report.session.class_name)}</p>
      <p style="margin:0 0 4px;"><strong>${escapeHtml(sessionTerm)} :</strong> ${escapeHtml(report.session.title)}</p>
      <p style="margin:0 0 4px;">${escapeHtml(t(language, 'summary.email.date', { date }))}</p>
      ${startTime ? `<p style="margin:0 0 4px;">${escapeHtml(t(language, 'summary.email.start_time', { time: startTime }))}</p>` : ''}
      <div style="margin:18px 0;padding:12px 14px;background:#f1f5f9;border-radius:6px;line-height:1.55;">
        <strong>${escapeHtml(t(language, 'summary.email.total_line', { present: report.summary.present, absent: report.summary.absent, total: report.summary.opportunities }))}</strong>
        ${report.summary.punctualityApplicable ? `<br>${escapeHtml(t(language, 'summary.email.punctuality_line', { onTime: report.summary.onTime, late: report.summary.late, rate: percentage(report.summary.punctualityRate) }))}` : ''}
      </div>
      <div style="overflow-x:auto;"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.4;">
        <thead><tr><th style="padding:7px 8px;text-align:left;border-bottom:2px solid #cbd5e1;">${escapeHtml(studentTerm)}</th><th style="padding:7px 8px;text-align:left;border-bottom:2px solid #cbd5e1;">${escapeHtml(t(language, 'summary.email.status'))}</th><th style="padding:7px 8px;text-align:left;border-bottom:2px solid #cbd5e1;">${escapeHtml(t(language, 'summary.email.arrival'))}</th><th style="padding:7px 8px;text-align:left;border-bottom:2px solid #cbd5e1;">${escapeHtml(t(language, 'summary.email.punctuality'))}</th></tr></thead>
        <tbody>${detailRows}</tbody>
      </table></div>
    </div>
  </div>
</body></html>`,
    logoAttachment: logo?.data ? {
      filename: 'logo-organisation.png', content: logo.data, contentType: logo.mimeType,
      contentDisposition: 'inline', cid: logoContentId,
    } : null,
  };
}

async function auditDelivery({ report, source, result, recipientCount, attachmentIncluded, errorCode }) {
  await recordAuditEventSafely({
    category: 'session',
    action: source === 'automatic' ? 'session.summary.send' : 'session.summary.resend',
    result,
    targetType: 'session',
    targetPublicId: report?.session.public_id || null,
    targetLabel: report?.session.title || null,
    summary: result === 'success' ? 'Résumé des présences envoyé.' : 'Échec de l’envoi du résumé des présences.',
    metadata: {
      source,
      recipient_count: recipientCount,
      attachment_included: attachmentIncluded,
      ...(errorCode ? { error_code: errorCode } : {}),
    },
  });
}

async function sendSessionSummary(sessionPublicId, {
  source = 'automatic',
  deliver = sendMail,
  workbookBuilder = buildSessionWorkbook,
} = {}) {
  let delivery;
  let report;
  try {
    delivery = await resolveSessionSummaryDelivery(sessionPublicId);
    if (!delivery) return { status: 'not_found' };
    if (delivery.session.state !== 'closed') return { status: 'not_closed' };
    if (delivery.recipients.length === 0) return { status: 'no_recipients' };
    report = await getSessionReport(sessionPublicId);
    if (!report) return { status: 'not_found' };
    const logo = await getEffectiveLogoForClass(delivery.session.class_public_id);
    const language = resolveSessionSummaryLanguage({
      sessionLanguage: delivery.session.language,
      classLanguage: delivery.session.class_language,
      defaultLanguage: delivery.session.default_language,
    });
    const terminology = await loadTerminology();
    const message = createSessionSummaryEmail(report, logo, language, terminology);
    const attachments = message.logoAttachment ? [message.logoAttachment] : [];
    if (delivery.attachXlsx) {
      const workbook = workbookBuilder(report, {
        includeParticipantEmail: false, language, terminology,
      });
      const buffer = await workbook.xlsx.writeBuffer();
      attachments.push({
        filename: `${t(language, 'summary.email.attachment_prefix')}-${safeFilenamePart(report.session.title, 'session')}.xlsx`,
        content: Buffer.from(buffer),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentDisposition: 'attachment',
      });
    }
    await deliver({
      bcc: delivery.recipients,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments,
    });
    await auditDelivery({
      report, source, result: 'success', recipientCount: delivery.recipients.length,
      attachmentIncluded: delivery.attachXlsx,
    });
    return {
      status: 'sent', recipientCount: delivery.recipients.length,
      attachmentIncluded: delivery.attachXlsx,
    };
  } catch (error) {
    const errorCode = error.code || 'SESSION_SUMMARY_FAILED';
    try {
      console.error('Unable to send attendance summary:', errorCode);
    } catch (_loggingError) {}
    await auditDelivery({
      report, source, result: 'failed', recipientCount: delivery?.recipients.length || 0,
      attachmentIncluded: Boolean(delivery?.attachXlsx), errorCode,
    });
    return { status: 'failed', errorCode };
  }
}

module.exports = {
  createSessionSummaryEmail,
  resolveSessionSummaryDelivery,
  sendSessionSummary,
};
