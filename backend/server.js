const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5002;
const DB_PATH = process.env.DB_PATH || '/data/hooopspay.db';
const SESSION_SECRET = process.env.SESSION_SECRET || 'hoopspay-secret-key';
const ADMIN_INITIAL_PASS = process.env.ADMIN_INITIAL_PASS || 'admin';

// Ensure /data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── Middleware ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Static files (no auto-index so we control who sees index.html)
app.use(express.static(path.join(__dirname, '../frontend'), { index: false }));

// ── Database setup ──
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4d9fff',
    rate REAL NOT NULL DEFAULT 10,
    t_rate REAL NOT NULL DEFAULT 8,
    c_rate REAL NOT NULL DEFAULT 2,
    owner_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    fname TEXT NOT NULL,
    lname TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    team_id TEXT,
    date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    month_key TEXT NOT NULL,
    paid INTEGER DEFAULT 0,
    pay_date TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(student_id, month_key),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS teacher_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_key TEXT NOT NULL,
    paid INTEGER DEFAULT 0,
    pay_date TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(month_key)
  );
`);

// Migration: add rate columns to teams if missing
try { db.prepare("SELECT rate FROM teams LIMIT 1").get(); }
catch(e) {
  db.exec("ALTER TABLE teams ADD COLUMN rate REAL NOT NULL DEFAULT 10");
  db.exec("ALTER TABLE teams ADD COLUMN t_rate REAL NOT NULL DEFAULT 8");
  db.exec("ALTER TABLE teams ADD COLUMN c_rate REAL NOT NULL DEFAULT 2");
}

// Migration: add owner_id to teams if missing
try { db.prepare("SELECT owner_id FROM teams LIMIT 1").get(); }
catch(e) {
  db.exec("ALTER TABLE teams ADD COLUMN owner_id TEXT REFERENCES users(id)");
}

// Seed admin user if no users exist
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  const hash = bcrypt.hashSync(ADMIN_INITIAL_PASS, 10);
  db.prepare('INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)')
    .run('u_admin', 'admin', hash, 'Administrator', 'admin');
  // Assign existing teams to admin
  db.prepare('UPDATE teams SET owner_id = ? WHERE owner_id IS NULL').run('u_admin');
  console.log('Admin user created (username: admin)');
}

// ── Public routes ──
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Συμπλήρωσε όλα τα πεδία' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Λάθος στοιχεία σύνδεσης' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.displayName = user.display_name;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Auth middleware — everything below requires login ──
app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    req.user = {
      id: req.session.userId,
      username: req.session.username,
      role: req.session.role,
      displayName: req.session.displayName
    };
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Απαιτείται σύνδεση' });
  res.redirect('/login');
});

// Helper: check if user is admin
function isAdmin(req) { return req.user.role === 'admin'; }

// Helper: get team IDs visible to user
function userTeamIds(req) {
  if (isAdmin(req)) return null; // null = all
  return db.prepare('SELECT id FROM teams WHERE owner_id = ?').all(req.user.id).map(t => t.id);
}

// ══════════════════════════════
// CURRENT USER
// ══════════════════════════════
app.get('/api/me', (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    displayName: req.user.displayName,
    role: req.user.role
  });
});

app.post('/api/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Συμπλήρωσε όλα τα πεδία' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Ο κωδικός πρέπει να έχει τουλάχιστον 4 χαρακτήρες' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Λάθος τρέχων κωδικός' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

// ══════════════════════════════
// USER MANAGEMENT (admin only)
// ══════════════════════════════
app.get('/api/users', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Μόνο admin' });
  const users = db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at').all();
  res.json(users);
});

app.post('/api/users', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Μόνο admin' });
  const { username, password, displayName, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Απαιτείται username και password' });
  if (password.length < 4) return res.status(400).json({ error: 'Ο κωδικός πρέπει να έχει τουλάχιστον 4 χαρακτήρες' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Το username υπάρχει ήδη' });
  const id = 'u' + Date.now();
  const hash = bcrypt.hashSync(password, 10);
  const r = role === 'admin' ? 'admin' : 'user';
  db.prepare('INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, hash, displayName || username, r);
  res.json({ id, username, display_name: displayName || username, role: r });
});

app.delete('/api/users/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Μόνο admin' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Δεν μπορείς να διαγράψεις τον εαυτό σου' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Χρήστης δεν βρέθηκε' });
  // Reassign their teams to admin
  db.prepare('UPDATE teams SET owner_id = ? WHERE owner_id = ?').run(req.user.id, req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/users/:id/reset-password', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Μόνο admin' });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Ο κωδικός πρέπει να έχει τουλάχιστον 4 χαρακτήρες' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════
// TEAMS (ACTIVITIES)
// ══════════════════════════════
app.get('/api/teams', (req, res) => {
  let teams;
  if (isAdmin(req)) {
    teams = db.prepare('SELECT * FROM teams ORDER BY created_at').all();
  } else {
    teams = db.prepare('SELECT * FROM teams WHERE owner_id = ? ORDER BY created_at').all(req.user.id);
  }
  res.json(teams);
});

app.post('/api/teams', (req, res) => {
  const { id, name, color, rate, t_rate, c_rate, owner_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Απαιτείται όνομα δραστηριότητας' });
  const teamId = id || 't' + Date.now();
  const r = rate != null ? rate : 10;
  const tr = t_rate != null ? t_rate : 8;
  const cr = c_rate != null ? c_rate : 2;
  const ownerId = (isAdmin(req) && owner_id) ? owner_id : req.user.id;
  db.prepare('INSERT INTO teams (id, name, color, rate, t_rate, c_rate, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(teamId, name, color || '#4d9fff', r, tr, cr, ownerId);
  res.json({ id: teamId, name, color, rate: r, t_rate: tr, c_rate: cr, owner_id: ownerId });
});

app.put('/api/teams/:id', (req, res) => {
  const { name, color, rate, t_rate, c_rate, owner_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Απαιτείται όνομα δραστηριότητας' });
  // Check ownership
  if (!isAdmin(req)) {
    const team = db.prepare('SELECT owner_id FROM teams WHERE id = ?').get(req.params.id);
    if (!team || team.owner_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  }
  if (isAdmin(req) && owner_id) {
    db.prepare('UPDATE teams SET name=?, color=?, rate=?, t_rate=?, c_rate=?, owner_id=? WHERE id=?')
      .run(name, color || '#4d9fff', rate != null ? rate : 10, t_rate != null ? t_rate : 8, c_rate != null ? c_rate : 2, owner_id, req.params.id);
  } else {
    db.prepare('UPDATE teams SET name=?, color=?, rate=?, t_rate=?, c_rate=? WHERE id=?')
      .run(name, color || '#4d9fff', rate != null ? rate : 10, t_rate != null ? t_rate : 8, c_rate != null ? c_rate : 2, req.params.id);
  }
  res.json({ ok: true });
});

app.delete('/api/teams/:id', (req, res) => {
  // Check ownership
  if (!isAdmin(req)) {
    const team = db.prepare('SELECT owner_id FROM teams WHERE id = ?').get(req.params.id);
    if (!team || team.owner_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM students WHERE team_id = ?').get(req.params.id);
  if (count.c > 0) return res.status(400).json({ error: 'Υπάρχουν μαθητές σε αυτή τη δραστηριότητα' });
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════
// STUDENTS
// ══════════════════════════════
app.get('/api/students', (req, res) => {
  let students;
  if (isAdmin(req)) {
    students = db.prepare('SELECT * FROM students ORDER BY lname, fname').all();
  } else {
    const tids = userTeamIds(req);
    if (!tids.length) return res.json([]);
    const placeholders = tids.map(() => '?').join(',');
    students = db.prepare(`SELECT * FROM students WHERE team_id IN (${placeholders}) ORDER BY lname, fname`).all(...tids);
  }
  res.json(students.map(s => ({ ...s, active: s.active === 1 })));
});

app.post('/api/students', (req, res) => {
  const { fname, lname, phone, email, teamId, date, notes } = req.body;
  if (!fname || !lname) return res.status(400).json({ error: 'Απαιτείται όνομα' });
  // Check team ownership
  if (teamId && !isAdmin(req)) {
    const team = db.prepare('SELECT owner_id FROM teams WHERE id = ?').get(teamId);
    if (!team || team.owner_id !== req.user.id) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα σε αυτή τη δραστηριότητα' });
  }
  const id = 's' + Date.now();
  db.prepare(`
    INSERT INTO students (id, fname, lname, phone, email, team_id, date, notes, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, fname, lname, phone || '', email || '', teamId || null, date || '', notes || '');
  res.json({ id, fname, lname, phone, email, teamId, date, notes, active: true });
});

