// End-to-end tests for every API endpoint. Run with `npm test`.
// Tests within a describe run in order and share state (tokens, visits).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { startTestServer } = require('./helpers/testServer');

let t; // test server
const tokens = {};
const state = {};

function baseForm(overrides = {}) {
  return {
    formVersion: 2,
    fieldOfficerName: 'Vera', fieldOfficerPhone: '0712345678', visitDate: '2026-09-20', visitTypes: ['Follow-up Visit'],
    referenceNumber: state.maryRef, villageArea: 'Kiamaina', ward: 'Nakuru East', constituency: 'Nakuru Town East',
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

  it('deactivates an account: its session ends and it can no longer sign in', async () => {
    const id = state.newUserId;
    const sessionToken = await t.login('new@bheco.org', 'longenough1');
    assert.equal((await t.request('GET', '/auth/me', sessionToken)).status, 200);

    const res = await t.request('PATCH', `/users/${id}`, tokens.admin, { active: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.active, false);
    assert.ok(res.body.deactivatedAt);

    assert.equal((await t.request('GET', '/auth/me', sessionToken)).status, 401, 'existing session ends');
    const login = await t.request('POST', '/auth/login', null, { email: 'new@bheco.org', password: 'longenough1' });
    assert.equal(login.status, 403);
    assert.match(login.body.error, /deactivated/);
    const wrong = await t.request('POST', '/auth/login', null, { email: 'new@bheco.org', password: 'wrong-password' });
    assert.equal(wrong.status, 401, 'a wrong password still gets the generic answer');

    const listed = (await t.request('GET', '/users', tokens.admin)).body.find((u) => u.id === id);
    assert.equal(listed.active, false, 'still listed, marked inactive');
  });

  it('reactivates, and refuses self-deactivation or losing the last active Admin', async () => {
    const id = state.newUserId;
    assert.equal((await t.request('PATCH', `/users/${id}`, tokens.admin, { active: 'no' })).status, 400);
    assert.equal((await t.request('PATCH', '/users/5', tokens.admin, { active: false })).status, 400, 'not yourself');
    assert.equal((await t.request('PATCH', `/users/${id}`, tokens.coord, { active: true })).status, 403);

    // A deactivated Admin doesn't count towards "at least one active Admin".
    assert.equal((await t.request('PATCH', `/users/${id}`, tokens.admin, { role: 'Admin' })).status, 200);
    const lastAdmin = await t.request('PATCH', '/users/5', tokens.admin, { role: 'Volunteer/CHW' });
    assert.equal(lastAdmin.status, 400);
    assert.match(lastAdmin.body.error, /active Admin/);

    const res = await t.request('PATCH', `/users/${id}`, tokens.admin, { active: true, role: 'Coordinator/Field officer' });
    assert.equal(res.status, 200);
    assert.equal(res.body.active, true);
    assert.equal(res.body.deactivatedAt, null);
    assert.ok(await t.login('new@bheco.org', 'longenough1'), 'can sign in again');
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
    assert.equal(res.body.prefill.values.constituency, 'Nakuru Town East');
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

  it('downloads a ZIP with the spreadsheets and every attached file, byte for byte', async () => {
    const res = await t.request('GET', '/visits/export?format=zip', tokens.dir);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition'), /bheco-visits-.*\.zip/);
    const zip = await JSZip.loadAsync(res.buffer);
    assert.ok(zip.file('visits.xlsx') && zip.file('visits.csv'));
    assert.equal(zip.file('MISSING_FILES.txt'), null);

    const visit = (await t.request('GET', `/visits/${state.maryVisit.id}`, tokens.dir)).body;
    const folder = `files/${visit.id}_${visit.formData.referenceNumber}_${visit.formData.visitDate}/`;
    const attached = ['photo', 'videoInterview', 'supportingDocument'].filter((f) => visit.formData[f]);
    assert.ok(attached.length >= 1);
    for (const field of attached) {
      const file = visit.formData[field];
      const entry = Object.values(zip.files).find((e) => e.name.startsWith(folder) && e.name.endsWith(` - ${file.name}`));
      assert.ok(entry, `${field} (${file.name}) is in ${folder}`);
      const original = (await t.request('GET', `/uploads/${file.id}`, tokens.dir)).buffer;
      assert.ok((await entry.async('nodebuffer')).equals(original), `${file.name} is byte-identical`);
    }

    // The spreadsheet inside points at the file's place in the ZIP.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await zip.file('visits.xlsx').async('nodebuffer'));
    const sheet = workbook.getWorksheet('Visits');
    const headers = sheet.getRow(1).values.slice(1);
    const row = sheet.getRows(2, sheet.rowCount - 1).find((r) => r.getCell(headers.indexOf('Visit ID') + 1).value === visit.id);
    assert.equal(row.getCell(headers.indexOf('Upload Beneficiary Photograph') + 1).value, `${folder}Upload Beneficiary Photograph - mary.jpg`);
  });

  it('scopes and filters ZIPs like the spreadsheets, and lists files missing on disk', async () => {
    const vol2Zip = await JSZip.loadAsync((await t.request('GET', '/visits/export?format=zip', tokens.vol2)).buffer);
    assert.equal(Object.keys(vol2Zip.files).filter((n) => n.startsWith('files/')).length, 0, 'no one else’s files');

    const dayZip = await JSZip.loadAsync((await t.request('GET', '/visits/export?format=zip&from=2026-09-21&to=2026-09-21', tokens.dir)).buffer);
    assert.ok(!Object.keys(dayZip.files).some((n) => n.startsWith(`files/${state.maryVisit.id}_`)), 'outside the date range');

    const { rows } = await t.db.query('SELECT storage_name FROM uploads WHERE id = $1', [state.img.id]);
    const diskPath = path.join(t.uploadDir, rows[0].storage_name);
    fs.renameSync(diskPath, `${diskPath}.moved`);
    try {
      const res = await t.request('GET', '/visits/export?format=zip', tokens.dir);
      assert.equal(res.status, 200);
      const zip = await JSZip.loadAsync(res.buffer);
      assert.match(await zip.file('MISSING_FILES.txt').async('string'), /mary\.jpg/);
      assert.ok(zip.file('visits.xlsx'), 'the rest of the export still arrives');
    } finally {
      fs.renameSync(`${diskPath}.moved`, diskPath);
    }
  });
});

describe('deleting visits (Admin, recoverable)', () => {
  const ytd = async () => (await t.request('GET', '/stats/dashboard', tokens.dir)).body.totalVisitsYtd;
  const listIds = async (token) => (await t.request('GET', '/visits?limit=200', token)).body.visits.map((v) => v.id);

  before(async () => {
    const photo = await t.upload(tokens.vol, 'image', 'delete-me.jpg', 'image/jpeg', Buffer.alloc(3, 7));
    const res = await t.request('POST', '/visits', tokens.vol, baseForm({ photo: { id: photo.body.id }, visitDate: '2026-09-22' }));
    assert.equal(res.status, 201);
    state.binVisit = res.body;
    state.binPhotoId = photo.body.id;
  });

  it('only Admins can delete', async () => {
    for (const role of ['vol', 'coord', 'dir']) {
      assert.equal((await t.request('DELETE', `/visits/${state.binVisit.id}`, tokens[role])).status, 403, role);
    }
    assert.equal((await t.request('DELETE', '/visits/abc', tokens.admin)).status, 400);
    assert.equal((await t.request('DELETE', '/visits/99999', tokens.admin)).status, 404);
  });

  it('hides a deleted visit everywhere', async () => {
    const id = state.binVisit.id;
    const before = await ytd();
    assert.equal((await t.request('DELETE', `/visits/${id}`, tokens.admin)).status, 204);
    assert.equal((await t.request('DELETE', `/visits/${id}`, tokens.admin)).status, 404, 'already deleted');

    assert.equal((await t.request('GET', `/visits/${id}`, tokens.coord)).status, 404);
    assert.equal((await t.request('GET', `/visits/${id}`, tokens.vol)).status, 404, 'even for the officer who logged it');
    assert.ok(!(await listIds(tokens.dir)).includes(id));
    const history = (await t.request('GET', '/beneficiaries/1', tokens.dir)).body.visits.map((v) => v.id);
    assert.ok(!history.includes(id));
    assert.equal(await ytd(), before - 1, 'left out of the dashboard figures');
    const csv = (await t.request('GET', '/visits/export?format=csv', tokens.dir)).buffer.toString('utf8');
    assert.ok(!csv.includes(`\r\n"${id}",`), 'left out of exports');
    const edit = await t.request('PATCH', `/visits/${id}`, tokens.vol, baseForm({ photo: null }));
    assert.equal(edit.status, 404, "can't be edited");
  });

  it('lists deleted visits for Admins with who deleted them and when they go for good', async () => {
    const res = await t.request('GET', '/visits/deleted', tokens.admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.retentionDays, 30);
    const entry = res.body.visits.find((v) => v.id === state.binVisit.id);
    assert.equal(entry.deletedByName, 'Adam Admin');
    assert.equal(entry.beneficiaryName, 'Mary Wanjiru');
    const days = (new Date(entry.purgeAt) - new Date(entry.deletedAt)) / 86_400_000;
    assert.ok(Math.abs(days - 30) < 0.01, `purged 30 days after deletion (${days})`);
    assert.equal((await t.request('GET', '/visits/deleted', tokens.dir)).status, 403);
  });

  it('restores a deleted visit', async () => {
    const id = state.binVisit.id;
    assert.equal((await t.request('POST', `/visits/${id}/restore`, tokens.coord)).status, 403);
    const res = await t.request('POST', `/visits/${id}/restore`, tokens.admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, id);
    assert.equal((await t.request('POST', `/visits/${id}/restore`, tokens.admin)).status, 404, 'not in the bin any more');
    assert.equal((await t.request('GET', `/visits/${id}`, tokens.vol)).status, 200);
    assert.ok((await listIds(tokens.dir)).includes(id));
    assert.ok(!(await t.request('GET', '/visits/deleted', tokens.admin)).body.visits.some((v) => v.id === id));
  });

  it('keeps the files while recoverable, then removes visit and files after 30 days', async () => {
    const { purgeDeletedVisits } = require('../src/jobs/purgeDeletedVisits');
    const { cleanupUploads } = require('../src/jobs/cleanupUploads');
    const id = state.binVisit.id;
    const { rows } = await t.db.query('SELECT storage_name FROM uploads WHERE id = $1', [state.binPhotoId]);
    const photoPath = path.join(t.uploadDir, rows[0].storage_name);

    assert.equal((await t.request('DELETE', `/visits/${id}`, tokens.admin)).status, 204);
    await t.db.query(`UPDATE uploads SET created_at = now() - interval '8 days' WHERE id = $1`, [state.binPhotoId]);
    await t.db.query(`UPDATE visits SET deleted_at = now() - interval '29 days' WHERE id = $1`, [id]);
    assert.deepEqual(await purgeDeletedVisits(30), [], 'not yet 30 days');
    await cleanupUploads(7);
    assert.ok(fs.existsSync(photoPath), 'file kept while the visit can still be restored');

    await t.db.query(`UPDATE visits SET deleted_at = now() - interval '31 days' WHERE id = $1`, [id]);
    assert.deepEqual(await purgeDeletedVisits(30), [id]);
    assert.equal((await t.db.query('SELECT 1 FROM visits WHERE id = $1', [id])).rows.length, 0, 'row gone');
    assert.equal((await t.request('POST', `/visits/${id}/restore`, tokens.admin)).status, 404);
    await cleanupUploads(7);
    assert.ok(!fs.existsSync(photoPath), 'file removed once the visit is gone');
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
