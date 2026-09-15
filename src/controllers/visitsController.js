const Visit = require('../models/Visit');
const Beneficiary = require('../models/Beneficiary');
const { visitFormSchema } = require('../schemas/visit');

// List visits. Volunteers only see visits they logged themselves;
// coordinators/directors/admins see everything. Paginated via
// ?limit=&offset= (limit capped at 200, defaults to 50).
async function list(req, res) {
  const user = req.user;
  const isOwnOnly = user.role === 'Volunteer/CHW';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const { visits, total } = await Visit.list({ isOwnOnly, userId: user.id, limit, offset });
  res.json({ visits, total, limit, offset });
}

// A single visit, e.g. to pre-fill an edit form. Same visibility rule as
// list(): volunteers only see their own — a visit outside that scope 404s
// rather than 403s, so its existence isn't leaked to a volunteer either way.
async function detail(req, res) {
  const visitId = parseInt(req.params.id, 10);
  if (!Number.isInteger(visitId)) {
    return res.status(400).json({ error: 'Invalid visit id' });
  }

  const user = req.user;
  const isOwnOnly = user.role === 'Volunteer/CHW';
  const visit = await Visit.findById(visitId, { isOwnOnly, userId: user.id });
  if (!visit) {
    return res.status(404).json({ error: 'Visit not found' });
  }

  res.json(visit);
}

// Create a visit. Only field staff (volunteers and coordinators) log visits —
// enforced by requireRole on the route.
async function create(req, res) {
  const parsed = visitFormSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid visit data',
      details: parsed.error.flatten(),
    });
  }

  const beneficiaryId = await Beneficiary.findOrCreate(parsed.data);
  const visit = await Visit.create({ createdBy: req.user.id, beneficiaryId, data: parsed.data });

  res.status(201).json(visit);
}

// Edit a visit — e.g. fix a typo or add a follow-up note to an urgent case.
// Volunteers may only edit visits they logged themselves; coordinators may
// edit any visit. Note: editing beneficiaryName/location does NOT re-link
// the visit to a different beneficiary row — identity is fixed at creation.
async function update(req, res) {
  const visitId = parseInt(req.params.id, 10);
  if (!Number.isInteger(visitId)) {
    return res.status(400).json({ error: 'Invalid visit id' });
  }

  const parsed = visitFormSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid visit data',
      details: parsed.error.flatten(),
    });
  }

  const existing = await Visit.findCreatorById(visitId);
  if (!existing) {
    return res.status(404).json({ error: 'Visit not found' });
  }

  const user = req.user;
  if (user.role === 'Volunteer/CHW' && existing.created_by !== user.id) {
    return res.status(403).json({ error: 'You can only edit visits you logged yourself' });
  }

  const updated = await Visit.update(visitId, parsed.data);
  if (!updated) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  res.json(updated);
}

module.exports = { list, detail, create, update };
