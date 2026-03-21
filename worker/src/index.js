/**
 * Lift Log — Cloudflare Worker v2
 *
 * Acts as the server layer for the Lift Log personal strength training tracker.
 * Client is a single HTML file hosted on GitHub Pages.
 *
 * D1 binding: env.DB  (database: liftlog-db)
 *
 * Auth: simple token-based. Client sends X-User-Id header with every request.
 * Worker scopes all queries to that userId. No password verification for now.
 *
 * Endpoints:
 *   GET    /exercises                — list exercises for this user
 *   POST   /exercises                — add an exercise
 *   DELETE /exercises/:key           — remove an exercise (cascade deletes sessions + sets)
 *   POST   /save                     — save a workout session
 *   GET    /history?liftKey=x        — get session history for an exercise
 *   GET    /restore                  — restore exercise list for this user
 *   POST   /user                     — register a new user (first-time setup)
 *   GET    /wellness?date=x          — get wellness entry for a date
 *   POST   /wellness                 — save or update a wellness entry
 */

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function preflightResponse() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ---------------------------------------------------------------------------
// Auth helper — reads userId from header, validates it exists in DB
// ---------------------------------------------------------------------------

/**
 * Extracts userId from the X-User-Id request header.
 * Returns the userId string, or null if missing/blank.
 * Does NOT hit the DB — just reads the header.
 */
function getUserId(request) {
  const id = request.headers.get("X-User-Id");
  return id && id.trim() ? id.trim() : null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if value is a finite number (not NaN, not Infinity).
 * Accepts both number primitives and numeric strings.
 */
function isValidNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  return isFinite(n);
}

/**
 * Returns true if value is a positive number (> 0).
 */
function isPositiveNumber(value) {
  return isValidNumber(value) && Number(value) > 0;
}

// ---------------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------------

/**
 * POST /user
 * Registers a new user. Called once on first app load if userId is new.
 * Body: { id, name }
 * Returns 200 if created, 409 if already exists (safe to ignore on client).
 */
async function handlePostUser(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { id, name } = body ?? {};

  if (!id || typeof id !== "string" || !name || typeof name !== "string") {
    return jsonResponse({ error: "id and name are required" }, 400);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO users (id, name, createdAt) VALUES (?, ?, ?)"
    )
      .bind(id, name.trim(), new Date().toISOString())
      .run();
  } catch (err) {
    if (err.message?.includes("UNIQUE") || err.message?.includes("unique")) {
      return jsonResponse({ ok: true, existing: true });
    }
    console.error("POST /user D1 error:", err);
    return jsonResponse({ error: "Failed to create user" }, 500);
  }

  return jsonResponse({ ok: true, existing: false });
}

/**
 * GET /user/:id
 * Looks up an existing user by ID. Used by the "Already a user?" sign-in flow.
 * Returns 404 if not found.
 */
async function handleGetUser(id, env) {
  const row = await env.DB.prepare(
    "SELECT id, name FROM users WHERE id = ?"
  ).bind(id).first();

  if (!row) return jsonResponse({ error: "User not found" }, 404);
  return jsonResponse({ id: row.id, name: row.name });
}

/**
 * GET /exercises
 * Returns all exercises for the authenticated user.
 */
async function handleGetExercises(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: "X-User-Id header required" }, 401);

  const { results } = await env.DB.prepare(
    "SELECT key, name FROM exercises WHERE userId = ? ORDER BY name ASC"
  )
    .bind(userId)
    .all();

  return jsonResponse(results ?? []);
}

/**
 * POST /exercises
 * Adds a new exercise for the authenticated user.
 * Body: { key, name }
 */
async function handlePostExercises(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: "X-User-Id header required" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { key, name } = body ?? {};

  if (!key || typeof key !== "string" || !name || typeof name !== "string") {
    return jsonResponse({ error: "key and name are required" }, 400);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO exercises (key, userId, name) VALUES (?, ?, ?)"
    )
      .bind(key.trim(), userId, name.trim())
      .run();
  } catch (err) {
    if (err.message?.includes("UNIQUE") || err.message?.includes("unique")) {
      return jsonResponse({ error: "Exercise already exists" }, 409);
    }
    console.error("POST /exercises D1 error:", err);
    return jsonResponse({ error: "Failed to add exercise" }, 500);
  }

  return jsonResponse({ key, name });
}

/**
 * DELETE /exercises/:key
 * Removes an exercise and all its sessions and sets for this user.
 */
