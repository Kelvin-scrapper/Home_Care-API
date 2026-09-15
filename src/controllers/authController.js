const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const { signAccessToken } = require('../utils/jwt');

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await User.findByEmail(email);
  if (!user || !(await User.verifyPassword(user, password))) {
    return res.status(401).json({ error: 'Invalid email or password' });
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
