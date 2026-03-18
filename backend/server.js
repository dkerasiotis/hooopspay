const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5002;
const DB_PATH = process.env.DB_PATH || '/data/hooopspay.db';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'hoopspay2024';
const SESSION_SECRET = process.env.SESSION_SECRET || 'hoopspay-secret-key';

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

// ── Public routes ──
app.get('/login', (req, res) => {
  if (req.session && req.session.loggedIn) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Λάθος στοιχεία σύνδεσης' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Auth middleware — everything below requires login ──
app.use((req, res, next) => {
  if (req.session && req.session.loggedIn) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Απαιτείται σύνδεση' });
  res.redirect('/login');
});

// ── Database setup ──
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4d9fff',
    created_at TEXT DEFAULT (datetime('now'))
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

// Seed default teams if empty
const teamCount = db.prepare('SELECT COUNT(*) as c FROM teams').get();
if (teamCount.c === 0) {
  const ins = db.prepare('INSERT INTO teams (id, name, color) VALUES (?, ?, ?)');
  ins.run('t1', 'Παιδικό Τμήμα', '#4d9fff');
  ins.run('t2', 'Έφηβοι', '#ff6b00');
  ins.run('t3', 'Ενήλικες', '#00d084');
}

// ══════════════════════════════
// TEAMS
// ══════════════════════════════
app.get('/api/teams', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY created_at').all();
  res.json(teams);
});

app.post('/api/teams', (req, res) => {
  const { id, name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Απαιτείται όνομα ομάδας' });
  const teamId = id || 't' + Date.now();
  db.prepare('INSERT INTO teams (id, name, color) VALUES (?, ?, ?)').run(teamId, name, color || '#4d9fff');
  res.json({ id: teamId, name, color });
});

app.delete('/api/teams/:id', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM students WHERE team_id = ?').get(req.params.id);
  if (count.c > 0) return res.status(400).json({ error: 'Υπάρχουν μαθητές σε αυτή την ομάδα' });
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════
// STUDENTS
// ══════════════════════════════
app.get('/api/students', (req, res) => {
  const students = db.prepare('SELECT * FROM students ORDER BY lname, fname').all();
  res.json(students.map(s => ({ ...s, active: s.active === 1 })));
});

app.post('/api/students', (req, res) => {
  const { fname, lname, phone, email, teamId, date, notes } = req.body;
  if (!fname || !lname) return res.status(400).json({ error: 'Απαιτείται όνομα' });
  const id = 's' + Date.now();
  db.prepare(`
    INSERT INTO students (id, fname, lname, phone, email, team_id, date, notes, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, fname, lname, phone || '', email || '', teamId || null, date || '', notes || '');
  res.json({ id, fname, lname, phone, email, teamId, date, notes, active: true });
});

app.put('/api/students/:id', (req, res) => {
  const { fname, lname, phone, email, teamId, notes, active } = req.body;
  db.prepare(`
    UPDATE students SET fname=?, lname=?, phone=?, email=?, team_id=?, notes=?, active=?
    WHERE id=?
  `).run(fname, lname, phone || '', email || '', teamId || null, notes || '',
         active === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/students/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════
// PAYMENTS
// ══════════════════════════════

// Get all payments for a month
app.get('/api/payments/:monthKey', (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE month_key = ?').all(req.params.monthKey);
  // Return as object: { studentId: { paid, date, note } }
  const result = {};
  rows.forEach(r => {
    result[r.student_id] = { paid: r.paid === 1, date: r.pay_date, note: r.note };
  });
  res.json(result);
});

// Get all payments (for history, teacher report, charts)
app.get('/api/payments', (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE paid = 1 ORDER BY month_key DESC').all();
  // Group by month_key
  const result = {};
  rows.forEach(r => {
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
  const { teams, students, payments, teacherPayments } = req.body;
  if (!teams || !students || !payments) return res.status(400).json({ error: 'Μη έγκυρο backup' });

  const restore = db.transaction(() => {
    db.prepare('DELETE FROM payments').run();
    db.prepare('DELETE FROM students').run();
    db.prepare('DELETE FROM teams').run();
    db.prepare('DELETE FROM teacher_payments').run();

    const insTeam = db.prepare('INSERT OR IGNORE INTO teams (id, name, color) VALUES (?, ?, ?)');
    teams.forEach(t => insTeam.run(t.id, t.name, t.color || '#4d9fff'));

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
  console.log(`🏀 HoopsPay running on http://localhost:${PORT}`);
});
