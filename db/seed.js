// Seeds users. Safe to re-run — upserts by email. Run with `npm run db:seed`,
// and automatically on container start (see Dockerfile).
//
//  - SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD set: seeds only that Admin
//    (SEED_ADMIN_NAME optional). Use this on any server reachable from the
//    internet.
//  - Otherwise, outside production: seeds one test account per role, all
//    with the password "password".
//  - Otherwise (NODE_ENV=production, no admin configured): seeds nothing, so
//    default-credential accounts can never be created on a live server.
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/db');

const TEST_PASSWORD = 'password';

const TEST_USERS = [
  { name: 'System Admin', email: 'admin@bheco.org', role: 'Admin' },
  { name: 'Programme Director', email: 'director@bheco.org', role: 'Management/Director' },
  { name: 'Field Coordinator', email: 'coordinator@bheco.org', role: 'Coordinator/Field officer' },
  { name: 'Field Volunteer', email: 'volunteer@bheco.org', role: 'Volunteer/CHW' },
];

const { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME } = process.env;
const adminConfigured = Boolean(SEED_ADMIN_EMAIL && SEED_ADMIN_PASSWORD);

function getSeedUsers() {
  if (adminConfigured) {
    return [
      {
        name: SEED_ADMIN_NAME || 'System Admin',
        email: SEED_ADMIN_EMAIL,
        role: 'Admin',
        password: SEED_ADMIN_PASSWORD,
      },
    ];
  }
  if (process.env.NODE_ENV === 'production') {
    return [];
  }
  return TEST_USERS.map((user) => ({ ...user, password: TEST_PASSWORD }));
}

async function main() {
  const users = getSeedUsers();
  if (users.length === 0) {
    console.log('NODE_ENV=production and no SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD set — skipping user seed.');
    return;
  }

  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [user.name, user.email, passwordHash, user.role]
    );
    console.log(`Seeded ${user.email} (${user.role})`);
  }

  if (!adminConfigured) {
    console.log(`\nAll seeded accounts use password: "${TEST_PASSWORD}"`);
  }
}

main()
  .catch((err) => {
    console.error('Failed to seed database:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
