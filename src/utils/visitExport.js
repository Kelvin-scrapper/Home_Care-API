const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const ExcelJS = require('exceljs');
const { SECTIONS } = require('../schemas/visitFormDefinition');
const Upload = require('../models/Upload');

// Original-form (v1) columns that correspond to a v2 question, so old visits
// fill the matching columns of the export instead of being left out.
const V1_TO_V2 = {
  beneficiaryName: 'beneficiaryName',
  age: 'age',
  weight: 'weight',
  location: 'villageArea',
  volunteerName: 'fieldOfficerName',
  visitDate: 'visitDate',
  registeredSHA: 'registeredSha',
  receivingStipend: 'receivingStipend',
  needsIdentified: 'importantNeeds',
  actionsRecommendations: 'immediateFollowUp',
};

const FIELDS = SECTIONS.flatMap((section) => section.fields.map((field) => ({ section, field })));

// Question text as the header, like a Google Forms response sheet; repeated
// labels ("Phone Number", "Field Officer Name") get their section added.
const labelCounts = FIELDS.reduce((m, { field }) => m.set(field.label, (m.get(field.label) || 0) + 1), new Map());
const COLUMNS = [
  { header: 'Visit ID', key: 'id', width: 9 },
  { header: 'Submitted At', key: 'createdAt', width: 20 },
  { header: 'Form Version', key: 'formVersion', width: 8 },
  { header: 'Urgency Level', key: 'urgencyLevel', width: 14 },
  ...FIELDS.map(({ section, field }) => ({
    header: labelCounts.get(field.label) > 1 ? `${field.label} (${section.title})` : field.label,
    key: field.name,
    width: field.type === 'textarea' ? 40 : 22,
  })),
];

function cellValue(field, value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'file') return value.name || '';
  return String(value);
}

// `fileCell(visit, field)`, if given, replaces what a file answer shows (the
// ZIP export shows the file's path inside the ZIP instead of its name).
function toRow(visit, fileCell) {
  const answers = visit.formVersion === 2 && visit.formData ? visit.formData : {};
  if (visit.formVersion !== 2) {
    for (const [v1Key, v2Key] of Object.entries(V1_TO_V2)) answers[v2Key] = visit[v1Key];
  }
  const row = {
    id: visit.id,
    createdAt: new Date(visit.createdAt).toISOString().replace('T', ' ').slice(0, 16),
    formVersion: visit.formVersion,
    urgencyLevel: visit.urgencyLevel || '',
  };
  for (const { field } of FIELDS) {
    const value = answers[field.name];
    row[field.name] = field.type === 'file' && fileCell && value ? fileCell(visit, field) : cellValue(field, value);
  }
  return row;
}

async function toXlsx(visits, { fileCell } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BHECO Home Care';
  const sheet = workbook.addWorksheet('Visits', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B4A2A' } };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  // Every answer is written as a string cell, so phone numbers keep their
  // leading 0 and nothing typed into the form is ever run as a formula.
  for (const visit of visits) sheet.addRow(toRow(visit, fileCell));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  return workbook.xlsx.writeBuffer();
}

// Cells starting with = + - @ would run as formulas in Excel/Sheets; a
// leading apostrophe makes them text. Plain numbers (phones like +2547…)
// are left alone.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text) && !/^[+\-]?[\d\s().-]+$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(visits, { fileCell } = {}) {
  const lines = [COLUMNS.map((c) => csvCell(c.header)).join(',')];
  for (const visit of visits) {
    const row = toRow(visit, fileCell);
    lines.push(COLUMNS.map((c) => csvCell(row[c.key])).join(','));
  }
  // BOM so Excel opens it as UTF-8.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// Safe as one path segment on Windows, macOS and Linux.
function safeName(text, fallback) {
  const cleaned = String(text || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

// Streams a ZIP to `res`: visits.xlsx + visits.csv (file answers point at
// their path in the ZIP) and every attached file under files/<visit>/. A file
// missing from disk is listed in MISSING_FILES.txt instead of failing the
// whole download.
async function toZip(visits, res) {
  // Plan every attachment's path first, so the spreadsheets can refer to them.
  const planned = new Map(); // "<visitId>:<fieldName>" -> { zipPath, upload }
  for (const visit of visits) {
    if (visit.formVersion !== 2 || !visit.formData) continue;
    const folder = safeName(
      [visit.id, visit.formData.referenceNumber || 'no-ref', visit.formData.visitDate || visit.visitDate || 'no-date'].join('_'),
      String(visit.id)
    );
    const used = new Set();
    for (const { field } of FIELDS) {
      const value = visit.formData[field.name];
      if (field.type !== 'file' || !value || typeof value.id !== 'string') continue;
      let name = safeName(`${field.label} - ${value.name || 'file'}`, field.name);
      for (let n = 2; used.has(name.toLowerCase()); n += 1) {
        const ext = path.extname(name);
        name = `${path.basename(name, ext)} (${n})${ext}`;
      }
      used.add(name.toLowerCase());
      planned.set(`${visit.id}:${field.name}`, { zipPath: `files/${folder}/${name}`, uploadId: value.id });
    }
  }
  const fileCell = (visit, field) => (planned.get(`${visit.id}:${field.name}`) || {}).zipPath || '';

  const uploads = await Upload.findManyByIds([...new Set([...planned.values()].map((p) => p.uploadId))]);
  const byId = new Map(uploads.map((u) => [u.id, u]));

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', (err) => console.warn('[export] zip warning:', err.message));
  archive.on('error', (err) => {
    console.error('[export] zip failed:', err);
    res.destroy(err);
  });
  archive.pipe(res);

  archive.append(Buffer.from(await toXlsx(visits, { fileCell })), { name: 'visits.xlsx' });
  archive.append(toCsv(visits, { fileCell }), { name: 'visits.csv' });

  const missing = [];
  for (const [key, { zipPath, uploadId }] of planned) {
    const upload = byId.get(uploadId);
    const diskPath = upload && path.join(Upload.UPLOAD_DIR, upload.storage_name);
    const exists = diskPath && (await fs.promises.stat(diskPath).then((s) => s.isFile(), () => false));
    if (!exists) {
      missing.push(`${zipPath}  (visit ${key.split(':')[0]})`);
      continue;
    }
    // Photos and videos are already compressed; storing them is much faster.
    const store = /^(image|video|audio)\//.test(upload.mime_type);
    archive.file(diskPath, { name: zipPath, store });
  }
  if (missing.length > 0) {
    archive.append(
      `These attachments are recorded on a visit but their files could not be found on the server:\r\n\r\n${missing.join('\r\n')}\r\n`,
      { name: 'MISSING_FILES.txt' }
    );
  }

  await archive.finalize();
}

module.exports = { toXlsx, toCsv, toZip, COLUMNS };
