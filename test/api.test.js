// End-to-end tests for every API endpoint. Run with `npm test`.
// Tests within a describe run in order and share state (tokens, visits).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { startTestServer } = require('./helpers/testServer');

let t; // test server
const tokens = {};
const state = {};

function baseForm(overrides = {}) {
  return {
    formVersion: 2,
    fieldOfficerName: 'Vera', fieldOfficerPhone: '0712345678', visitDate: '2026-09-20', visitTypes: ['Follow-up Visit'],
    referenceNumber: state.maryRef, villageArea: 'Kiamaina', ward: 'Nakuru', constituency: 'Bahati',
    beneficiaryName: 'Mary Wanjiru', age: '82', weight: '50', registeredSha: 'Yes', receivingStipend: 'No', gender: 'Female',
    nationalId: '12345678', physicalAddress: 'Near church', livingArrangement: ['Lives alone'],
    nokName: 'John', nokRelationship: 'Son', nokPhone: '0711000000',
    purposeExplained: 'Yes', consentDataCollection: 'Yes', consentPhotography: 'Yes', consentAudio: 'No', consentVideo: 'No', consentStoryUse: 'Yes',
    generalHealth: 'Fair', mobilityStatus: 'Requires assistance', healthcareAccess: 'Occasionally', healthCondition: 'No',
    foodSecurity: 'Sometimes lacks food', hygiene: 'Adequate', shelter: 'Poor', isolation: 'Frequently', assistiveDevice: 'Walking Aid',
    urgentConcern: 'No',
    supportProvided: ['Food'], supportDescription: 'Maize', supportDate: '2026-09-20', supportReceived: 'Yes',
    gardenEligible: 'Yes', hasKitchenGarden: 'No', gardenLinked: 'Pending', gardenStatus: 'Site identified',
    cropsPlanted: ['Sukuma Wiki'], gardenFurtherSupport: 'Yes',
    storyBefore: 'a', storySupport: 'b', storyChange: 'c', storyHopes: 'd', storyQuote: '=HYPERLINK("http://evil")', recommendImpactStory: 'Yes',
    photo: null, photoAdditional: null, videoInterview: null, supportingDocument: null, evidenceComplete: 'Yes',
    importantNeeds: 'Food', immediateFollowUp: 'Revisit',
    declarationAccurate: true, declarationConsent: true, declarationOfficerName: 'Vera', submissionDate: '2026-09-20',
    ...overrides,
  };
}

const URGENT = {
  urgentConcern: 'Yes', urgentConcernTypes: ['Neglect'], urgentConcernDescription: 'x', immediateActions: ['Other'],
  referralMade: 'No', followUpRequired: 'Yes', followUpDate: '2026-10-01',
};

before(async () => {
  console.warn = () => {};
  console.info = () => {};
  t = await startTestServer();
  for (const [key, email] of Object.entries({
    vol: 'vol@bheco.org', vol2: 'vol2@bheco.org', coord: 'coord@bheco.org', dir: 'dir@bheco.org', admin: 'admin@bheco.org',
  })) {
    tokens[key] = await t.login(email);
  }
});

after(() => t.stop());

