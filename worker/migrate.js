/**
 * Lift Log — Google Sheets to Cloudflare D1 Migration Script
 *
 * This script reads your exported Google Sheets CSV and writes all
 * exercises and sets into your D1 database via the Worker API.
 *
 * HOW TO RUN:
 * 1. Place this file in your liftlog-worker folder
 * 2. Update the two variables below: CSV_PATH and WORKER_URL
 * 3. In your terminal, navigate to liftlog-worker and run:
 *    node migrate.js
 */

const fs = require('fs');
const path = require('path');

// ─── CONFIGURE THESE TWO VALUES ───────────────────────────────────────────────

// Path to your exported CSV file. If it's on your Desktop:
const CSV_PATH = path.join(require('os').homedir(), 'Desktop', 'liftlog.csv');

// Your live Worker URL
const WORKER_URL = 'https://liftlog-worker.11-api-prod-x7k2.workers.dev';

// ──────────────────────────────────────────────────────────────────────────────


// Maps Google Sheets set type names to the values the app uses
const SET_TYPE_MAP = {
  'warm up': 'Warm Up',
  'working': 'Working',
  'back off': 'Back Off'
};

// Normalises exercise names — fixes capitalisation inconsistencies
const EXERCISE_NAME_MAP = {
  'cable rows': 'Cable Rows',
  'incline press': 'Incline Press'
};

// Dates are already in YYYY-MM-DD format from Google Sheets export
function convertDate(dateStr) {
  return dateStr.trim();
}

// Generates a stable key from an exercise name
// Uses a fixed timestamp so the key is consistent across runs
function makeKey(name) {
  const slug = name.toLowerCase().replace(/\s+/g, '_');
  return `${slug}_migration`;
}

// Normalises an exercise name using the map above
function normaliseName(raw) {
  const lower = raw.trim().toLowerCase();
  return EXERCISE_NAME_MAP[lower] || raw.trim();
}

// Parses the CSV into an array of row objects
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim() !== '');

  return lines.map((line, index) => {
    // Handle tab-separated (Google Sheets default export)
    const separator = line.includes('\t') ? '\t' : ',';
    const cols = line.split(separator);

    if (cols.length < 6) {
      console.warn(`Skipping line ${index + 1} — not enough columns: ${line}`);
      return null;
    }

    const [date, exercise, setType, setNumber, weight, reps, partials] = cols;

    return {
      date: convertDate(date),
      exercise: normaliseName(exercise),
      setType: SET_TYPE_MAP[setType.trim().toLowerCase()] || setType.trim().toLowerCase(),
      setNumber: parseInt(setNumber.trim(), 10),
      weight: parseFloat(weight.trim()),
      reps: parseInt(reps.trim(), 10),
      partials: partials && partials.trim() !== '' ? parseInt(partials.trim(), 10) : null
    };
  }).filter(row => row !== null);
}

// Groups rows by exercise name and date into session objects
function groupIntoSessions(rows) {
  const exerciseMap = {};
  const sessions = {};

  rows.forEach(row => {
    const name = row.exercise;

    // Track unique exercises
    if (!exerciseMap[name]) {
      exerciseMap[name] = makeKey(name);
    }

    const liftKey = exerciseMap[name];
    const sessionKey = `${row.date}__${liftKey}`;

    if (!sessions[sessionKey]) {
      sessions[sessionKey] = {
        date: row.date,
        liftKey,
        lift: name,
        sets: []
      };
    }

    sessions[sessionKey].sets.push({
      type: row.setType,
      setNumber: row.setNumber,
      weight: row.weight,
      reps: row.reps,
      partials: row.partials
    });
  });

  return { exerciseMap, sessions: Object.values(sessions) };
}

// Posts all exercises to the Worker
async function migrateExercises(exerciseMap) {
  console.log('\n── Migrating exercises ──');

  for (const [name, key] of Object.entries(exerciseMap)) {
    try {
      const res = await fetch(`${WORKER_URL}/exercises`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name })
      });

      if (res.ok) {
        console.log(`  ✓ ${name} (key: ${key})`);
      } else if (res.status === 409) {
        console.log(`  → ${name} already exists, skipping`);
      } else {
        const text = await res.text();
        console.error(`  ✗ Failed to add ${name}: ${res.status} ${text}`);
      }
    } catch (err) {
      console.error(`  ✗ Network error adding ${name}:`, err.message);
    }
  }
}

// Posts all sessions to the Worker
async function migrateSessions(sessions) {
  console.log('\n── Migrating sessions ──');

  for (const session of sessions) {
    try {
      const res = await fetch(`${WORKER_URL}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session)
      });

      if (res.ok) {
        console.log(`  ✓ ${session.date} — ${session.lift} (${session.sets.length} sets)`);
      } else {
        const text = await res.text();
        console.error(`  ✗ Failed: ${session.date} ${session.lift}: ${res.status} ${text}`);
      }
    } catch (err) {
      console.error(`  ✗ Network error on ${session.date} ${session.lift}:`, err.message);
    }
  }
}

// Main
async function main() {
  console.log('Lift Log — Migration Script');
  console.log(`Reading from: ${CSV_PATH}`);
  console.log(`Writing to:   ${WORKER_URL}\n`);

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`✗ CSV file not found at: ${CSV_PATH}`);
    console.error('  Update the CSV_PATH variable at the top of this file.');
    process.exit(1);
  }

  const rows = parseCSV(CSV_PATH);
  console.log(`Parsed ${rows.length} rows from CSV`);

  const { exerciseMap, sessions } = groupIntoSessions(rows);
  console.log(`Found ${Object.keys(exerciseMap).length} exercises and ${sessions.length} sessions`);

  await migrateExercises(exerciseMap);
  await migrateSessions(sessions);

  console.log('\n✓ Migration complete');
  console.log('  Open the app and check the progress dashboard to verify your data.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
