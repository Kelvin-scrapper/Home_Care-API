const express = require('express');
const { authenticate } = require('../middleware/auth');
const loginRateLimit = require('../middleware/loginRateLimit');
const { login, logout, me, refresh } = require('../controllers/authController');

const router = express.Router();

router.post('/login', loginRateLimit, login);
router.post('/logout', authenticate, logout);
router.post('/refresh', authenticate, refresh);
router.get('/me', authenticate, me);

module.exports = router;
