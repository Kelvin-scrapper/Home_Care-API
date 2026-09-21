const bcrypt = require('bcrypt');
const pool = require('../db');

const SALT_ROUNDS = 10;
const ROLES = ['Volunteer/CHW', 'Coordinator/Field officer', 'Admin', 'Management/Director'];

// Shared by login and user creation so an account can always be signed in to.
// (bcrypt only uses the first 72 bytes anyway.)
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;

// Checked against when the email doesn't exist, so a failed login takes about
// as long whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

// Case-insensitive, so accounts created with a differently-cased email can
// still sign in. Callers pass an already trimmed/lowercased email.
async function findByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [email]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function list() {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, created_at AS "createdAt"
     FROM users
     ORDER BY created_at ASC`
  );
  return rows;
}

async function create({ name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role, created_at AS "createdAt"`,
    [name, email, passwordHash, role]
  );
  return rows[0];
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
  MAX_PASSWORD_LENGTH,
  findByEmail,
  findById,
  list,
  create,
  verifyPassword,
};
