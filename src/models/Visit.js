const pool = require('../db');

// Maps VisitFormData camelCase keys to their snake_case columns. Reused for
// both writing (form -> row) and reading (row -> form) so the two directions
// can never drift apart.
const FIELD_MAP = {
  beneficiaryName: 'beneficiary_name',
  age: 'age',
  weight: 'weight',
  location: 'location',
  timeInCommunity: 'time_in_community',
  volunteerName: 'volunteer_name',
  visitDate: 'visit_date',

  appearance: 'appearance',
  mobilityChallenges: 'mobility_challenges',
  signsOfIllness: 'signs_of_illness',
  screeningDone: 'screening_done',

  hadMeals: 'had_meals',
  foodInHome: 'food_in_home',
  cleanWater: 'clean_water',

  houseClean: 'house_clean',
  beddingAdequate: 'bedding_adequate',
  sanitationAccess: 'sanitation_access',
  receivingStipend: 'receiving_stipend',

  mood: 'mood',
  signsOfNeglect: 'signs_of_neglect',
  socialSupport: 'social_support',
  registeredSHA: 'registered_sha',

  needsIdentified: 'needs_identified',
  actionsRecommendations: 'actions_recommendations',
  urgencyLevel: 'urgency_level',

  backgroundChallenges: 'background_challenges',
  interventionChange: 'intervention_change',
  youthParticipation: 'youth_participation',
  futureAspirations: 'future_aspirations',

  consentInterview: 'consent_interview',
  consentPhotoVideo: 'consent_photo_video',
  beneficiarySignature: 'beneficiary_signature',
  volunteerSignature: 'volunteer_signature',
  dateSigned: 'date_signed',
};

function toRow(data) {
  const row = {};
  for (const [key, column] of Object.entries(FIELD_MAP)) {
    row[column] = data[key] ?? null;
  }
  return row;
}

// Like toRow, but only includes keys actually present in a partial update —
// omitted keys must leave their columns untouched, not null them out.
function toPartialRow(data) {
  const row = {};
  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (key in data) {
      row[column] = data[key] ?? null;
    }
  }
  return row;
}

function toVisit(row) {
  const visit = {
    id: row.id,
    createdBy: row.created_by,
    beneficiaryId: row.beneficiary_id,
    createdAt: row.created_at,
    formVersion: row.form_version,
    formData: row.form_data,
    followUpDoneAt: row.follow_up_done_at ?? null,
    followUpDoneBy: row.follow_up_done_by ?? null,
    followUpNote: row.follow_up_note ?? null,
  };
  for (const [key, column] of Object.entries(FIELD_MAP)) {
    visit[key] = row[column];
  }
  return visit;
}

// Visits that asked for a follow-up: "Follow-up required: Yes" on the new
// form, or "Follow-up Needed" on the original one.
const NEEDS_FOLLOW_UP = `(v.form_data->>'followUpRequired' = 'Yes' OR v.urgency_level = 'Follow-up Needed')`;

