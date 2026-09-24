const Beneficiary = require('../models/Beneficiary');
const Visit = require('../models/Visit');
const { normalizeReferenceNumber, PREFILL_FIELDS } = require('../schemas/visitFormDefinition');

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

// Reserve a new unique BHECO reference number for a ward. When the
// beneficiary's name and village are sent and someone with that name and
// village already has an ID, returns them as possibleDuplicates instead
// (no ID reserved) unless confirmNew is true.
async function generateReference(req, res) {
  const { ward, name, location, confirmNew } = req.body ?? {};
  const wardName = typeof ward === 'string' ? ward.trim() : '';
  if (!/[a-z]/i.test(wardName)) {
    return res.status(400).json({ error: 'Enter the ward name first' });
  }

  if (confirmNew !== true && typeof name === 'string' && name.trim() && typeof location === 'string' && location.trim()) {
    const possibleDuplicates = await Beneficiary.findPossibleDuplicates(name, location);
    if (possibleDuplicates.length > 0) {
      return res.json({ referenceNumber: null, possibleDuplicates });
    }
  }

  const referenceNumber = await Beneficiary.generateReferenceNumber(wardName);
  res.status(201).json({ referenceNumber, possibleDuplicates: [] });
}

// Who (if anyone) a reference number already belongs to, so field staff can
// tell a follow-up from a new registration before submitting. Includes
// `prefill` (details from their last visit) only for staff allowed to see
// that beneficiary's visits: volunteers must have visited them before.
async function lookupReference(req, res) {
  const raw = typeof req.query.ref === 'string' ? req.query.ref : '';
  const referenceNumber = normalizeReferenceNumber(raw);
  if (!referenceNumber) {
    return res.status(400).json({ error: 'Missing ref' });
  }

  const found = await Beneficiary.findByReference(referenceNumber);
  if (!found) {
    return res.json({ referenceNumber, beneficiary: null, prefill: null });
  }

  const { age, ...beneficiary } = found;
  const canSeeDetails = req.user.role !== 'Volunteer/CHW' || (await Beneficiary.hasVisitBy(found.id, req.user.id));
  let prefill = null;
  if (canSeeDetails) {
    const latest = await Beneficiary.latestFormData(found.id);
    if (latest) {
      const values = Object.fromEntries(
        PREFILL_FIELDS.filter((name) => latest.formData[name] !== undefined).map((name) => [name, latest.formData[name]])
      );
      prefill = { fromVisitDate: latest.visitDate, values };
    } else {
      // Only original-form visits so far: carry over what that form recorded.
      prefill = {
        fromVisitDate: null,
        values: { beneficiaryName: found.name, villageArea: found.location, ...(age ? { age } : {}) },
      };
    }
  }

  res.json({ referenceNumber, beneficiary, prefill });
}

module.exports = { list, detail, generateReference, lookupReference };
