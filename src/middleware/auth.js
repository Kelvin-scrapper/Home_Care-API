const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const { verifyAccessToken } = require('../utils/jwt');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (await TokenBlacklist.isRevoked(decoded.jti)) {
    return res.status(401).json({ error: 'Token has been revoked' });
  }

  const user = await User.findById(decoded.sub);
  if (!user) {
    return res.status(401).json({ error: 'User no longer exists' });
  }

  req.user = user;
  req.tokenMeta = { jti: decoded.jti, exp: decoded.exp };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
