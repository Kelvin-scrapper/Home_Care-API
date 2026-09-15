const pool = require('../db');

// Finds the beneficiary matching (name, location), or creates one. Race-safe
// under concurrent requests via the unique index on lower(name),
// lower(location) (see db/init.sql) + ON CONFLICT DO NOTHING.
async function findOrCreate({ name, location, age, weight, timeInCommunity }) {
  const trimmedName = name.trim();
  const trimmedLocation = location.trim();

  const inserted = await pool.query(
    `INSERT INTO beneficiaries (name, location, age, weight, time_in_community)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lower(name), lower(location)) DO NOTHING
     RETURNING id`,
    [trimmedName, trimmedLocation, age || null, weight || null, timeInCommunity || null]
  );
  if (inserted.rows[0]) {
    return inserted.rows[0].id;
  }

  const existing = await pool.query(
    `SELECT id FROM beneficiaries WHERE lower(name) = lower($1) AND lower(location) = lower($2)`,
    [trimmedName, trimmedLocation]
  );
  return existing.rows[0].id;
}

// Beneficiary directory with visit counts. Volunteers only see beneficiaries
// they've personally visited; coordinators/directors/admins see everyone.
async function list({ isOwnOnly, userId }) {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.location, b.age, b.weight,
            b.time_in_community AS "timeInCommunity",
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
    `SELECT id, name, location, age, weight, time_in_community AS "timeInCommunity"
     FROM beneficiaries WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

module.exports = { findOrCreate, list, findById };
