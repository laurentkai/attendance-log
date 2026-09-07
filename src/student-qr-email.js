const { escapeHtml } = require('./ui');
const { getTerm } = require('./terminology');
const { PERSONAL_QR_WARNING } = require('./student-qr-content');

const qrContentId = 'student-qr@attendance-log';
const logoContentId = 'organization-logo@attendance-log';

function safeQrFilename(studentCode) {
  const safeCode = String(studentCode || '').replace(/[^A-Z0-9_-]/gi, '') || 'eleve';
  return `qr-${safeCode}.png`;
}

function createStudentQrEmail(student, qrPng, logo = null) {
  const studentName = `${student.first_name} ${student.last_name}`.trim();
  const escapedName = escapeHtml(studentName);
  const escapedCode = escapeHtml(student.student_code);
  const attachmentFilename = safeQrFilename(student.student_code);
  const studentTerm = getTerm('student');
  const attendanceTerm = getTerm('attendance', 'plural').toLocaleLowerCase('fr');
  const escapedStudentTerm = escapeHtml(studentTerm);
  const escapedAttendanceTerm = escapeHtml(attendanceTerm);

  return {
    subject: 'Votre QR Attendance Log',
    text: [
      `Bonjour ${studentName},`,
      '',
      `Voici votre QR Attendance Log pour l’enregistrement des ${attendanceTerm}.`,
      '',
      `${studentTerm} : ${studentName}`,
      `Code d’identification : ${student.student_code}`,
      '',
      `Présentez ce QR lors de l’enregistrement des ${attendanceTerm}.`,
      PERSONAL_QR_WARNING,
      `Le QR est également joint à cet e-mail sous le nom ${attachmentFilename}.`,
    ].join('\n'),
    html: `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f8fafc;color:#172033;font-family:Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
      <div style="padding:24px;border:1px solid #dbe2ea;border-radius:8px;background:#ffffff;">
        ${logo?.data ? `<div style="margin:0 0 16px;text-align:center;"><img src="cid:${logoContentId}" width="200" height="72" alt="Logo de l’organisation" style="display:block;width:auto;max-width:200px;height:auto;max-height:72px;margin:0 auto;"></div>` : ''}
        <p style="margin:0 0 16px;font-size:20px;font-weight:700;line-height:1.3;">Attendance Log</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Bonjour ${escapedName},</p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.5;">Voici votre QR pour l’enregistrement des ${escapedAttendanceTerm}.</p>
        <div style="margin:0 0 20px;text-align:center;">
          <img src="cid:${qrContentId}" width="320" height="320" alt="QR personnel de ${escapedName}" style="display:block;width:100%;max-width:320px;height:auto;margin:0 auto;border:1px solid #dbe2ea;">
        </div>
        <p style="margin:0 0 6px;font-size:16px;line-height:1.5;"><strong>${escapedStudentTerm} :</strong> ${escapedName}</p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.5;"><strong>Code d’identification :</strong> ${escapedCode}</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Présentez ce QR lors de l’enregistrement des ${escapedAttendanceTerm}.</p>
        <p style="margin:0;padding:12px 14px;border-left:3px solid #b45309;background:#fffbeb;color:#713f12;font-size:14px;line-height:1.5;"><strong>QR personnel.</strong> ${PERSONAL_QR_WARNING}</p>
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
  personalQrWarning: PERSONAL_QR_WARNING,
  safeQrFilename,
};
