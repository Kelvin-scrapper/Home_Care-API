const Visit = require('../models/Visit');
const Beneficiary = require('../models/Beneficiary');
const Upload = require('../models/Upload');
const { toXlsx, toCsv, toZip } = require('../utils/visitExport');
const { RETENTION_DAYS } = require('../jobs/purgeDeletedVisits');
const { visitFormSchema } = require('../schemas/visit');
const {
  FORM_VERSION,
  validateVisitForm,
  fileFields,
  normalizeReferenceNumber,
} = require('../schemas/visitFormDefinition');

// Validates a v2 submission and swaps each file reference for the stored
// upload's metadata. Returns { formData } or { status, body } on failure.
// `previousFormData` lets an edit keep files someone else attached.
async function prepareV2Form(body, user, previousFormData) {
  const { data, errors } = validateVisitForm(body);
  if (Object.keys(errors).length > 0) {
    return { status: 400, body: { error: 'Please complete all required fields', fieldErrors: errors } };
  }
  data.referenceNumber = normalizeReferenceNumber(data.referenceNumber);

  const fields = fileFields().filter((f) => data[f.name]);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalid = fields.find((f) => !uuidPattern.test(data[f.name].id));
  if (invalid) {
    return { status: 400, body: { error: 'Invalid file', fieldErrors: { [invalid.name]: 'Invalid file' } } };
  }

  const rows = await Upload.findManyByIds(fields.map((f) => data[f.name].id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const previousIds = new Set(
    Object.values(previousFormData || {})
      .filter((v) => v && typeof v === 'object' && typeof v.id === 'string')
      .map((v) => v.id)
  );

  for (const field of fields) {
    const row = byId.get(data[field.name].id);
    const usable =
      row &&
      row.kind === field.fileKind &&
      (row.uploaded_by === user.id || previousIds.has(row.id));
    if (!usable) {
      return {
        status: 400,
        body: { error: 'An attached file could not be found', fieldErrors: { [field.name]: 'File not found — please upload it again' } },
      };
    }
    data[field.name] = Upload.toUpload(row);
  }

  return { formData: data };
}

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
  if (req.body?.formVersion === FORM_VERSION) {
    const prepared = await prepareV2Form(req.body, req.user, null);
    if (!prepared.formData) {
      return res.status(prepared.status).json(prepared.body);
    }
    const { formData } = prepared;

    // A new reference number for a name + village that already has one is
    // probably the same person registered twice — ask before creating them.
    if (req.body.confirmNewBeneficiary !== true && !(await Beneficiary.findIdByReference(formData.referenceNumber))) {
      const possibleDuplicates = await Beneficiary.findPossibleDuplicates(formData.beneficiaryName, formData.villageArea);
      if (possibleDuplicates.length > 0) {
        return res.status(409).json({
          error: 'A beneficiary with this name and village already has a reference number',
          possibleDuplicates,
        });
      }
    }

    const beneficiaryId = await Beneficiary.findOrCreateByReference({
      referenceNumber: formData.referenceNumber,
      name: formData.beneficiaryName,
      location: formData.villageArea,
      age: formData.age,
      weight: formData.weight,
    });
    const visit = await Visit.createV2({
      createdBy: req.user.id,
      beneficiaryId,
      formVersion: FORM_VERSION,
      formData,
    });
    return res.status(201).json(visit);
  }

  const parsed = visitFormSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid visit data',
      details: parsed.error.flatten(),
    });
  }

  const beneficiaryId = await Beneficiary.findOrCreate({
    name: parsed.data.beneficiaryName,
    location: parsed.data.location,
    age: parsed.data.age,
    weight: parsed.data.weight,
    timeInCommunity: parsed.data.timeInCommunity,
  });
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

  const existing = await Visit.findFormById(visitId);
  if (!existing) {
    return res.status(404).json({ error: 'Visit not found' });
  }

  const user = req.user;
  if (user.role === 'Volunteer/CHW' && existing.created_by !== user.id) {
    return res.status(403).json({ error: 'You can only edit visits you logged yourself' });
  }

  // A v2 edit sends the whole form and replaces it.
  if (req.body?.formVersion === FORM_VERSION) {
    const prepared = await prepareV2Form(req.body, user, existing.form_data);
    if (!prepared.formData) {
      return res.status(prepared.status).json(prepared.body);
    }
    const visit = await Visit.updateV2(visitId, { formVersion: FORM_VERSION, formData: prepared.formData });
    return res.json(visit);
  }
  if (existing.form_version >= FORM_VERSION) {
    return res.status(400).json({ error: 'This visit uses the new form; send the full form with formVersion 2' });
  }

  const parsed = visitFormSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid visit data',
      details: parsed.error.flatten(),
    });
  }

  const updated = await Visit.update(visitId, parsed.data);
  if (!updated) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  res.json(updated);
}

// Download visits as a spreadsheet (?format=xlsx|csv, optional ?from=&to=
// visit-date range). Same visibility rule as list().
async function exportVisits(req, res) {
  const format = ['csv', 'zip'].includes(req.query.format) ? req.query.format : 'xlsx';
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const { from, to } = req.query;
  for (const value of [from, to]) {
    if (value !== undefined && (typeof value !== 'string' || !datePattern.test(value))) {
      return res.status(400).json({ error: 'from and to must be dates in YYYY-MM-DD format' });
    }
  }

  const visits = await Visit.listForExport({
    isOwnOnly: req.user.role === 'Volunteer/CHW',
    userId: req.user.id,
    from,
    to,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'zip') {
    res.attachment(`bheco-visits-${stamp}.zip`);
    res.type('application/zip');
    return toZip(visits, res);
  }
  if (format === 'csv') {
    res.attachment(`bheco-visits-${stamp}.csv`);
    res.type('text/csv; charset=utf-8');
    return res.send(toCsv(visits));
  }
  res.attachment(`bheco-visits-${stamp}.xlsx`);
  res.send(Buffer.from(await toXlsx(visits)));
}

function visitIdFrom(req) {
  const id = parseInt(req.params.id, 10);
  return Number.isInteger(id) ? id : null;
}

// Admin only. Hides the visit everywhere; restorable for RETENTION_DAYS.
async function remove(req, res) {
  const visitId = visitIdFrom(req);
  if (visitId === null) {
    return res.status(400).json({ error: 'Invalid visit id' });
  }
  if (!(await Visit.softDelete(visitId, req.user.id))) {
    return res.status(404).json({ error: 'Visit not found' });
  }
  console.info(`[visits] user ${req.user.id} deleted visit ${visitId}`);
  res.status(204).send();
}

// Admin only. Deleted visits that can still be restored.
async function listDeleted(req, res) {
  res.json({ retentionDays: RETENTION_DAYS, visits: await Visit.listDeleted(RETENTION_DAYS) });
}

// Admin only.
async function restore(req, res) {
  const visitId = visitIdFrom(req);
  if (visitId === null) {
    return res.status(400).json({ error: 'Invalid visit id' });
  }
  const visit = await Visit.restore(visitId);
  if (!visit) {
    return res.status(404).json({ error: 'No deleted visit with that id' });
  }
  console.info(`[visits] user ${req.user.id} restored visit ${visitId}`);
  res.json(visit);
}

module.exports = { list, detail, create, update, exportVisits, remove, listDeleted, restore };
