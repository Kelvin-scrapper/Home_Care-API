const pool = require('../db');

// Original-form (v1) identity: (name, location). Links to any existing
// beneficiary with that name and location — including one that has since
// been given a reference number — and otherwise creates an unreferenced row.
// Race-safe via the partial unique index on unreferenced (name, location).
async function findOrCreate({ name, location, age, weight, timeInCommunity }) {
  const trimmedName = name.trim();
  const trimmedLocation = location.trim();
  const findExisting = () =>
    pool.query(
      `SELECT id FROM beneficiaries
       WHERE lower(name) = lower($1) AND lower(location) = lower($2)
       ORDER BY id LIMIT 1`,
      [trimmedName, trimmedLocation]
    );

  const existing = await findExisting();
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const inserted = await pool.query(
    `INSERT INTO beneficiaries (name, location, age, weight, time_in_community)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lower(name), lower(location)) WHERE reference_number IS NULL DO NOTHING
     RETURNING id`,
    [trimmedName, trimmedLocation, age || null, weight || null, timeInCommunity || null]
  );
  if (inserted.rows[0]) {
    return inserted.rows[0].id;
  }
  return (await findExisting()).rows[0].id;
}

async function findIdByReference(referenceNumber) {
  const { rows } = await pool.query('SELECT id FROM beneficiaries WHERE reference_number = $1', [referenceNumber]);
  return rows[0]?.id ?? null;
}

// v2 identity: the (normalized) BHECO reference number alone. The only
// (name, location) matching left is to adopt an original-form record that
// has no reference number yet, so that person keeps their visit history.
// A beneficiary who already has a different reference number is never
// matched by name — two elders can share a name and village.
async function findOrCreateByReference({ referenceNumber, name, location, age, weight }) {
  const existingId = await findIdByReference(referenceNumber);
  if (existingId) {
    return existingId;
  }

  try {
    const adopted = await pool.query(
      `UPDATE beneficiaries SET reference_number = $3
       WHERE id = (
         SELECT id FROM beneficiaries
         WHERE reference_number IS NULL AND lower(name) = lower($1) AND lower(location) = lower($2)
         ORDER BY id LIMIT 1
       )
       RETURNING id`,
      [name.trim(), location.trim(), referenceNumber]
    );
    if (adopted.rows[0]) {
      return adopted.rows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO beneficiaries (name, location, age, weight, reference_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name.trim(), location.trim(), age || null, weight || null, referenceNumber]
    );
    return rows[0].id;
  } catch (err) {
    // Another request registered this reference number concurrently.
    if (err.code === '23505') {
      const retryId = await findIdByReference(referenceNumber);
      if (retryId) return retryId;
    }
    throw err;
  }
}

// Beneficiary directory with visit counts. Volunteers only see beneficiaries
// they've personally visited; coordinators/directors/admins see everyone.
async function list({ isOwnOnly, userId }) {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.location, b.age, b.weight,
            b.time_in_community AS "timeInCommunity",
            b.reference_number AS "referenceNumber",
            COUNT(v.id)::int AS "visitCount",
            MAX(v.created_at) AS "lastVisitAt"
     FROM beneficiaries b
     JOIN visits v ON v.beneficiary_id = b.id
     ${isOwnOnly ? 'WHERE v.created_by = $1' : ''}
     GROUP BY b.id
     ORDER BY "lastVisitAt" DESC`,
    isOwnOnly ? [userId] : []
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, location, age, weight, time_in_community AS "timeInCommunity",
            reference_number AS "referenceNumber"
     FROM beneficiaries WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Ward name -> two-letter code: first letter plus the next consonant, so
// "Nakuru" -> "NK" (matching the form's BHECO-NK-001 example). Codes may
// collide between wards; uniqueness comes from the per-code sequence.
function wardCode(ward) {
  const letters = String(ward || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!letters) return null;
  const consonant = letters.slice(1).split('').find((c) => !'AEIOU'.includes(c));
  return letters[0] + (consonant || letters[1] || 'X');
}

function formatReference(code, number) {
  return `BHECO-${code}-${String(number).padStart(3, '0')}`;
}

// Reserves the next unused reference number for a ward. The first reservation
// for a code starts after the highest number already on record for it; any
// number someone typed in by hand is skipped rather than reused.
async function generateReferenceNumber(ward) {
  const code = wardCode(ward);
  if (!code) return null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await pool.query(
      `INSERT INTO reference_sequences (code, last_number)
       VALUES ($1, COALESCE((
         SELECT MAX(substring(reference_number from '-(\\d+)$')::int)
         FROM beneficiaries WHERE reference_number LIKE 'BHECO-' || $1 || '-%'
       ), 0) + 1)
       ON CONFLICT (code) DO UPDATE SET last_number = reference_sequences.last_number + 1
       RETURNING last_number`,
      [code]
    );
    const referenceNumber = formatReference(code, rows[0].last_number);
    const taken = await pool.query('SELECT 1 FROM beneficiaries WHERE reference_number = $1', [referenceNumber]);
    if (taken.rows.length === 0) return referenceNumber;
  }
  throw new Error(`Could not find a free reference number for code ${code}`);
}

async function findByReference(referenceNumber) {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.location, b.age, b.reference_number AS "referenceNumber",
            COUNT(v.id)::int AS "visitCount"
     FROM beneficiaries b
     LEFT JOIN visits v ON v.beneficiary_id = b.id
     WHERE b.reference_number = $1
     GROUP BY b.id`,
    [referenceNumber]
  );
  return rows[0] || null;
}

// Beneficiaries that already have a reference number and the same name and
// village — shown before a new ID is created for what may be the same person.
async function findPossibleDuplicates(name, location) {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.location, b.reference_number AS "referenceNumber",
            COUNT(v.id)::int AS "visitCount"
     FROM beneficiaries b
     LEFT JOIN visits v ON v.beneficiary_id = b.id
     WHERE b.reference_number IS NOT NULL
       AND lower(trim(b.name)) = lower(trim($1))
       AND lower(trim(b.location)) = lower(trim($2))
     GROUP BY b.id
     ORDER BY b.id`,
    [name, location]
  );
  return rows;
}

async function hasVisitBy(beneficiaryId, userId) {
  const { rows } = await pool.query('SELECT 1 FROM visits WHERE beneficiary_id = $1 AND created_by = $2 LIMIT 1', [
    beneficiaryId,
    userId,
  ]);
  return rows.length > 0;
}

// The most recent new-form answers for a beneficiary, or null.
async function latestFormData(beneficiaryId) {
  const { rows } = await pool.query(
    `SELECT form_data, visit_date FROM visits
     WHERE beneficiary_id = $1 AND form_version = 2 AND form_data IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [beneficiaryId]
  );
  return rows[0] ? { formData: rows[0].form_data, visitDate: rows[0].visit_date } : null;
}

module.exports = {
  findIdByReference,
  findPossibleDuplicates,
  hasVisitBy,
  latestFormData,
  findOrCreate,
  findOrCreateByReference,
  list,
  findById,
  wardCode,
  generateReferenceNumber,
  findByReference,
};
