# Lift Log — Full System Specification
**Version:** 1.0
**Date:** March 2026
**Status:** Live

---

## 1. What Lift Log Is

A personal strength training tracker and wellness coach. It runs entirely in a web browser as a single HTML file served from GitHub Pages. All data is stored in a Cloudflare database. An AI coach (Claude Haiku) runs daily check-ins before and after workouts.

There is no app store, no installation, no backend server to manage. The app is bookmarked on the user's phone like a website.

---

## 2. How the Pieces Connect

```
iPhone / Browser
     │
     │  visits eezymacc.github.io/lift-log
     ▼
index.html  (GitHub Pages — static file, no server)
     │
     │  makes API calls (fetch) to the Cloudflare Worker
     ▼
liftlog-worker.11-api-prod-x7k2.workers.dev  (Cloudflare Worker)
     │
     │  reads and writes to the database
     ▼
liftlog-db  (Cloudflare D1 — SQLite database)
     │
     │  (coaching endpoints only)
     ▼
api.anthropic.com  (Claude Haiku API)
```

**Key point:** The HTML file never talks to the Claude API directly. It only talks to the Cloudflare Worker. The Worker talks to Claude. This keeps the API key hidden.

---

## 3. Where the Code Lives

```
lift-log/  (local folder + GitHub repository: github.com/EezyMAcc/lift-log)
│
├── index.html              ← The entire frontend. One file. Served by GitHub Pages.
│
├── worker/
│   ├── src/index.js        ← The entire backend. One file. Deployed to Cloudflare.
│   ├── schema.sql          ← Database table definitions (reference — not auto-run)
│   ├── wrangler.jsonc      ← Cloudflare Worker configuration
│   ├── migrate.js          ← Original data migration script (v1 → v2 data)
│   └── migrate_v3.js       ← Schema migration script (v2 → v3 structure)
│
├── docs/
│   ├── lift-log-spec-v1.md ← This document
│   └── coaching-prompts-v1.md ← The exact prompts used by the AI coach
│
├── skills/                 ← Claude Code AI skill files (internal tooling)
├── archive/                ← Old HTML versions kept for reference
└── README.md
```

**To deploy changes:**
- Frontend: `git push` → GitHub Pages auto-deploys (allow 2–5 minutes)
- Worker: `npx wrangler deploy` from inside the `worker/` folder

---

## 4. Identity and Authentication

### How a user is identified

There are no passwords. Each user has a unique ID (e.g. `usr_tobyhuxtable_001`) stored in the browser's localStorage. Every request the app makes to the Worker includes this ID in a header:

```
X-User-Id: usr_tobyhuxtable_001
```

The Worker reads this header and uses it to scope all database queries to that user. If the header is missing, the Worker returns a 401 error.

### First-time setup

On first visit, the app shows a login screen asking for the user's name. Tapping "Get Started" creates a new user in the database and stores the ID in localStorage.

Returning users: if the ID is already in localStorage, the login screen is skipped.

### Recovery (new device / cleared browser)

The "Already a user?" link on the login screen shows a field to paste an existing user ID. The app then looks up that ID in the database and restores the user's identity.

**Important:** The user ID must be kept somewhere safe (e.g. Notes app). If it's lost and the login screen appears on a device, the user needs their ID to access existing data. A future login system (Google sign-in etc.) will replace this.

---

## 5. App Flow — Screen by Screen

```
App opens
    │
    ├─ No userId in localStorage? → LOGIN SCREEN
    │       User enters name → new user created → COACHING SCREEN (pre)
    │       User pastes existing ID → user found → check coaching status
    │
    └─ userId exists in localStorage?
            │
            └─ Check today's coaching status (GET /coaching/status)
                    │
                    ├─ Not done yet → COACHING SCREEN (pre-session)
                    │       User completes → MODULES SCREEN
                    │       User skips → MODULES SCREEN
                    │
                    └─ Already done today → MODULES SCREEN

MODULES SCREEN
    ├─ Workout button → WORKOUT TRACKER (existing log/progress/last views)
    └─ Coach button (greyed out if coaching done today) → COACHING SCREEN (pre)

WORKOUT TRACKER
    └─ User saves a session → POST-SESSION COACHING SCREEN (automatic, no skip)
            └─ Completes → returns to WORKOUT TRACKER (Log view)
```

---

## 6. Database Structure

Six tables. All live in Cloudflare D1 (SQLite).

---

### Table: `users`

One row per person.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | Primary key. Client-generated UUID. e.g. `usr_tobyhuxtable_001` |
| name | TEXT | Display name entered at login |
| createdAt | TEXT | ISO timestamp |

---

### Table: `exercises`

One row per exercise, scoped to a user.

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT | Clean slug. e.g. `incline_press`. Part of composite primary key. |
| userId | TEXT | References users.id |
| name | TEXT | Display name. e.g. `Incline Press` |

**Primary key:** (key, userId) — so the same exercise key can exist for different users.

---

### Table: `sessions`

