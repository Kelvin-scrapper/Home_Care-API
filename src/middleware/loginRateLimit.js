const { rateLimit } = require('express-rate-limit');

// Brute-force guard for POST /auth/login: 10 failed attempts per client IP
// per 15 minutes. Successful logins don't use up the budget. State is
// in-memory, so it resets on restart and isn't shared between instances.
// Behind a reverse proxy, set TRUST_PROXY (see src/index.js) so the limit is
// per real client, not per proxy.
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfterSeconds = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000));
    res.set('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Too many failed sign-in attempts. Please try again later.',
      retryAfterSeconds,
    });
  },
});

module.exports = loginRateLimit;
