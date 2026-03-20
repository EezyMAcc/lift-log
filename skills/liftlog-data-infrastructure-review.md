---
name: liftlog-data-infrastructure-review
description: >
  Use this skill whenever the user asks to review, audit, or understand the Lift Log
  app's data infrastructure — meaning how the HTML frontend talks to the Cloudflare
  Worker backend, how data flows between them, and whether that connection is working
  correctly. Trigger this skill when the user says things like "review my data layer",
  "check how the frontend talks to the worker", "audit my API calls", "explain how
  my fetch calls work", "review my Cloudflare integration", or asks any question about
  how data gets in or out of D1 through the Worker. Also trigger when the user shares
  updated versions of LiftLog_Cloud_v1.html or worker_code.js and wants to understand
  what changed from a data perspective.
---

# Lift Log — Data Infrastructure Code Review

This skill performs a structured review of the Lift Log data layer: the connection
between the HTML frontend (hosted on GitHub Pages) and the Cloudflare Worker backend
(which reads and writes to the D1 database). It produces plain-English explanations
suitable for someone with little to no coding background, alongside structured JSON
summaries of what was found.

---

## What this review covers

The Lift Log app has two files that together form its data infrastructure:

1. **`LiftLog_Cloud_v1.html`** — the frontend. This is what the user sees. It contains
   JavaScript functions that *ask* the server for data or *send* data to the server.
2. **`worker_code.js`** — the backend. This runs on Cloudflare and *handles* those
   requests, reading from or writing to the D1 database.

Think of it like a café: the frontend is the customer placing an order; the Worker is
the barista at the counter; and D1 is the kitchen where the food is actually made.

---

## Step 1 — Review the HTML frontend

### What to look for

A complete review of frontend data infrastructure has two parts — not just the lines
that fire the request, but also the lines that *build the data* being sent. Both matter.

**Part A — The `fetch()` calls themselves.** These are the lines that actually send a
request to the Worker. Look for:
- `fetch(` — JavaScript's built-in function for making a network request
- `WORKER_URL` — the constant that stores the Worker's address
- Any endpoint path string: `/exercises`, `/save`, `/history`, `/restore`
- The `method:` field on each fetch — this tells you whether it is a GET (reading),
  POST (sending new data), or DELETE (removing data)

**Part B — The payload construction for POST and DELETE requests.** For every push
request (POST or DELETE), there is code *above* the `fetch()` that assembles the data
being sent. This is equally important to review because:
- If a field name in the payload doesn't match what the Worker expects, the data will
  either be silently ignored or cause a validation failure
- The Worker cannot correct a mismatch — it only sees what the frontend sends

For each POST request, find the `body: JSON.stringify(...)` argument and inspect every
field name inside it. Then cross-reference those field names against the Worker's
validation code and SQL `.bind()` calls to confirm they match exactly.

For DELETE requests, check that the key is correctly included in the URL path and
encoded with `encodeURIComponent()` to handle special characters safely.

### The WORKER_URL constant

```
const WORKER_URL = 'https://11-api-prod-x7k2.workers.dev';
```

**What this is:** This is the address (URL) of the Cloudflare Worker. Every time the
frontend wants to talk to the backend, it uses this address. Think of it as the café's
street address — without it, the customer can't find the counter.

**Why it is correct:** It is defined once at the top of the script and reused everywhere.
This means if the Worker URL ever changes, there is only one line to update, not dozens.

### Frontend API calls inventory

For each `fetch()` call found, identify:
- Which function it lives in
- Which endpoint it calls
- Whether it is a GET (asking for data) or a POST/DELETE (sending or removing data)
- What data it sends (if any)
- What it does with the response

### Output: Frontend JSON

Produce a JSON object in the following format. One entry per `fetch()` call found.

