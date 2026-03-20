/**
 * Lift Log — Cloudflare Worker
 *
 * Acts as the server layer for the Lift Log personal strength training tracker.
 * Client is a single HTML file hosted on GitHub Pages.
 *
 * D1 binding: env.DB  (database: liftlog-db)
 *
 * Endpoints:
 *   GET    /exercises           — list all exercises
 *   POST   /exercises           — add an exercise
 *   DELETE /exercises/:key      — remove an exercise (cascade deletes its sets)
 *   POST   /save                — save a workout session
 *   GET    /history?liftKey=x   — get set history for an exercise
 *   GET    /restore             — restore exercise list (returns { exercises: [] })
 */

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Return a JSON response with CORS headers attached.
 * @param {any}    body   — value to serialise as JSON
 * @param {number} status — HTTP status code (default 200)
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

/**
 * Return a 204 No Content response for OPTIONS preflight requests.
 */
function preflightResponse() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ---------------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------------

/**
 * GET /exercises
 * Returns all exercises as a bare JSON array.
 * Called by loadState() on app boot.
 */
async function handleGetExercises(env) {
  const { results } = await env.DB.prepare(
    "SELECT key, name FROM exercises"
  ).all();
  return jsonResponse(results ?? []);
}

/**
 * POST /exercises
 * Adds a new exercise. key is generated client-side.
 * Returns the created exercise object or 409 if key already exists.
 */
async function handlePostExercises(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { key, name } = body ?? {};

  if (!key || typeof key !== "string" || !name || typeof name !== "string") {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  try {
    await env.DB.prepare("INSERT INTO exercises (key, name) VALUES (?, ?)")
      .bind(key, name)
      .run();
  } catch (err) {
    // D1 throws on UNIQUE constraint violations
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
 * Removes an exercise and cascades-deletes all its associated sets.
 * Returns 404 if the exercise does not exist.
 */
async function handleDeleteExercise(key, env) {
  // Check existence first so we can return a meaningful 404
  const existing = await env.DB.prepare(
    "SELECT key FROM exercises WHERE key = ?"
  )
    .bind(key)
    .first();

  if (!existing) {
    return jsonResponse({ error: "Exercise not found" }, 404);
  }

  // Cascade: delete sets first, then the exercise row
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sets WHERE liftKey = ?").bind(key),
    env.DB.prepare("DELETE FROM exercises WHERE key = ?").bind(key),
  ]);

  return jsonResponse({ ok: true });
}

/**
 * POST /save
 * Saves a full workout session — one row per set in the sets array.
 * Inserts are batched via D1's batch API.
 */
async function handlePostSave(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { date, liftKey, lift, sets } = body ?? {};

  // Top-level validation
  if (
    !date || typeof date !== "string" ||
    !liftKey || typeof liftKey !== "string" ||
    !lift || typeof lift !== "string" ||
    !Array.isArray(sets) || sets.length === 0
  ) {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  // Per-set validation
  for (const set of sets) {
    if (
      set.type === undefined ||
      set.setNumber === undefined ||
      set.weight === undefined ||
      set.reps === undefined
    ) {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }
  }

  try {
    const statements = sets.map((set) =>
      env.DB.prepare(
        `INSERT INTO sets (date, liftKey, lift, type, setNumber, weight, reps, partials)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        date,
        liftKey,
        lift,
        set.type,
        set.setNumber,
        set.weight,
        set.reps,
        set.partials ?? null
      )
    );

    await env.DB.batch(statements);
  } catch (err) {
    console.error("POST /save D1 error:", err);
    return jsonResponse({ error: "Failed to save session" }, 500);
  }

  return jsonResponse({ ok: true });
}

/**
 * GET /history?liftKey=x
 * Returns all sets for an exercise grouped into session objects by date,
 * ordered oldest-first. The client calls .reverse() for display.
 *
 * Note: DB column is `setNumber`; response key is `setNum` (client expects this).
 */
async function handleGetHistory(url, env) {
  const liftKey = url.searchParams.get("liftKey");

  if (!liftKey) {
    return jsonResponse({ error: "Missing liftKey query parameter" }, 400);
  }

  const { results } = await env.DB.prepare(
    "SELECT * FROM sets WHERE liftKey = ? ORDER BY date ASC, setNumber ASC"
  )
    .bind(liftKey)
    .all();

  if (!results || results.length === 0) {
    return jsonResponse([]);
  }

  // Group rows into session objects keyed by date
  const sessionsMap = new Map();

  for (const row of results) {
    if (!sessionsMap.has(row.date)) {
      sessionsMap.set(row.date, {
        date: row.date,
        liftKey: row.liftKey,
        lift: row.lift,
        sets: [],
      });
    }

    sessionsMap.get(row.date).sets.push({
      type: row.type,
      setNum: row.setNumber, // client expects setNum, not setNumber
      weight: row.weight,
      reps: row.reps,
      partials: row.partials ?? null,
    });
  }

  return jsonResponse(Array.from(sessionsMap.values()));
}

/**
 * GET /restore
 * Returns the exercise list wrapped in { exercises: [] }.
 * Called by restoreFromServer() — response shape differs from GET /exercises.
 */
async function handleGetRestore(env) {
  const { results } = await env.DB.prepare(
    "SELECT key, name FROM exercises"
  ).all();
  return jsonResponse({ exercises: results ?? [] });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, method } = Object.assign(url, { method: request.method });

    // Handle CORS preflight for all routes
    if (method === "OPTIONS") {
      return preflightResponse();
    }

    // --- /exercises ---
    if (pathname === "/exercises") {
      if (method === "GET") return handleGetExercises(env);
      if (method === "POST") return handlePostExercises(request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /exercises/:key ---
    const exerciseKeyMatch = pathname.match(/^\/exercises\/(.+)$/);
    if (exerciseKeyMatch) {
      const key = decodeURIComponent(exerciseKeyMatch[1]);
      if (method === "DELETE") return handleDeleteExercise(key, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /save ---
    if (pathname === "/save") {
      if (method === "POST") return handlePostSave(request, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /history ---
    if (pathname === "/history") {
      if (method === "GET") return handleGetHistory(url, env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // --- /restore ---
    if (pathname === "/restore") {
      if (method === "GET") return handleGetRestore(env);
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Fallthrough — no matching route
    return jsonResponse({ error: "Not found" }, 404);
  },
};
