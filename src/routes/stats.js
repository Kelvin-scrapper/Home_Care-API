const express = require('express');
const { authenticate } = require('../middleware/auth');
const { dashboard } = require('../controllers/statsController');

const router = express.Router();

router.get('/dashboard', authenticate, dashboard);

module.exports = router;
