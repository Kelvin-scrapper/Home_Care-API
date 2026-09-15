const bcrypt = require('bcrypt');
const pool = require('../db');

const SALT_ROUNDS = 10;
const ROLES = ['Volunteer/CHW', 'Coordinator/Field officer', 'Admin', 'Management/Director'];

async function findByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = $1',
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

function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password_hash);
}

module.exports = { ROLES, findByEmail, findById, list, create, verifyPassword };