app.put('/api/students/:id', (req, res) => {
  const { fname, lname, phone, email, teamId, notes, active } = req.body;
  // Check ownership via team
  if (!isAdmin(req)) {
    const student = db.prepare('SELECT team_id FROM students WHERE id = ?').get(req.params.id);
    if (student) {
      const tids = userTeamIds(req);
      if (!tids.includes(student.team_id)) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
    }
  }
  db.prepare(`
    UPDATE students SET fname=?, lname=?, phone=?, email=?, team_id=?, notes=?, active=?
    WHERE id=?
  `).run(fname, lname, phone || '', email || '', teamId || null, notes || '',
         active === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/students/:id', (req, res) => {
  if (!isAdmin(req)) {
    const student = db.prepare('SELECT team_id FROM students WHERE id = ?').get(req.params.id);
    if (student) {
      const tids = userTeamIds(req);
      if (!tids.includes(student.team_id)) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
    }
  }
  db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════
// PAYMENTS
// ══════════════════════════════

// Get all payments for a month
app.get('/api/payments/:monthKey', (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE month_key = ?').all(req.params.monthKey);
  const result = {};
  const tids = userTeamIds(req);
  rows.forEach(r => {
    if (tids) {
      const s = db.prepare('SELECT team_id FROM students WHERE id = ?').get(r.student_id);
      if (!s || !tids.includes(s.team_id)) return;
    }
    result[r.student_id] = { paid: r.paid === 1, date: r.pay_date, note: r.note };
  });
  res.json(result);
});

// Get all payments (for history, teacher report, charts)
app.get('/api/payments', (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE paid = 1 ORDER BY month_key DESC').all();
  const tids = userTeamIds(req);
  const result = {};
  rows.forEach(r => {
    if (tids) {
      const s = db.prepare('SELECT team_id FROM students WHERE id = ?').get(r.student_id);
      if (!s || !tids.includes(s.team_id)) return;
    }
    if (!result[r.month_key]) result[r.month_key] = {};
    result[r.month_key][r.student_id] = { paid: true, date: r.pay_date, note: r.note };
  });
  res.json(result);
});

// Record or update a payment
app.post('/api/payments', (req, res) => {
  const { studentId, monthKey, paid, date, note } = req.body;
  db.prepare(`
    INSERT INTO payments (student_id, month_key, paid, pay_date, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, month_key) DO UPDATE SET paid=excluded.paid, pay_date=excluded.pay_date, note=excluded.note
  `).run(studentId, monthKey, paid ? 1 : 0, date || '', note || '');
  res.json({ ok: true });
});

// Bulk mark paid
app.post('/api/payments/bulk', (req, res) => {
  const { studentIds, monthKey, paid, date, note } = req.body;
  const stmt = db.prepare(`
    INSERT INTO payments (student_id, month_key, paid, pay_date, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, month_key) DO UPDATE SET paid=excluded.paid, pay_date=excluded.pay_date, note=excluded.note
  `);
  const runMany = db.transaction((ids) => {
    ids.forEach(sid => stmt.run(sid, monthKey, paid ? 1 : 0, date || '', note || ''));
  });
  runMany(studentIds);
  res.json({ ok: true });
});

// Unpay
app.delete('/api/payments/:studentId/:monthKey', (req, res) => {
  db.prepare('DELETE FROM payments WHERE student_id=? AND month_key=?')
    .run(req.params.studentId, req.params.monthKey);
  res.json({ ok: true });
});

// ══════════════════════════════
// TEACHER PAYMENTS
// ══════════════════════════════
app.get('/api/teacher-payments', (req, res) => {
  const rows = db.prepare('SELECT * FROM teacher_payments').all();
  const result = {};
  rows.forEach(r => {
    result[r.month_key] = { paid: r.paid === 1, date: r.pay_date, note: r.note };
  });
  res.json(result);
});

app.post('/api/teacher-payments', (req, res) => {
  const { monthKey, paid, date, note } = req.body;
  db.prepare(`
    INSERT INTO teacher_payments (month_key, paid, pay_date, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(month_key) DO UPDATE SET paid=excluded.paid, pay_date=excluded.pay_date, note=excluded.note
  `).run(monthKey, paid ? 1 : 0, date || '', note || '');
  res.json({ ok: true });
});

// ══════════════════════════════
// BACKUP & RESTORE
// ══════════════════════════════
app.get('/api/backup', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Μόνο admin' });
  const teams = db.prepare('SELECT * FROM teams').all();
  const students = db.prepare('SELECT * FROM students').all()
    .map(s => ({ ...s, active: s.active === 1, teamId: s.team_id }));
  const payRows = db.prepare('SELECT * FROM payments').all();
  const payments = {};
  payRows.forEach(r => {
    if (!payments[r.month_key]) payments[r.month_key] = {};
    payments[r.month_key][r.student_id] = { paid: r.paid === 1, date: r.pay_date, note: r.note };
  });
  const tpRows = db.prepare('SELECT * FROM teacher_payments').all();
  const teacherPayments = {};
  tpRows.forEach(r => {
    teacherPayments[r.month_key] = { paid: r.paid === 1, date: r.pay_date, note: r.note };
  });
  res.json({ teams, students, payments, teacherPayments, exportedAt: new Date().toISOString() });
});

app.post('/api/restore', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Μόνο admin' });
  const { teams, students, payments, teacherPayments } = req.body;
  if (!teams || !students || !payments) return res.status(400).json({ error: 'Μη έγκυρο backup' });

  const restore = db.transaction(() => {
    db.prepare('DELETE FROM payments').run();
    db.prepare('DELETE FROM students').run();
    db.prepare('DELETE FROM teams').run();
    db.prepare('DELETE FROM teacher_payments').run();

    const insTeam = db.prepare('INSERT OR IGNORE INTO teams (id, name, color, rate, t_rate, c_rate, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    teams.forEach(t => insTeam.run(t.id, t.name, t.color || '#4d9fff', t.rate != null ? t.rate : 10, t.t_rate != null ? t.t_rate : 8, t.c_rate != null ? t.c_rate : 2, t.owner_id || req.user.id));

    const insStu = db.prepare(`INSERT OR IGNORE INTO students (id, fname, lname, phone, email, team_id, date, notes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    students.forEach(s => insStu.run(s.id, s.fname, s.lname, s.phone || '', s.email || '', s.teamId || s.team_id || null, s.date || '', s.notes || '', s.active === false ? 0 : 1));

    const insPay = db.prepare(`INSERT OR IGNORE INTO payments (student_id, month_key, paid, pay_date, note) VALUES (?, ?, ?, ?, ?)`);
    Object.entries(payments).forEach(([mk, mo]) => {
      Object.entries(mo).forEach(([sid, pay]) => {
        insPay.run(sid, mk, pay.paid ? 1 : 0, pay.date || '', pay.note || '');
      });
    });

    if (teacherPayments) {
      const insTP = db.prepare(`INSERT OR IGNORE INTO teacher_payments (month_key, paid, pay_date, note) VALUES (?, ?, ?, ?)`);
      Object.entries(teacherPayments).forEach(([mk, tp]) => {
        insTP.run(mk, tp.paid ? 1 : 0, tp.date || '', tp.note || '');
      });
    }
  });

  restore();
  res.json({ ok: true });
});

// ── Catch-all: serve app ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`HoopsPay running on http://localhost:${PORT}`);
});