async function handleDeleteExercise(key, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: "X-User-Id header required" }, 401);

  const existing = await env.DB.prepare(
    "SELECT key FROM exercises WHERE key = ? AND userId = ?"
  )
    .bind(key, userId)
    .first();

  if (!existing) {
    return jsonResponse({ error: "Exercise not found" }, 404);
  }

  // Cascade: delete sets → sessions → exercise
  // Sets reference sessionId, so find all session IDs first
  const { results: sessionRows } = await env.DB.prepare(
    "SELECT id FROM sessions WHERE liftKey = ? AND userId = ?"
  )
    .bind(key, userId)
    .all();

  const sessionIds = (sessionRows ?? []).map((r) => r.id);

  const statements = [];

  if (sessionIds.length > 0) {
    // Delete sets for each session (D1 doesn't support IN with bound arrays natively,
    // so we batch individual deletes)
    for (const sid of sessionIds) {
      statements.push(
        env.DB.prepare("DELETE FROM sets WHERE sessionId = ?").bind(sid)
      );
    }
  }

  statements.push(
    env.DB.prepare("DELETE FROM sessions WHERE liftKey = ? AND userId = ?").bind(key, userId)
  );
  statements.push(
    env.DB.prepare("DELETE FROM exercises WHERE key = ? AND userId = ?").bind(key, userId)
  );

  await env.DB.batch(statements);

  return jsonResponse({ ok: true });
}

/**
 * POST /save
 * Saves a full workout session.
 * Body: { sessionId, date, liftKey, lift, rpe?, notes?, sets: [...] }
 * Each set: { type, setNumber, weight (number), reps (integer), partials? }
 *
 * Validates that weight and reps are real numbers before writing to D1.
 */
