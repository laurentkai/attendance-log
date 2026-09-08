const { recordAuditEventSafely } = require('./audit');
const { getEffectiveLogoForClass } = require('./branding');
const { formatLocalTime, normalizeClockTime } = require('./application-time');
const { pool } = require('./db/client');
const { formatDateForDisplay } = require('./date-format');
const { sendMail } = require('./mail');
const { getSessionReport } = require('./reporting-data');
const { buildSessionWorkbook, safeFilenamePart } = require('./reporting-excel');
const { normalizeEmail } = require('./session-summary-config');
const { getTerm } = require('./terminology');
const { escapeHtml } = require('./ui');

const logoContentId = 'session-summary-logo@attendance-log';

function percentage(value) {
  return value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('fr-BE', { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

async function resolveSessionSummaryDelivery(sessionPublicId, client = pool) {
  const sessionResult = await client.query(
    `SELECT cs.id, cs.public_id, cs.state, cs.summary_attach_xlsx_override,
            c.id AS class_id, c.public_id AS class_public_id,
            c.summary_attach_xlsx AS class_attach_xlsx
     FROM course_sessions cs
     INNER JOIN classes c ON c.id = cs.class_id
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

function attendanceStatus(row) {
  return row.status === 'present' ? 'Présent' : row.status === 'absent' ? 'Absent' : 'En attente';
}

function punctualityStatus(row) {
  if (!row.punctuality?.available) return '—';
  return row.punctuality.status === 'late' ? `+${row.punctuality.delayMinutes} min` : 'À l’heure';
}

function createSessionSummaryEmail(report, logo = null) {
  const classTerm = getTerm('class');
  const sessionTerm = getTerm('session');
  const studentTerm = getTerm('student');
  const studentPlural = getTerm('student', 'plural');
  const date = formatDateForDisplay(report.session.date);
  const startTime = normalizeClockTime(report.session.start_time || '');
  const rowsText = report.details.map((row) => {
    const arrival = row.status === 'present' ? formatLocalTime(row.checked_in_at) || 'inconnue' : '—';
    return `${row.first_name} ${row.last_name} — ${attendanceStatus(row)} — arrivée : ${arrival} — ponctualité : ${punctualityStatus(row)}`;
  });
  const punctualityText = report.summary.punctualityApplicable
    ? [
      `À l’heure : ${report.summary.onTime}`,
      `En retard : ${report.summary.late}`,
      `Taux de ponctualité : ${percentage(report.summary.punctualityRate)}`,
    ]
    : [];
  const detailRows = report.details.map((row) => {
    const arrival = row.status === 'present' ? formatLocalTime(row.checked_in_at) || 'Inconnue' : '—';
    return `<tr>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(`${row.first_name} ${row.last_name}`)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(attendanceStatus(row))}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(arrival)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(punctualityStatus(row))}</td>
    </tr>`;
  }).join('');

  return {
    subject: `Résumé des présences — ${report.session.title}`,
    text: [
      'Attendance Log', '',
      `Résumé des présences pour ${report.session.title}`,
      `${classTerm} : ${report.session.class_name}`,
      `${sessionTerm} : ${report.session.title}`,
      `Date : ${date}`,
      ...(startTime ? [`Heure de début : ${startTime}`] : []),
      '',
      `${studentPlural} : ${report.summary.opportunities}`,
      `Présents : ${report.summary.present}`,
      `Absents : ${report.summary.absent}`,
      ...punctualityText,
      '',
      ...rowsText,
    ].join('\n'),
    html: `<!doctype html>
<html lang="fr"><body style="margin:0;padding:0;background:#f8fafc;color:#172033;font-family:Arial,sans-serif;">
  <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
    <div style="padding:24px;border:1px solid #dbe2ea;border-radius:8px;background:#ffffff;">
      ${logo?.data ? `<div style="margin:0 0 16px;"><img src="cid:${logoContentId}" width="200" height="72" alt="Logo de l’organisation" style="display:block;width:auto;max-width:200px;height:auto;max-height:72px;"></div>` : ''}
      <p style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.3;">Attendance Log</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;">Résumé des présences</h1>
      <p style="margin:0 0 4px;"><strong>${escapeHtml(classTerm)} :</strong> ${escapeHtml(report.session.class_name)}</p>
      <p style="margin:0 0 4px;"><strong>${escapeHtml(sessionTerm)} :</strong> ${escapeHtml(report.session.title)}</p>
      <p style="margin:0 0 4px;"><strong>Date :</strong> ${escapeHtml(date)}</p>
      ${startTime ? `<p style="margin:0 0 4px;"><strong>Heure de début :</strong> ${escapeHtml(startTime)}</p>` : ''}
      <div style="margin:18px 0;padding:12px 14px;background:#f1f5f9;border-radius:6px;line-height:1.55;">
        <strong>${report.summary.present} présent${report.summary.present === 1 ? '' : 's'}</strong> · ${report.summary.absent} absent${report.summary.absent === 1 ? '' : 's'} · ${report.summary.opportunities} au total
        ${report.summary.punctualityApplicable ? `<br>${report.summary.onTime} à l’heure · ${report.summary.late} en retard · ${escapeHtml(percentage(report.summary.punctualityRate))}` : ''}
      </div>
      <div style="overflow-x:auto;"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.4;">
        <thead><tr><th style="padding:7px 8px;text-align:left;border-bottom:2px solid #cbd5e1;">${escapeHtml(studentTerm)}</th><th style="padding:7px 8px;text-align:left;border-bottom:2px solid #cbd5e1;">Statut</th><th style="padding:7px 8px;text-align:left;border-bottom:2px solid #cbd5e1;">Arrivée</th><th style="padding:7px 8px;text-align:left;border-bottom:2px solid #cbd5e1;">Ponctualité</th></tr></thead>
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
    const message = createSessionSummaryEmail(report, logo);
    const attachments = message.logoAttachment ? [message.logoAttachment] : [];
    if (delivery.attachXlsx) {
      const workbook = workbookBuilder(report, { includeParticipantEmail: false });
      const buffer = await workbook.xlsx.writeBuffer();
      attachments.push({
        filename: `resume-${safeFilenamePart(report.session.title, 'session')}.xlsx`,
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
