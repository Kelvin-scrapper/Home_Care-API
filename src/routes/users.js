const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { list, create, update } = require('../controllers/usersController');

const router = express.Router();

router.get('/', authenticate, requireRole('Admin'), list);
router.post('/', authenticate, requireRole('Admin'), create);
router.patch('/:id', authenticate, requireRole('Admin'), update);

module.exports = router;
