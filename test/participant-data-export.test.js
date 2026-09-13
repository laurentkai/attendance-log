const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';
process.env.APP_TIMEZONE = 'Europe/Brussels';

const {
  buildParticipantDataWorkbook,
  createParticipantWorksheetNames,
  loadParticipantDataExport,
} = require('../src/participant-data-export');

const participantPublicId = '11111111-1111-4111-8111-111111111111';

function syntheticData() {
  return {
    identity: {
      publicId: participantPublicId,
      firstName: 'Élodie',
      lastName: 'Martin',
      email: 'elodie@example.invalid',
      participantCode: 'ABCDEFG',
      language: 'fr',
      active: false,
      createdAt: new Date('2024-01-01T10:00:00Z'),
      lastActivityAt: new Date('2025-01-02T19:06:00Z'),
    },
    memberships: [{ activityName: 'Navigation', active: false, createdAt: new Date('2024-01-01T10:00:00Z') }],
    attendance: [{
      activityName: 'Navigation', sessionName: 'Séance 1', sessionDate: '2025-01-02',
      sessionStartTime: '20:00:00', status: 'present', checkedInAt: new Date('2025-01-02T19:06:00Z'),
      updatedAt: new Date('2025-01-02T19:06:00Z'),
      punctuality: { available: true, delayMinutes: 6, status: 'late', label: '+6 min' },
    }],
    audit: [{
      occurredAt: new Date('2025-01-02T19:06:00Z'), actorName: 'Admin', category: 'attendance',
      action: 'attendance.manual.update', result: 'success', summary: 'Présence modifiée.',
      beforeData: { status: 'absent' }, afterData: { status: 'present' },
    }],
  };
}

test('participant data workbook has separated readable sheets and no hidden sensitive fields', async () => {
  const workbook = buildParticipantDataWorkbook(syntheticData(), { language: 'fr' });
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Identité', 'Activités', 'Présences', 'Audit']);
  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = await new (require('exceljs').Workbook)().xlsx.load(buffer);
  const text = reloaded.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter(Boolean).join(' ');
  assert.match(text, /Élodie/);
  assert.match(text, /Navigation/);
  assert.match(text, /En retard/);
  assert.doesNotMatch(text, /qr_token|password|session cookie|ip_hash|user_agent_hash/i);
});

test('anonymized participant export describes erasure without exposing technical replacements', async () => {
  const data = syntheticData();
  data.identity = {
    ...data.identity,
    firstName: 'Supprimé lors de l’anonymisation',
    lastName: 'Supprimé lors de l’anonymisation',
    email: 'Supprimé lors de l’anonymisation',
    participantCode: 'Remplacé lors de l’anonymisation',
    anonymizedAt: new Date('2026-09-12T12:00:00Z'),
  };
  const workbook = buildParticipantDataWorkbook(data, { language: 'fr' });
  const text = workbook.worksheets[0].getSheetValues().flat(Infinity).filter(Boolean).join(' ');
  assert.match(text, /Participant anonymisé/);
  assert.match(text, /Supprimé lors de l’anonymisation/);
  assert.match(text, /Remplacé lors de l’anonymisation/);
  assert.doesNotMatch(text, /anonymized-[0-9a-f-]+@attendance-log\.invalid/i);
});

test('participant worksheet names remain safe and unique under terminology collisions', () => {
  assert.deepEqual(
    createParticipantWorksheetNames({ classPlural: 'Identité', attendancePlural: 'Audit', language: 'fr' }),
    { identity: 'Identité', memberships: 'Identité (2)', attendance: 'Audit (2)', audit: 'Audit' },
  );
  assert.deepEqual(
    createParticipantWorksheetNames({ classPlural: 'Registre', attendancePlural: 'registre', language: 'fr' }),
    { identity: 'Identité', memberships: 'Registre', attendance: 'registre (2)', audit: 'Audit' },
  );

  const sanitized = createParticipantWorksheetNames({
    classPlural: "  'Activités/2027:*?[]'  ",
    attendancePlural: 'Présences administratives et historiques très détaillées',
    language: 'fr',
  });
  assert.equal(sanitized.memberships, 'Activités 2027');
  assert.equal(sanitized.attendance.length, 31);
  assert.doesNotMatch(sanitized.memberships, /[\\/*?:[\]\u0000-\u001f\u007f]/);
  assert.doesNotMatch(sanitized.attendance, /[\\/*?:[\]\u0000-\u001f\u007f]/);
  assert.equal(new Set(Object.values(sanitized).map((name) => name.toLocaleLowerCase('fr'))).size, 4);
  const collisionWorkbook = new (require('exceljs').Workbook)();
  assert.doesNotThrow(() => Object.values(sanitized).forEach((name) => collisionWorkbook.addWorksheet(name)));
});

test('participant export inventory resolves by public UUID and omits internal IDs and fingerprints', async () => {
  const responses = [
    { rowCount: 1, rows: [{ id: 91, public_id: participantPublicId, first_name: 'Élodie', last_name: 'Martin', email: 'elodie@example.invalid', student_code: 'ABCDEFG', active: false, language: null, created_at: new Date('2024-01-01T10:00:00Z'), last_activity_at: null }] },
    { rows: [{ activity_name: 'Navigation', active: false, created_at: new Date('2024-01-01T10:00:00Z') }] },
    { rows: [] },
    { rows: [{ occurred_at: new Date(), actor_name: 'Admin', action: 'student.update', category: 'student', result: 'success', summary: 'Participant modifié.', before_data: { email: 'old@example.invalid', password: 'never' }, after_data: { email: 'new@example.invalid' } }] },
  ];
  const queries = [];
  const client = { query: async (sql, values) => { queries.push({ sql, values }); return responses.shift(); } };
  const data = await loadParticipantDataExport(participantPublicId, client);
  assert.equal(data.identity.publicId, participantPublicId);
  assert.equal(data.identity.language, null);
  assert.equal(Object.hasOwn(data.identity, 'id'), false);
  assert.equal(Object.hasOwn(data.audit[0].beforeData, 'password'), false);
  assert.equal(JSON.stringify(data).includes('ip_hash'), false);
  assert.ok(queries.every((query) => !/SELECT\s+\*/i.test(query.sql)));
  assert.deepEqual(queries[0].values, [participantPublicId]);
});

test('participant export inventory masks anonymization replacement fields at the data boundary', async () => {
  const replacementEmail = 'anonymized-11111111-1111-4111-8111-111111111111@attendance-log.invalid';
  const responses = [
    { rowCount: 1, rows: [{
      id: 92, public_id: participantPublicId, first_name: 'Participant', last_name: 'anonymisé',
      email: replacementEmail, student_code: 'BCDEFGH', active: false,
      language: 'fr',
      created_at: new Date('2024-01-01T10:00:00Z'), last_activity_at: null,
      anonymized_at: new Date('2026-09-12T12:00:00Z'),
    }] },
    { rows: [] }, { rows: [] }, { rows: [] },
  ];
  const client = { query: async () => responses.shift() };
  const data = await loadParticipantDataExport(participantPublicId, client);
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes(replacementEmail), false);
  assert.equal(serialized.includes('BCDEFGH'), false);
  assert.equal(data.identity.email, null);
  assert.equal(data.identity.participantCode, null);
  assert.equal(data.identity.language, null);
});
