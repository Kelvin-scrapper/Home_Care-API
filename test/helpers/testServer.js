// Boots the real Express app against an in-memory Postgres (PGlite), so the
// tests need no database server. The schema is applied the way production
// gets it: the pre-form-v2 schema with some data, then db/init.sql (twice —
// it re-runs on every container start).
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const { PGlite } = require('@electric-sql/pglite');

const ROOT = path.join(__dirname, '../..');
const PASSWORD = 'password123';

async function startTestServer() {
  const db = new PGlite();
  const pool = {
    query: async (text, params = []) => {
      // node-postgres serializes plain objects to JSON; PGlite needs it done for it.
      const values = params.map((v) =>
        v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v
      );
      const result = await db.query(text, values);
      return { rows: result.rows, rowCount: result.affectedRows };
    },
    end: async () => {},
  };
  require.cache[require.resolve(path.join(ROOT, 'src/db.js'))] = {
    id: 'db',
    filename: 'db',
    loaded: true,
    exports: pool,
  };

  await db.exec(fs.readFileSync(path.join(__dirname, '../fixtures/init-before-form-v2.sql'), 'utf8'));
  const hash = await bcrypt.hash(PASSWORD, 4);
  await db.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES
     ('Vera Volunteer', 'vol@bheco.org', $1, 'Volunteer/CHW'),
     ('Victor Volunteer', 'vol2@bheco.org', $1, 'Volunteer/CHW'),
     ('Cora Coordinator', 'coord@bheco.org', $1, 'Coordinator/Field officer'),
     ('Dina Director', 'dir@bheco.org', $1, 'Management/Director'),
     ('Adam Admin', 'admin@bheco.org', $1, 'Admin')`,
    [hash]
  );
  await db.query(`INSERT INTO beneficiaries (name, location, age) VALUES ('Mary Wanjiru', 'Kiamaina', '81')`);
  await db.query(
    `INSERT INTO visits (created_by, beneficiary_id, beneficiary_name, location, volunteer_name, visit_date, mood, urgency_level)
     VALUES (1, 1, 'Mary Wanjiru', 'Kiamaina', 'Vera', '2026-01-01', 'Happy', 'Follow-up Needed')`
  );
  const initSql = fs.readFileSync(path.join(ROOT, 'db/init.sql'), 'utf8');
  await db.exec(initSql);
  await db.exec(initSql);

  process.env.JWT_SECRET = 'test-secret';
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'home-care-uploads-'));
  const app = require(path.join(ROOT, 'src/index.js'));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, urlPath, token, body, headers = {}) {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + urlPath, { method, headers: h, body: payload });
    const buffer = Buffer.from(await res.arrayBuffer());
    let json;
    try {
      json = JSON.parse(buffer.toString('utf8'));
    } catch {
      json = undefined;
    }
    return { status: res.status, body: json, buffer, headers: res.headers };
  }

  async function login(email, password = PASSWORD) {
    const res = await request('POST', '/auth/login', null, { email, password });
    return res.body.token;
  }

  async function upload(token, kind, name, type, bytes) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    return request('POST', `/uploads?kind=${kind}`, token, form);
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    await db.close();
  }

  return { db, request, login, upload, stop, uploadDir: process.env.UPLOAD_DIR };
}

module.exports = { startTestServer };
