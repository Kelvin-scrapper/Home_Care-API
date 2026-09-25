const fs = require('fs');
const path = require('path');
const pool = require('../db');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function toUpload(row) {
  return {
    id: row.id,
    name: row.original_name,
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    kind: row.kind,
  };
}

async function create({ uploadedBy, kind, originalName, mimeType, sizeBytes, storageName }) {
  const { rows } = await pool.query(
    `INSERT INTO uploads (uploaded_by, kind, original_name, mime_type, size_bytes, storage_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [uploadedBy, kind, originalName, mimeType, sizeBytes, storageName]
  );
  return toUpload(rows[0]);
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM uploads WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findManyByIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await pool.query('SELECT * FROM uploads WHERE id = ANY($1::uuid[])', [ids]);
  return rows;
}

// Whether a volunteer may view this upload: they uploaded it, or it's
// attached to a visit they logged.
async function isVisibleToVolunteer(uploadId, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM uploads WHERE id = $1 AND uploaded_by = $2
     UNION ALL
     SELECT 1 FROM visits v, jsonb_each(v.form_data) AS f(key, value)
     WHERE v.created_by = $2 AND v.deleted_at IS NULL
       AND jsonb_typeof(f.value) = 'object' AND f.value->>'id' = $1::text
     LIMIT 1`,
    [uploadId, userId]
  );
  return rows.length > 0;
}

// Uploads older than the cutoff that no visit references — files from forms
// that were never submitted, or replaced during an edit. Deletes the rows
// and returns their storage names so the caller can remove the files.
// Deleted-but-recoverable visits still count as referencing their files, so
// a restore gets them back; once the visit is purged its files go here.
async function deleteUnattachedOlderThan(days) {
  const { rows } = await pool.query(
    `DELETE FROM uploads u
     WHERE u.created_at < now() - make_interval(days => $1)
       AND NOT EXISTS (
         SELECT 1 FROM visits v, jsonb_each(v.form_data) AS f(key, value)
         WHERE jsonb_typeof(f.value) = 'object' AND f.value->>'id' = u.id::text
       )
     RETURNING storage_name`,
    [days]
  );
  return rows.map((r) => r.storage_name);
}

module.exports = {
  UPLOAD_DIR,
  create,
  findById,
  findManyByIds,
  isVisibleToVolunteer,
  toUpload,
  deleteUnattachedOlderThan,
};
