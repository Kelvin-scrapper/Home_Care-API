const express = require('express');
const { authenticate } = require('../middleware/auth');
const { list, detail } = require('../controllers/beneficiariesController');

const router = express.Router();

router.get('/', authenticate, list);
router.get('/:id', authenticate, detail);

module.exports = router;
