const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';
process.env.APP_TIMEZONE = 'Europe/Brussels';

const { createAdminInvitationEmail } = require('../src/admin-invitations');
const { AVERY_PROFILES } = require('../src/avery-profiles');
const { auditActionLabel, auditFieldLabel, auditResultLabel } = require('../src/audit-presentation');
const { configureApplicationRegionalSettings, getSpreadsheetDateFormats } = require('../src/application-time');
const { TRANSLATIONS } = require('../src/i18n');
const { renderOtpMessage } = require('../src/otp-auth');
const { buildParticipantDataWorkbook } = require('../src/participant-data-export');
const { buildPrivacyNotice, renderPrivacyNoticePage } = require('../src/privacy-notice');
const { buildSessionWorkbook } = require('../src/reporting-excel');
const { createSessionSummaryEmail } = require('../src/session-summary');
const { createStudentQrEmail } = require('../src/student-qr-email');
const { createParticipantQrSheetPdf } = require('../src/student-qr-label-pdf');
const { copyTerminology } = require('../src/terminology');

function sessionReport() {
  return {
    canViewPii: true,
    session: {
      title: 'Cours de navigation', class_name: 'Navigation', date: '2026-09-11',
      instructor: 'Morgan', start_time: '20:00:00', effective_tolerance_minutes: 5,
    },
    summary: {
      opportunities: 1, present: 1, absent: 0, attendanceRate: 1,
      punctualityApplicable: true, punctualityKnown: 1, onTime: 0, late: 1, punctualityRate: 0,
    },
    details: [{
      first_name: 'Paul', last_name: 'BALDEWYNS', student_code: 'ABCDEFG', email: 'test@example.invalid',
      status: 'present', checked_in_at: new Date('2026-09-11T18:06:00Z'),
      punctuality: { available: true, delayMinutes: 6, status: 'late' },
    }],
  };
}

function exportData() {
  return {
    identity: {
      publicId: '11111111-1111-4111-8111-111111111111', firstName: 'Paul', lastName: 'BALDEWYNS',
      email: 'test@example.invalid', participantCode: 'ABCDEFG', language: 'en', active: false,
      createdAt: new Date('2024-01-01T10:00:00Z'), lastActivityAt: null, anonymizedAt: null,
    },
    memberships: [], attendance: [], audit: [],
  };
}

