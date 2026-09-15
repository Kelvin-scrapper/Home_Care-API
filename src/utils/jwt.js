const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

function signAccessToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.id, email: user.email, jti },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
  return { token, jti };
}

function verifyAccessToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signAccessToken, verifyAccessToken };
