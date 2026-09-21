const User = require('../models/User');

async function list(req, res) {
  res.json(await User.list());
}

// Returns a message if the password isn't acceptable, otherwise null.
function passwordProblem(password) {
  if (typeof password !== 'string') return 'password must be a string';
  if (password.length < User.MIN_PASSWORD_LENGTH) {
    return `password must be at least ${User.MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > User.MAX_PASSWORD_LENGTH) return 'password is too long';
  return null;
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
  if (email.length > User.MAX_EMAIL_LENGTH) {
    return res.status(400).json({ error: 'email is too long' });
  }
  const problem = passwordProblem(password);
  if (problem) {
    return res.status(400).json({ error: problem });
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

// Edit an account. Any of name, email, role and password may be sent; only
// those are changed. Role changes apply immediately: the role is read fresh
// from the database on every authenticated request, not baked into the token.
// (Sessions that already exist stay valid until their token expires, even
// after a password reset.)
async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const { name, email, password, role } = req.body ?? {};
  const changes = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    changes.name = name.trim();
  }
  if (email !== undefined) {
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email must be a non-empty string' });
    }
    if (email.length > User.MAX_EMAIL_LENGTH) {
      return res.status(400).json({ error: 'email is too long' });
    }
    changes.email = email.trim().toLowerCase();
  }
  if (role !== undefined) {
    if (!User.ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${User.ROLES.join(', ')}` });
    }
    changes.role = role;
  }
  if (password !== undefined) {
    const problem = passwordProblem(password);
    if (problem) {
      return res.status(400).json({ error: problem });
    }
    changes.password = password;
  }
  if (Object.keys(changes).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const target = await User.findById(id);
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (changes.email && changes.email !== target.email.toLowerCase()) {
    const existing = await User.findByEmail(changes.email);
    if (existing && existing.id !== id) {
      return res.status(409).json({ error: 'Email is already registered' });
    }
  }

  // Never leave the system without an Admin (including an Admin demoting themselves).
  if (changes.role && target.role === 'Admin' && changes.role !== 'Admin') {
    if ((await User.countByRole('Admin')) <= 1) {
      return res.status(400).json({ error: 'At least one Admin account must remain' });
    }
  }

  let updated;
  try {
    updated = await User.update(id, changes);
  } catch (err) {
    // Lost a race with another request creating/renaming to the same email.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email is already registered' });
    }
    throw err;
  }

  console.info(`[users] user ${req.user.id} updated user ${id}: ${Object.keys(changes).join(', ')}`);
  res.json(updated);
}

module.exports = { list, create, update };
