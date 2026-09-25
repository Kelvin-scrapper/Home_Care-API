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
  };
  for (const [key, column] of Object.entries(FIELD_MAP)) {
    visit[key] = row[column];
  }
  return visit;
}

// Paginated via limit/offset (limit capped at 200, defaults to 50).
// Volunteers only see visits they logged themselves; coordinators/
// directors/admins see everything. Deleted visits are hidden everywhere
// (every read in this file filters on deleted_at).
async function list({ isOwnOnly, userId, limit, offset }) {
  const whereClause = isOwnOnly ? 'WHERE deleted_at IS NULL AND created_by = $1' : 'WHERE deleted_at IS NULL';
  const scopeParams = isOwnOnly ? [userId] : [];

  const [countResult, rowsResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM visits ${whereClause}`, scopeParams),
    pool.query(
      `SELECT * FROM visits
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${scopeParams.length + 1} OFFSET $${scopeParams.length + 2}`,
      [...scopeParams, limit, offset]
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

async function createV2({ createdBy, beneficiaryId, formVersion, formData }) {
  const row = summaryColumns(formData);
  const columns = Object.keys(row);
  const values = Object.values(row);
  const placeholders = values.map((_, i) => `$${i + 5}`);

  const result = await pool.query(
    `INSERT INTO visits (created_by, beneficiary_id, form_version, form_data, ${columns.join(', ')})
     VALUES ($1, $2, $3, $4, ${placeholders.join(', ')})
     RETURNING *`,
    [createdBy, beneficiaryId, formVersion, formData, ...values]
  );
  return toVisit(result.rows[0]);
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

// Every visit in scope for a spreadsheet export, oldest first. from/to are
// optional YYYY-MM-DD bounds on the visit date (inclusive).
async function listForExport({ isOwnOnly, userId, from, to }) {
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  if (isOwnOnly) {
    params.push(userId);
    conditions.push(`created_by = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`visit_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`visit_date <= $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT * FROM visits WHERE ${conditions.join(' AND ')}
     ORDER BY visit_date ASC, id ASC`,
    params
  );
  return rows.map(toVisit);
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
  list,
  listByBeneficiary,
  create,
  update,
  createV2,
  updateV2,
  findFormById,
  findById,
  toVisit,
  softDelete,
  restore,
  listDeleted,
  purgeDeletedOlderThan,
};
