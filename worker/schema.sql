-- ============================================================
-- Lift Log — D1 Schema v2
-- ============================================================
-- Changes from v1:
--   • users table added (simple token-based auth)
--   • exercises scoped to a userId
--   • sessions table added (replaces date-grouping in worker)
--   • sets now reference sessionId, not date + liftKey directly
--   • daily_wellness table added for coach scoring
--   • rpe + notes added to sessions for coach analysis
-- ============================================================

-- Users
-- One row per person. id is a client-generated UUID stored in
-- localStorage. No passwords — simple token-based auth for now.
CREATE TABLE IF NOT EXISTS users (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

-- Exercises
-- Scoped to a user. key is a clean slug e.g. "incline_press".
CREATE TABLE IF NOT EXISTS exercises (
  key    TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES users(id),
  name   TEXT NOT NULL,
  PRIMARY KEY (key, userId)
);

-- Sessions
-- One row per workout session. Replaces the old approach of
-- grouping sets by date in the worker.
CREATE TABLE IF NOT EXISTS sessions (
  id        TEXT PRIMARY KEY,           -- client-generated UUID
  userId    TEXT NOT NULL REFERENCES users(id),
  liftKey   TEXT NOT NULL,
  date      TEXT NOT NULL,             -- YYYY-MM-DD
  rpe       INTEGER,                   -- 1–10, optional
  notes     TEXT,                      -- free text, optional
  createdAt TEXT NOT NULL              -- ISO timestamp
);

-- Sets
-- One row per set. References its parent session.
-- weight stored as REAL, reps as INTEGER throughout.
-- partials is NULL when not applicable (not empty string).
CREATE TABLE IF NOT EXISTS sets (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT    NOT NULL REFERENCES sessions(id),
  type      TEXT    NOT NULL,          -- "Warm Up" | "Working" | "Back Off"
  setNumber INTEGER NOT NULL,
  weight    REAL    NOT NULL,
  reps      INTEGER NOT NULL,
  partials  INTEGER                    -- NULL if none, integer if present
);

-- Daily Wellness
-- One row per user per day. Populated by the agent coach.
-- Separate from sessions — exists on rest days too.
CREATE TABLE IF NOT EXISTS daily_wellness (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  userId         TEXT    NOT NULL REFERENCES users(id),
  date           TEXT    NOT NULL,    -- YYYY-MM-DD
  sleepScore     INTEGER,             -- 1–10
  stressScore    INTEGER,             -- 1–10
  nutritionScore INTEGER,             -- 1–10
  notes          TEXT,
  createdAt      TEXT    NOT NULL,
  UNIQUE(userId, date)
);
