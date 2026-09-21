const User = require('../models/User');

async function list(req, res) {
  res.json(await User.list());
}

async function create(req, res) {
  const { name, email, password, role } = req.body ?? {};
  if (
    typeof name !== 'string' || typeof email !== 'string' ||
    typeof password !== 'string' || typeof role !== 'string' ||
    !name.trim() || !email.trim() || !password || !role
  ) {
    return res.status(400).json({ error: 'name, email, password and role are required' });
  }
  if (!User.ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${User.ROLES.join(', ')}` });
  }
  if (email.length > User.MAX_EMAIL_LENGTH || password.length > User.MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'email or password is too long' });
  }

  // Stored lowercased so it matches how login looks emails up.
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'Email is already registered' });
  }

  const user = await User.create({ name: name.trim(), email: normalizedEmail, password, role });
  res.status(201).json(user);
}

module.exports = { list, create };
