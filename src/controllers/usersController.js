const User = require('../models/User');

async function list(req, res) {
  res.json(await User.list());
}

async function create(req, res) {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required' });
  }
  if (!User.ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${User.ROLES.join(', ')}` });
  }

  const existing = await User.findByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Email is already registered' });
  }

  const user = await User.create({ name, email, password, role });
  res.status(201).json(user);
}

module.exports = { list, create };