```json
{
  "frontend_api_calls": [
    {
      "function_name": "loadState",
      "line_reference": "~line 352",
      "endpoint": "GET /exercises",
      "direction": "pull",
      "purpose": "Fetches the full exercise list when the app first opens",
      "data_sent": null,
      "data_received": "Array of { key, name } objects",
      "error_handling": "Catches network errors; falls back to empty exercises array",
      "status": "working",
      "status_reason": "Correct endpoint, correct HTTP method, response is checked with res.ok, parse result is validated with Array.isArray()"
    },
    {
      "function_name": "addExercise",
      "line_reference": "~line 428",
      "endpoint": "POST /exercises",
      "direction": "push",
      "purpose": "Sends a new exercise (key + name) to the server to be saved",
      "data_sent": "{ key: string, name: string }",
      "data_received": "{ key, name } of the created exercise",
      "error_handling": "Catches errors; shows status message to user on failure",
      "status": "working",
      "status_reason": "Sends JSON body with Content-Type header, validates res.ok, updates local exercises array on success"
    },
    {
      "function_name": "removeExercise",
      "line_reference": "~line 450",
      "endpoint": "DELETE /exercises/:key",
      "direction": "push",
      "purpose": "Tells the server to delete an exercise and all its historical sets",
      "data_sent": "Exercise key encoded in the URL path",
      "data_received": "{ ok: true }",
      "error_handling": "Catches errors; shows status message to user on failure",
      "status": "working",
      "status_reason": "Uses encodeURIComponent() to safely encode the key in the URL, checks res.ok, removes exercise from local state on success"
    },
    {
      "function_name": "saveSession",
      "line_reference": "~line 563–570",
      "endpoint": "POST /save",
      "direction": "push",
      "purpose": "Sends a completed workout session (date, exercise, all sets) to be stored permanently",
      "data_sent": "{ date, liftKey, lift, sets: [{ type, setNum, weight, reps, partials }] }",
      "data_received": "{ ok: true }",
      "error_handling": "Catches errors; informs user sets are held locally if server unreachable",
      "status": "BUG",
      "status_reason": "The frontend builds each set object with the field name 'setNum' (lines 563–565). The Worker's per-set validation checks for 'set.setNumber' (not 'setNum'), and the SQL bind also uses 'set.setNumber'. Because 'setNumber' is never present in the payload, the Worker will return a 400 validation error on every save attempt, OR if validation is somehow passed, 'undefined' will be written into the setNumber column in D1. The fix is to rename 'setNum' to 'setNumber' in the three payload-building lines in saveSession(), so the frontend matches what the Worker expects."
    },
    {
      "function_name": "getHistory",
      "line_reference": "~line 588",
      "endpoint": "GET /history?liftKey=x",
      "direction": "pull",
      "purpose": "Fetches all historical sessions for a given exercise, used for charts and last-session display",
      "data_sent": "liftKey as a URL query parameter",
      "data_received": "Array of session objects, each containing { date, liftKey, lift, sets }",
      "error_handling": "Returns empty array on any error; caller handles empty gracefully",
      "status": "working",
      "status_reason": "Uses encodeURIComponent() on liftKey, calls .reverse() on result so newest sessions appear first in the UI"
    },
    {
      "function_name": "restoreFromServer",
      "line_reference": "~line 806",
      "endpoint": "GET /restore",
      "direction": "pull",
      "purpose": "Re-hydrates the exercise list from the server — used when local state is lost or the app is opened on a new device",
      "data_sent": null,
      "data_received": "{ exercises: [{ key, name }] }",
      "error_handling": "Catches errors; shows message. Button is reset in finally block so it never gets stuck.",
      "status": "working",
      "status_reason": "Note: response shape here is { exercises: [] } not a bare array — this is intentional and matches the Worker's /restore handler"
    }
  ]
}
```

**Critical: `setNum` vs `setNumber` field name mismatch — this is a bug, not an asymmetry.**

When `saveSession()` builds the sets payload (lines 563–565), it names the field `setNum`.
The Worker's `handlePostSave` validation (line 159) checks for `set.setNumber`, and the
SQL `.bind()` (line 177) also reads `set.setNumber`. Because the frontend never sends
`setNumber`, the Worker will reject every save with a 400 error or store `undefined` in
the database.

The fix is in the frontend only — change `setNum:` to `setNumber:` in the three
`sets.push(...)` lines inside `saveSession()`. The Worker code is correct as written.

Note: `getHistory` correctly renames `setNumber` back to `setNum` in its response (this
*is* intentional, because the chart rendering code reads `setNum`). So after fixing the
save bug, the full lifecycle becomes: frontend sends `setNumber` → Worker stores
`setNumber` → Worker reads and renames to `setNum` → frontend displays `setNum`. That
chain is consistent.

---

## Step 2 — Review the Worker backend

### What to look for

In `worker_code.js`, identify:
- The **router** (the `fetch` export at the bottom) — this is the traffic controller
  that reads the URL and method, then decides which handler to call
