const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { dashboard, impact } = require('../controllers/statsController');

const router = express.Router();

router.get('/dashboard', authenticate, dashboard);
router.get('/impact', authenticate, requireRole('Coordinator/Field officer', 'Management/Director', 'Admin'), impact);

module.exports = router;
