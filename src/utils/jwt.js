const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
// Field staff record visits where signal comes and goes, often for hours, so
// their sessions last longer; visits queued offline are sent with this token
// once the phone reconnects. Deactivation and sign-out still end a session
// at once (checked on every request).
const FIELD_EXPIRES_IN = process.env.JWT_FIELD_EXPIRES_IN || '7d';
const FIELD_ROLES = ['Volunteer/CHW', 'Coordinator/Field officer'];

function signAccessToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.id, email: user.email, jti },
    SECRET,
    { expiresIn: FIELD_ROLES.includes(user.role) ? FIELD_EXPIRES_IN : EXPIRES_IN }
  );
  return { token, jti };
}

function verifyAccessToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signAccessToken, verifyAccessToken };
