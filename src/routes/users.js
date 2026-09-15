const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { list, create } = require('../controllers/usersController');

const router = express.Router();

router.get('/', authenticate, requireRole('Admin'), list);
router.post('/', authenticate, requireRole('Admin'), create);

module.exports = router;
