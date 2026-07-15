# Jane's — One Backend For Everything

Both the **staff schedule portal** (`index.html` + `admin.html`) and the
**bakery clock in/out system** (`bakery.html`) now run on this single
backend. One small API, one SQLite file, every device reads and writes
through it — no more Firebase, no more "last save wins" overwrite bugs.

## What's in here

- `server.js` — the whole backend (Express + SQLite). One file, ~350 lines.
- `package.json` — dependencies.
- `bakery.html` — clock in/out frontend.
- `index.html` — staff schedule portal frontend.
- `admin.html` — admin/manager schedule editor frontend.

All three HTML files go on GitHub Pages exactly as before. Only `server.js`
needs real hosting (it's the only piece that has to "run" continuously).

## Default logins

**Bakery clock in/out** (change PINs any time from the Team tab):

| Name    | PIN    | Role    |
|---------|--------|---------|
| Sly     | 1111   | Staff   |
| Wayne   | 2222   | Staff   |
| Panashe | 3333   | Staff   |
| Hilda   | 4444   | Staff   |
| Grace   | 5555   | Manager |
| Josh    | 765305 | Manager |

**Staff schedule portal** (`index.html` / `admin.html`):

| Name    | PIN  | Role      |
|---------|------|-----------|
| Panashe | 3333 | Budtender |
| Kate    | 2222 | Budtender |
| Jamal   | 1111 | Budtender (admin) |
| JP      | 4444 | Chef      |
| Josh    | 5555 | Manager (admin, owner) |
| Eva     | 6666 | Owner (admin) |
| Charlet | 7777 | Owner (admin) |

## 1. Run it locally first (optional, just to see it work)

```bash
npm install
npm start
```

Starts the API on `http://localhost:3000`, creates `bakery.db` automatically
on first run, seeded with everyone above and the default weekly schedules.

## 2. Deploy the backend somewhere it can run 24/7

GitHub Pages only serves static files — it can't run `server.js`. Pick one
(all have a free tier as of writing):

### Render (recommended, easiest)
1. Push this folder to a **new GitHub repo** — just `server.js` and
   `package.json` need to be there.
2. Go to [render.com](https://render.com) → New → Web Service → connect
   that repo.
3. Build command: `npm install`
   Start command: `npm start`
4. Deploy. You'll get a URL like `https://janes-backend.onrender.com`.
   Free tier sleeps after 15 min idle — first request after a quiet spell
   takes a few seconds to wake up, everything after that is instant.

### Railway / Fly.io / a cheap VPS
Same idea, connect the repo, it detects Node.js automatically.

## 3. Point every frontend at your backend

Each of the three HTML files has an **"API settings"** link on its login
screen. Click it once per device, paste your backend URL
(e.g. `https://janes-backend.onrender.com` — no trailing slash), hit
Save & Connect. It's remembered after that on that device/browser.

## 4. Upload the HTML files to GitHub Pages

Same as before — `index.html`, `admin.html`, `bakery.html` all sit in your
Pages repo alongside each other.

## How data flows now

Every device — phone, tablet, laptop — talks to the same backend over
plain HTTPS `fetch` calls:

- **Bakery**: clocking in/out is a single row insert/update in the
  `shifts` table. Two people clocking in on two different devices at the
  exact same second can never collide.
- **Portal/Admin**: the whole schedule/planner/tasks data lives in a
  `portal_data` table, one row per top-level field (`staff`, `schedules`,
  `events`, `duties`, `personalTasks`, `shiftHistory`, etc). Saving a shift
  only touches the `schedules` row — it can never accidentally wipe out
  someone's personal task or a planner event that changed a second earlier
  on a different device.

Each frontend polls the backend every 10 seconds and also refreshes
whenever the tab regains focus, so changes show up everywhere within a
few seconds without needing WebSockets.

## API reference

### Bakery (clock in/out)
| Method | Path                  | What it does |
|--------|------------------------|--------------|
| GET    | `/employees`          | List bakery staff (no PINs returned) |
| POST   | `/employees`          | Add employee `{name, pin, role, manager}` |
| DELETE | `/employees/:name`    | Remove an employee |
| POST   | `/verify-pin`         | Check one employee's own PIN |
| POST   | `/verify-manager-pin` | Check PIN against any manager account |
| POST   | `/clockin`            | `{employee, pin}` → starts a shift |
| POST   | `/clockout`           | `{employee, pin}` → ends a shift |
| PUT    | `/shifts/:id`         | Manager edit: `{clockIn, clockOut, reason}` |
| GET    | `/status`             | Who is currently clocked in |
| GET    | `/today`              | Today's shifts |
| GET    | `/history/:employee`  | Full shift history for one person |
| GET    | `/history`            | Full shift history, everyone |

### Portal / Admin (schedules, planner, tasks)
| Method | Path                    | What it does |
|--------|--------------------------|--------------|
| GET    | `/portal-data`          | Full staff/schedule/planner state |
| GET    | `/portal-data/:field`   | One field only (lightweight) |
| PUT    | `/portal-data`          | Update only the fields you send, e.g. `{"schedules": {...}}` |

Nothing here ever does a full-document overwrite — every write is scoped
to the exact rows/fields that changed.
