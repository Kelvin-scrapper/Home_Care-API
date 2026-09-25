const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const { signAccessToken } = require('../utils/jwt');

async function login(req, res) {
  // req.body is undefined when the request has no JSON body / wrong Content-Type.
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (email.length > User.MAX_EMAIL_LENGTH || password.length > User.MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'email or password is too long' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findByEmail(normalizedEmail);
  const passwordMatches = await User.verifyPassword(user, password);

  if (!user || !passwordMatches) {
    // The client always gets the same message, so this endpoint can't be used
    // to discover which emails have accounts. The real reason goes to the log.
    console.warn(
      `[auth] failed login (${user ? 'wrong password' : 'unknown email'}) for ${JSON.stringify(normalizedEmail)} from ${req.ip}`
    );
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Only reachable with the right password, so it reveals nothing to a guesser.
  if (user.deactivated_at) {
    console.warn(`[auth] login refused for deactivated account ${JSON.stringify(normalizedEmail)} from ${req.ip}`);
    return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
  }

  const { token } = signAccessToken(user);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
}

async function logout(req, res) {
  const { jti, exp } = req.tokenMeta;
  await TokenBlacklist.revoke(jti, new Date(exp * 1000));
  res.status(204).send();
}

async function me(req, res) {
  res.json(req.user);
}

module.exports = { login, logout, me };
