require('dotenv').config();

// Without this every login would fail with an opaque 500 when signing the token.
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set — refusing to start. Add it to .env (see .env.example).');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const beneficiariesRoutes = require('./routes/beneficiaries');
const visitsRoutes = require('./routes/visits');
const statsRoutes = require('./routes/stats');
const uploadsRoutes = require('./routes/uploads');
const { startUploadCleanup } = require('./jobs/cleanupUploads');
const { startDeletedVisitPurge } = require('./jobs/purgeDeletedVisits');

const app = express();
const PORT = process.env.PORT || 3000;

// Number of reverse proxies in front of the API (e.g. 1 for nginx/Traefik/a
// platform load balancer). Needed so req.ip — which the login rate limit is
// keyed on — is the real client, not the proxy. Leave unset if the API is
// reached directly: trusting X-Forwarded-For there would let clients spoof it.
const trustProxyHops = Number(process.env.TRUST_PROXY);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

const allowedOrigins = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim())
  : true;
// Content-Disposition carries the filename of spreadsheet exports; browsers
// hide it from cross-origin JavaScript unless it's exposed.
app.use(cors({ origin: allowedOrigins, exposedHeaders: ['Content-Disposition'] }));
// The v2 visit form has many long free-text answers; 100kb (the default) is too tight.
app.use(express.json({ limit: '1mb' }));

app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/beneficiaries', beneficiariesRoutes);
app.use('/visits', visitsRoutes);
app.use('/stats', statsRoutes);
app.use('/uploads', uploadsRoutes);

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

app.use((err, req, res, next) => {
  // Client mistakes from express.json() are 4xx, not server errors.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Tests import the app without starting the server or the cleanup timer.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Home Care API listening on port ${PORT}`);
  });
  startDeletedVisitPurge();
  startUploadCleanup();
}

module.exports = app;