// The follow-up list. status 'open' (not yet done; soonest due first, those
// without a date last) or 'done' (most recently done first, last 200).
// Volunteers only see follow-ups on their own visits.
async function listFollowUps({ isOwnOnly, userId, status }) {
  const params = [];
  const conditions = ['v.deleted_at IS NULL', NEEDS_FOLLOW_UP];
  conditions.push(status === 'done' ? 'v.follow_up_done_at IS NOT NULL' : 'v.follow_up_done_at IS NULL');
  if (isOwnOnly) {
    params.push(userId);
    conditions.push(`v.created_by = $${params.length}`);
  }
  const order =
    status === 'done'
      ? 'v.follow_up_done_at DESC LIMIT 200'
      : `NULLIF(v.form_data->>'followUpDate', '') ASC NULLS LAST, v.created_at ASC`;

  const { rows } = await pool.query(
    `SELECT v.id, v.beneficiary_id, v.beneficiary_name, v.location, v.volunteer_name, v.visit_date,
            v.urgency_level, v.form_data, v.follow_up_done_at, v.follow_up_note,
            b.reference_number, done_by.name AS done_by_name,
            later.id AS later_visit_id, later.visit_date AS later_visit_date
     FROM visits v
     LEFT JOIN beneficiaries b ON b.id = v.beneficiary_id
     LEFT JOIN users done_by ON done_by.id = v.follow_up_done_by
     LEFT JOIN LATERAL (
       SELECT l.id, l.visit_date FROM visits l
       WHERE l.beneficiary_id = v.beneficiary_id AND l.deleted_at IS NULL AND l.created_at > v.created_at
       ORDER BY l.created_at DESC LIMIT 1
     ) later ON true
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${order}`,
    params
  );

  return rows.map((r) => {
    const f = r.form_data || {};
    return {
      visitId: r.id,
      beneficiaryId: r.beneficiary_id,
      beneficiaryName: r.beneficiary_name,
      referenceNumber: f.referenceNumber || r.reference_number || null,
      ward: f.ward || null,
      location: r.location,
      volunteerName: r.volunteer_name,
      visitDate: r.visit_date,
      urgent: r.urgency_level === 'Urgent',
      dueDate: f.followUpDate || null,
      concernTypes: Array.isArray(f.urgentConcernTypes) ? f.urgentConcernTypes : [],
      concern: f.urgentConcernDescription || null,
      plannedFollowUp: f.immediateFollowUp || null,
      laterVisit: r.later_visit_id ? { id: r.later_visit_id, visitDate: r.later_visit_date } : null,
      doneAt: r.follow_up_done_at,
      doneByName: r.done_by_name,
      note: r.follow_up_note,
    };
  });
}

// Marks a visit's follow-up done (note optional) or, with done = false,
// reopens it. Returns false when the visit doesn't exist or never asked for
// a follow-up.
async function setFollowUpDone(id, { done, userId, note }) {
  const { rows } = await pool.query(
    `UPDATE visits v SET
       follow_up_done_at = CASE WHEN $2 THEN now() ELSE NULL END,
       follow_up_done_by = CASE WHEN $2 THEN $3::int ELSE NULL END,
       follow_up_note = CASE WHEN $2 THEN $4 ELSE NULL END
     WHERE v.id = $1 AND v.deleted_at IS NULL AND ${NEEDS_FOLLOW_UP}
     RETURNING v.id`,
    [id, done, userId, note || null]
  );
  return rows.length > 0;
}