- Each **handler function** — `handleGetExercises`, `handlePostExercises`,
  `handleDeleteExercise`, `handlePostSave`, `handleGetHistory`, `handleGetRestore`
- CORS headers — the mechanism that allows the browser (on GitHub Pages) to talk to
  the Worker (on a different domain)

### Plain-English explanation of the Worker

The Worker is a small program that lives on Cloudflare's servers. When a request
arrives, the router at the bottom reads two things: *where* the request is going
(the URL path) and *what* it wants to do (the HTTP method — GET, POST, or DELETE).
It then calls the right handler function.

Each handler does one specific job:
- **Read from D1** using a SQL `SELECT` statement
- **Write to D1** using SQL `INSERT` or `DELETE` statements
- **Reply** to the frontend using `jsonResponse()`, which sends back a JSON-formatted
  response with the correct headers attached

The `CORS_HEADERS` block near the top is important: because the frontend is hosted at
`github.io` and the Worker is at `workers.dev`, browsers treat them as different
"origins" and will block requests unless the Worker explicitly says "I allow this".
The CORS headers are what give that permission. The `OPTIONS` preflight handler at
the top of the router handles the browser's "can I talk to you?" pre-check.

### Output: Worker JSON

Produce a JSON object in the following format. One entry per handler function.

```json
{
  "worker_handlers": [
    {
      "handler": "handleGetExercises",
      "route": "GET /exercises",
      "direction": "pull (frontend reads from D1)",
      "sql": "SELECT key, name FROM exercises",
      "response_shape": "Array of { key, name }",
      "validation": "None required — read-only query",
      "error_handling": "Returns empty array if no results (null-coalesced with ?? [])",
      "status": "working",
      "status_reason": "Simple read with no parameters. Response shape matches what loadState() expects."
    },
    {
      "handler": "handlePostExercises",
      "route": "POST /exercises",
      "direction": "push (frontend writes to D1)",
      "sql": "INSERT INTO exercises (key, name) VALUES (?, ?)",
      "response_shape": "{ key, name } of the created exercise, or error object",
      "validation": "Checks key and name are present, non-empty strings",
      "error_handling": "Returns 409 if key already exists (UNIQUE constraint), 400 for bad input, 500 for unexpected DB errors",
      "status": "working",
      "status_reason": "Uses parameterised query (? placeholders) preventing SQL injection. UNIQUE violation is caught and returned as a clean 409 rather than a 500."
    },
    {
      "handler": "handleDeleteExercise",
      "route": "DELETE /exercises/:key",
      "direction": "push (frontend removes from D1)",
      "sql": "DELETE FROM sets WHERE liftKey = ?  then  DELETE FROM exercises WHERE key = ?",
      "response_shape": "{ ok: true } or error object",
      "validation": "Checks exercise exists first; returns 404 if not found",
      "error_handling": "404 if exercise not found. Deletion uses D1 batch API to run both statements atomically.",
      "status": "working",
      "status_reason": "Cascade delete is handled manually (sets first, then exercise) using env.DB.batch(). This keeps referential integrity even though D1 SQLite doesn't enforce foreign keys by default."
    },
    {
      "handler": "handlePostSave",
      "route": "POST /save",
      "direction": "push (frontend writes to D1)",
      "sql": "INSERT INTO sets (date, liftKey, lift, type, setNumber, weight, reps, partials) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      "response_shape": "{ ok: true } or error object",
      "validation": "Validates top-level fields (date, liftKey, lift, sets array) then each set object — checks for set.setNumber",
      "error_handling": "400 for invalid input, 500 for DB errors. Inserts are batched.",
      "status": "working (Worker is correct — bug is in the frontend payload)",
      "status_reason": "The Worker correctly expects 'setNumber' in each set object and uses env.DB.batch() for efficient multi-row inserts. The bug is upstream: the frontend sends 'setNum' instead of 'setNumber', so the Worker's validation will reject the request. Fix is in saveSession() in the HTML, not here."
    },
    {
      "handler": "handleGetHistory",
      "route": "GET /history?liftKey=x",
      "direction": "pull (frontend reads from D1)",
      "sql": "SELECT * FROM sets WHERE liftKey = ? ORDER BY date ASC, setNumber ASC",
      "response_shape": "Array of session objects: { date, liftKey, lift, sets: [{ type, setNum, weight, reps, partials }] }",
      "validation": "Checks liftKey query param is present",
      "error_handling": "400 if liftKey missing. Returns [] if no results. Groups rows into sessions using a Map.",
      "status": "working",
      "status_reason": "Groups multiple DB rows into nested session objects in JavaScript rather than using SQL GROUP BY. setNumber column is renamed to setNum in the response to match frontend expectations."
    },
    {
      "handler": "handleGetRestore",
      "route": "GET /restore",
      "direction": "pull (frontend reads from D1)",
      "sql": "SELECT key, name FROM exercises",
      "response_shape": "{ exercises: [{ key, name }] }",
      "validation": "None required — read-only query",
      "error_handling": "Returns { exercises: [] } if no results",
      "status": "working",
      "status_reason": "Same SQL as GET /exercises but response is wrapped in { exercises: [] } — this deliberate shape difference is what restoreFromServer() expects. Do not 'unify' these two endpoints without updating the frontend."
    }
  ],
  "cors_configuration": {
    "status": "working",
    "allow_origin": "*",
    "allowed_methods": ["GET", "POST", "DELETE", "OPTIONS"],
    "allowed_headers": ["Content-Type"],
    "preflight_handler": "OPTIONS requests return 204 No Content before hitting any route logic",
    "note": "Wildcard origin (*) is appropriate for a personal single-user tool. When authentication is added in Stage 2, this should be tightened to the specific GitHub Pages origin."
  }
}
```