describe('schema migration', () => {
  it('keeps original-form visits as form_version 1', async () => {
    const { rows } = await t.db.query('SELECT form_version, mood FROM visits WHERE id = 1');
    assert.equal(rows[0].form_version, 1);
    assert.equal(rows[0].mood, 'Happy');
  });

  it('replaces the unconditional name/location index with a partial one', async () => {
    const { rows } = await t.db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'beneficiaries'`);
    const names = rows.map((r) => r.indexname);
    assert.ok(!names.includes('idx_beneficiaries_identity'));
    assert.ok(names.includes('idx_beneficiaries_identity_unreferenced'));
  });
});

describe('health', () => {
  it('GET /health reports the database', async () => {
    const res = await t.request('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.db, 'connected');
  });
});

describe('auth', () => {
  it('logs in with a case- and space-insensitive email, without leaking the hash', async () => {
    const res = await t.request('POST', '/auth/login', null, { email: '  VOL@bheco.org ', password: 'password123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'Volunteer/CHW');
    assert.ok(res.body.token);
    assert.ok(!JSON.stringify(res.body).includes('password_hash'));
  });

  it('rejects bad credentials with one generic message', async () => {
    const wrong = await t.request('POST', '/auth/login', null, { email: 'vol@bheco.org', password: 'nope' });
    const unknown = await t.request('POST', '/auth/login', null, { email: 'x@y.org', password: 'nope' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.body.error, wrong.body.error);
  });

  it('rejects missing fields and malformed JSON with 400', async () => {
    assert.equal((await t.request('POST', '/auth/login', null, {})).status, 400);
    assert.equal((await t.request('POST', '/auth/login', null, '{bad', { 'Content-Type': 'application/json' })).status, 400);
  });

  it('GET /auth/me needs a valid token', async () => {
    const me = await t.request('GET', '/auth/me', tokens.vol);
    assert.equal(me.body.email, 'vol@bheco.org');
    assert.equal((await t.request('GET', '/auth/me')).status, 401);
    assert.equal((await t.request('GET', '/auth/me', 'garbage')).status, 401);
  });

  it('logout revokes the token', async () => {
    const token = await t.login('vol@bheco.org');
    assert.equal((await t.request('POST', '/auth/logout', token)).status, 204);
    assert.equal((await t.request('GET', '/auth/me', token)).status, 401);
  });
});

describe('users (Admin only)', () => {
  it('lists users without password data, and only for admins', async () => {
    const res = await t.request('GET', '/users', tokens.admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 5);
    assert.ok(!JSON.stringify(res.body).includes('password'));
    for (const role of ['vol', 'coord', 'dir']) {
      assert.equal((await t.request('GET', '/users', tokens[role])).status, 403, role);
    }
  });

  it('creates a user who can then log in', async () => {
    const res = await t.request('POST', '/users', tokens.admin, {
      name: 'New Vol', email: 'New@BHECO.org', password: 'longenough1', role: 'Volunteer/CHW',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.email, 'new@bheco.org');
    state.newUserId = res.body.id;
    assert.ok(await t.login('new@bheco.org', 'longenough1'));
  });

  it('validates new users', async () => {
    const make = (body) => t.request('POST', '/users', tokens.admin, { name: 'x', password: 'longenough1', role: 'Admin', ...body });
    assert.equal((await make({ email: 'new@bheco.org' })).status, 409);
    assert.equal((await make({ email: 'z@bheco.org', role: 'King' })).status, 400);
    assert.equal((await make({ email: 'z@bheco.org', password: 'short' })).status, 400);
  });

  it('updates users and protects the last admin', async () => {
    const res = await t.request('PATCH', `/users/${state.newUserId}`, tokens.admin, { name: 'Renamed', role: 'Coordinator/Field officer' });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Renamed');
    assert.equal((await t.request('PATCH', '/users/5', tokens.admin, { role: 'Volunteer/CHW' })).status, 400);
    assert.equal((await t.request('PATCH', `/users/${state.newUserId}`, tokens.admin, { email: 'vol@bheco.org' })).status, 409);
    assert.equal((await t.request('PATCH', '/users/9999', tokens.admin, { name: 'x' })).status, 404);
    assert.equal((await t.request('PATCH', '/users/abc', tokens.admin, { name: 'x' })).status, 400);
    assert.equal((await t.request('PATCH', `/users/${state.newUserId}`, tokens.admin, {})).status, 400);
    assert.equal((await t.request('PATCH', '/users/1', tokens.coord, { name: 'x' })).status, 403);
  });
});

describe('uploads', () => {
  it('accepts each kind of file', async () => {
    const img = await t.upload(tokens.vol, 'image', 'mary.jpg', 'image/jpeg', Buffer.alloc(2048, 1));
    const vid = await t.upload(tokens.vol, 'video', 'story.mp4', 'video/mp4', Buffer.alloc(4096, 2));
    const doc = await t.upload(tokens.vol, 'document', 'referral.pdf', 'application/pdf', Buffer.from('%PDF-1.4'));
    const docx = await t.upload(tokens.vol, 'document', 'notes.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('x'));
    for (const res of [img, vid, doc, docx]) assert.equal(res.status, 201);
    assert.equal(img.body.size, 2048);
    Object.assign(state, { img: img.body, vid: vid.body, doc: doc.body });
  });

  it('rejects oversized, wrong-type and unauthorized uploads', async () => {
    assert.equal((await t.upload(tokens.vol, 'image', 'big.jpg', 'image/jpeg', Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await t.upload(tokens.vol, 'image', 'v.mp4', 'video/mp4', Buffer.alloc(10))).status, 400);
    assert.equal((await t.upload(tokens.vol, 'exe', 'a.exe', 'application/octet-stream', Buffer.alloc(10))).status, 400);
    assert.equal((await t.upload(tokens.dir, 'image', 'a.jpg', 'image/jpeg', Buffer.alloc(10))).status, 403);
    assert.equal((await t.upload(null, 'image', 'a.jpg', 'image/jpeg', Buffer.alloc(10))).status, 401);
  });

  it('serves the exact file back to allowed users only', async () => {
    const res = await t.request('GET', `/uploads/${state.img.id}`, tokens.vol);
    assert.equal(res.status, 200);
    assert.equal(res.buffer.length, 2048);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('content-disposition'), /mary\.jpg/);
    assert.equal((await t.request('GET', `/uploads/${state.img.id}`, tokens.vol2)).status, 404);
    assert.equal((await t.request('GET', `/uploads/${state.img.id}`, tokens.coord)).status, 200);
    assert.equal((await t.request('GET', '/uploads/not-a-uuid', tokens.coord)).status, 404);
  });
});

describe('reference numbers', () => {
  it('generates BHECO-<ward code>-<number>', async () => {
    const res = await t.request('POST', '/beneficiaries/reference-numbers', tokens.vol, { ward: 'Nakuru' });
    assert.equal(res.status, 201);
    assert.equal(res.body.referenceNumber, 'BHECO-NK-001');
    state.maryRef = res.body.referenceNumber;
  });

  it('never hands out the same number twice, even concurrently', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => t.request('POST', '/beneficiaries/reference-numbers', tokens.coord, { ward: 'Nakuru' }))
    );
    const refs = results.map((r) => r.body.referenceNumber);
    assert.equal(new Set(refs).size, 25);
    state.spareRefs = refs;
  });

  it('skips numbers already typed in by hand', async () => {
    await t.db.query(`INSERT INTO beneficiaries (name, location, reference_number) VALUES ('Hand', 'X', 'BHECO-KM-001'), ('Hand2', 'Y', 'BHECO-KM-002')`);
    await t.db.query(`INSERT INTO reference_sequences (code, last_number) VALUES ('KM', 0)`);
    const res = await t.request('POST', '/beneficiaries/reference-numbers', tokens.vol, { ward: 'Kiamaina' });
    assert.equal(res.body.referenceNumber, 'BHECO-KM-003');
  });

  it('requires a ward and field-staff role', async () => {
    assert.equal((await t.request('POST', '/beneficiaries/reference-numbers', tokens.vol, {})).status, 400);
    assert.equal((await t.request('POST', '/beneficiaries/reference-numbers', tokens.dir, { ward: 'Nakuru' })).status, 403);
  });
});

describe('visits', () => {
  it('creates a new-form visit, adopting the original-form beneficiary', async () => {
    const res = await t.request('POST', '/visits', tokens.vol, baseForm({
      photo: { id: state.img.id }, videoInterview: { id: state.vid.id }, supportingDocument: { id: state.doc.id },
    }));
    assert.equal(res.status, 201);
    assert.equal(res.body.formVersion, 2);
    assert.equal(res.body.beneficiaryId, 1);
    assert.equal(res.body.formData.referenceNumber, state.maryRef);
    assert.equal(res.body.formData.photo.name, 'mary.jpg');
    assert.equal(res.body.formData.videoInterview.name, 'story.mp4');
    assert.equal(res.body.urgencyLevel, 'Routine');
    state.maryVisit = res.body;
  });

  it('normalizes reference numbers typed with spaces and lower case', async () => {
    const res = await t.request('POST', '/visits', tokens.vol, baseForm({ referenceNumber: state.maryRef.toLowerCase().replace(/-/g, ' - ') }));
    assert.equal(res.status, 201);
    assert.equal(res.body.beneficiaryId, 1);
  });

  it('drops answers to hidden questions', async () => {
    const res = await t.request('POST', '/visits', tokens.vol, baseForm({ healthCondition: 'No', healthConditionDetails: 'stale' }));
    assert.ok(!('healthConditionDetails' in res.body.formData));
  });

  it('asks before registering a namesake in the same village under a new ID', async () => {
    const newRef = state.spareRefs[0];
    const blocked = await t.request('POST', '/visits', tokens.vol, baseForm({ referenceNumber: newRef }));
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.possibleDuplicates[0].referenceNumber, state.maryRef);

    const confirmed = await t.request('POST', '/visits', tokens.vol, baseForm({ referenceNumber: newRef, confirmNewBeneficiary: true }));
    assert.equal(confirmed.status, 201);
    assert.notEqual(confirmed.body.beneficiaryId, 1);
  });

  it('warns about possible duplicates when generating an ID', async () => {
    const warn = await t.request('POST', '/beneficiaries/reference-numbers', tokens.vol, { ward: 'Nakuru', name: ' mary wanjiru ', location: 'KIAMAINA' });
    assert.equal(warn.body.referenceNumber, null);
    assert.ok(warn.body.possibleDuplicates.length >= 1);
    const forced = await t.request('POST', '/beneficiaries/reference-numbers', tokens.vol, { ward: 'Nakuru', name: 'Mary Wanjiru', location: 'Kiamaina', confirmNew: true });
    assert.match(forced.body.referenceNumber, /^BHECO-NK-\d{3}$/);
  });

  it('still accepts original-form visits, linked by name and village', async () => {
    const res = await t.request('POST', '/visits', tokens.vol, {
      beneficiaryName: 'Mary Wanjiru', age: '82', weight: '', location: 'Kiamaina', timeInCommunity: '', volunteerName: 'Vera',
      visitDate: '2026-09-21', needsIdentified: '', actionsRecommendations: '', backgroundChallenges: '', interventionChange: '',
      youthParticipation: '', futureAspirations: '', beneficiarySignature: '', volunteerSignature: '', dateSigned: '',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.beneficiaryId, 1);
  });

  it('validates answers', async () => {
    assert.equal((await t.request('POST', '/visits', tokens.vol, baseForm({ gender: 'Robot' }))).body.fieldErrors.gender, 'Invalid option selected');
    assert.equal((await t.request('POST', '/visits', tokens.vol, baseForm({ constituency: 'Atlantis' }))).status, 400);
    assert.equal((await t.request('POST', '/visits', tokens.vol, baseForm({ visitDate: '20/09/2026' }))).body.fieldErrors.visitDate, 'Invalid date');
    assert.equal((await t.request('POST', '/visits', tokens.vol, baseForm({ declarationConsent: false }))).status, 400);
    const urgentMissing = await t.request('POST', '/visits', tokens.vol, baseForm({ urgentConcern: 'Yes' }));
    assert.ok(urgentMissing.body.fieldErrors.urgentConcernTypes);
    const empty = await t.request('POST', '/visits', tokens.vol, { formVersion: 2 });
    assert.ok(empty.body.fieldErrors.beneficiaryName && !empty.body.fieldErrors.urgentConcernTypes);
  });

  it("rejects files the submitter didn't upload or of the wrong kind", async () => {
    assert.ok((await t.request('POST', '/visits', tokens.vol2, baseForm({ photo: { id: state.img.id } }))).body.fieldErrors.photo);
    assert.equal((await t.request('POST', '/visits', tokens.vol, baseForm({ photo: { id: state.vid.id } }))).status, 400);
  });

  it('only lets field staff submit', async () => {
    assert.equal((await t.request('POST', '/visits', tokens.dir, baseForm())).status, 403);
    assert.equal((await t.request('POST', '/visits', tokens.admin, baseForm())).status, 403);
  });

  it('marks urgent visits', async () => {
    const res = await t.request('POST', '/visits', tokens.coord, baseForm(URGENT));
    assert.equal(res.status, 201);
    assert.equal(res.body.urgencyLevel, 'Urgent');
  });

  it('lists with pagination and per-role scope', async () => {
    const page = await t.request('GET', '/visits?limit=2&offset=0', tokens.dir);
    assert.equal(page.body.visits.length, 2);
    assert.equal(page.body.total, 7);
    assert.equal((await t.request('GET', '/visits?limit=9999', tokens.dir)).body.limit, 200);
    assert.equal((await t.request('GET', '/visits', tokens.vol2)).body.total, 0);
  });

  it('shows one visit to those allowed to see it', async () => {
    assert.equal((await t.request('GET', `/visits/${state.maryVisit.id}`, tokens.dir)).body.formData.referenceNumber, state.maryRef);
    assert.equal((await t.request('GET', `/visits/${state.maryVisit.id}`, tokens.vol2)).status, 404);
    assert.equal((await t.request('GET', '/visits/abc', tokens.dir)).status, 400);
    assert.equal((await t.request('GET', '/visits/99999', tokens.dir)).status, 404);
  });

  it('edits a new-form visit, keeping files uploaded by the original officer', async () => {
    const res = await t.request('PATCH', `/visits/${state.maryVisit.id}`, tokens.coord, {
      ...baseForm({ age: '83' }),
      photo: { id: state.img.id }, videoInterview: { id: state.vid.id }, supportingDocument: { id: state.doc.id },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.age, '83');
    assert.equal(res.body.formData.photo.name, 'mary.jpg');
  });

  it('enforces edit permissions and form versions', async () => {
    assert.equal((await t.request('PATCH', `/visits/${state.maryVisit.id}`, tokens.vol2, baseForm())).status, 403);
    assert.equal((await t.request('PATCH', `/visits/${state.maryVisit.id}`, tokens.dir, baseForm())).status, 403);
    assert.equal((await t.request('PATCH', '/visits/1', tokens.vol, { mood: 'Calm' })).body.mood, 'Calm');
    assert.equal((await t.request('PATCH', `/visits/${state.maryVisit.id}`, tokens.vol, { age: '1' })).status, 400);
    assert.equal((await t.request('PATCH', '/visits/99999', tokens.vol, baseForm())).status, 404);
  });
});

describe('beneficiaries', () => {
  it('lists per-role scope', async () => {
    const all = await t.request('GET', '/beneficiaries', tokens.dir);
    assert.equal(all.status, 200);
    assert.equal(all.body.length, 2);
    assert.equal((await t.request('GET', '/beneficiaries', tokens.vol2)).body.length, 0);
  });

  it('shows one beneficiary with their visit history', async () => {
    const res = await t.request('GET', '/beneficiaries/1', tokens.dir);
    assert.equal(res.body.referenceNumber, state.maryRef);
    assert.ok(res.body.visits.length >= 4);
    assert.equal((await t.request('GET', '/beneficiaries/1', tokens.vol2)).status, 404);
    assert.equal((await t.request('GET', '/beneficiaries/abc', tokens.dir)).status, 400);
  });

  it('looks up a reference number with details from the last visit', async () => {
    const res = await t.request('GET', `/beneficiaries/lookup?ref=${encodeURIComponent(state.maryRef.toLowerCase())}`, tokens.coord);
    assert.equal(res.status, 200);
    assert.equal(res.body.beneficiary.name, 'Mary Wanjiru');
    assert.equal(res.body.prefill.values.nokName, 'John');
    assert.equal(res.body.prefill.values.constituency, 'Bahati');
    assert.ok(!('weight' in res.body.prefill.values), 'weight is re-measured, not copied');
    assert.ok(!('storyQuote' in res.body.prefill.values), 'only identity/contact answers are copied');
  });

  it("doesn't reveal a stranger's details to a volunteer who never visited them", async () => {
    const res = await t.request('GET', `/beneficiaries/lookup?ref=${state.maryRef}`, tokens.vol2);
    assert.equal(res.body.beneficiary.name, 'Mary Wanjiru');
    assert.equal(res.body.prefill, null);
  });

  it('handles unknown and missing reference numbers', async () => {
    assert.equal((await t.request('GET', '/beneficiaries/lookup?ref=BHECO-ZZ-999', tokens.vol)).body.beneficiary, null);
    assert.equal((await t.request('GET', '/beneficiaries/lookup', tokens.vol)).status, 400);
    assert.equal((await t.request('GET', '/beneficiaries/lookup?ref=X', tokens.dir)).status, 403);
  });
});

describe('stats', () => {
  it('counts across both form versions', async () => {
    const res = await t.request('GET', '/stats/dashboard', tokens.dir);
    assert.equal(res.status, 200);
    assert.equal(res.body.urgentEscalations, 1);
    // Original visit 1 is 'Follow-up Needed'; the urgent new-form visit has followUpRequired = Yes.
    assert.equal(res.body.pendingFollowUps, 2);
    assert.equal(res.body.totalSystemUsers, 6);
  });

  it('scopes volunteer stats to their own visits', async () => {
    const res = await t.request('GET', '/stats/dashboard', tokens.vol);
    assert.ok(res.body.recentSubmissions.every((r) => r.volunteerName === 'Vera'));
    assert.equal((await t.request('GET', '/stats/dashboard')).status, 401);
  });
});

describe('export', () => {
  it('downloads every visit as an Excel workbook with one column per question', async () => {
    const res = await t.request('GET', '/visits/export', tokens.dir);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /bheco-visits-.*\.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.buffer);
    const sheet = workbook.getWorksheet('Visits');
    const headers = sheet.getRow(1).values.slice(1);
    assert.ok(headers.includes('Beneficiary/Household Reference Number'));
    assert.ok(headers.includes('Field Officer Name (Field Officer Declaration)'));
    assert.equal(sheet.rowCount, 1 + 7);

    const col = (header) => headers.indexOf(header) + 1;
    const rows = sheet.getRows(2, sheet.rowCount - 1);
    const maryRow = rows.find((r) => r.getCell(col('Visit ID')).value === state.maryVisit.id);
    assert.equal(maryRow.getCell(col('Field Officer Phone Number')).value, '0712345678', 'leading zero kept');
    assert.equal(maryRow.getCell(col('Current Living Arrangement')).value, 'Lives alone');
    assert.equal(maryRow.getCell(col('Upload Beneficiary Photograph')).value, 'mary.jpg');
    const originalRow = rows.find((r) => r.getCell(col('Visit ID')).value === 1);
    assert.equal(originalRow.getCell(col('Full Name of Beneficiary')).value, 'Mary Wanjiru');
    assert.equal(originalRow.getCell(col('Form Version')).value, 1);
  });

  it('downloads CSV with formula injection neutralized', async () => {
    const res = await t.request('GET', '/visits/export?format=csv', tokens.dir);
    const text = res.buffer.toString('utf8');
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.ok(text.includes(`"'=HYPERLINK(""http://evil"")"`));
    assert.ok(text.includes('"0712345678"'));
  });

  it('filters by visit date and scopes volunteers to their own visits', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await t.request('GET', '/visits/export?from=2026-09-21&to=2026-09-21', tokens.dir)).buffer);
    assert.equal(workbook.getWorksheet('Visits').rowCount, 2);

    const csv = (await t.request('GET', '/visits/export?format=csv', tokens.vol2)).buffer.toString('utf8');
    assert.equal(csv.trim().split('\r\n').length, 1, 'header only');
    assert.equal((await t.request('GET', '/visits/export?from=yesterday', tokens.dir)).status, 400);
    assert.equal((await t.request('GET', '/visits/export')).status, 401);
  });
});

describe('upload cleanup', () => {
  it('removes old uploads no visit uses, and keeps attached or recent ones', async () => {
    const { cleanupUploads } = require('../src/jobs/cleanupUploads');
    const orphan = await t.upload(tokens.vol, 'image', 'never-submitted.jpg', 'image/jpeg', Buffer.alloc(10));
    const recent = await t.upload(tokens.vol, 'image', 'still-drafting.jpg', 'image/jpeg', Buffer.alloc(10));
    await t.db.query(`UPDATE uploads SET created_at = now() - interval '8 days' WHERE id <> $1`, [recent.body.id]);
    const { rows } = await t.db.query('SELECT storage_name FROM uploads WHERE id = $1', [orphan.body.id]);
    const orphanPath = path.join(t.uploadDir, rows[0].storage_name);
    assert.ok(fs.existsSync(orphanPath));

    const removed = await cleanupUploads(7);
    assert.ok(removed >= 1);
    assert.ok(!fs.existsSync(orphanPath), 'file deleted from disk');
    assert.equal((await t.request('GET', `/uploads/${orphan.body.id}`, tokens.coord)).status, 404);
    assert.equal((await t.request('GET', `/uploads/${state.img.id}`, tokens.coord)).status, 200, 'attached file kept');
    assert.equal((await t.request('GET', `/uploads/${recent.body.id}`, tokens.coord)).status, 200, 'recent file kept');
  });
});

describe('misc', () => {
  it('404s unknown routes and 413s oversized bodies', async () => {
    assert.equal((await t.request('GET', '/nope', tokens.dir)).status, 404);
    assert.equal((await t.request('POST', '/visits', tokens.vol, baseForm({ storyQuote: 'x'.repeat(1_100_000) }))).status, 413);
  });

  it('locks out logins after 10 failures', async () => {
    let res;
    for (let i = 0; i < 11; i += 1) {
      res = await t.request('POST', '/auth/login', null, { email: 'vol@bheco.org', password: 'wrong' });
    }
    assert.equal(res.status, 429);
    assert.ok(res.body.retryAfterSeconds > 0);
  });
});
