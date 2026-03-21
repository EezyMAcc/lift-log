/**
 * Lift Log — v2 Migration Script
 *
 * Migrates existing D1 data into the new 5-table schema.
 * Run this AFTER applying the new schema (schema.sql) to D1.
 *
 * What this script does:
 *   1. Creates your user record
 *   2. Creates all exercises with clean keys
 *   3. Creates all sessions with proper session IDs
 *   4. Inserts all sets (partials "" fixed to null, numbers enforced)
 *
 * HOW TO RUN:
 *   cd into the worker folder and run:
 *   node migrate_v2.js
 */

const WORKER_URL = 'https://liftlog-worker.11-api-prod-x7k2.workers.dev';

// ─── YOUR USER ────────────────────────────────────────────────────────────────
// This is your permanent user ID. It will be stored in localStorage in the app.
// Keep a note of it — if you clear localStorage you'll need to re-enter it.
const USER_ID   = 'usr_tobyhuxtable_001';
const USER_NAME = 'Toby Huxtable';

// ─── EXERCISES ────────────────────────────────────────────────────────────────
// Old key → new clean key mapping
const EXERCISES = [
  { key: 'incline_press', name: 'Incline Press' },
  { key: 'cable_rows',    name: 'Cable Rows'    },
  { key: 'barbell_rows',  name: 'Barbell Rows'  },
];

// ─── SESSIONS + SETS ─────────────────────────────────────────────────────────
// Each session has a stable ID, a date, a liftKey (new clean key),
// and the full set of sets exactly as they were in D1.
// partials: null where original had "" — numbers enforced throughout.
const SESSIONS = [
  {
    id:      'sess_incline_press_20260309',
    date:    '2026-03-09',
    liftKey: 'incline_press',
    lift:    'Incline Press',
    sets: [
      { type: 'Warm Up',  setNumber: 1, weight: 20, reps: 12, partials: null },
      { type: 'Warm Up',  setNumber: 2, weight: 40, reps: 10, partials: null },
      { type: 'Warm Up',  setNumber: 3, weight: 50, reps: 6,  partials: null },
      { type: 'Warm Up',  setNumber: 4, weight: 60, reps: 3,  partials: null },
      { type: 'Warm Up',  setNumber: 5, weight: 65, reps: 1,  partials: null },
      { type: 'Working',  setNumber: 1, weight: 55, reps: 7,  partials: 1    },
      { type: 'Back Off', setNumber: 1, weight: 50, reps: 9,  partials: null },
    ],
  },
  {
    id:      'sess_cable_rows_20260311',
    date:    '2026-03-11',
    liftKey: 'cable_rows',
    lift:    'Cable Rows',
    sets: [
      { type: 'Warm Up',  setNumber: 1, weight: 50, reps: 10, partials: null },
      { type: 'Warm Up',  setNumber: 2, weight: 64, reps: 6,  partials: null },
      { type: 'Warm Up',  setNumber: 3, weight: 73, reps: 3,  partials: null },
      { type: 'Warm Up',  setNumber: 4, weight: 86, reps: 1,  partials: null },
      { type: 'Working',  setNumber: 1, weight: 77, reps: 6,  partials: 2    },
      { type: 'Back Off', setNumber: 1, weight: 68, reps: 10, partials: 2    },
      { type: 'Back Off', setNumber: 2, weight: 59, reps: 8,  partials: 3    },
    ],
  },
  {
    id:      'sess_incline_press_20260314',
    date:    '2026-03-14',
    liftKey: 'incline_press',
    lift:    'Incline Press',
    sets: [
      { type: 'Warm Up',  setNumber: 1, weight: 20, reps: 20, partials: null },
      { type: 'Warm Up',  setNumber: 2, weight: 40, reps: 10, partials: null },
      { type: 'Warm Up',  setNumber: 3, weight: 50, reps: 6,  partials: null },
      { type: 'Warm Up',  setNumber: 4, weight: 60, reps: 3,  partials: null },
      { type: 'Warm Up',  setNumber: 5, weight: 65, reps: 1,  partials: null },
      { type: 'Working',  setNumber: 1, weight: 55, reps: 8,  partials: null },
      { type: 'Back Off', setNumber: 1, weight: 50, reps: 12, partials: null },
    ],
  },
  {
    id:      'sess_cable_rows_20260320',
    date:    '2026-03-20',
    liftKey: 'cable_rows',
    lift:    'Cable Rows',
    sets: [
      { type: 'Warm Up',  setNumber: 1, weight: 50, reps: 10, partials: null },
      { type: 'Warm Up',  setNumber: 2, weight: 64, reps: 6,  partials: null },
      { type: 'Warm Up',  setNumber: 3, weight: 73, reps: 4,  partials: null },
      { type: 'Warm Up',  setNumber: 4, weight: 86, reps: 1,  partials: null },
      { type: 'Working',  setNumber: 1, weight: 77, reps: 7,  partials: 2    },
      { type: 'Back Off', setNumber: 1, weight: 68, reps: 9,  partials: 2    },
      { type: 'Back Off', setNumber: 2, weight: 59, reps: 10, partials: 2    },
    ],
  },
  {
    id:      'sess_barbell_rows_20260320',
    date:    '2026-03-20',
    liftKey: 'barbell_rows',
    lift:    'Barbell Rows',
    sets: [
      { type: 'Warm Up',  setNumber: 1, weight: 20,  reps: 12, partials: null },
      { type: 'Warm Up',  setNumber: 2, weight: 40,  reps: 10, partials: null },
      { type: 'Warm Up',  setNumber: 3, weight: 60,  reps: 6,  partials: null },
      { type: 'Warm Up',  setNumber: 4, weight: 80,  reps: 3,  partials: null },
      { type: 'Warm Up',  setNumber: 5, weight: 90,  reps: 2,  partials: null },
      { type: 'Warm Up',  setNumber: 6, weight: 95,  reps: 0,  partials: 1    }, // intentional failed set
      { type: 'Working',  setNumber: 1, weight: 80,  reps: 7,  partials: 2    },
      { type: 'Back Off', setNumber: 1, weight: 70,  reps: 10, partials: 1    },
    ],
  },
  {
    id:      'sess_incline_press_20260320',
    date:    '2026-03-20',
    liftKey: 'incline_press',
    lift:    'Incline Press',
    sets: [
      { type: 'Warm Up',  setNumber: 1, weight: 20, reps: 12, partials: null },
      { type: 'Warm Up',  setNumber: 2, weight: 40, reps: 10, partials: null },
      { type: 'Warm Up',  setNumber: 3, weight: 50, reps: 6,  partials: null },
      { type: 'Warm Up',  setNumber: 4, weight: 60, reps: 3,  partials: null },
      { type: 'Warm Up',  setNumber: 5, weight: 65, reps: 0,  partials: null }, // intentional failed set
      { type: 'Working',  setNumber: 1, weight: 60, reps: 5,  partials: 1    },
      { type: 'Back Off', setNumber: 1, weight: 50, reps: 12, partials: null },
    ],
  },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-User-Id': USER_ID,
  };
}

