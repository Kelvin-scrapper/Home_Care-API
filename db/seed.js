// Seeds users. Safe to re-run — upserts by email. Run with `npm run db:seed`,
// and automatically on container start (see Dockerfile).
//
//  1. SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD set: only that Admin, created or
//     reset to this password every time. The recovery path if an admin is
//     locked out (SEED_ADMIN_NAME optional).
//  2. NODE_ENV=production: the accounts listed in db/seed-users.js, but only
//     on a fresh database (no users yet). After that users are managed in the
//     app, so redeploys never overwrite edits.
//  3. Otherwise (local dev): one test account per role, all with the
//     password "password", reset on every run.
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/db');
const { ROLES } = require('../src/models/User');

const SALT_ROUNDS = 10;
const TEST_PASSWORD = 'password';

const TEST_USERS = [
  { name: 'System Admin', email: 'admin@bheco.org', role: 'Admin' },
  { name: 'Programme Director', email: 'director@bheco.org', role: 'Management/Director' },
  { name: 'Field Coordinator', email: 'coordinator@bheco.org', role: 'Coordinator/Field officer' },
  { name: 'Field Volunteer', email: 'volunteer@bheco.org', role: 'Volunteer/CHW' },
];

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// Checks every entry up front so a typo in db/seed-users.js is reported clearly
// and nothing is half-applied.
function validateUsers(users) {
  const problems = [];
  const seen = new Set();

  users.forEach((user, index) => {
    const label = `entry ${index + 1}${user && user.email ? ` (${user.email})` : ''}`;
    if (!user || typeof user.name !== 'string' || !user.name.trim()) {
      problems.push(`${label}: name is required`);
    }
    if (!user || typeof user.email !== 'string' || !user.email.includes('@')) {
      problems.push(`${label}: a valid email is required`);
    } else {
      const key = user.email.trim().toLowerCase();
      if (seen.has(key)) problems.push(`${label}: duplicate email`);
      seen.add(key);
    }
    if (!user || !ROLES.includes(user.role)) {
      problems.push(`${label}: role must be one of ${ROLES.join(', ')}`);
    }
    if (!user || typeof user.passwordHash !== 'string' || !BCRYPT_HASH.test(user.passwordHash)) {
      problems.push(`${label}: passwordHash must be a bcrypt hash (make one with: npm run db:hash -- "<password>")`);
    }
  });

  if (problems.length > 0) {
    throw new Error(`Invalid seed users:\n - ${problems.join('\n - ')}`);
  }
}

const { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME } = process.env;
const adminConfigured = Boolean(SEED_ADMIN_EMAIL && SEED_ADMIN_PASSWORD);
const useFixedUsers = !adminConfigured && process.env.NODE_ENV === 'production';
const useTestAccounts = !adminConfigured && !useFixedUsers;

async function getSeedUsers() {
  if (adminConfigured) {
    return [
      {
        name: SEED_ADMIN_NAME || 'System Admin',
        email: SEED_ADMIN_EMAIL,
        role: 'Admin',
        passwordHash: await bcrypt.hash(SEED_ADMIN_PASSWORD, SALT_ROUNDS),
      },
    ];
  }
  if (useTestAccounts) {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, SALT_ROUNDS);
    return TEST_USERS.map((user) => ({ ...user, passwordHash }));
  }
  return require('./seed-users');
}

async function main() {
  if (useFixedUsers) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    if (rows[0].count > 0) {
      console.log('Users already exist — leaving them as they are.');
      return;
    }
  }

  const users = await getSeedUsers();
  if (users.length === 0) {
    console.log('db/seed-users.js is empty — skipping user seed.');
    return;
  }
  validateUsers(users);

  const onConflict = useFixedUsers
    ? 'DO NOTHING'
    : 'DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role';

  for (const user of users) {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) ${onConflict}`,
      [user.name.trim(), user.email.trim().toLowerCase(), user.passwordHash, user.role]
    );
    console.log(`Seeded ${user.email.trim().toLowerCase()} (${user.role})`);
  }

  if (useTestAccounts) {
    console.log(`\nAll seeded accounts use password: "${TEST_PASSWORD}"`);
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Failed to seed database:', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { validateUsers };