---

## Step 3 — Suggestions and explanations

After producing both JSONs, summarise findings for the user in plain English. Structure
your output as follows, leading with bugs if any are found:

### Bugs (fix these — something will not work correctly until they are resolved)

List any cases where a field name in the frontend payload does not match what the Worker
expects, where an endpoint is called with the wrong HTTP method, or where the response
shape is handled incorrectly. Explain the impact in plain English and give the specific
lines to change.

> **`setNum` should be `setNumber` in saveSession()** — When the app tries to save a
> workout session, it sends each set with a field called `setNum`. But the Worker is
> waiting for a field called `setNumber`. Because these names don't match, the Worker
> rejects the save every time with an error. Your workouts are not being stored.
>
> **Fix:** In `LiftLog_Cloud_v1.html`, find the three lines inside `saveSession()` that
> build the sets array (around lines 563–565). On each line, change `setNum:` to
> `setNumber:`. The Worker code does not need to change.

### What is working well

List each part of the data layer that is correctly implemented, with a one-sentence
explanation of *why* it is correct written for a non-developer. Example format:

> **Error handling on saveSession** — If the server can't be reached when you tap
> "Save Session", the app tells you your data is safe locally rather than silently
> failing. This is good because you will never lose a workout without knowing about it.

### Things to be aware of (not broken, but worth knowing)

Raise intentional asymmetries, naming differences, or areas that could confuse a future
developer. Be clear these are not bugs. Example:

> **`setNumber` on the way in, `setNum` on the way out** — Once the save bug above
> is fixed, there is still a naming difference worth understanding. The frontend sends
> `setNumber` when saving. The Worker stores it as `setNumber` in the database. But
> when the Worker sends history back to the frontend, it renames the field to `setNum`
> — because the chart and display code reads `setNum`. This rename is intentional and
> correct. If you ever touch the history or chart code, remember this: `setNumber` is
> the database name; `setNum` is the display name.

### Suggestions for improvement (optional, flag clearly as optional)

Only include suggestions that are genuinely useful at the current stage of the project.
Do not suggest premature complexity. Each suggestion should:
- State what to change
- Explain why in plain English
- Rate effort: Low / Medium / High
- State whether it is relevant now or in a future stage

Example:

> **CORS origin hardening** (Stage 2, Low effort) — Currently the Worker accepts
> requests from any website in the world (`*`). For a personal tool this is fine. But
> once you add authentication in Stage 2, you should change this to only accept
> requests from your specific GitHub Pages URL. This means even if someone found your
> Worker address, they couldn't call it from their own website.

---

## How to use this skill

When a user provides their HTML and Worker code files, or asks about the data layer:

1. Read both files (if available in project knowledge or as uploads)
2. Perform Step 1 — produce the frontend JSON
3. Perform Step 2 — produce the Worker JSON
4. Perform Step 3 — write the plain-English summary

If only one file is provided, perform the review for that file only, and note that a
complete picture requires both files.

Always write as if the reader has no coding background. Avoid jargon without definition.
The goal is not just to say what the code does — it is to help the user understand it
well enough to maintain it themselves.
