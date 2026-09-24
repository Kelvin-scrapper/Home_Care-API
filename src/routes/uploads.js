const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const Upload = require('../models/Upload');
const { FILE_KINDS } = require('../schemas/visitFormDefinition');

const { UPLOAD_DIR } = Upload;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_STAFF = ['Volunteer/CHW', 'Coordinator/Field officer'];

const uploaders = Object.fromEntries(
  Object.entries(FILE_KINDS).map(([kind, rules]) => [
    kind,
    multer({
      storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => cb(null, crypto.randomUUID()),
      }),
      limits: { fileSize: rules.maxBytes, files: 1 },
      fileFilter: (req, file, cb) => {
        cb(null, rules.mimePrefixes.some((prefix) => file.mimetype.startsWith(prefix)));
      },
    }).single('file'),
  ])
);

const router = express.Router();

// Upload one Media & Evidence file. ?kind=image|video|document picks the
// size/type rules. Returns { id, name, mimeType, size, kind } for form_data.
router.post('/', authenticate, requireRole(...FIELD_STAFF), (req, res, next) => {
  const kind = req.query.kind;
  const upload = uploaders[kind];
  if (!upload) {
    return res.status(400).json({ error: 'Unknown upload kind' });
  }

  upload(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMb = FILE_KINDS[kind].maxBytes / (1024 * 1024);
        return res.status(413).json({ error: `File is too large (max ${maxMb} MB)` });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: `Please choose a supported ${kind} file` });
    }

    try {
      const saved = await Upload.create({
        uploadedBy: req.user.id,
        kind,
        originalName: req.file.originalname.slice(0, 255),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storageName: req.file.filename,
      });
      res.status(201).json(saved);
    } catch (dbErr) {
      fs.promises.unlink(req.file.path).catch(() => {});
      next(dbErr);
    }
  });
});

router.get('/:id', authenticate, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const row = await Upload.findById(req.params.id);
  const allowed =
    row && (req.user.role !== 'Volunteer/CHW' || (await Upload.isVisibleToVolunteer(row.id, req.user.id)));
  if (!allowed) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.attachment(row.original_name);
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(path.join(UPLOAD_DIR, row.storage_name));
});

module.exports = router;
