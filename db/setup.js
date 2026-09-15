// Applies db/init.sql against DATABASE_URL. Safe to re-run (the schema uses
// IF NOT EXISTS throughout). Run with `npm run db:setup`.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema applied.');
}

main()
  .catch((err) => {
    console.error('Failed to apply schema:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