async function post(path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ─── STEPS ───────────────────────────────────────────────────────────────────

async function createUser() {
  console.log('\n── Step 1: Create user ──');
  const { status, body } = await post('/user', { id: USER_ID, name: USER_NAME });
  if (status === 200 && body.existing) {
    console.log(`  → User already exists (${USER_ID}), continuing`);
  } else if (status === 200) {
    console.log(`  ✓ User created: ${USER_NAME} (${USER_ID})`);
  } else {
    console.error(`  ✗ Failed to create user: ${status}`, body);
    process.exit(1);
  }
}

async function createExercises() {
  console.log('\n── Step 2: Create exercises ──');
  for (const ex of EXERCISES) {
    const { status, body } = await post('/exercises', { key: ex.key, name: ex.name });
    if (status === 200) {
      console.log(`  ✓ ${ex.name} (key: ${ex.key})`);
    } else if (status === 409) {
      console.log(`  → ${ex.name} already exists, skipping`);
    } else {
      console.error(`  ✗ Failed to add ${ex.name}: ${status}`, body);
    }
  }
}

async function createSessions() {
  console.log('\n── Step 3: Create sessions + sets ──');
  for (const session of SESSIONS) {
    const { status, body } = await post('/save', {
      sessionId: session.id,
      date:      session.date,
      liftKey:   session.liftKey,
      lift:      session.lift,
      sets:      session.sets,
    });

    if (status === 200 && body.duplicate) {
      console.log(`  → ${session.date} — ${session.lift}: already exists, skipping`);
    } else if (status === 200) {
      console.log(`  ✓ ${session.date} — ${session.lift} (${session.sets.length} sets)`);
    } else {
      console.error(`  ✗ Failed: ${session.date} ${session.lift}: ${status}`, body);
    }
  }
}

async function main() {
  console.log('Lift Log — v2 Migration');
  console.log(`Target: ${WORKER_URL}`);
  console.log(`User:   ${USER_NAME} (${USER_ID})\n`);

  await createUser();
  await createExercises();
  await createSessions();

  console.log('\n✓ Migration complete');
  console.log(`\n  Your User ID is: ${USER_ID}`);
  console.log('  Save this — you will need to enter it in the app on first load.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
