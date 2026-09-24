const ExcelJS = require('exceljs');
const { SECTIONS } = require('../schemas/visitFormDefinition');

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

function toRow(visit) {
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
  for (const { field } of FIELDS) row[field.name] = cellValue(field, answers[field.name]);
  return row;
}

async function toXlsx(visits) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BHECO Home Care';
  const sheet = workbook.addWorksheet('Visits', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B4A2A' } };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  // Every answer is written as a string cell, so phone numbers keep their
  // leading 0 and nothing typed into the form is ever run as a formula.
  for (const visit of visits) sheet.addRow(toRow(visit));
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

function toCsv(visits) {
  const lines = [COLUMNS.map((c) => csvCell(c.header)).join(',')];
  for (const visit of visits) {
    const row = toRow(visit);
    lines.push(COLUMNS.map((c) => csvCell(row[c.key])).join(','));
  }
  // BOM so Excel opens it as UTF-8.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { toXlsx, toCsv, COLUMNS };
