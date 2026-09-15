const express = require('express');
const { authenticate } = require('../middleware/auth');
const { login, logout, me } = require('../controllers/authController');

const router = express.Router();

router.post('/login', login);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, me);

module.exports = router;
