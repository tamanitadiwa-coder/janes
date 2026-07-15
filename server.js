// ══════════════════════════════════════════════════════
// JANE'S BAKERY — BACKEND API
// Node.js + Express + SQLite (better-sqlite3)
// ══════════════════════════════════════════════════════
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, 'bakery.db'));
db.pragma('journal_mode = WAL');

// ── SCHEMA ──
db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT UNIQUE NOT NULL,
  pin     TEXT NOT NULL,
  role    TEXT NOT NULL DEFAULT 'Staff',
  manager INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shifts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  employee   TEXT NOT NULL,
  clock_in   TEXT NOT NULL,
  clock_out  TEXT,
  hours      REAL,
  adjusted   INTEGER NOT NULL DEFAULT 0,
  reason     TEXT
);

-- Generic key/value store for the staff portal + admin panel.
-- Each row is one top-level field of the portal's "db" object
-- (staff, schedules, defaultSched, events, duties, personalTasks,
-- shiftHistory, weekTypeOverrides). Updating one field never touches
-- any other row, so two people saving different things at the same
-- time can never overwrite each other.
CREATE TABLE IF NOT EXISTS portal_data (
  field      TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// ── SEED DEFAULT EMPLOYEES (only if table is empty) ──
const seedEmployees = [
  { name: 'Sly',     pin: '1111', role: 'Staff',   manager: 0 },
  { name: 'Wayne',   pin: '2222', role: 'Staff',   manager: 0 },
  { name: 'Panashe', pin: '3333', role: 'Staff',   manager: 0 },
  { name: 'Hilda',   pin: '4444', role: 'Staff',   manager: 0 },
  { name: 'Grace',   pin: '5555', role: 'Manager', manager: 1 },
  { name: 'Josh',    pin: '765305', role: 'Manager', manager: 1 }
];

const countRow = db.prepare('SELECT COUNT(*) AS c FROM employees').get();
if (countRow.c === 0) {
  const insert = db.prepare('INSERT INTO employees (name, pin, role, manager) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r.name, r.pin, r.role, r.manager);
  });
  insertMany(seedEmployees);
  console.log('Seeded default employees:', seedEmployees.map(e => e.name).join(', '));
}

// ══════════════════════════════════════════════════════
// PORTAL / ADMIN DATA — seed defaults for the staff portal
// ══════════════════════════════════════════════════════
const PORTAL_DEFAULT_STAFF = {
  Panashe: { pin: '3333', role: 'Budtender', admin: false, owner: false, weekType: 5, pic: null },
  Kate:    { pin: '2222', role: 'Budtender', admin: false, owner: false, weekType: 5, pic: null },
  Jamal:   { pin: '1111', role: 'Budtender', admin: true,  owner: false, weekType: 5, pic: null },
  JP:      { pin: '4444', role: 'Chef',      admin: false, owner: false, weekType: 6, pic: null },
  Josh:    { pin: '5555', role: 'Manager',   admin: true,  owner: true,  weekType: 6, pic: null },
  Eva:     { pin: '6666', role: 'Owner',     admin: true,  owner: true,  weekType: 5, pic: null },
  Charlet: { pin: '7777', role: 'Owner',     admin: true,  owner: true,  weekType: 6, pic: null }
};
const PORTAL_DEFAULT_SCHEDULES = {
  Panashe: [{type:'open',station:'cafe'},{type:'open',station:'cafe'},null,{type:'close',station:'bakery'},{type:'close',station:'bakery'},{type:'open',station:'cafe'},null],
  Kate:    [null,{type:'open',station:'cafe'},{type:'open',station:'bakery'},{type:'open',station:'cafe'},null,{type:'close',station:'cafe'},{type:'close',station:'cafe'}],
  Jamal:   [{type:'open',station:'cafe'},{type:'open',station:'cafe'},null,{type:'open',station:'bakery'},{type:'open',station:'cafe'},null,null],
  JP:      [{type:'close',station:'bakery'},null,{type:'open',station:'bakery'},{type:'open',station:'bakery'},{type:'close',station:'bakery'},null,{type:'open',station:'bakery'}],
  Josh:    [{type:'open',station:'cafe'},{type:'open',station:'cafe'},{type:'open',station:'cafe'},null,{type:'open',station:'cafe'},{type:'open',station:'cafe'},null],
  Eva:     [{type:'open',station:'cafe'},{type:'open',station:'cafe'},{type:'open',station:'bakery'},{type:'open',station:'cafe'},null,null,null],
  Charlet: [{type:'open',station:'bakery'},{type:'open',station:'bakery'},null,{type:'close',station:'cafe'},{type:'close',station:'cafe'},{type:'open',station:'cafe'},null]
};

