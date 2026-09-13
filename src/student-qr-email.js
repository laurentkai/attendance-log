const { escapeHtml } = require('./ui');
const { DEFAULT_LANGUAGE, t } = require('./i18n');
const { getTerm } = require('./terminology');
const { getPersonalQrWarning } = require('./student-qr-content');

const qrContentId = 'student-qr@attendance-log';
const logoContentId = 'organization-logo@attendance-log';

function safeQrFilename(studentCode) {
  const safeCode = String(studentCode || '').replace(/[^A-Z0-9_-]/gi, '') || 'eleve';
  return `qr-${safeCode}.png`;
}

function createStudentQrEmail(student, qrPng, logo = null, language = DEFAULT_LANGUAGE, terminology) {
  const studentName = `${student.first_name} ${student.last_name}`.trim();
  const escapedName = escapeHtml(studentName);
  const escapedCode = escapeHtml(student.student_code);
  const attachmentFilename = safeQrFilename(student.student_code);
  const studentTerm = getTerm(language, 'student', 'singular', terminology);
  const attendanceTerm = getTerm(language, 'attendance', 'plural', terminology);
  const warning = getPersonalQrWarning(language);
  const escapedStudentTerm = escapeHtml(studentTerm);

  return {
    subject: t(language, 'qr.email.subject'),
    text: [
      t(language, 'qr.email.greeting', { name: studentName }),
      '',
      t(language, 'qr.email.intro', { attendance: attendanceTerm }),
      '',
      t(language, 'qr.email.participant', { participant: studentTerm, name: studentName }),
      t(language, 'qr.email.code', { code: student.student_code }),
      '',
      t(language, 'qr.email.present', { attendance: attendanceTerm }),
      warning,
      t(language, 'qr.email.attachment', { filename: attachmentFilename }),
    ].join('\n'),
    html: `<!doctype html>
<html lang="${language}">
  <body style="margin:0;padding:0;background:#f8fafc;color:#172033;font-family:Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
      <div style="padding:24px;border:1px solid #dbe2ea;border-radius:8px;background:#ffffff;">
        ${logo?.data ? `<div style="margin:0 0 16px;text-align:center;"><img src="cid:${logoContentId}" width="200" height="72" alt="${escapeHtml(t(language, 'qr.email.organization_logo'))}" style="display:block;width:auto;max-width:200px;height:auto;max-height:72px;margin:0 auto;"></div>` : ''}
        <p style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.3;">Attendance Log</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(t(language, 'qr.email.greeting', { name: studentName }))}</p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${escapeHtml(t(language, 'qr.email.intro', { attendance: attendanceTerm }))}</p>
        <div style="margin:0 0 20px;text-align:center;">
          <img src="cid:${qrContentId}" width="320" height="320" alt="${escapeHtml(t(language, 'qr.email.personal_alt', { name: studentName }))}" style="display:block;width:100%;max-width:320px;height:auto;margin:0 auto;border:1px solid #dbe2ea;">
        </div>
        <p style="margin:0 0 6px;font-size:16px;line-height:1.5;"><strong>${escapedStudentTerm} :</strong> ${escapedName}</p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.5;"><strong>${escapeHtml(t(language, 'report.column.code'))}:</strong> ${escapedCode}</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(t(language, 'qr.email.present', { attendance: attendanceTerm }))}</p>
        <p style="margin:0;padding:12px 14px;border-left:3px solid #b45309;background:#fffbeb;color:#713f12;font-size:14px;line-height:1.5;"><strong>${escapeHtml(t(language, 'qr.email.personal_title'))}</strong> ${escapeHtml(warning)}</p>
      </div>
    </div>
  </body>
</html>`,
    attachments: [
      ...(logo?.data ? [{
        filename: 'logo-organisation.png',
        content: logo.data,
        contentType: logo.mimeType,
        contentDisposition: 'inline',
        cid: logoContentId,
      }] : []),
      {
        filename: 'qr-inline.png',
        content: qrPng,
        contentType: 'image/png',
        contentDisposition: 'inline',
        cid: qrContentId,
      },
      {
        filename: attachmentFilename,
        content: qrPng,
        contentType: 'image/png',
        contentDisposition: 'attachment',
      },
    ],
  };
}

module.exports = {
  createStudentQrEmail,
  personalQrWarning: getPersonalQrWarning,
  safeQrFilename,
};
