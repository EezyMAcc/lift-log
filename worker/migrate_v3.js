/**
 * Lift Log — D1 Migration v3
 *
 * Run with:
 *   node migrate_v3.js --remote
 *
 * What this does:
 *   1. Adds post-session wellness columns to the sessions table
 *   2. Renames daily_wellness score columns to snake_case (sleep_pre etc.)
 *   3. Adds rationale + coaching state columns to daily_wellness
 *   4. Creates the coaching_conversations table
 *
 * Safe to re-run — uses IF NOT EXISTS / checks before altering.
 */

import { execSync } from 'child_process';

const remote = process.argv.includes('--remote') ? '--remote' : '--local';
const DB = 'liftlog-db';

function run(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  try {
    execSync(`npx wrangler d1 execute ${DB} ${remote} --command="${escaped}"`, {
      stdio: 'inherit',
      cwd: new URL('.', import.meta.url).pathname,
    });
  } catch (e) {
    console.error('Migration step failed:', sql);
    throw e;
  }
}

console.log('\n── Lift Log D1 Migration v3 ──\n');

// ── sessions: add post-session wellness columns ──────────────────────────────
console.log('Adding post-session columns to sessions...');
run('ALTER TABLE sessions ADD COLUMN exertion_post INTEGER');
run('ALTER TABLE sessions ADD COLUMN energy_post INTEGER');
run('ALTER TABLE sessions ADD COLUMN mood_post INTEGER');
run('ALTER TABLE sessions ADD COLUMN exertion_rationale TEXT');
run('ALTER TABLE sessions ADD COLUMN energy_rationale TEXT');
run('ALTER TABLE sessions ADD COLUMN mood_rationale TEXT');

// ── daily_wellness: rename score columns ─────────────────────────────────────
// SQLite RENAME COLUMN supported since 3.25 (Cloudflare D1 supports this)
console.log('Renaming daily_wellness score columns...');
run('ALTER TABLE daily_wellness RENAME COLUMN sleepScore TO sleep_pre');
run('ALTER TABLE daily_wellness RENAME COLUMN stressScore TO stress_pre');
run('ALTER TABLE daily_wellness RENAME COLUMN nutritionScore TO feed_pre');

// ── daily_wellness: add new columns ─────────────────────────────────────────
console.log('Adding new columns to daily_wellness...');
run('ALTER TABLE daily_wellness ADD COLUMN sleep_rationale TEXT');
run('ALTER TABLE daily_wellness ADD COLUMN feed_rationale TEXT');
run('ALTER TABLE daily_wellness ADD COLUMN stress_rationale TEXT');
run('ALTER TABLE daily_wellness ADD COLUMN coaching_skipped INTEGER DEFAULT 0');
run('ALTER TABLE daily_wellness ADD COLUMN pre_complete INTEGER DEFAULT 0');

// ── coaching_conversations: create new table ─────────────────────────────────
console.log('Creating coaching_conversations table...');
run(`
  CREATE TABLE IF NOT EXISTS coaching_conversations (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT    NOT NULL REFERENCES users(id),
    date      TEXT    NOT NULL,
    phase     TEXT    NOT NULL,
    sessionId TEXT    NOT NULL,
    messages  TEXT    NOT NULL DEFAULT '[]',
    status    TEXT    NOT NULL DEFAULT 'in_progress',
    createdAt TEXT    NOT NULL,
    updatedAt TEXT    NOT NULL,
    UNIQUE(userId, sessionId, phase)
  )
`);

console.log('\n✓ Migration v3 complete.\n');
