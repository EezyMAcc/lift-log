-- ============================================================
-- Lift Log — D1 Schema v3
-- ============================================================
-- Changes from v2:
--   • sessions: added post-session wellness score columns
--   • daily_wellness: renamed score columns (snake_case, feed vs nutrition),
--     added rationale columns, coaching state flags
--   • coaching_conversations: new table for AI coach message history
-- ============================================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  createdAt           TEXT NOT NULL,
  profile_text        TEXT,                -- AI-maintained prose profile (null until onboarding complete)
  profile_updated_at  TEXT,                -- ISO timestamp of last profile update
  onboarding_complete INTEGER DEFAULT 0    -- 1 once journal onboarding conversation is done
);

-- Exercises
CREATE TABLE IF NOT EXISTS exercises (
  key    TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES users(id),
  name   TEXT NOT NULL,
  PRIMARY KEY (key, userId)
);

-- Sessions
-- One row per workout session.
-- Post-session wellness scores stored here (per-session, not per-day).
CREATE TABLE IF NOT EXISTS sessions (
  id                 TEXT PRIMARY KEY,
  userId             TEXT NOT NULL REFERENCES users(id),
  liftKey            TEXT NOT NULL,
  date               TEXT NOT NULL,             -- YYYY-MM-DD
  rpe                INTEGER,                   -- 1–10, optional
  notes              TEXT,
  exertion_post      INTEGER,                   -- 1–5, post-session score
  energy_post        INTEGER,                   -- 1–5, post-session score
  mood_post          INTEGER,                   -- 1–5, post-session score
  exertion_rationale TEXT,
  energy_rationale   TEXT,
  mood_rationale     TEXT,
  createdAt          TEXT NOT NULL
);

-- Sets
CREATE TABLE IF NOT EXISTS sets (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT    NOT NULL REFERENCES sessions(id),
  type      TEXT    NOT NULL,                   -- "Warm Up" | "Working" | "Back Off"
  setNumber INTEGER NOT NULL,
  weight    REAL    NOT NULL,
  reps      INTEGER NOT NULL,
  partials  INTEGER                             -- NULL if none
);

-- Daily Wellness
-- One row per user per day. Pre-session scores only (sleep, feed, stress).
-- Post-session scores live on the sessions table.
CREATE TABLE IF NOT EXISTS daily_wellness (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  userId           TEXT    NOT NULL REFERENCES users(id),
  date             TEXT    NOT NULL,            -- YYYY-MM-DD
  sleep_pre        INTEGER,                     -- 1–5
  feed_pre         INTEGER,                     -- 1–5
  stress_pre       INTEGER,                     -- 1–5
  sleep_rationale  TEXT,
  feed_rationale   TEXT,
  stress_rationale TEXT,
  coaching_skipped INTEGER DEFAULT 0,           -- 1 if user tapped Skip
  pre_complete     INTEGER DEFAULT 0,           -- 1 once scores confirmed
  notes            TEXT,
  createdAt        TEXT NOT NULL,
  UNIQUE(userId, date)
);

-- Journal Onboarding Conversations
-- One row per user. Stores message history for the one-time onboarding conversation.
CREATE TABLE IF NOT EXISTS journal_onboarding_conversations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  userId    TEXT    NOT NULL REFERENCES users(id),
  messages  TEXT    NOT NULL DEFAULT '[]',      -- JSON array of {role, content}
  status    TEXT    NOT NULL DEFAULT 'in_progress', -- 'in_progress' | 'complete'
  createdAt TEXT    NOT NULL,
  updatedAt TEXT    NOT NULL
);

-- Journal Prompts
-- One row per user per day. Cached prompts — generated once, reused on subsequent opens.
CREATE TABLE IF NOT EXISTS journal_prompts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  userId          TEXT    NOT NULL REFERENCES users(id),
  date            TEXT    NOT NULL,             -- YYYY-MM-DD
  prompt_1        TEXT,                         -- training/progress prompt
  prompt_2        TEXT,                         -- profile-informed prompt
  prompt_3        TEXT,                         -- open/broader prompt
  refresh_count_1 INTEGER DEFAULT 0,
  refresh_count_2 INTEGER DEFAULT 0,
  refresh_count_3 INTEGER DEFAULT 0,
  generatedAt     TEXT    NOT NULL,
  UNIQUE(userId, date)
);

-- Journal Entries
-- One row per submitted entry. Stores all three prompt/response pairs.
-- UNIQUE(userId, date) enforces one submission per day at the database level.
CREATE TABLE IF NOT EXISTS journal_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  userId        TEXT    NOT NULL REFERENCES users(id),
  date          TEXT    NOT NULL,               -- YYYY-MM-DD — UNIQUE with userId
  prompt_1_text TEXT,
  response_1    TEXT,
  prompt_2_text TEXT,
  response_2    TEXT,
  prompt_3_text TEXT,
  response_3    TEXT,
  createdAt     TEXT    NOT NULL,
  UNIQUE(userId, date)
);

-- Coaching Conversations
-- Stores full message history for AI coaching sessions.
-- Enables tab-close recovery and audit trail.
-- sessionId convention:
--   pre-session  → 'pre_YYYY-MM-DD'
--   post-session → the workout session UUID
CREATE TABLE IF NOT EXISTS coaching_conversations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  userId    TEXT    NOT NULL REFERENCES users(id),
  date      TEXT    NOT NULL,                   -- YYYY-MM-DD
  phase     TEXT    NOT NULL,                   -- 'pre' | 'post'
  sessionId TEXT    NOT NULL,                   -- see convention above
  messages  TEXT    NOT NULL DEFAULT '[]',      -- JSON array of {role, content}
  status    TEXT    NOT NULL DEFAULT 'in_progress', -- 'in_progress'|'complete'|'skipped'
  createdAt TEXT    NOT NULL,
  updatedAt TEXT    NOT NULL,
  UNIQUE(userId, sessionId, phase)
);
