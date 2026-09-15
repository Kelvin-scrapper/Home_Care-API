const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { list, detail, create, update } = require('../controllers/visitsController');

const router = express.Router();

const FIELD_STAFF = ['Volunteer/CHW', 'Coordinator/Field officer'];

router.get('/', authenticate, list);
router.get('/:id', authenticate, detail);
router.post('/', authenticate, requireRole(...FIELD_STAFF), create);
router.patch('/:id', authenticate, requireRole(...FIELD_STAFF), update);

module.exports = router;