async function handlePostSave(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: "X-User-Id header required" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { sessionId, date, liftKey, lift, rpe, notes, sets } = body ?? {};

  // Top-level validation
  if (
    !sessionId || typeof sessionId !== "string" ||
    !date || typeof date !== "string" ||
    !liftKey || typeof liftKey !== "string" ||
    !lift || typeof lift !== "string" ||
    !Array.isArray(sets) || sets.length === 0
  ) {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  // Per-set validation — weight and reps must be valid numbers
  for (const set of sets) {
    if (!isValidNumber(set.weight) || !isValidNumber(set.reps)) {
      return jsonResponse(
        { error: `Invalid weight or reps in set ${set.setNumber} — must be numbers` },
        400
      );
    }
    if (!isPositiveNumber(set.weight)) {
      return jsonResponse(
        { error: `Weight must be greater than zero in set ${set.setNumber}` },
        400
      );
    }
  }

  // Check for duplicate sessionId (prevents double-save)
  const existing = await env.DB.prepare(
    "SELECT id FROM sessions WHERE id = ?"
  )
    .bind(sessionId)
    .first();

  if (existing) {
    // Idempotent — already saved, return success
    return jsonResponse({ ok: true, duplicate: true });
  }

  try {
    const statements = [];

    // Insert the session row
    statements.push(
      env.DB.prepare(
        `INSERT INTO sessions (id, userId, liftKey, date, rpe, notes, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sessionId,
        userId,
        liftKey,
        date,
        rpe !== undefined && rpe !== null ? Number(rpe) : null,
        notes ?? null,
        new Date().toISOString()
      )
    );

    // Insert each set, referencing the session
    for (const set of sets) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO sets (sessionId, type, setNumber, weight, reps, partials)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          sessionId,
          set.type,
          Number(set.setNumber),
          Number(set.weight),         // stored as REAL
          Math.round(Number(set.reps)), // stored as INTEGER
          set.partials !== undefined && set.partials !== null && set.partials !== ""
            ? Math.round(Number(set.partials))
            : null                   // NULL if not present — never empty string
        )
      );
    }

    await env.DB.batch(statements);
  } catch (err) {
    console.error("POST /save D1 error:", err);
    return jsonResponse({ error: "Failed to save session" }, 500);
  }

  return jsonResponse({ ok: true });
}

/**
 * GET /history?liftKey=x
 * Returns all sessions for an exercise, each with their sets.
 * Ordered oldest-first (client reverses for display).
 */
async function handleGetHistory(url, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: "X-User-Id header required" }, 401);

  const liftKey = url.searchParams.get("liftKey");
  if (!liftKey) {
    return jsonResponse({ error: "Missing liftKey query parameter" }, 400);
  }

  // Fetch sessions for this user + exercise
  const { results: sessionRows } = await env.DB.prepare(
    `SELECT id, date, liftKey, rpe, notes
     FROM sessions
     WHERE userId = ? AND liftKey = ?
     ORDER BY date ASC, createdAt ASC`
  )
    .bind(userId, liftKey)
    .all();

  if (!sessionRows || sessionRows.length === 0) {
    return jsonResponse([]);
  }

  // Fetch all sets for these sessions in one query
  const sessionIds = sessionRows.map((s) => s.id);

  // D1 doesn't support array binding for IN clauses, so we use a
  // parameterised query built from the session count
  const placeholders = sessionIds.map(() => "?").join(", ");
  const { results: setRows } = await env.DB.prepare(
    `SELECT sessionId, type, setNumber, weight, reps, partials
     FROM sets
     WHERE sessionId IN (${placeholders})
     ORDER BY setNumber ASC`
  )
    .bind(...sessionIds)
    .all();

  // Group sets by sessionId
  const setsBySession = new Map();
  for (const row of setRows ?? []) {
    if (!setsBySession.has(row.sessionId)) {
      setsBySession.set(row.sessionId, []);
    }
    setsBySession.get(row.sessionId).push({
      type: row.type,
      setNum: row.setNumber,
      weight: row.weight,
      reps: row.reps,
      partials: row.partials ?? null,
    });
  }

  // Build response — one object per session
  const sessions = sessionRows.map((s) => ({
    sessionId: s.id,
    date: s.date,
    liftKey: s.liftKey,
    rpe: s.rpe ?? null,
    notes: s.notes ?? null,
    sets: setsBySession.get(s.id) ?? [],
  }));

  return jsonResponse(sessions);
}

/**
 * GET /restore
 * Returns the exercise list for this user.
 * Shape: { exercises: [] }
 */
async function handleGetRestore(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: "X-User-Id header required" }, 401);

  const { results } = await env.DB.prepare(
    "SELECT key, name FROM exercises WHERE userId = ? ORDER BY name ASC"
  )
    .bind(userId)
    .all();

  return jsonResponse({ exercises: results ?? [] });
}

/**
 * GET /wellness?date=YYYY-MM-DD
 * Returns the wellness entry for this user on a given date.
 */
async function handleGetWellness(url, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: "X-User-Id header required" }, 401);

  const date = url.searchParams.get("date");
  if (!date) return jsonResponse({ error: "Missing date query parameter" }, 400);

  const row = await env.DB.prepare(
    "SELECT sleepScore, stressScore, nutritionScore, notes FROM daily_wellness WHERE userId = ? AND date = ?"
  )
    .bind(userId, date)
    .first();

  return jsonResponse(row ?? null);
}

/**
 * POST /wellness
 * Saves or updates the wellness entry for this user on a given date.
 * Body: { date, sleepScore?, stressScore?, nutritionScore?, notes? }
 */
async function handlePostWellness(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: "X-User-Id header required" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { date, sleepScore, stressScore, nutritionScore, notes } = body ?? {};

  if (!date || typeof date !== "string") {
    return jsonResponse({ error: "date is required" }, 400);
  }

  // Validate scores if provided
  for (const [field, val] of [["sleepScore", sleepScore], ["stressScore", stressScore], ["nutritionScore", nutritionScore]]) {
    if (val !== undefined && val !== null) {
      const n = Number(val);
      if (!isFinite(n) || n < 1 || n > 10) {
        return jsonResponse({ error: `${field} must be between 1 and 10` }, 400);
      }
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO daily_wellness (userId, date, sleepScore, stressScore, nutritionScore, notes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET
         sleepScore     = excluded.sleepScore,
         stressScore    = excluded.stressScore,
         nutritionScore = excluded.nutritionScore,
         notes          = excluded.notes`
    )
      .bind(
        userId,
        date,
        sleepScore !== undefined && sleepScore !== null ? Number(sleepScore) : null,
        stressScore !== undefined && stressScore !== null ? Number(stressScore) : null,
        nutritionScore !== undefined && nutritionScore !== null ? Number(nutritionScore) : null,
        notes ?? null,
        new Date().toISOString()
      )
      .run();
  } catch (err) {
    console.error("POST /wellness D1 error:", err);
    return jsonResponse({ error: "Failed to save wellness entry" }, 500);
  }

  return jsonResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS") return preflightResponse();

    // --- /user ---
    if (pathname === "/user") {
      if (method === "POST") return handlePostUser(request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /user/:id ---
    const userIdMatch = pathname.match(/^\/user\/(.+)$/);
    if (userIdMatch) {
      const id = decodeURIComponent(userIdMatch[1]);
      if (method === "GET") return handleGetUser(id, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /exercises ---
    if (pathname === "/exercises") {
      if (method === "GET") return handleGetExercises(request, env);
      if (method === "POST") return handlePostExercises(request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /exercises/:key ---
    const exerciseKeyMatch = pathname.match(/^\/exercises\/(.+)$/);
    if (exerciseKeyMatch) {
      const key = decodeURIComponent(exerciseKeyMatch[1]);
      if (method === "DELETE") return handleDeleteExercise(key, request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /save ---
    if (pathname === "/save") {
      if (method === "POST") return handlePostSave(request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /history ---
    if (pathname === "/history") {
      if (method === "GET") return handleGetHistory(url, request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /restore ---
    if (pathname === "/restore") {
      if (method === "GET") return handleGetRestore(request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /wellness ---
    if (pathname === "/wellness") {
      if (method === "GET") return handleGetWellness(url, request, env);
      if (method === "POST") return handlePostWellness(request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};
