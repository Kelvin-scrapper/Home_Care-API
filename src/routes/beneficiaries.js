const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { list, detail, generateReference, lookupReference } = require('../controllers/beneficiariesController');

const FIELD_STAFF = ['Volunteer/CHW', 'Coordinator/Field officer'];

const router = express.Router();

router.get('/', authenticate, list);
router.post('/reference-numbers', authenticate, requireRole(...FIELD_STAFF), generateReference);
router.get('/lookup', authenticate, requireRole(...FIELD_STAFF), lookupReference);
router.get('/:id', authenticate, detail);

module.exports = router;