const PORTAL_FIELDS = ['staff','schedules','defaultSched','events','duties','personalTasks','shiftHistory','weekTypeOverrides'];

function getPortalField(field) {
  const row = db.prepare('SELECT value FROM portal_data WHERE field = ?').get(field);
  return row ? JSON.parse(row.value) : undefined;
}
function setPortalField(field, value) {
  db.prepare(`
    INSERT INTO portal_data (field, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(field, JSON.stringify(value), new Date().toISOString());
}

// Seed portal_data once, only for fields that don't exist yet
(function seedPortalData() {
  const existingStaff = getPortalField('staff');
  if (!existingStaff) {
    const defaultSched = {};
    const schedules = {};
    const personalTasks = {};
    const shiftHistory = {};
    Object.keys(PORTAL_DEFAULT_STAFF).forEach(nm => {
      defaultSched[nm] = PORTAL_DEFAULT_SCHEDULES[nm];
      schedules[nm] = {};
      personalTasks[nm] = {};
      shiftHistory[nm] = [];
    });
    setPortalField('staff', PORTAL_DEFAULT_STAFF);
    setPortalField('defaultSched', defaultSched);
    setPortalField('schedules', schedules);
    setPortalField('events', []);
    setPortalField('duties', []);
    setPortalField('personalTasks', personalTasks);
    setPortalField('shiftHistory', shiftHistory);
    setPortalField('weekTypeOverrides', {});
    console.log('Seeded portal data (staff schedules, planner, etc.)');
  }
})();

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════
function nowISO() {
  return new Date().toISOString();
}
function hoursBetween(inISO, outISO) {
  const ms = new Date(outISO).getTime() - new Date(inISO).getTime();
  return Math.round((ms / 3600000) * 100) / 100;
}
function getEmployee(name) {
  return db.prepare('SELECT * FROM employees WHERE name = ?').get(name);
}
function getOpenShift(name) {
  return db.prepare('SELECT * FROM shifts WHERE employee = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1').get(name);
}

// ══════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: "Jane's Bakery API" });
});

// ── List all employees (name + role only, never pins) ──
app.get('/employees', (req, res) => {
  const rows = db.prepare('SELECT id, name, role, manager FROM employees').all();
  res.json(rows);
});

// ── Add a new employee ──
// POST /employees  { name, pin, role, manager }
app.post('/employees', (req, res) => {
  const { name, pin, role, manager } = req.body;
  if (!name || !pin) {
    return res.status(400).json({ success: false, error: 'name and pin are required' });
  }
  if (getEmployee(name)) {
    return res.status(409).json({ success: false, error: 'Employee already exists' });
  }
  try {
    db.prepare('INSERT INTO employees (name, pin, role, manager) VALUES (?, ?, ?, ?)')
      .run(name, pin, role || 'Staff', manager ? 1 : 0);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Remove an employee (their shift history is kept for records) ──
app.delete('/employees/:name', (req, res) => {
  const { name } = req.params;
  const result = db.prepare('DELETE FROM employees WHERE name = ?').run(name);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, error: 'Employee not found' });
  }
  res.json({ success: true });
});

// ── Verify PIN (used for login / manager gate) ──
// POST /verify-pin  { name, pin }
app.post('/verify-pin', (req, res) => {
  const { name, pin } = req.body;
  const emp = getEmployee(name);
  if (!emp || emp.pin !== pin) {
    return res.status(401).json({ success: false, error: 'Incorrect PIN' });
  }
  res.json({ success: true, role: emp.role, manager: !!emp.manager });
});

// ── Verify a manager PIN against ANY manager account ──
// POST /verify-manager-pin  { pin }
app.post('/verify-manager-pin', (req, res) => {
  const { pin } = req.body;
  const mgr = db.prepare('SELECT * FROM employees WHERE pin = ? AND manager = 1').get(pin);
  if (!mgr) {
    return res.status(401).json({ success: false, error: 'Incorrect manager PIN' });
  }
  res.json({ success: true, name: mgr.name });
});

// ── Clock in ──
// POST /clockin  { employee, pin }
app.post('/clockin', (req, res) => {
  const { employee, pin } = req.body;
  const emp = getEmployee(employee);
  if (!emp || emp.pin !== pin) {
    return res.status(401).json({ success: false, error: 'Incorrect PIN' });
  }
  const existing = getOpenShift(employee);
  if (existing) {
    return res.status(409).json({ success: false, error: 'Already clocked in' });
  }
  const clockIn = nowISO();
  const result = db.prepare('INSERT INTO shifts (employee, clock_in) VALUES (?, ?)').run(employee, clockIn);
  res.json({ success: true, shiftId: result.lastInsertRowid, clockIn });
});

// ── Clock out ──
// POST /clockout  { employee, pin }
app.post('/clockout', (req, res) => {
  const { employee, pin } = req.body;
  const emp = getEmployee(employee);
  if (!emp || emp.pin !== pin) {
    return res.status(401).json({ success: false, error: 'Incorrect PIN' });
  }
  const shift = getOpenShift(employee);
  if (!shift) {
    return res.status(409).json({ success: false, error: 'Not clocked in' });
  }
  const clockOut = nowISO();
  const hours = hoursBetween(shift.clock_in, clockOut);
  db.prepare('UPDATE shifts SET clock_out = ?, hours = ? WHERE id = ?').run(clockOut, hours, shift.id);
  res.json({ success: true, clockOut, hours });
});

// ── Modify a shift (manager only — PIN checked client-side via /verify-manager-pin first) ──
// PUT /shifts/:id  { clockIn, clockOut, reason }
app.put('/shifts/:id', (req, res) => {
  const { id } = req.params;
  const { clockIn, clockOut, reason } = req.body;
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
  if (!shift) return res.status(404).json({ success: false, error: 'Shift not found' });

  const newIn = clockIn || shift.clock_in;
  const newOut = clockOut || shift.clock_out;
  const hours = newOut ? hoursBetween(newIn, newOut) : null;

  db.prepare('UPDATE shifts SET clock_in = ?, clock_out = ?, hours = ?, adjusted = 1, reason = ? WHERE id = ?')
    .run(newIn, newOut, hours, reason || '', id);
  res.json({ success: true });
});

// ── Who is currently clocked in ──
app.get('/status', (req, res) => {
  const rows = db.prepare('SELECT employee, clock_in FROM shifts WHERE clock_out IS NULL').all();
  res.json(rows);
});

// ── Today's shifts (all employees) ──
app.get('/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM shifts
    WHERE date(clock_in) = ? OR (clock_out IS NULL)
    ORDER BY clock_in DESC
  `).all(today);
  res.json(rows);
});

