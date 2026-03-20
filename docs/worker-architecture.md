# Lift Log — Cloudflare Worker Architecture Prompt

> **How to use this file.** Paste the contents of this file into a new conversation with Claude and ask it to generate the Worker code. The file contains everything Claude needs to produce a correct, working `src/index.js` for the Lift Log Cloudflare Worker. Do not edit the spec sections — they are derived directly from the walkthrough notes and must match the client-side code exactly.

---

## Context

You are building a Cloudflare Worker that acts as the server layer for Lift Log, a personal strength training tracker. The client is a single HTML file hosted on GitHub Pages. It currently uses Google Apps Script + Google Sheets as its backend. This Worker replaces that entirely.

The Worker must be written in plain JavaScript (no TypeScript). It runs on Cloudflare Workers runtime and has a D1 SQLite database bound to it as `env.DB`.

---

## Database schema

Two tables. This schema already exists — do not include `CREATE TABLE` statements in the Worker itself.

```sql
-- Table 1: exercises
CREATE TABLE IF NOT EXISTS exercises (
  key   TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

-- Table 2: sets
CREATE TABLE IF NOT EXISTS sets (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT    NOT NULL,
  liftKey   TEXT    NOT NULL,
  lift      TEXT    NOT NULL,
  type      TEXT    NOT NULL,
  setNumber INTEGER NOT NULL,
  weight    REAL    NOT NULL,
  reps      INTEGER NOT NULL,
  partials  INTEGER
);
```

---

## Required endpoints

The Worker must implement exactly these six endpoints. The client-side code calls each one — the method, path, request shape, and response shape must match exactly.

---

### GET /exercises

**Purpose:** Called by `loadState()` on app boot. Returns the full exercise list so the app can populate the in-memory `exercises` array.

**Request:** No body. No query parameters.

**D1 query:**
```sql
SELECT key, name FROM exercises
```

**Response:** JSON array.
```json
[
  { "key": "bench_1234567890", "name": "Bench Press" },
  { "key": "rows_1234567891", "name": "Barbell Rows" }
]
```

Returns an empty array `[]` if no exercises exist. This is the expected state on first load — the app handles it by showing the first-load empty state screen.

---

### POST /exercises

**Purpose:** Called by `addExercise()` when the user adds a new exercise via the drawer menu.

**Request body:**
```json
{ "key": "bench_1234567890", "name": "Bench Press" }
```

- `key` is generated client-side as `exerciseName_timestamp` (e.g. `bench_1711234567890`). It is the stable identifier used as a foreign key in the `sets` table.
- `name` is the user-entered display string.

**D1 query:**
```sql
INSERT INTO exercises (key, name) VALUES (?, ?)
```

**Response on success:** The created exercise object.
```json
{ "key": "bench_1234567890", "name": "Bench Press" }
```

**Response on failure (e.g. duplicate key):** HTTP 409 with error body.
```json
{ "error": "Exercise already exists" }
```

---

### DELETE /exercises/:key

**Purpose:** Called by `removeExercise()` when the user removes an exercise via the drawer menu.

**Request:** No body. The exercise key is in the URL path (e.g. `DELETE /exercises/bench_1234567890`).

**D1 queries:**

Option A — cascade delete (deletes associated set history):
```sql
DELETE FROM sets WHERE liftKey = ?;
DELETE FROM exercises WHERE key = ?;
```

Option B — retain orphaned history (deletes exercise only):
```sql
DELETE FROM exercises WHERE key = ?;
```

**Implement Option A (cascade delete).** This is the cleaner choice for a personal tool — if you are removing an exercise you are done with it and its history. The client already presents a confirmation dialog before calling this endpoint.

**Response on success:**
```json
{ "ok": true }
```

**Response on not found:** HTTP 404.
```json
{ "error": "Exercise not found" }
```

---

### POST /save

**Purpose:** Called by `saveSession()` after the user taps the save button at the end of a workout. Writes one row to the `sets` table for every set in the session.

**Request body:**
```json
{
  "date": "2026-03-15",
  "liftKey": "bench_1234567890",
  "lift": "Bench Press",
  "sets": [
    { "type": "warmup",  "setNumber": 1, "weight": 60,  "reps": 10, "partials": null },
    { "type": "warmup",  "setNumber": 2, "weight": 80,  "reps": 5,  "partials": null },
    { "type": "working", "setNumber": 1, "weight": 100, "reps": 8,  "partials": null },
    { "type": "backoff", "setNumber": 1, "weight": 80,  "reps": 10, "partials": 3    }
  ]
}
```

- `date`: ISO date string (`YYYY-MM-DD`), derived from `todayStr()` on the client.
- `liftKey`: the stable exercise identifier from the `exercises` table.
- `lift`: the display name of the exercise (stored for readability — not used for querying).
- `sets`: array of set objects. `partials` may be null.

**D1 query (run once per set in the array):**
```sql
INSERT INTO sets (date, liftKey, lift, type, setNumber, weight, reps, partials)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```

Insert all sets in a single batch if D1's batch API is available, otherwise loop.

