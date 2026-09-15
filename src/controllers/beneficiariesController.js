const Beneficiary = require('../models/Beneficiary');
const Visit = require('../models/Visit');

// Volunteers only see beneficiaries/visits they've personally logged;
// coordinators/directors/admins see everyone.
async function list(req, res) {
  const user = req.user;
  const isOwnOnly = user.role === 'Volunteer/CHW';

  const beneficiaries = await Beneficiary.list({ isOwnOnly, userId: user.id });
  res.json(beneficiaries);
}

// A single beneficiary plus their full visit history, for a per-beneficiary
// timeline view. Volunteers only get this if they have at least one visit
// for that beneficiary — otherwise a 404, same as if it didn't exist.
async function detail(req, res) {
  const beneficiaryId = parseInt(req.params.id, 10);
  if (!Number.isInteger(beneficiaryId)) {
    return res.status(400).json({ error: 'Invalid beneficiary id' });
  }

  const user = req.user;
  const isOwnOnly = user.role === 'Volunteer/CHW';

  const beneficiary = await Beneficiary.findById(beneficiaryId);
  if (!beneficiary) {
    return res.status(404).json({ error: 'Beneficiary not found' });
  }

  const visits = await Visit.listByBeneficiary(beneficiaryId, { isOwnOnly, userId: user.id });
  if (isOwnOnly && visits.length === 0) {
    return res.status(404).json({ error: 'Beneficiary not found' });
  }

  res.json({ ...beneficiary, visits });
}

module.exports = { list, detail };
