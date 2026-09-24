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
// directors/admins see everything.
async function list({ isOwnOnly, userId, limit, offset }) {
  const whereClause = isOwnOnly ? 'WHERE created_by = $1' : '';
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
     WHERE beneficiary_id = $1 ${isOwnOnly ? 'AND created_by = $2' : ''}
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
    `SELECT * FROM visits WHERE id = $1 ${isOwnOnly ? 'AND created_by = $2' : ''}`,
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
    `UPDATE visits SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
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
     WHERE id = $1 RETURNING *`,
    [id, formVersion, formData, ...Object.values(row)]
  );
  return toVisit(result.rows[0]);
}

async function findFormById(id) {
  const { rows } = await pool.query(
    'SELECT created_by, form_version, form_data FROM visits WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

// Every visit in scope for a spreadsheet export, oldest first. from/to are
// optional YYYY-MM-DD bounds on the visit date (inclusive).
async function listForExport({ isOwnOnly, userId, from, to }) {
  const conditions = [];
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
    `SELECT * FROM visits ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY visit_date ASC, id ASC`,
    params
  );
  return rows.map(toVisit);
}

module.exports = { listForExport, list, listByBeneficiary, create, update, createV2, updateV2, findFormById, findById, toVisit };