// ── Full history for one employee ──
app.get('/history/:employee', (req, res) => {
  const rows = db.prepare('SELECT * FROM shifts WHERE employee = ? ORDER BY clock_in DESC').all(req.params.employee);
  res.json(rows);
});

// ── Full history, all employees (manager dashboard) ──
app.get('/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM shifts ORDER BY clock_in DESC').all();
  res.json(rows);
});

// ══════════════════════════════════════════════════════
// PORTAL / ADMIN DATA ROUTES
// This backs the staff schedule portal (index.html + admin.html).
// GET returns the full db object shape the frontend already expects.
// PUT lets the frontend push only the fields that changed —
// nothing else in the store is touched.
// ══════════════════════════════════════════════════════

// ── Get the whole portal db object ──
app.get('/portal-data', (req, res) => {
  const out = { version: 6 };
  PORTAL_FIELDS.forEach(f => { out[f] = getPortalField(f); });
  res.json(out);
});

// ── Get one field only (lightweight polling option) ──
app.get('/portal-data/:field', (req, res) => {
  const { field } = req.params;
  if (!PORTAL_FIELDS.includes(field)) return res.status(400).json({ error: 'Unknown field' });
  res.json({ value: getPortalField(field) });
});

// ── Update one or more fields — only the given fields are touched ──
// PUT /portal-data  { schedules: {...} }  or  { staff: {...}, events: [...] }
app.put('/portal-data', (req, res) => {
  const body = req.body || {};
  const updated = [];
  Object.keys(body).forEach(field => {
    if (PORTAL_FIELDS.includes(field)) {
      setPortalField(field, body[field]);
      updated.push(field);
    }
  });
  if (!updated.length) return res.status(400).json({ success: false, error: 'No valid fields provided' });
  res.json({ success: true, updated });
});

// ══════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jane's Bakery API running on port ${PORT}`);
});
