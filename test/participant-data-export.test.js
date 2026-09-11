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
    audit: [{ occurredAt: new Date('2025-01-02T19:06:00Z'), actorName: 'Admin', category: 'attendance', action: 'attendance.manual.update', result: 'success', summary: 'Présence modifiée.', changes: 'status: absent → present' }],
  };
}

test('participant data workbook has separated readable sheets and no hidden sensitive fields', async () => {
  const workbook = buildParticipantDataWorkbook(syntheticData());
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Identité', 'Activités', 'Présences', 'Audit']);
  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = await new (require('exceljs').Workbook)().xlsx.load(buffer);
  const text = reloaded.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity).filter(Boolean).join(' ');
  assert.match(text, /Élodie/);
  assert.match(text, /Navigation/);
  assert.match(text, /\+6 min/);
  assert.doesNotMatch(text, /qr_token|password|session cookie|ip_hash|user_agent_hash/i);
});

test('participant worksheet names remain safe and unique under terminology collisions', () => {
  assert.deepEqual(
    createParticipantWorksheetNames({ classPlural: 'Identité', attendancePlural: 'Audit' }),
    { identity: 'Identité', memberships: 'Identité (2)', attendance: 'Audit (2)', audit: 'Audit' },
  );
  assert.deepEqual(
    createParticipantWorksheetNames({ classPlural: 'Registre', attendancePlural: 'registre' }),
    { identity: 'Identité', memberships: 'Registre', attendance: 'registre (2)', audit: 'Audit' },
  );

  const sanitized = createParticipantWorksheetNames({
    classPlural: "  'Activités/2027:*?[]'  ",
    attendancePlural: 'Présences administratives et historiques très détaillées',
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
    { rowCount: 1, rows: [{ id: 91, public_id: participantPublicId, first_name: 'Élodie', last_name: 'Martin', email: 'elodie@example.invalid', student_code: 'ABCDEFG', active: false, created_at: new Date('2024-01-01T10:00:00Z'), last_activity_at: null }] },
    { rows: [{ activity_name: 'Navigation', active: false, created_at: new Date('2024-01-01T10:00:00Z') }] },
    { rows: [] },
    { rows: [{ occurred_at: new Date(), actor_name: 'Admin', action: 'student.update', category: 'student', result: 'success', summary: 'Participant modifié.', before_data: { email: 'old@example.invalid', password: 'never' }, after_data: { email: 'new@example.invalid' } }] },
  ];
  const queries = [];
  const client = { query: async (sql, values) => { queries.push({ sql, values }); return responses.shift(); } };
  const data = await loadParticipantDataExport(participantPublicId, client);
  assert.equal(data.identity.publicId, participantPublicId);
  assert.equal(Object.hasOwn(data.identity, 'id'), false);
  assert.equal(data.audit[0].changes.includes('password'), false);
  assert.equal(JSON.stringify(data).includes('ip_hash'), false);
  assert.ok(queries.every((query) => !/SELECT\s+\*/i.test(query.sql)));
  assert.deepEqual(queries[0].values, [participantPublicId]);
});