// WHERE conditions shared by the visit list and the export, so a download
// holds exactly the visits the list shows. All filters are optional:
//   q        beneficiary name or reference number (case-insensitive, partial)
//   urgency  'urgent' | 'routine'
//   officer  exact field officer name
//   ward     exact ward (new-form visits only; older visits have none)
//   from/to  YYYY-MM-DD bounds on the visit date, inclusive
// Volunteers only see visits they logged themselves (isOwnOnly).
function filterConditions({ isOwnOnly, userId, q, urgency, officer, ward, from, to }) {
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (isOwnOnly) conditions.push(`created_by = ${add(userId)}`);
  if (q) {
    const pattern = add(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    conditions.push(
      `(beneficiary_name ILIKE ${pattern}
        OR form_data->>'referenceNumber' ILIKE ${pattern}
        OR EXISTS (SELECT 1 FROM beneficiaries b
                   WHERE b.id = visits.beneficiary_id AND b.reference_number ILIKE ${pattern}))`
    );
  }
  if (urgency === 'urgent') conditions.push(`urgency_level = 'Urgent'`);
  if (urgency === 'routine') conditions.push(`urgency_level IS DISTINCT FROM 'Urgent'`);
  if (officer) conditions.push(`volunteer_name = ${add(officer)}`);
  if (ward) conditions.push(`form_data->>'ward' = ${add(ward)}`);
  if (from) conditions.push(`visit_date >= ${add(from)}`);
  if (to) conditions.push(`visit_date <= ${add(to)}`);

  return { where: conditions.join(' AND '), params };
}

// Paginated via limit/offset (limit capped at 200, defaults to 50), newest
// first, narrowed by the filters above. Deleted visits are hidden everywhere
// (every read in this file filters on deleted_at).
async function list({ limit, offset, ...filters }) {
  const { where, params } = filterConditions(filters);

  const [countResult, rowsResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM visits WHERE ${where}`, params),
    pool.query(
      `SELECT * FROM visits
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  return {
    visits: rowsResult.rows.map(toVisit),
    total: countResult.rows[0].count,
  };
}

// Full visit history for one beneficiary, for the per-beneficiary timeline
// view. Volunteers only see visits they logged themselves.
async function listByBeneficiary(beneficiaryId, { isOwnOnly, userId }) {
  const { rows } = await pool.query(
    `SELECT * FROM visits
     WHERE beneficiary_id = $1 AND deleted_at IS NULL ${isOwnOnly ? 'AND created_by = $2' : ''}
     ORDER BY created_at DESC`,
    isOwnOnly ? [beneficiaryId, userId] : [beneficiaryId]
  );
  return rows.map(toVisit);
}

async function create({ createdBy, beneficiaryId, data }) {
  const row = toRow(data);
  const columns = Object.keys(row);
  const values = Object.values(row);
  const placeholders = values.map((_, i) => `$${i + 3}`);

  const result = await pool.query(
    `INSERT INTO visits (created_by, beneficiary_id, ${columns.join(', ')})
     VALUES ($1, $2, ${placeholders.join(', ')})
     RETURNING *`,
    [createdBy, beneficiaryId, ...values]
  );
  return toVisit(result.rows[0]);
}

// A single visit, e.g. to pre-fill an edit form. Volunteers only see visits
// they logged themselves — scoped the same way as list().
async function findById(id, { isOwnOnly, userId }) {
  const { rows } = await pool.query(
    `SELECT * FROM visits WHERE id = $1 AND deleted_at IS NULL ${isOwnOnly ? 'AND created_by = $2' : ''}`,
    isOwnOnly ? [id, userId] : [id]
  );
  return rows[0] ? toVisit(rows[0]) : null;
}

// Returns null if the partial update had no recognized fields — caller
// treats that as a 400, not a no-op success.
async function update(id, partialData) {
  const row = toPartialRow(partialData);
  const columns = Object.keys(row);
  if (columns.length === 0) {
    return null;
  }

  const values = Object.values(row);
  const setClauses = columns.map((column, i) => `${column} = $${i + 2}`);

  const result = await pool.query(
    `UPDATE visits SET ${setClauses.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, ...values]
  );
  return toVisit(result.rows[0]);
}

// The flat columns every list/stat/directory query reads, derived from a v2
// form so those keep working without knowing about form_data.
function summaryColumns(formData) {
  return {
    beneficiary_name: formData.beneficiaryName,
    age: formData.age,
    weight: formData.weight,
    location: formData.villageArea,
    volunteer_name: formData.fieldOfficerName,
    visit_date: formData.visitDate,
    registered_sha: formData.registeredSha,
    receiving_stipend: formData.receivingStipend,
    needs_identified: formData.importantNeeds,
    actions_recommendations: formData.immediateFollowUp,
    urgency_level: formData.urgentConcern === 'Yes' ? 'Urgent' : 'Routine',
  };
}

// clientSubmissionId (optional) is the phone's id for this submission; the
// same id from the same user never creates a second visit.
async function createV2({ createdBy, beneficiaryId, formVersion, formData, clientSubmissionId = null }) {
  const row = summaryColumns(formData);
  const columns = Object.keys(row);
  const values = Object.values(row);
  const placeholders = values.map((_, i) => `$${i + 6}`);

  try {
    const result = await pool.query(
      `INSERT INTO visits (created_by, beneficiary_id, form_version, form_data, client_submission_id, ${columns.join(', ')})
       VALUES ($1, $2, $3, $4, $5, ${placeholders.join(', ')})
       RETURNING *`,
      [createdBy, beneficiaryId, formVersion, formData, clientSubmissionId, ...values]
    );
    return toVisit(result.rows[0]);
  } catch (err) {
    // The same submission arrived twice at once; hand back the first.
    if (err.code === '23505' && clientSubmissionId) {
      const existing = await findBySubmissionId(createdBy, clientSubmissionId);
      if (existing) return existing;
    }
    throw err;
  }
}

// A visit this user already sent with this submission id (even one since
// deleted, so a late resend can't bring it back), or null.
async function findBySubmissionId(createdBy, clientSubmissionId) {
  const { rows } = await pool.query(
    'SELECT * FROM visits WHERE created_by = $1 AND client_submission_id = $2',
    [createdBy, clientSubmissionId]
  );
  return rows[0] ? toVisit(rows[0]) : null;
}

// Replaces the whole v2 form. Like update(), does not re-link the visit to a
// different beneficiary — identity is fixed at creation.
async function updateV2(id, { formVersion, formData }) {
  const row = summaryColumns(formData);
  const columns = Object.keys(row);
  const setClauses = columns.map((column, i) => `${column} = $${i + 4}`);

  const result = await pool.query(
    `UPDATE visits SET form_version = $2, form_data = $3, ${setClauses.join(', ')}
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, formVersion, formData, ...Object.values(row)]
  );
  return toVisit(result.rows[0]);
}

async function findFormById(id) {
  const { rows } = await pool.query(
    'SELECT created_by, form_version, form_data FROM visits WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rows[0] || null;
}

// Every visit matching the list filters, for a spreadsheet/ZIP export,
// oldest first.
async function listForExport(filters) {
  const { where, params } = filterConditions(filters);
  const { rows } = await pool.query(
    `SELECT * FROM visits WHERE ${where}
     ORDER BY visit_date ASC, id ASC`,
    params
  );
  return rows.map(toVisit);
}

// The field officers and wards that appear on visits in scope, for the
// Visits list filter dropdowns.
async function filterOptions({ isOwnOnly, userId }) {
  const { where, params } = filterConditions({ isOwnOnly, userId });
  const [officers, wards] = await Promise.all([
    pool.query(
      `SELECT DISTINCT volunteer_name AS value FROM visits
       WHERE ${where} AND volunteer_name <> '' ORDER BY 1`,
      params
    ),
    pool.query(
      `SELECT DISTINCT form_data->>'ward' AS value FROM visits
       WHERE ${where} AND COALESCE(form_data->>'ward', '') <> '' ORDER BY 1`,
      params
    ),
  ]);
  return { officers: officers.rows.map((r) => r.value), wards: wards.rows.map((r) => r.value) };
}

// Hides a visit (recoverable). Returns false if it doesn't exist or is
// already deleted.
async function softDelete(id, deletedBy) {
  const { rows } = await pool.query(
    `UPDATE visits SET deleted_at = now(), deleted_by = $2
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id, deletedBy]
  );
  return rows.length > 0;
}

// Brings a deleted visit back. Returns the visit, or null if it isn't in the bin.
async function restore(id) {
  const { rows } = await pool.query(
    `UPDATE visits SET deleted_at = NULL, deleted_by = NULL
     WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *`,
    [id]
  );
  return rows[0] ? toVisit(rows[0]) : null;
}

// Deleted visits still recoverable, newest deletion first.
async function listDeleted(retentionDays) {
  const { rows } = await pool.query(
    `SELECT v.id, v.beneficiary_name, v.location, v.visit_date, v.volunteer_name,
            v.deleted_at, u.name AS deleted_by_name,
            v.deleted_at + make_interval(days => $1) AS purge_at
     FROM visits v LEFT JOIN users u ON u.id = v.deleted_by
     WHERE v.deleted_at IS NOT NULL
     ORDER BY v.deleted_at DESC`,
    [retentionDays]
  );
  return rows.map((r) => ({
    id: r.id,
    beneficiaryName: r.beneficiary_name,
    location: r.location,
    visitDate: r.visit_date,
    volunteerName: r.volunteer_name,
    deletedAt: r.deleted_at,
    deletedByName: r.deleted_by_name,
    purgeAt: r.purge_at,
  }));
}

// Permanently removes visits deleted more than `days` ago. Their uploads are
// then unattached, and the upload cleanup job removes the files.
async function purgeDeletedOlderThan(days) {
  const { rows } = await pool.query(
    `DELETE FROM visits
     WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)
     RETURNING id`,
    [days]
  );
  return rows.map((r) => r.id);
}

module.exports = {
  listForExport,
  filterOptions,
  list,
  listByBeneficiary,
  create,
  update,
  createV2,
  findBySubmissionId,
  listFollowUps,
  setFollowUpDone,
  updateV2,
  findFormById,
  findById,
  toVisit,
  softDelete,
  restore,
  listDeleted,
  purgeDeletedOlderThan,
};
