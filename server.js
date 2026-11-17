const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const path = require('node:path');
const { openDb } = require('./db');

const SESSION_DAYS = 30;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.use(express.static(path.join(__dirname, 'public')));

  // ---------- helpers ----------
  const q = (sql) => db.prepare(sql);
  const httpError = (status, message) => Object.assign(new Error(message), { status });

  function parseCookies(header = '') {
    return Object.fromEntries(
      header.split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
    );
  }

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + SESSION_DAYS * 864e5;
    q('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_DAYS * 864e5 });
  }

  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

  function presentRow(p) {
    return {
      id: p.id,
      itemName: p.item_name,
      link: p.link,
      cost: p.cost,
      forUserId: p.for_user_id,
      suggestedBy: { id: p.suggested_by_id, name: p.suggested_by_name },
      familyId: p.family_id,
      createdAt: p.created_at,
    };
  }

  const PRESENT_SELECT = `SELECT p.*, u.name AS suggested_by_name FROM presents p JOIN users u ON u.id = p.suggested_by_id`;
  const ideasFor = (userId) =>
    q(`${PRESENT_SELECT} WHERE p.for_user_id = ? AND p.suggested_by_id = p.for_user_id ORDER BY p.created_at, p.id`).all(userId).map(presentRow);
  const suggestionsFor = (userId, familyId) =>
    q(`${PRESENT_SELECT} WHERE p.for_user_id = ? AND p.suggested_by_id != p.for_user_id AND p.family_id = ? ORDER BY p.created_at, p.id`)
      .all(userId, familyId).map(presentRow);

  function validatePresent(body) {
    const itemName = String(body.itemName ?? '').trim();
    if (!itemName) throw httpError(400, 'Item name is required');
    let link = body.link ? String(body.link).trim() : null;
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    let cost = body.cost === '' || body.cost == null ? null : Number(body.cost);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw httpError(400, 'Cost must be a positive number');
    return { itemName: itemName.slice(0, 200), link, cost };
  }

  function summary(familyId) {
    return q(`SELECT f.id, f.name, f.code, (SELECT COUNT(*) FROM family_members m WHERE m.family_id = f.id) AS memberCount
              FROM families f WHERE f.id = ?`).get(familyId);
  }

  const isMember = (familyId, userId) => !!q('SELECT 1 FROM family_members WHERE family_id = ? AND user_id = ?').get(familyId, userId);

  function requireMember(req) {
    const familyId = Number(req.params.id);
    if (!isMember(familyId, req.user.id)) throw httpError(403, 'You are not a member of this family');
    return familyId;
  }

  function newFamilyCode() {
    for (;;) {
      const code = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      if (!q('SELECT 1 FROM families WHERE code = ?').get(code)) return code;
    }
  }

  // wrap handlers so thrown errors become JSON responses
  const h = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (e) {
      if (!e.status) console.error(e);
      res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });
    }
  };

  // ---------- auth ----------
  app.post('/api/auth/register', h((req, res) => {
    const name = String(req.body.name ?? '').trim();
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    if (!name) throw httpError(400, 'Name is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'A valid email is required');
    if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw httpError(409, 'An account with that email already exists');
    const { lastInsertRowid } = q('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, bcrypt.hashSync(password, 10));
    startSession(res, Number(lastInsertRowid));
    res.json({ user: publicUser({ id: Number(lastInsertRowid), name, email }) });
  }));

  app.post('/api/auth/login', h((req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const user = q('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(String(req.body.password ?? ''), user.password_hash)) throw httpError(401, 'Incorrect email or password');
    startSession(res, user.id);
    res.json({ user: publicUser(user) });
  }));

  // everything below requires a session
  app.use('/api', (req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    const row = token && q('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
    if (!row || row.expires_at < Date.now()) return res.status(401).json({ error: 'Please log in' });
    req.user = publicUser(row);
    req.sessionToken = token;
    next();
  });

  app.post('/api/auth/logout', h((req, res) => {
    q('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.clearCookie('sid');
    res.json({ ok: true });
  }));

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

  // ---------- families ----------
  app.get('/api/families', h((req, res) => {
    const ids = q('SELECT family_id FROM family_members WHERE user_id = ? ORDER BY joined_at').all(req.user.id);
    res.json({ families: ids.map((r) => summary(r.family_id)) });
  }));

  app.post('/api/families', h((req, res) => {
    const name = String(req.body.name ?? '').trim();
    if (!name) throw httpError(400, 'Family name is required');
    const { lastInsertRowid } = q('INSERT INTO families (name, code, created_by) VALUES (?, ?, ?)').run(name.slice(0, 100), newFamilyCode(), req.user.id);
    q('INSERT INTO family_members (family_id, user_id) VALUES (?, ?)').run(lastInsertRowid, req.user.id);
    res.json({ family: summary(Number(lastInsertRowid)) });
  }));

  app.post('/api/families/join', h((req, res) => {
    const code = String(req.body.code ?? '').trim().toUpperCase();
    const family = q('SELECT id FROM families WHERE code = ?').get(code);
    if (!family) throw httpError(404, 'No family found with that code');
    q('INSERT OR IGNORE INTO family_members (family_id, user_id) VALUES (?, ?)').run(family.id, req.user.id);
    res.json({ family: summary(family.id) });
  }));

  app.get('/api/families/:id', h((req, res) => {
    const familyId = requireMember(req);
    const f = q('SELECT * FROM families WHERE id = ?').get(familyId);
    const members = q(`SELECT u.id, u.name FROM family_members m JOIN users u ON u.id = m.user_id
                       WHERE m.family_id = ? ORDER BY m.joined_at`).all(familyId);
    res.json({ family: { id: f.id, name: f.name, code: f.code, members, allocated: !!f.allocated_at, allocatedAt: f.allocated_at ? f.allocated_at.replace(' ', 'T') + 'Z' : null } });
  }));

  app.post('/api/families/:id/arrange', h((req, res) => {
    const familyId = requireMember(req);
    const ids = q('SELECT user_id FROM family_members WHERE family_id = ?').all(familyId).map((r) => r.user_id);
    if (ids.length < 2) throw httpError(400, 'You need at least 2 family members to arrange Secret Santa');
    // Fisher–Yates shuffle, then each person gives to the next in the circle,
    // so nobody can ever draw themselves.
    for (let i = ids.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    db.exec('BEGIN');
    try {
      q('DELETE FROM allocations WHERE family_id = ?').run(familyId);
      const ins = q('INSERT INTO allocations (family_id, giver_id, receiver_id) VALUES (?, ?, ?)');
      ids.forEach((giver, i) => ins.run(familyId, giver, ids[(i + 1) % ids.length]));
      q("UPDATE families SET allocated_at = datetime('now') WHERE id = ?").run(familyId);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true });
  }));

  app.get('/api/families/:id/assignment', h((req, res) => {
    const familyId = requireMember(req);
    const recipient = q(`SELECT u.id, u.name FROM allocations a JOIN users u ON u.id = a.receiver_id
                         WHERE a.family_id = ? AND a.giver_id = ?`).get(familyId, req.user.id);
    if (!recipient) return res.json({ recipient: null, ideas: [], suggestions: [] });
    res.json({ recipient, ideas: ideasFor(recipient.id), suggestions: suggestionsFor(recipient.id, familyId) });
  }));

  function otherMember(req) {
    const familyId = requireMember(req);
    const userId = Number(req.params.userId);
    if (userId === req.user.id) throw httpError(403, "You can't view secret suggestions for yourself");
    if (!isMember(familyId, userId)) throw httpError(404, 'That person is not in this family');
    return { familyId, userId };
  }

  app.get('/api/families/:id/members/:userId', h((req, res) => {
    const { familyId, userId } = otherMember(req);
    const member = q('SELECT id, name FROM users WHERE id = ?').get(userId);
    res.json({ member, ideas: ideasFor(userId), suggestions: suggestionsFor(userId, familyId) });
  }));

  app.post('/api/families/:id/members/:userId/suggestions', h((req, res) => {
    const { familyId, userId } = otherMember(req);
    const p = validatePresent(req.body);
    const { lastInsertRowid } = q(`INSERT INTO presents (item_name, for_user_id, suggested_by_id, family_id, link, cost)
                                   VALUES (?, ?, ?, ?, ?, ?)`).run(p.itemName, userId, req.user.id, familyId, p.link, p.cost);
    res.json({ present: presentRow(q(`${PRESENT_SELECT} WHERE p.id = ?`).get(lastInsertRowid)) });
  }));

  // ---------- my present profile ----------
  app.get('/api/presents/mine', h((req, res) => res.json({ ideas: ideasFor(req.user.id) })));

  app.post('/api/presents', h((req, res) => {
    const p = validatePresent(req.body);
    const { lastInsertRowid } = q(`INSERT INTO presents (item_name, for_user_id, suggested_by_id, link, cost)
                                   VALUES (?, ?, ?, ?, ?)`).run(p.itemName, req.user.id, req.user.id, p.link, p.cost);
    res.json({ present: presentRow(q(`${PRESENT_SELECT} WHERE p.id = ?`).get(lastInsertRowid)) });
  }));

  function ownPresent(req) {
    const row = q('SELECT * FROM presents WHERE id = ?').get(Number(req.params.id));
    if (!row) throw httpError(404, 'Present not found');
    if (row.suggested_by_id !== req.user.id) throw httpError(403, 'You can only change presents you added');
    return row;
  }

  app.put('/api/presents/:id', h((req, res) => {
    const row = ownPresent(req);
    const p = validatePresent(req.body);
    q('UPDATE presents SET item_name = ?, link = ?, cost = ? WHERE id = ?').run(p.itemName, p.link, p.cost, row.id);
    res.json({ present: presentRow(q(`${PRESENT_SELECT} WHERE p.id = ?`).get(row.id)) });
  }));

  app.delete('/api/presents/:id', h((req, res) => {
    const row = ownPresent(req);
    q('DELETE FROM presents WHERE id = ?').run(row.id);
    res.json({ ok: true });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp(openDb()).listen(port, () => console.log(`Secret Santa running at http://localhost:${port}`));
}

module.exports = { createApp };