function pdfUtf16BeHex(text) {
  return `feff${Array.from(text).map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
}

test('shipping English and French catalogs have exact, non-empty key parity', () => {
  const englishKeys = Object.keys(TRANSLATIONS.en).sort();
  const frenchKeys = Object.keys(TRANSLATIONS.fr).sort();
  assert.deepEqual(frenchKeys, englishKeys);
  for (const key of englishKeys) {
    assert.equal(typeof TRANSLATIONS.en[key], 'string', key);
    assert.notEqual(TRANSLATIONS.en[key], '', key);
    assert.equal(typeof TRANSLATIONS.fr[key], 'string', key);
    assert.notEqual(TRANSLATIONS.fr[key], '', key);
  }
});

test('authentication and administrator messages keep subject, text, and HTML in one language', () => {
  const otpEn = renderOtpMessage('123456', 'en');
  const otpFr = renderOtpMessage('123456', 'fr');
  assert.match(otpEn.subject, /sign-in code/i);
  assert.match(otpEn.text, /expires in 10 minutes/i);
  assert.match(otpEn.html, /Your Attendance Log sign-in code/i);
  assert.match(otpFr.subject, /code de connexion/i);
  assert.match(otpFr.text, /expire dans 10 minutes/i);
  assert.match(otpFr.html, /Votre code de connexion/i);

  const baseUser = { account_type: 'otp', active: true, email: 'admin@example.invalid', name: '<Admin>', role: 'manager' };
  const invitationEn = createAdminInvitationEmail({ ...baseUser, ui_language: 'en' }, 'https://example.invalid/login');
  const invitationFr = createAdminInvitationEmail({ ...baseUser, ui_language: 'fr' }, 'https://example.invalid/login');
  assert.match(invitationEn.subject, /Invitation to Attendance Log/i);
  assert.match(invitationEn.text, /Hello <Admin>/);
  assert.match(invitationEn.html, /Hello &lt;Admin&gt;/);
  assert.match(invitationFr.subject, /Invitation à Attendance Log/i);
  assert.match(invitationFr.text, /Bonjour <Admin>/);
  assert.match(invitationFr.html, /Bonjour &lt;Admin&gt;/);
});

test('participant and session communications use one explicit business language across all parts', () => {
  const student = { first_name: 'Paul', last_name: 'BALDEWYNS', student_code: 'ABCDEFG' };
  const qrEn = createStudentQrEmail(student, Buffer.from('qr'), null, 'en');
  const qrFr = createStudentQrEmail(student, Buffer.from('qr'), null, 'fr');
  assert.match(qrEn.text, /Hello Paul BALDEWYNS/);
  assert.match(qrEn.html, /lang="en"/);
  assert.match(qrFr.text, /Bonjour Paul BALDEWYNS/);
  assert.match(qrFr.html, /lang="fr"/);

  const summaryEn = createSessionSummaryEmail(sessionReport(), null, 'en');
  const summaryFr = createSessionSummaryEmail(sessionReport(), null, 'fr');
  assert.match(summaryEn.subject, /Attendance summary/);
  assert.match(summaryEn.text, /Late: 1/);
  assert.match(summaryEn.html, /lang="en"/);
  assert.match(summaryFr.subject, /Résumé — Présences/);
  assert.match(summaryFr.text, /En retard : 1/);
  assert.match(summaryFr.html, /lang="fr"/);
  assert.match(summaryEn.text, /Cours de navigation/);
  assert.match(summaryFr.text, /Cours de navigation/);
});

test('generated workbooks translate system labels without translating business data', () => {
  const english = buildSessionWorkbook(sessionReport(), { language: 'en' });
  const french = buildSessionWorkbook(sessionReport(), { language: 'fr' });
  const englishText = english.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter(Boolean).join(' ');
  const frenchText = french.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter(Boolean).join(' ');
  assert.match(englishText, /Present/);
  assert.match(englishText, /Late/);
  assert.match(frenchText, /Présences/);
  assert.match(frenchText, /En retard/);
  assert.match(englishText, /Cours de navigation/);
  assert.match(frenchText, /Cours de navigation/);

  assert.equal(buildParticipantDataWorkbook(exportData(), { language: 'en' }).worksheets[0].name, 'Identity');
  assert.equal(buildParticipantDataWorkbook(exportData(), { language: 'fr' }).worksheets[0].name, 'Identité');
});

test('generated output uses localized terminology from business language, independent of UI language', () => {
  const terminology = copyTerminology();
  terminology.en.student.singular = 'Learner';
  terminology.en.student.plural = 'Learners';
  terminology.en.class.singular = 'Course';
  terminology.en.class.plural = 'Courses';
  terminology.fr.student.singular = 'Navigateur';
  terminology.fr.student.plural = 'Navigateurs';
  terminology.fr.class.singular = 'Formation';
  terminology.fr.class.plural = 'Formations';
  terminology.fr.attendance.plural = 'Pointages';

  const englishWorkbook = buildSessionWorkbook(sessionReport(), { language: 'en', terminology });
  const frenchWorkbook = buildSessionWorkbook(sessionReport(), { language: 'fr', terminology });
  const englishText = englishWorkbook.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter(Boolean).join(' ');
  const frenchText = frenchWorkbook.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter(Boolean).join(' ');
  assert.match(englishText, /Learner/);
  assert.match(englishText, /Course/);
  assert.doesNotMatch(englishText, /Navigateur|Formation/);
  assert.match(frenchText, /Navigateur/);
  assert.match(frenchText, /Formation/);
  assert.doesNotMatch(frenchText, /Learner|Course/);
  assert.match(englishText, /Cours de navigation/);
  assert.match(frenchText, /Cours de navigation/);

  const participant = { first_name: 'Paul', last_name: 'BALDEWYNS', student_code: 'ABCDEFG' };
  const englishMail = createStudentQrEmail(participant, Buffer.from('qr'), null, 'en', terminology);
  const frenchMail = createStudentQrEmail(participant, Buffer.from('qr'), null, 'fr', terminology);
  assert.match(englishMail.text, /Learner/);
  assert.match(frenchMail.text, /Navigateur/);
  assert.match(createSessionSummaryEmail(sessionReport(), null, 'en', terminology).text, /Course/);
  const frenchSummary = createSessionSummaryEmail(sessionReport(), null, 'fr', terminology);
  assert.match(frenchSummary.text, /Formation/);
  assert.match(frenchSummary.subject, /Pointages/);

  const englishGdprExport = buildParticipantDataWorkbook(exportData(), { language: 'en', terminology });
  const frenchGdprExport = buildParticipantDataWorkbook(exportData(), { language: 'fr', terminology });
  assert.equal(englishGdprExport.worksheets[1].name, 'Courses');
  assert.equal(frenchGdprExport.worksheets[1].name, 'Formations');
  assert.match(
    englishGdprExport.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter(Boolean).join(' '),
    /Learner code/,
  );
  assert.match(
    frenchGdprExport.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter(Boolean).join(' '),
    /Code — Navigateur/,
  );
});

test('badge PDF document terminology follows explicit output language', async () => {
  const terminology = copyTerminology();
  terminology.en.student.plural = 'Learners';
  terminology.fr.student.plural = 'Navigateurs';
  const participant = {
    first_name: 'Paul', last_name: 'BALDEWYNS', student_code: 'ABCDEFG',
    qr_token: 'synthetic-qr-token-for-i18n-test',
  };
  const english = await createParticipantQrSheetPdf({
    profile: AVERY_PROFILES.L7160,
    participants: [{ ...participant, effectiveLanguage: 'en' }],
    defaultLanguage: 'en',
    terminology,
  });
  const french = await createParticipantQrSheetPdf({
    profile: AVERY_PROFILES.L7160,
    participants: [{ ...participant, effectiveLanguage: 'fr' }],
    defaultLanguage: 'fr',
    terminology,
  });
  assert.match(english.toString('ascii', 0, 8), /^%PDF-/);
  assert.match(french.toString('ascii', 0, 8), /^%PDF-/);
  assert.ok(english.toString('hex').includes(pdfUtf16BeHex('Learners QR codes — Avery L7160')));
  assert.ok(french.toString('hex').includes(pdfUtf16BeHex('QR — Navigateurs — Avery L7160')));
});

test('audit presentation translates stable stored identifiers without rewriting them', () => {
  assert.equal(auditActionLabel('privacy.student.anonymize', 'en'), 'Participant anonymized');
  assert.equal(auditActionLabel('privacy.student.anonymize', 'fr'), 'Participant anonymisé');
  assert.equal(auditResultLabel('failed', 'en'), 'Failed');
  assert.equal(auditResultLabel('failed', 'fr'), 'Échec');
});

test('audit presentation uses the terminology set matching its rendering language', () => {
  const terminology = copyTerminology();
  terminology.en.student.singular = 'Learner';
  terminology.en.session.singular = 'Meeting';
  terminology.fr.student.singular = 'Navigateur';
  terminology.fr.session.singular = 'Atelier';

  assert.equal(auditActionLabel('student.create', 'en', terminology), 'Learner created');
  assert.equal(auditActionLabel('student.create', 'fr', terminology), 'Création — Navigateur');
  assert.equal(auditActionLabel('session.close', 'en', terminology), 'Meeting closed');
  assert.equal(auditActionLabel('session.close', 'fr', terminology), 'Clôture — Atelier');
  assert.equal(auditFieldLabel('student_singular', 'en', terminology), 'Learner term (singular)');
  assert.equal(auditFieldLabel('student_singular', 'fr', terminology), 'Terme « Navigateur » (singulier)');
});

test('public privacy notice has equivalent EN/FR legal facts and resolved HTML language', () => {
  const english = renderPrivacyNoticePage(buildPrivacyNotice('en'));
  const french = renderPrivacyNoticePage(buildPrivacyNotice('fr'));
  for (const html of [english, french]) {
    assert.match(html, /ASBL Nouveaux Horizons/);
    assert.match(html, /contact@nouveauxhorizons\.be/);
    assert.match(html, /12/);
    assert.match(html, /6\(1\)\(b\)|6, paragraphe 1, point b/i);
    assert.match(html, /6\(1\)\(f\)|6, paragraphe 1, point f/i);
  }
  assert.match(english, /<html lang="en">/);
  assert.match(french, /<html lang="fr">/);
  assert.match(english, /not automatic/i);
  assert.match(french, /n’est pas automatique/i);
});

test('spreadsheet date formats follow installation locale independently from language', () => {
  configureApplicationRegionalSettings({ locale: 'en-US', timezone: 'America/New_York' });
  assert.deepEqual(getSpreadsheetDateFormats(), { date: 'm/d/yyyy', dateTime: 'm/d/yyyy h:mm' });
  configureApplicationRegionalSettings({ locale: 'fr-BE', timezone: 'Europe/Brussels' });
  assert.deepEqual(getSpreadsheetDateFormats(), { date: 'dd/mm/yyyy', dateTime: 'dd/mm/yyyy hh:mm' });
});

test('runtime renderers do not hardcode French document language or regional Intl locale', () => {
  const runtimeFiles = fs.readdirSync(path.join(__dirname, '..', 'src'))
    .filter((name) => name.endsWith('.js'));
  for (const name of runtimeFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
    assert.doesNotMatch(source, /<html[^>]+lang="fr"/, name);
    assert.doesNotMatch(source, /toLocale(?:Date|Time|String)\([^)]*['"]fr-BE['"]/, name);
  }
});

test('the PWA shell ships an English fallback and cached EN/FR offline resources', () => {
  const publicDirectory = path.join(__dirname, '..', 'public');
  const offline = fs.readFileSync(path.join(publicDirectory, 'offline.html'), 'utf8');
  const worker = fs.readFileSync(path.join(publicDirectory, 'service-worker.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDirectory, 'manifest.webmanifest'), 'utf8'));

  assert.match(offline, /<html lang="en"[^>]*data-i18n-title="pwa\.offline\.title"/);
  assert.match(offline, /data-i18n="pwa\.offline\.heading"/);
  assert.match(offline, /src="\/js\/i18n\.js"/);
  assert.match(worker, /CACHE_NAME = `\$\{CACHE_PREFIX\}v17`/);
  assert.match(worker, /'\/i18n\/en\.json'/);
  assert.match(worker, /'\/i18n\/fr\.json'/);
  assert.equal(manifest.lang, 'en');
  assert.equal(manifest.description, TRANSLATIONS.en['pwa.description']);
});