One row per workout session. Created each time the user taps "Save Session."

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT | Primary key. UUID generated by the browser at save time. |
| userId | TEXT | References users.id |
| liftKey | TEXT | Which exercise. References exercises.key |
| date | TEXT | YYYY-MM-DD |
| rpe | INTEGER | Rate of Perceived Exertion 1–10. Optional. |
| notes | TEXT | Free text. Optional. |
| exertion_post | INTEGER | Post-session score 1–5. Set by coach after workout. |
| energy_post | INTEGER | Post-session score 1–5. |
| mood_post | INTEGER | Post-session score 1–5. |
| exertion_rationale | TEXT | Coach's one-line reasoning for the exertion score. |
| energy_rationale | TEXT | Coach's reasoning for energy score. |
| mood_rationale | TEXT | Coach's reasoning for mood score. |
| createdAt | TEXT | ISO timestamp |

---

### Table: `sets`

One row per set logged. References its parent session.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Auto-incrementing primary key |
| sessionId | TEXT | References sessions.id |
| type | TEXT | "Warm Up", "Working", or "Back Off" |
| setNumber | INTEGER | Position within that type (1, 2, 3…) |
| weight | REAL | Stored as a real number. Never text. |
| reps | INTEGER | Stored as an integer. Never text. |
| partials | INTEGER | Partial reps. NULL if none (never empty string). |

---

### Table: `daily_wellness`

One row per user per day. Populated by the pre-session coach conversation.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Auto-incrementing primary key |
| userId | TEXT | References users.id |
| date | TEXT | YYYY-MM-DD. Unique per user. |
| sleep_pre | INTEGER | Sleep score 1–5 |
| feed_pre | INTEGER | Nutrition score 1–5 |
| stress_pre | INTEGER | Stress score 1–5 |
| sleep_rationale | TEXT | Coach's reasoning |
| feed_rationale | TEXT | Coach's reasoning |
| stress_rationale | TEXT | Coach's reasoning |
| coaching_skipped | INTEGER | 1 if user tapped Skip, 0 otherwise |
| pre_complete | INTEGER | 1 once scores are confirmed and saved |
| notes | TEXT | Optional free text |
| createdAt | TEXT | ISO timestamp |

**Unique constraint:** (userId, date) — only one wellness entry per user per day.

---

### Table: `coaching_conversations`

One row per coaching conversation. Stores the full message history so the user can close the tab and resume later.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Auto-incrementing primary key |
| userId | TEXT | References users.id |
| date | TEXT | YYYY-MM-DD — which day this conversation belongs to |
| phase | TEXT | "pre" or "post" |
| sessionId | TEXT | For pre: `pre_YYYY-MM-DD`. For post: the workout session UUID. |
| messages | TEXT | JSON array of `{role, content}` objects |
| status | TEXT | "in_progress", "complete", or "skipped" |
| createdAt | TEXT | ISO timestamp |
| updatedAt | TEXT | Updated each time a message is added |

**Unique constraint:** (userId, sessionId, phase) — one pre per day, one post per workout session.

**sessionId convention:**
- Pre-session: `pre_2026-03-21` (the date string prefixed with "pre_")
- Post-session: the actual UUID of the workout session (e.g. `a3f9b2c1-...`)

---

## 7. API Endpoints

All requests go to: `https://liftlog-worker.11-api-prod-x7k2.workers.dev`

All requests (except POST /user and GET /user/:id) require the header:
```
X-User-Id: <userId>
```

---

### User

| Method | Path | What it does |
|--------|------|--------------|
| POST | /user | Register a new user. Body: `{ id, name }` |
| GET | /user/:id | Look up an existing user by ID. Returns 404 if not found. |

---

### Exercises

| Method | Path | What it does |
|--------|------|--------------|
| GET | /exercises | List all exercises for this user |
| POST | /exercises | Add an exercise. Body: `{ key, name }` |
| DELETE | /exercises/:key | Remove an exercise and all its sessions and sets |

---

### Workout

| Method | Path | What it does |
|--------|------|--------------|
| POST | /save | Save a workout session. Body: `{ sessionId, date, liftKey, lift, sets[] }` |
| GET | /history?liftKey=x | Get all sessions for an exercise, with sets grouped by session |
| GET | /restore | Get the full exercise list (used for data restore on new device) |

---

### Wellness

| Method | Path | What it does |
|--------|------|--------------|
| GET | /wellness?date=x | Get the wellness entry for a given date |
| POST | /wellness | Save or update a wellness entry manually |

---

### Coaching

| Method | Path | What it does |
|--------|------|--------------|
| GET | /coaching/status?date=x | Returns `{ pre_complete, coaching_skipped }` for today. Used on app load to decide routing. |
| POST | /coaching/start | Start or resume a coaching conversation. Returns message history. Body: `{ date, phase, sessionId }` |
| POST | /coaching/message | Send a user message, get the coach's reply. Body: `{ date, phase, sessionId, content }` |
| POST | /coaching/skip | Mark today's pre-session as skipped. Body: `{ date }` |

---

## 8. The Coaching Module

### How it works end-to-end

