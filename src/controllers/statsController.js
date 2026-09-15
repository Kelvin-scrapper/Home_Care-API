const Stats = require('../models/Stats');

// Single aggregate endpoint backing every role's dashboard. Each of the four
// dashboards (Volunteer/Coordinator/Director/Admin) reads only the fields it
// needs from this response — see src/models/Stats.js for the query set.
async function dashboard(req, res) {
  const user = req.user;
  const isOwnOnly = user.role === 'Volunteer/CHW';

  const stats = await Stats.getDashboard({ isOwnOnly, userId: user.id });
  res.json(stats);
}

module.exports = { dashboard };
