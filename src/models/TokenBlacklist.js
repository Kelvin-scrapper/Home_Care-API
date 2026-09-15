const pool = require('../db');

async function isRevoked(jti) {
  const { rows } = await pool.query('SELECT 1 FROM token_blacklist WHERE jti = $1', [jti]);
  return rows.length > 0;
}

async function revoke(jti, expiresAt) {
  await pool.query(
    'INSERT INTO token_blacklist (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING',
    [jti, expiresAt]
  );
}

module.exports = { isRevoked, revoke };