1. App calls `GET /coaching/status` on load.
2. If not done today, app calls `POST /coaching/start` — Worker creates a conversation record in D1 and calls Claude to get the opening message. Returns the message array.
3. App displays the opening message as a chat bubble.
4. User types a reply. App calls `POST /coaching/message`. Worker appends the user message, calls Claude with the full conversation history, gets a reply. Returns the reply.
5. This continues until Claude decides it has enough information and calls the `submit_scores` tool. When this happens, the Worker:
   - Extracts the scores from the tool call
   - Saves them to the appropriate D1 table
   - Marks the conversation as "complete"
   - Returns `{ reply, complete: true, scores }`
6. The frontend sees `complete: true`, shows the final bubble, then transitions to the next screen.

### Tab-close recovery

If the user closes the tab mid-conversation, the full message history is already saved in `coaching_conversations` with status `in_progress`. When the app reopens, `POST /coaching/start` finds the existing row and returns the full message history. The conversation resumes exactly where it left off.

### Score submission (tool_use)

The Worker uses Claude's "tool use" feature rather than asking Claude to output JSON directly. A tool called `submit_scores` is defined with the exact fields required (scores + rationale for each). Claude calls this tool when it's ready to confirm scores. This is more reliable than parsing text for a JSON block.

### Where scores are stored

| Score type | Table | Columns |
|------------|-------|---------|
| Sleep, feed, stress (pre-session, daily) | daily_wellness | sleep_pre, feed_pre, stress_pre + rationale columns |
| Exertion, energy, mood (post-session, per workout) | sessions | exertion_post, energy_post, mood_post + rationale columns |

### Guardrails (non-negotiable, enforced in the system prompt)

- AI disclosure: the coach identifies itself as an AI in every opening message
- Scope constraint: the coach only derives scores. No advice, support, or general conversation.
- Keyword protocol: if the user expresses self-harm, crisis, hopelessness, or disordered eating language — the coach stops immediately and outputs a fixed redirect message. No AI-generated response.
- Message limits: 10 messages total for pre-session, 6 for post-session
- Dispute mechanic: users can dispute a score once. The coach asks one follow-up question and re-derives. A second dispute is not accepted.

### The "Coach" button on the modules screen

- Visible at all times at the bottom centre of the modules screen
- Disabled (greyed out) once pre-session coaching is complete or skipped for the day
- Opens the pre-session coaching screen
- The post-session chat is completely separate — it fires automatically after a workout save and is not connected to this button

---

## 9. Data Validation Rules

These rules are enforced in the Worker (server-side), not just the frontend:

- Weight must be a finite number greater than zero
- Reps must be a finite number
- Wellness scores must be integers between 1 and 5
- RPE (session effort rating) must be between 1 and 10
- A session cannot be saved twice — the Worker checks for a duplicate sessionId and returns early if found (prevents double-tap bugs)
- Empty strings are never stored for numeric fields — they become NULL or are rejected

---

## 10. Known Limitations (Not Yet Fixed)

These bugs are documented and understood but not yet addressed:

| # | Issue | Impact |
|---|-------|--------|
| 8 | Projection shows positive trend even when reps are declining | Misleading advice only |
| 9 | In-progress session recovery failure is silent | User loses in-progress data with no explanation |
| 11 | Chart header blank if exercise has no name | Minor display issue |

---

## 11. Future Roadmap (Planned, Not Built)

- **Journal module** — daily free-text journaling, linked by userId and date
- **Nutrition module** — detailed food logging (beyond the daily feed score)
- **Practitioner view** — a separate view for a coach or physio to see a client's wellness data (Stage 2)
- **Proper authentication** — Google Sign-In or magic link, replacing the user ID system
- **RAG / coach memory** — the coach reading more than the last 5 sessions of history
- **Upgrade to Claude Sonnet** — one-line change in the Worker when warranted by usage

---

## 12. Deployment Reference

### Deploy the Worker
```bash
cd "/Users/tobyhuxtable/Documents/lift log/worker"
npx wrangler deploy
```

### Deploy the Frontend
```bash
cd "/Users/tobyhuxtable/Documents/lift log"
git add index.html
git commit -m "your message"
git push
# GitHub Pages updates automatically within 2–5 minutes
```

### Run a database migration
```bash
cd "/Users/tobyhuxtable/Documents/lift log/worker"
npx wrangler d1 execute liftlog-db --remote --command="YOUR SQL HERE"
```

### Check what's in the database
```bash
npx wrangler d1 execute liftlog-db --remote --command="SELECT * FROM sessions LIMIT 10"
```

### Add or rotate the Claude API key
```bash
cd "/Users/tobyhuxtable/Documents/lift log/worker"
npx wrangler secret put ANTHROPIC_API_KEY
# Paste the key when prompted. Never put it in any code file.
```

---

## 13. File Size Reference

| File | What changed in this version |
|------|------------------------------|
| index.html | ~1,400 lines. Adds modules screen, coach screen, routing logic, coaching JS. |
| worker/src/index.js | ~600 lines. Adds 4 coaching endpoints, Claude API integration, prompt constants. |
| worker/schema.sql | Updated to v3 — 6 tables documented |
| worker/migrate_v3.js | New — ALTER TABLE script for v2→v3 schema changes |