**Response on success:**
```json
{ "ok": true }
```

**Response on failure:** HTTP 500 with error body.
```json
{ "error": "Failed to save session" }
```

---

### GET /history?liftKey=x

**Purpose:** Called by `getHistory(liftKey)` every time the progress dashboard or last session view loads. Returns all sets for a given exercise, grouped into session objects, sorted oldest-first (the client calls `.reverse()` for display).

**Request:** Query parameter `liftKey` — the exercise key to fetch history for.

**D1 query:**
```sql
SELECT * FROM sets WHERE liftKey = ? ORDER BY date ASC, setNumber ASC
```

**Response:** JSON array of session objects. Each session contains all the sets logged on a given date for the given exercise, grouped by `date`.

```json
[
  {
    "date": "2026-03-01",
    "liftKey": "bench_1234567890",
    "lift": "Bench Press",
    "sets": [
      { "type": "warmup",  "setNum": 1, "weight": 60,  "reps": 10, "partials": null },
      { "type": "working", "setNum": 1, "weight": 100, "reps": 8,  "partials": null },
      { "type": "backoff", "setNum": 1, "weight": 80,  "reps": 10, "partials": 3    }
    ]
  },
  {
    "date": "2026-03-08",
    "liftKey": "bench_1234567890",
    "lift": "Bench Press",
    "sets": [...]
  }
]
```

**Important:** The `sets` array inside each session object uses `setNum` as the key name (not `setNumber`) — this matches what the client-side rendering functions (`renderSetTable()`, `renderCharts()`) expect. Map `setNumber` from the D1 row to `setNum` in the response object.

Returns an empty array `[]` if no history exists for the given exercise. The client handles this gracefully (shows "no sessions logged" empty state).

---

### GET /restore

**Purpose:** Called by `restoreFromServer()` when the user taps "Restore from server" — either from the settings panel or from the first-load empty state screen. Returns the exercise list so the app can hydrate in-memory state. Does not return set history — that is fetched on demand via `GET /history`.

**Request:** No body. No query parameters.

**D1 query:**
```sql
SELECT key, name FROM exercises
```

**Response:**
```json
{
  "exercises": [
    { "key": "bench_1234567890", "name": "Bench Press" },
    { "key": "rows_1234567891", "name": "Barbell Rows" }
  ]
}
```

Note: this returns the same data as `GET /exercises` but wrapped in an `{ exercises: [] }` object rather than a bare array. This distinction matters — the client code in `restoreFromServer()` reads `data.exercises`, while the client code in `loadState()` reads the array directly. The two endpoints have different response shapes by design.

---

## CORS requirements

Every response from the Worker must include:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

The Worker must handle `OPTIONS` preflight requests for all paths. When the method is `OPTIONS`, return HTTP 204 with the headers above and no body.

This is required because the HTML file is served from GitHub Pages (`*.github.io`) and the Worker runs on `*.workers.dev` — they are different origins and the browser will block responses without these headers.

---

## Request validation

For POST endpoints, validate the incoming body before writing to D1:

- `POST /exercises`: check that `key` and `name` are both present strings.
- `POST /save`: check that `date`, `liftKey`, `lift`, and `sets` are all present; check that `sets` is a non-empty array; check that each set has `type`, `setNumber`, `weight`, and `reps`.

Return HTTP 400 with `{ "error": "Invalid request body" }` if validation fails.

---

## Error handling

Every endpoint must return appropriate HTTP status codes:

- 200: success
- 204: OPTIONS preflight response (no body)
- 400: bad request (missing or invalid fields)
- 404: not found (DELETE on a non-existent key)
- 405: method not allowed (wrong HTTP method for the path)
- 409: conflict (duplicate key on POST /exercises)
- 500: internal server error (D1 query failure)

All error responses return JSON: `{ "error": "description" }`.

---

## Environment bindings

The Worker has one binding defined in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "liftlog-db"
database_id = "your-actual-id-here"
```

Access the database in the Worker as `env.DB`. Use `env.DB.prepare(sql).bind(...args).run()` for writes and `env.DB.prepare(sql).bind(...args).all()` for reads.

---

## What is NOT in this Worker yet (Phase 2)

The Anthropic API proxy for the coaching conversation is a Phase 2 feature. It is not part of this initial build. When it is added, the Anthropic API key will be stored as a Wrangler secret (`ANTHROPIC_API_KEY`) and accessed as `env.ANTHROPIC_API_KEY` inside the Worker. Do not add any coaching-related endpoints to this initial Worker — keep it scoped to exercise and set data only.

---

## Output expected

A single `src/index.js` file that:

1. Exports a `fetch` handler as the default export
2. Routes requests by method and path
3. Handles CORS preflight on all routes
4. Implements all six endpoints exactly as specified above
5. Validates request bodies on POST endpoints
6. Returns appropriate HTTP status codes and JSON responses
7. Uses `env.DB` for all D1 operations with parameterised queries

The file should be readable, commented at the function level, and structured so each endpoint handler is easy to locate and modify independently.
