// One-off script: seeds one test account per role, matching the login hint
// shown on the sign-in page. Safe to re-run — upserts by email.
// Run with `npm run db:seed`.
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/db');

const TEST_PASSWORD = 'password';

const SEED_USERS = [
  { name: 'System Admin', email: 'admin@bheco.org', role: 'Admin' },
  { name: 'Programme Director', email: 'director@bheco.org', role: 'Management/Director' },
  { name: 'Field Coordinator', email: 'coordinator@bheco.org', role: 'Coordinator/Field officer' },
  { name: 'Field Volunteer', email: 'volunteer@bheco.org', role: 'Volunteer/CHW' },
];

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  for (const user of SEED_USERS) {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [user.name, user.email, passwordHash, user.role]
    );
    console.log(`Seeded ${user.email} (${user.role})`);
  }

  console.log(`\nAll seeded accounts use password: "${TEST_PASSWORD}"`);
}

main()
  .catch((err) => {
    console.error('Failed to seed database:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
