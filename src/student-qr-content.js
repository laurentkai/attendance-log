const { t } = require('./i18n');

function getPersonalQrWarning(language = 'en') {
  return t(language, 'qr.personal_warning');
}

const PERSONAL_QR_WARNING = getPersonalQrWarning('en');

module.exports = { getPersonalQrWarning, PERSONAL_QR_WARNING };
