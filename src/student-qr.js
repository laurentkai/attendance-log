const QRCode = require('qrcode');

const studentQrPrefix = 'attendance-log:student:';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createStudentQrPayload(qrToken) {
  return `${studentQrPrefix}${qrToken}`;
}

function parseStudentQrPayload(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(studentQrPrefix)) {
    return null;
  }

  const qrToken = payload.slice(studentQrPrefix.length);
  return uuidPattern.test(qrToken) ? qrToken.toLowerCase() : null;
}

function createStudentQrPng(qrToken) {
  return QRCode.toBuffer(createStudentQrPayload(qrToken), {
    type: 'png',
    width: 512,
    margin: 3,
    errorCorrectionLevel: 'M',
    color: { dark: '#172033', light: '#ffffff' },
  });
}

module.exports = { createStudentQrPayload, createStudentQrPng, parseStudentQrPayload };
