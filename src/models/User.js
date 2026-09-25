const bcrypt = require('bcrypt');
const pool = require('../db');

const SALT_ROUNDS = 10;
const ROLES = ['Volunteer/CHW', 'Coordinator/Field officer', 'Admin', 'Management/Director'];

// Shared by login and user creation/editing so an account can always be
// signed in to. (bcrypt only uses the first 72 bytes anyway.)
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// Checked against when the email doesn't exist, so a failed login takes about
// as long whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

// Case-insensitive, so accounts created with a differently-cased email can
// still sign in. Callers pass an already trimmed/lowercased email.
// What the admin user list and edit endpoints return.
const PUBLIC_COLUMNS = `id, name, email, role, created_at AS "createdAt",
  deactivated_at IS NULL AS active, deactivated_at AS "deactivatedAt"`;

async function findByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, password_hash, deactivated_at FROM users WHERE lower(email) = lower($1)',
    [email]
  );
  return rows[0] || null;
}

// The signed-in user for an authenticated request. Deactivated accounts
// aren't returned, so their sessions end on the next request.
async function findActiveById(id) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role FROM users WHERE id = $1 AND deactivated_at IS NULL',
    [id]
  );
  return rows[0] || null;
}

// Any account, active or not (for admin edits).
async function findById(id) {
  const { rows } = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function list() {
  const { rows } = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at ASC`);
  return rows;
}

async function countActiveByRole(role) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE role = $1 AND deactivated_at IS NULL',
    [role]
  );
  return rows[0].count;
}

async function create({ name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PUBLIC_COLUMNS}`,
    [name, email, passwordHash, role]
  );
  return rows[0];
}

// Only the fields present in `changes` are touched. `password`, if given, is
// hashed here; `active: false` deactivates, `active: true` reactivates.
// Returns null if the user doesn't exist.
async function update(id, { name, email, role, password, active }) {
  const values = [id];
  const sets = [];
  const set = (column, value) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (name !== undefined) set('name', name);
  if (email !== undefined) set('email', email);
  if (role !== undefined) set('role', role);
  if (password !== undefined) set('password_hash', await bcrypt.hash(password, SALT_ROUNDS));
  // Keeps the original deactivation time if an inactive account is saved again.
  if (active === false) sets.push('deactivated_at = COALESCE(deactivated_at, now())');
  if (active === true) sets.push('deactivated_at = NULL');

  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    values
  );
  return rows[0] || null;
}

// `user` may be null (unknown email): the dummy comparison still runs, but the
// result is always false.
async function verifyPassword(user, password) {
  const matches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  return Boolean(user) && matches;
}

module.exports = {
  ROLES,
  MAX_EMAIL_LENGTH,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  findByEmail,
  findActiveById,
  findById,
  list,
  countActiveByRole,
  create,
  update,
  verifyPassword,
};
