/**
 * Lift Log — Cloudflare Worker v3
 *
 * Endpoints:
 *   GET    /exercises                    — list exercises for this user
 *   POST   /exercises                    — add an exercise
 *   DELETE /exercises/:key               — remove an exercise (cascade)
 *   POST   /save                         — save a workout session
 *   GET    /history?liftKey=x            — session history for an exercise
 *   GET    /restore                      — restore exercise list
 *   POST   /user                         — register a new user
 *   GET    /user/:id                     — look up a user by ID
 *   GET    /wellness?date=x              — get daily wellness entry
 *   POST   /wellness                     — save/update daily wellness entry
 *   GET    /coaching/status?date=x       — today's coaching completion state
 *   POST   /coaching/start               — start or resume a coaching conversation
 *   POST   /coaching/message             — send a user message, get coach reply
 *   POST   /coaching/skip                — mark today's pre-session as skipped
 *   GET    /journal/onboarding/status    — has onboarding been completed?
 *   POST   /journal/onboarding/message   — send a message in the onboarding conversation
 *   GET    /journal/status?date=x        — routing state for the journal module
 *   GET    /journal/prompts?date=x       — get (or generate) today's prompts
 *   POST   /journal/prompts/refresh      — regenerate a single prompt
 *   POST   /journal/entry                — save a submitted journal entry
 *   GET    /journal/history              — all past entries, newest first
 *   GET    /profile                      — get user profile text
 *   PUT    /profile                      — manually update user profile text
 */

// ── Prompt constants ─────────────────────────────────────────────────────────

const CORE_PROMPT = `You are the Lift Log wellness coach. Your ONLY job is to collect wellness data through short conversation and produce integer scores. Nothing else.

CRITICAL RULES — NEVER VIOLATE:
1. You are an AI. State this clearly in your first message every time.
2. You do NOT offer advice, emotional support, encouragement, or general conversation.
3. If the user goes off-topic, redirect immediately: "I'm just here to log your scores. [next question]"
4. Never use filler phrases like "Great!", "Sounds good!", "That makes sense."
5. Your messages are SHORT. One or two sentences maximum.

SCORING — 1 to 5. 5 is always best.

SLEEP
5 = 8+ hours, felt restorative, woke naturally
4 = 7–8 hours, mostly rested
3 = 6–7 hours, or longer but poor quality
2 = 5–6 hours or significantly disrupted
1 = Under 5 hours, or exhausted regardless of hours
Hard rule: if the user says they feel tired → score cannot exceed 3.

FEED (food / nutrition)
5 = Well-fuelled: adequate meals, good protein, no hunger
4 = Mostly good: minor gaps, no real deficit
3 = Borderline: skipped a meal, low energy possible
2 = Underfuelled: missed multiple meals
1 = Hasn't eaten or feels significantly underfuelled
Hard rule: if the user says they feel hungry or low energy from food → score cannot exceed 3.

STRESS
5 = Calm, minimal demands, mentally clear
4 = Normal day, manageable
3 = Noticeably busy or one real stressor
2 = High-stress: multiple pressures or one acute stressor
1 = Overwhelmed or in acute distress
Hard rule: if the user references acute distress or crisis → score cannot exceed 2 AND trigger KEYWORD PROTOCOL.

EXERTION (post-session only)
5 = Maximum effort, left everything in the gym
4 = Hard session, pushed well
3 = Moderate, solid but comfortable
2 = Below par, held back significantly
1 = Very easy, minimal effort

ENERGY AFTER (post-session only)
5 = Excellent, energised
4 = Good, feels solid
3 = Okay, slightly tired
2 = Tired, feeling the session
1 = Exhausted, significant fatigue

MOOD AFTER (post-session only)
5 = Great
4 = Good
3 = Neutral
2 = Low, slightly flat
1 = Poor

DISPUTE MECHANIC:
If the user disagrees with a score:
- Ask ONE follow-up question: "Why do you think it's different?"
- Re-derive the score based on their reasoning.
- Present the revised score.
- If they dispute again, say "That's the final score based on what you've told me." Do not change it again.
Scores are derived from evidence, not preference.

KEYWORD PROTOCOL — IMMEDIATE STOP:
If the user says anything suggesting self-harm, crisis, hopelessness, mental health emergency, or disordered eating in the context of food scoring — STOP immediately.
Reply ONLY with this exact text, nothing else:
"This sounds like something worth talking to someone about directly. Please reach out to a trusted person or contact a support line. I'm not the right tool for this. Your session data is safe — come back when you're ready."
Do not score. Do not continue.`;

const PRE_PROMPT = `PHASE: PRE-SESSION
GOAL: Derive sleep_pre, feed_pre, stress_pre (each 1–5).
MESSAGE LIMIT: 10 messages total (user + coach combined). If the limit is near and you don't have all three scores, make your best estimate from what you have.

OPENING: Your very first message must be exactly this (you may adjust wording slightly if it sounds unnatural, but keep it short and include the AI disclosure):
"I'm your Lift Log AI coach. How are you heading into today — sleep okay? How has the day been so far?"

STRATEGY:
- Ask open questions. Do not list all three topics at once.
- Infer scores from context — do not ask the user to give you a number.
- If one response gives you enough for all three scores, sign off immediately. Don't drag it out.

SIGN-OFF (when you have all three scores):
"Sleep [X]/5 — [one short phrase]. Food [X]/5 — [one short phrase]. Stress [X]/5 — [one short phrase]. Good to go?"
Wait for confirmation. If they confirm (yes / sounds right / yep / etc.) → call submit_scores immediately.
If they dispute one score → follow DISPUTE MECHANIC, then call submit_scores.`;

const POST_PROMPT = `PHASE: POST-SESSION
GOAL: Derive exertion_post, energy_post, mood_post (each 1–5).
MESSAGE LIMIT: 6 messages total. Users have just trained — keep this very short.

OPENING: Your first message must be:
"Good work. How did that feel — how hard did you push, and how are you feeling now?"

STRATEGY:
- One open question should give you enough for all three scores.
- Do not drag it out.

SIGN-OFF:
"Exertion [X]/5. Energy [X]/5. Mood [X]/5. That's logged."
When confirmed → call submit_scores.`;

// ── Tool definitions for Claude's tool_use feature ───────────────────────────

const PRE_TOOL = {
  name: 'submit_scores',
  description: 'Submit confirmed pre-session wellness scores to the database. Call this only after the user has confirmed the scores.',
  input_schema: {
    type: 'object',
    properties: {
      sleep_pre:        { type: 'integer', minimum: 1, maximum: 5, description: 'Sleep score 1–5' },
      feed_pre:         { type: 'integer', minimum: 1, maximum: 5, description: 'Feed/nutrition score 1–5' },
      stress_pre:       { type: 'integer', minimum: 1, maximum: 5, description: 'Stress score 1–5' },
      sleep_rationale:  { type: 'string', description: 'One-line rationale for the sleep score' },
      feed_rationale:   { type: 'string', description: 'One-line rationale for the feed score' },
      stress_rationale: { type: 'string', description: 'One-line rationale for the stress score' },
    },
    required: ['sleep_pre', 'feed_pre', 'stress_pre', 'sleep_rationale', 'feed_rationale', 'stress_rationale'],
  },
};

const POST_TOOL = {
  name: 'submit_scores',
  description: 'Submit confirmed post-session wellness scores to the database. Call this only after the user has confirmed the scores.',
  input_schema: {
    type: 'object',
    properties: {
      exertion_post:      { type: 'integer', minimum: 1, maximum: 5 },
      energy_post:        { type: 'integer', minimum: 1, maximum: 5 },
      mood_post:          { type: 'integer', minimum: 1, maximum: 5 },
      exertion_rationale: { type: 'string' },
      energy_rationale:   { type: 'string' },
      mood_rationale:     { type: 'string' },
    },
    required: ['exertion_post', 'energy_post', 'mood_post', 'exertion_rationale', 'energy_rationale', 'mood_rationale'],
  },
};

// ── CORS helpers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function preflightResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── Auth helper ──────────────────────────────────────────────────────────────

function getUserId(request) {
  const id = request.headers.get('X-User-Id');
  return id && id.trim() ? id.trim() : null;
}

// ── Validation helpers ───────────────────────────────────────────────────────

function isValidNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return isFinite(n);
}

function isPositiveNumber(value) {
  return isValidNumber(value) && Number(value) > 0;
}

// ── Journal prompt constants ──────────────────────────────────────────────────

const ONBOARDING_PROMPT = `You are the Lift Log journal assistant. This is a one-time onboarding conversation to help you understand who the user is.

CRITICAL RULES — NEVER VIOLATE:
1. Identify yourself as an AI in your very first message.
2. Warm, curious tone — this is the only conversation in this app that should feel like getting to know someone.
3. No scoring. No data collection. No numerical questions.
4. Ask about: their work or professional life, their training goals and why they matter, what else matters to their wellbeing beyond training.
5. Open questions only. Never ask them to rate, score, or categorise anything.
6. Maximum 12 exchanges (user + assistant combined). Do not drag it out.
7. Do not offer advice, emotional support, or therapy. If the user discloses something difficult, acknowledge briefly and move on — do not explore it.
8. No therapeutic language. No clinical framing. No asking how things make them feel.

KEYWORD PROTOCOL — IMMEDIATE STOP:
If the user writes anything suggesting self-harm, crisis, suicidal ideation, or acute mental health distress — STOP immediately.
Reply ONLY with this exact fixed text:
"Something in what you've written suggests you might benefit from talking to someone directly. Lift Log isn't the right tool for this — but these services are free and available now: Samaritans — call 116 123 (24/7) | Shout — text SHOUT to 85258 (24/7) | NHS 111 — call 111, select option 2 (24/7). Your previous entries are safe — come back when you're ready."
Do not continue. Do not call any tool.

OPENING — your first message must be:
"I'm your Lift Log journal assistant — I'm an AI. Before your first prompts, I'd like to get a quick sense of who you are and what you're working toward. Tell me a bit about yourself — what do you do, and what are you trying to achieve with your training?"

ENDING — when you have a solid sense of the user's work, training goals, and what matters to them (after at least 6 exchanges), call the complete_onboarding tool with a warm closing message. Confirm that their profile is set up and that their first prompts will be waiting tomorrow.`;

const PROMPT_GENERATOR_SYSTEM = `You generate three short reflective journal prompts for a fitness app user. Each prompt should feel personal and invite genuine reflection — not a tick-box answer.

RULES:
- Maximum 30 words per prompt.
- Each prompt ends with a question mark.
- No therapeutic language. No clinical framing. No "how does that make you feel?" style questions.
- Do not ask the user to rate or score anything numerically.
- Vary the angle of each prompt — they should not feel like variations of the same question.

PROMPT 1 — Training & Progress:
If the user has fewer than 5 sessions logged for any exercise, ask open questions about their training goals, what they're working toward, and how they feel about their early progress.
If they have 5+ sessions, draw on recent session data and trends. Focus on the emotional and motivational dimension — not a workout summary. Ask about confidence, direction, effort, or what the numbers mean to them personally.

PROMPT 2 — Profile-informed:
If this is one of the user's first 5 journal entries, ask a warm 'get to know you' style question.
If they have 5+ entries, draw from the user profile, recent wellness score patterns, and themes from recent entries. Surface something specific and relevant — not generic.

PROMPT 3 — Open / Broader:
A broader question. May relate to life priorities, goals beyond training, or themes from the profile or recent entries. More open-ended and varied than prompts 1 and 2.

Call generate_prompts with your three prompts.`;

const PROFILE_UPDATE_SYSTEM = `You maintain the user profile for a fitness journalling app. Update the profile based on the new journal entry and context provided.

The profile has six sections — always use these exact headings:
## Training focus
## Work and life context
## Life priorities
## Wellness patterns
## Recent themes
## Notable patterns

RULES:
- The update is evolutionary. Refine and add. Do not rewrite from scratch unless something is clearly outdated.
- Keep the full profile under 600 words.
- No clinical or therapeutic language.
- Do not characterise the user's emotional state in subjective terms — observe patterns in data and what they have written.
- Wellness patterns: observe scored data only (sleep, stress, feed numbers). Do not summarise emotional content. Leave sparse until at least 2 weeks of check-in data exists.
- Notable patterns: cross-domain connections between training performance, wellness scores, and journal themes. Leave sparse until patterns genuinely emerge.
- Return ONLY the updated profile text with section headings. No preamble or explanation.`;

const INITIAL_PROFILE_SYSTEM = `You are generating an initial user profile for a fitness journalling app from a first conversation with the user.

The profile has six sections — always use these exact headings:
## Training focus
## Work and life context
## Life priorities
## Wellness patterns
## Recent themes
## Notable patterns

RULES:
- Base the profile entirely on what was shared in the conversation. Do not invent or extrapolate.
- Keep the profile under 400 words total.
- Wellness patterns, Recent themes, and Notable patterns should be left sparse — note briefly that these will develop over time.
- No clinical language. No therapeutic framing.
- Return ONLY the profile text with section headings. No preamble or explanation.`;

const JOURNAL_SAFETY_REDIRECT = `Something in what you've written suggests you might benefit from talking to someone directly. Lift Log isn't the right tool for this — but these services are free and available now:

Samaritans — call 116 123 (24/7)
Shout — text SHOUT to 85258 (24/7)
NHS 111 — call 111, select option 2 (24/7)
CALM — call 0800 58 58 58 (5pm–midnight)

Your previous entries are safe — come back when you're ready.`;

// Keywords that trigger the safety redirect on journal submission
const SAFETY_KEYWORDS = [
  'kill myself', 'killing myself', 'end my life', 'end it all', 'want to die',
  'suicidal', 'suicide', 'self-harm', 'self harm', 'hurt myself', 'hurting myself',
  'cutting myself', 'not worth living', 'no point in living', 'can\'t go on',
  'can\'t cope anymore', 'hopeless', 'helpless', 'crisis', 'purging', 'not eating',
  'starving myself',
];

function containsSafetyKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SAFETY_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Claude API helpers ────────────────────────────────────────────────────────

async function callClaude(env, systemPrompt, messages, tool) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages,
      tools: [tool],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  return response.json();
}

async function callSonnet(env, systemPrompt, messages, tool) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  };
  if (tool) {
    body.tools = [tool];
    body.tool_choice = { type: 'any' };
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Sonnet API error ${response.status}: ${err}`);
  }
  return response.json();
}

// ── Endpoint handlers ────────────────────────────────────────────────────────

async function handlePostUser(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }

  const { id, name } = body ?? {};
  if (!id || typeof id !== 'string' || !name || typeof name !== 'string') {
    return jsonResponse({ error: 'id and name are required' }, 400);
  }

  try {
    await env.DB.prepare('INSERT INTO users (id, name, createdAt) VALUES (?, ?, ?)')
      .bind(id, name.trim(), new Date().toISOString())
      .run();
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique')) {
      return jsonResponse({ ok: true, existing: true });
    }
    console.error('POST /user D1 error:', err);
    return jsonResponse({ error: 'Failed to create user' }, 500);
  }

  return jsonResponse({ ok: true, existing: false });
}

async function handleGetUser(id, env) {
  const row = await env.DB.prepare('SELECT id, name FROM users WHERE id = ?').bind(id).first();
  if (!row) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ id: row.id, name: row.name });
}

async function handleGetExercises(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT key, name FROM exercises WHERE userId = ? ORDER BY name ASC'
  ).bind(userId).all();

  return jsonResponse(results ?? []);
}

async function handlePostExercises(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }

  const { key, name } = body ?? {};
  if (!key || typeof key !== 'string' || !name || typeof name !== 'string') {
    return jsonResponse({ error: 'key and name are required' }, 400);
  }

  try {
    await env.DB.prepare('INSERT INTO exercises (key, userId, name) VALUES (?, ?, ?)')
      .bind(key.trim(), userId, name.trim())
      .run();
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique')) {
      return jsonResponse({ error: 'Exercise already exists' }, 409);
    }
    console.error('POST /exercises D1 error:', err);
    return jsonResponse({ error: 'Failed to add exercise' }, 500);
  }

  return jsonResponse({ key, name });
}

async function handleDeleteExercise(key, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const existing = await env.DB.prepare(
    'SELECT key FROM exercises WHERE key = ? AND userId = ?'
  ).bind(key, userId).first();

  if (!existing) return jsonResponse({ error: 'Exercise not found' }, 404);

  const { results: sessionRows } = await env.DB.prepare(
    'SELECT id FROM sessions WHERE liftKey = ? AND userId = ?'
  ).bind(key, userId).all();

  const sessionIds = (sessionRows ?? []).map(r => r.id);
  const statements = [];

  for (const sid of sessionIds) {
    statements.push(env.DB.prepare('DELETE FROM sets WHERE sessionId = ?').bind(sid));
  }

  statements.push(env.DB.prepare('DELETE FROM sessions WHERE liftKey = ? AND userId = ?').bind(key, userId));
  statements.push(env.DB.prepare('DELETE FROM exercises WHERE key = ? AND userId = ?').bind(key, userId));

  await env.DB.batch(statements);
  return jsonResponse({ ok: true });
}

async function handlePostSave(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }

  const { sessionId, date, liftKey, lift, rpe, notes, sets } = body ?? {};

  if (
    !sessionId || typeof sessionId !== 'string' ||
    !date || typeof date !== 'string' ||
    !liftKey || typeof liftKey !== 'string' ||
    !lift || typeof lift !== 'string' ||
    !Array.isArray(sets) || sets.length === 0
  ) {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  for (const set of sets) {
    if (!isValidNumber(set.weight) || !isValidNumber(set.reps)) {
      return jsonResponse({ error: `Invalid weight or reps in set ${set.setNumber}` }, 400);
    }
    if (!isPositiveNumber(set.weight)) {
      return jsonResponse({ error: `Weight must be greater than zero in set ${set.setNumber}` }, 400);
    }
  }

  const existing = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind(sessionId).first();
  if (existing) return jsonResponse({ ok: true, duplicate: true });

  try {
    const statements = [];

    statements.push(
      env.DB.prepare(
        `INSERT INTO sessions (id, userId, liftKey, date, rpe, notes, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sessionId, userId, liftKey, date,
        rpe !== undefined && rpe !== null ? Number(rpe) : null,
        notes ?? null,
        new Date().toISOString()
      )
    );

    for (const set of sets) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO sets (sessionId, type, setNumber, weight, reps, partials)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          sessionId,
          set.type,
          Number(set.setNumber),
          Number(set.weight),
          Math.round(Number(set.reps)),
          set.partials !== undefined && set.partials !== null && set.partials !== ''
            ? Math.round(Number(set.partials))
            : null
        )
      );
    }

    await env.DB.batch(statements);
  } catch (err) {
    console.error('POST /save D1 error:', err);
    return jsonResponse({ error: 'Failed to save session' }, 500);
  }

  return jsonResponse({ ok: true });
}

async function handleGetHistory(url, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const liftKey = url.searchParams.get('liftKey');
  if (!liftKey) return jsonResponse({ error: 'Missing liftKey query parameter' }, 400);

  const { results: sessionRows } = await env.DB.prepare(
    `SELECT id, date, liftKey, rpe, notes
     FROM sessions
     WHERE userId = ? AND liftKey = ?
     ORDER BY date ASC, createdAt ASC`
  ).bind(userId, liftKey).all();

  if (!sessionRows || sessionRows.length === 0) return jsonResponse([]);

  const sessionIds = sessionRows.map(s => s.id);
  const placeholders = sessionIds.map(() => '?').join(', ');
  const { results: setRows } = await env.DB.prepare(
    `SELECT sessionId, type, setNumber, weight, reps, partials
     FROM sets
     WHERE sessionId IN (${placeholders})
     ORDER BY setNumber ASC`
  ).bind(...sessionIds).all();

  const setsBySession = new Map();
  for (const row of setRows ?? []) {
    if (!setsBySession.has(row.sessionId)) setsBySession.set(row.sessionId, []);
    setsBySession.get(row.sessionId).push({
      type: row.type,
      setNum: row.setNumber,
      weight: row.weight,
      reps: row.reps,
      partials: row.partials ?? null,
    });
  }

  const sessions = sessionRows.map(s => ({
    sessionId: s.id,
    date: s.date,
    liftKey: s.liftKey,
    rpe: s.rpe ?? null,
    notes: s.notes ?? null,
    sets: setsBySession.get(s.id) ?? [],
  }));

  return jsonResponse(sessions);
}

async function handleGetRestore(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT key, name FROM exercises WHERE userId = ? ORDER BY name ASC'
  ).bind(userId).all();

  return jsonResponse({ exercises: results ?? [] });
}

async function handleGetWellness(url, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const date = url.searchParams.get('date');
  if (!date) return jsonResponse({ error: 'Missing date query parameter' }, 400);

  const row = await env.DB.prepare(
    `SELECT sleep_pre, feed_pre, stress_pre,
            sleep_rationale, feed_rationale, stress_rationale,
            coaching_skipped, pre_complete, notes
     FROM daily_wellness WHERE userId = ? AND date = ?`
  ).bind(userId, date).first();

  return jsonResponse(row ?? null);
}

async function handlePostWellness(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid request body' }, 400); }

  const { date, sleep_pre, feed_pre, stress_pre, notes } = body ?? {};
  if (!date || typeof date !== 'string') return jsonResponse({ error: 'date is required' }, 400);

  for (const [field, val] of [['sleep_pre', sleep_pre], ['feed_pre', feed_pre], ['stress_pre', stress_pre]]) {
    if (val !== undefined && val !== null) {
      const n = Number(val);
      if (!isFinite(n) || n < 1 || n > 5) {
        return jsonResponse({ error: `${field} must be between 1 and 5` }, 400);
      }
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO daily_wellness (userId, date, sleep_pre, feed_pre, stress_pre, notes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, date) DO UPDATE SET
         sleep_pre = excluded.sleep_pre,
         feed_pre  = excluded.feed_pre,
         stress_pre = excluded.stress_pre,
         notes     = excluded.notes`
    ).bind(
      userId, date,
      sleep_pre !== undefined && sleep_pre !== null ? Number(sleep_pre) : null,
      feed_pre  !== undefined && feed_pre  !== null ? Number(feed_pre)  : null,
      stress_pre !== undefined && stress_pre !== null ? Number(stress_pre) : null,
      notes ?? null,
      new Date().toISOString()
    ).run();
  } catch (err) {
    console.error('POST /wellness D1 error:', err);
    return jsonResponse({ error: 'Failed to save wellness entry' }, 500);
  }

  return jsonResponse({ ok: true });
}

// ── Coaching endpoint handlers ───────────────────────────────────────────────

/**
 * GET /coaching/status?date=YYYY-MM-DD
 * Returns the coaching completion state for today.
 * Used by the frontend on app load to decide whether to show the coach screen.
 */
async function handleCoachingStatus(url, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const date = url.searchParams.get('date');
  if (!date) return jsonResponse({ error: 'date required' }, 400);

  const row = await env.DB.prepare(
    'SELECT pre_complete, coaching_skipped FROM daily_wellness WHERE userId = ? AND date = ?'
  ).bind(userId, date).first();

  return jsonResponse({
    pre_complete:     row?.pre_complete     ?? 0,
    coaching_skipped: row?.coaching_skipped ?? 0,
  });
}

/**
 * POST /coaching/start
 * Starts a new coaching conversation or resumes an existing one.
 * Body: { date, phase, sessionId }
 *   phase     — 'pre' | 'post'
 *   sessionId — 'pre_YYYY-MM-DD' for pre, workout UUID for post
 *
 * Returns: { messages, status, resumed }
 * The opening message is generated by calling Claude with no user turn,
 * then stored as the first assistant message.
 */
async function handleCoachingStart(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid body' }, 400); }

  const { date, phase, sessionId } = body ?? {};
  if (!date || !phase || !sessionId) return jsonResponse({ error: 'date, phase, sessionId required' }, 400);
  if (!['pre', 'post'].includes(phase)) return jsonResponse({ error: 'Invalid phase' }, 400);

  // Check if a conversation already exists (tab-close resume)
  const existing = await env.DB.prepare(
    'SELECT id, messages, status FROM coaching_conversations WHERE userId = ? AND sessionId = ? AND phase = ?'
  ).bind(userId, sessionId, phase).first();

  if (existing) {
    return jsonResponse({
      messages: JSON.parse(existing.messages || '[]'),
      status: existing.status,
      resumed: true,
    });
  }

  // New conversation — get opening message from Claude
  const systemPrompt = CORE_PROMPT + '\n\n' + (phase === 'pre' ? PRE_PROMPT : POST_PROMPT);
  const tool = phase === 'pre' ? PRE_TOOL : POST_TOOL;

  let openingText;
  try {
    // Send a single "begin" user turn so Claude produces the opening message
    const claudeRes = await callClaude(env, systemPrompt, [
      { role: 'user', content: 'Begin.' },
    ], tool);

    openingText = (claudeRes.content ?? [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('') || 'Ready when you are.';
  } catch (err) {
    console.error('Claude opening message error:', err);
    // Fallback opening so the conversation can still start
    openingText = phase === 'pre'
      ? "I'm your Lift Log AI coach. How are you heading into today — sleep okay? How has the day been so far?"
      : "Good work. How did that feel — how hard did you push, and how are you feeling now?";
  }

  const messages = [{ role: 'assistant', content: openingText }];
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO coaching_conversations (userId, date, phase, sessionId, messages, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?)`
  ).bind(userId, date, phase, sessionId, JSON.stringify(messages), now, now).run();

  return jsonResponse({ messages, status: 'in_progress', resumed: false });
}

/**
 * POST /coaching/message
 * Sends a user message, gets a coach reply, persists both.
 * Body: { date, phase, sessionId, content }
 * Returns: { reply, complete, scores? }
 *   complete = true when Claude calls submit_scores — scores are saved automatically.
 */
async function handleCoachingMessage(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid body' }, 400); }

  const { date, phase, sessionId, content } = body ?? {};
  if (!date || !phase || !sessionId || !content) {
    return jsonResponse({ error: 'date, phase, sessionId, content required' }, 400);
  }

  const conv = await env.DB.prepare(
    'SELECT id, messages, status FROM coaching_conversations WHERE userId = ? AND sessionId = ? AND phase = ?'
  ).bind(userId, sessionId, phase).first();

  if (!conv) return jsonResponse({ error: 'Conversation not found — call /coaching/start first' }, 404);
  if (conv.status === 'complete') return jsonResponse({ error: 'Conversation already complete' }, 400);

  const messages = JSON.parse(conv.messages || '[]');

  // Enforce message limit (opening assistant message counts)
  const limit = phase === 'pre' ? 10 : 6;
  if (messages.length >= limit) {
    return jsonResponse({ error: 'Message limit reached' }, 400);
  }

  messages.push({ role: 'user', content });

  const systemPrompt = CORE_PROMPT + '\n\n' + (phase === 'pre' ? PRE_PROMPT : POST_PROMPT);
  const tool = phase === 'pre' ? PRE_TOOL : POST_TOOL;

  let claudeRes;
  try {
    claudeRes = await callClaude(env, systemPrompt, messages, tool);
  } catch (err) {
    console.error('Claude API error in /coaching/message:', err);
    return jsonResponse({ error: 'AI service unavailable — please try again' }, 503);
  }

  // Parse Claude's response
  let replyText = '';
  let toolInput = null;

  for (const block of claudeRes.content ?? []) {
    if (block.type === 'text') replyText = block.text;
    if (block.type === 'tool_use' && block.name === 'submit_scores') toolInput = block.input;
  }

  const now = new Date().toISOString();

  if (claudeRes.stop_reason === 'tool_use' && toolInput) {
    // Scores confirmed — persist to the appropriate table
    try {
      if (phase === 'pre') {
        await env.DB.prepare(
          `INSERT INTO daily_wellness
             (userId, date, sleep_pre, feed_pre, stress_pre,
              sleep_rationale, feed_rationale, stress_rationale,
              pre_complete, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(userId, date) DO UPDATE SET
             sleep_pre        = excluded.sleep_pre,
             feed_pre         = excluded.feed_pre,
             stress_pre       = excluded.stress_pre,
             sleep_rationale  = excluded.sleep_rationale,
             feed_rationale   = excluded.feed_rationale,
             stress_rationale = excluded.stress_rationale,
             pre_complete     = 1`
        ).bind(
          userId, date,
          toolInput.sleep_pre, toolInput.feed_pre, toolInput.stress_pre,
          toolInput.sleep_rationale, toolInput.feed_rationale, toolInput.stress_rationale,
          now
        ).run();
      } else {
        // post-session — update the sessions row
        await env.DB.prepare(
          `UPDATE sessions SET
             exertion_post      = ?,
             energy_post        = ?,
             mood_post          = ?,
             exertion_rationale = ?,
             energy_rationale   = ?,
             mood_rationale     = ?
           WHERE id = ? AND userId = ?`
        ).bind(
          toolInput.exertion_post, toolInput.energy_post, toolInput.mood_post,
          toolInput.exertion_rationale, toolInput.energy_rationale, toolInput.mood_rationale,
          sessionId, userId
        ).run();
      }
    } catch (err) {
      console.error('Score save error:', err);
      return jsonResponse({ error: 'Failed to save scores' }, 500);
    }

    // Add sign-off text to messages and mark complete
    if (replyText) messages.push({ role: 'assistant', content: replyText });

    await env.DB.prepare(
      'UPDATE coaching_conversations SET messages = ?, status = ?, updatedAt = ? WHERE id = ?'
    ).bind(JSON.stringify(messages), 'complete', now, conv.id).run();

    return jsonResponse({ reply: replyText, complete: true, scores: toolInput });
  }

  // Normal turn — persist and return reply
  if (replyText) messages.push({ role: 'assistant', content: replyText });

  await env.DB.prepare(
    'UPDATE coaching_conversations SET messages = ?, updatedAt = ? WHERE id = ?'
  ).bind(JSON.stringify(messages), now, conv.id).run();

  return jsonResponse({ reply: replyText, complete: false });
}

/**
 * POST /coaching/skip
 * Marks today's pre-session coaching as skipped.
 * Body: { date }
 */
async function handleCoachingSkip(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid body' }, 400); }

  const { date } = body ?? {};
  if (!date) return jsonResponse({ error: 'date required' }, 400);

  const now = new Date().toISOString();
  const sessionId = `pre_${date}`;

  try {
    await env.DB.prepare(
      `INSERT INTO daily_wellness (userId, date, coaching_skipped, pre_complete, createdAt)
       VALUES (?, ?, 1, 0, ?)
       ON CONFLICT(userId, date) DO UPDATE SET coaching_skipped = 1`
    ).bind(userId, date, now).run();

    // Record or update the conversation row as skipped
    const existing = await env.DB.prepare(
      'SELECT id FROM coaching_conversations WHERE userId = ? AND sessionId = ? AND phase = ?'
    ).bind(userId, sessionId, 'pre').first();

    if (existing) {
      await env.DB.prepare(
        'UPDATE coaching_conversations SET status = ?, updatedAt = ? WHERE id = ?'
      ).bind('skipped', now, existing.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO coaching_conversations (userId, date, phase, sessionId, messages, status, createdAt, updatedAt)
         VALUES (?, ?, 'pre', ?, '[]', 'skipped', ?, ?)`
      ).bind(userId, date, sessionId, now, now).run();
    }
  } catch (err) {
    console.error('POST /coaching/skip error:', err);
    return jsonResponse({ error: 'Failed to record skip' }, 500);
  }

  return jsonResponse({ ok: true });
}

// ── Journal handlers ─────────────────────────────────────────────────────────

/**
 * GET /journal/onboarding/status
 * Returns whether the onboarding conversation has been completed and,
 * if in progress, the existing message history for tab-close recovery.
 */
async function handleJournalOnboardingStatus(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const user = await env.DB.prepare('SELECT onboarding_complete FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonResponse({ error: 'User not found' }, 404);

  if (user.onboarding_complete) return jsonResponse({ complete: true, in_progress: false });

  const conv = await env.DB.prepare(
    'SELECT messages, status FROM journal_onboarding_conversations WHERE userId = ? ORDER BY id DESC LIMIT 1'
  ).bind(userId).first();

  if (!conv || conv.status === 'complete') return jsonResponse({ complete: false, in_progress: false });

  return jsonResponse({
    complete: false,
    in_progress: true,
    messages: JSON.parse(conv.messages || '[]'),
  });
}

/**
 * POST /journal/onboarding/message
 * Send a user message in the onboarding conversation; receive the next assistant reply.
 * Body: { content }
 * On completion: generates initial profile and marks onboarding done.
 */
async function handleJournalOnboardingMessage(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid body' }, 400); }

  const { content } = body ?? {};
  if (!content || typeof content !== 'string') return jsonResponse({ error: 'content required' }, 400);

  // Safety check on user input
  if (containsSafetyKeyword(content)) {
    return jsonResponse({ reply: JOURNAL_SAFETY_REDIRECT, complete: false, flagged: true });
  }

  const now = new Date().toISOString();

  // Find or create the onboarding conversation row
  let conv = await env.DB.prepare(
    'SELECT id, messages, status FROM journal_onboarding_conversations WHERE userId = ? ORDER BY id DESC LIMIT 1'
  ).bind(userId).first();

  let messages = [];
  let convId;

  if (!conv) {
    // First message — create the row with the opening assistant message baked in
    const opening = "I'm your Lift Log journal assistant — I'm an AI. Before your first prompts, I'd like to get a quick sense of who you are and what you're working toward. Tell me a bit about yourself — what do you do, and what are you trying to achieve with your training?";
    messages = [{ role: 'assistant', content: opening }];
    const result = await env.DB.prepare(
      'INSERT INTO journal_onboarding_conversations (userId, messages, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, JSON.stringify(messages), 'in_progress', now, now).run();
    convId = result.meta.last_row_id;
  } else {
    if (conv.status === 'complete') return jsonResponse({ error: 'Onboarding already complete' }, 400);
    messages = JSON.parse(conv.messages || '[]');
    convId = conv.id;
  }

  messages.push({ role: 'user', content });

  const COMPLETE_TOOL = {
    name: 'complete_onboarding',
    description: 'Call this when you have gathered enough context about the user (after at least 6 exchanges). Ends the onboarding and triggers profile generation.',
    input_schema: {
      type: 'object',
      properties: {
        closing_message: { type: 'string', description: 'A warm closing message for the user confirming their profile is set up.' },
      },
      required: ['closing_message'],
    },
  };

  let claudeRes;
  try {
    claudeRes = await callSonnet(env, ONBOARDING_PROMPT, messages, COMPLETE_TOOL);
  } catch (err) {
    console.error('Sonnet error in /journal/onboarding/message:', err);
    return jsonResponse({ error: 'AI service unavailable — please try again' }, 503);
  }

  let replyText = '';
  let toolInput = null;

  for (const block of claudeRes.content ?? []) {
    if (block.type === 'text') replyText = block.text;
    if (block.type === 'tool_use' && block.name === 'complete_onboarding') toolInput = block.input;
  }

  if (toolInput) {
    const closingMessage = toolInput.closing_message || 'All set. Your first prompts will be waiting tomorrow.';
    if (closingMessage) messages.push({ role: 'assistant', content: closingMessage });

    await env.DB.prepare(
      'UPDATE journal_onboarding_conversations SET messages = ?, status = ?, updatedAt = ? WHERE id = ?'
    ).bind(JSON.stringify(messages), 'complete', now, convId).run();

    // Generate initial profile from the conversation (non-blocking)
    env.waitUntil?.(generateInitialProfile(userId, messages, env));

    return jsonResponse({ reply: closingMessage, complete: true });
  }

  // Normal turn
  if (replyText) messages.push({ role: 'assistant', content: replyText });

  await env.DB.prepare(
    'UPDATE journal_onboarding_conversations SET messages = ?, updatedAt = ? WHERE id = ?'
  ).bind(JSON.stringify(messages), now, convId).run();

  return jsonResponse({ reply: replyText, complete: false });
}

async function generateInitialProfile(userId, messages, env) {
  try {
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const claudeRes = await callSonnet(env, INITIAL_PROFILE_SYSTEM, [
      { role: 'user', content: `Generate the initial user profile from this onboarding conversation:\n\n${conversationText}` },
    ], null);

    const profileText = claudeRes.content?.[0]?.text ?? '';
    const now = new Date().toISOString();

    await env.DB.prepare(
      'UPDATE users SET profile_text = ?, profile_updated_at = ?, onboarding_complete = 1 WHERE id = ?'
    ).bind(profileText, now, userId).run();
  } catch (err) {
    console.error('Initial profile generation error:', err);
    // Mark onboarding complete even if profile generation fails — don't block the user
    await env.DB.prepare('UPDATE users SET onboarding_complete = 1 WHERE id = ?').bind(userId).run();
  }
}

/**
 * GET /journal/status?date=YYYY-MM-DD
 * Returns routing state for the journal module on a given day.
 */
async function handleJournalStatus(url, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const date = url.searchParams.get('date');
  if (!date) return jsonResponse({ error: 'date required' }, 400);

  const user = await env.DB.prepare('SELECT onboarding_complete FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonResponse({ error: 'User not found' }, 404);

  if (!user.onboarding_complete) {
    const conv = await env.DB.prepare(
      'SELECT status FROM journal_onboarding_conversations WHERE userId = ? ORDER BY id DESC LIMIT 1'
    ).bind(userId).first();
    return jsonResponse({
      onboarding_complete: false,
      onboarding_in_progress: !!(conv && conv.status === 'in_progress'),
      submitted_today: false,
      prompts_generated: false,
    });
  }

  const [entry, prompts] = await Promise.all([
    env.DB.prepare('SELECT id FROM journal_entries WHERE userId = ? AND date = ?').bind(userId, date).first(),
    env.DB.prepare('SELECT id FROM journal_prompts WHERE userId = ? AND date = ?').bind(userId, date).first(),
  ]);

  return jsonResponse({
    onboarding_complete: true,
    onboarding_in_progress: false,
    submitted_today: !!entry,
    prompts_generated: !!prompts,
  });
}

/**
 * GET /journal/prompts?date=YYYY-MM-DD
 * Returns today's prompts. Generates them via Sonnet if not yet created.
 */
async function handleJournalPrompts(url, request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const date = url.searchParams.get('date');
  if (!date) return jsonResponse({ error: 'date required' }, 400);

  // Check onboarding
  const user = await env.DB.prepare('SELECT onboarding_complete, profile_text FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonResponse({ error: 'User not found' }, 404);
  if (!user.onboarding_complete) return jsonResponse({ needs_onboarding: true });

  // Return cached prompts if already generated today
  const cached = await env.DB.prepare(
    'SELECT prompt_1, prompt_2, prompt_3, refresh_count_1, refresh_count_2, refresh_count_3 FROM journal_prompts WHERE userId = ? AND date = ?'
  ).bind(userId, date).first();

  if (cached) return jsonResponse({ prompts: cached, generated: false });

  // Generate prompts via Sonnet
  const prompts = await generateJournalPrompts(userId, date, user.profile_text, env);
  return jsonResponse({ prompts, generated: true });
}

async function generateJournalPrompts(userId, date, profileText, env) {
  // Gather context
  const [wellnessRow, recentEntries, entryCount, sessionData] = await Promise.all([
    env.DB.prepare('SELECT sleep_pre, feed_pre, stress_pre FROM daily_wellness WHERE userId = ? AND date = ?').bind(userId, date).first(),
    env.DB.prepare(
      `SELECT date, prompt_1_text, response_1, prompt_2_text, response_2, prompt_3_text, response_3
       FROM journal_entries WHERE userId = ? ORDER BY date DESC LIMIT 3`
    ).bind(userId).all(),
    env.DB.prepare('SELECT COUNT(*) as cnt FROM journal_entries WHERE userId = ?').bind(userId).first(),
    env.DB.prepare(
      `SELECT s.liftKey, s.date, COUNT(DISTINCT s.id) as session_count
       FROM sessions s WHERE s.userId = ?
       GROUP BY s.liftKey ORDER BY s.date DESC LIMIT 10`
    ).bind(userId).all(),
  ]);

  const totalEntries = entryCount?.cnt ?? 0;
  const isEarlyUser = totalEntries < 5;

  const contextParts = [];
  if (wellnessRow) {
    contextParts.push(`Today's wellness scores: Sleep ${wellnessRow.sleep_pre ?? 'not recorded'}/5, Feed ${wellnessRow.feed_pre ?? 'not recorded'}/5, Stress ${wellnessRow.stress_pre ?? 'not recorded'}/5`);
  } else {
    contextParts.push('Today\'s wellness scores: not yet recorded.');
  }

  contextParts.push(`User profile:\n${profileText || 'No profile yet.'}`);
  contextParts.push(`Total journal entries to date: ${totalEntries} (${isEarlyUser ? 'early user — fewer than 5 entries' : 'established user'})`);

  if (recentEntries.results?.length) {
    const recentText = recentEntries.results.map(e =>
      `Date: ${e.date}\nQ1: ${e.prompt_1_text}\nA1: ${e.response_1 ?? '(no response)'}\nQ2: ${e.prompt_2_text}\nA2: ${e.response_2 ?? '(no response)'}\nQ3: ${e.prompt_3_text}\nA3: ${e.response_3 ?? '(no response)'}`
    ).join('\n\n');
    contextParts.push(`Recent journal entries (last 3 days):\n${recentText}`);
  }

  if (sessionData.results?.length) {
    const sessionText = sessionData.results.map(s => `${s.liftKey}: ${s.session_count} sessions logged`).join(', ');
    contextParts.push(`Recent training: ${sessionText}`);
  }

  const GENERATE_TOOL = {
    name: 'generate_prompts',
    description: 'Output the three journal prompts for today.',
    input_schema: {
      type: 'object',
      properties: {
        prompt_1: { type: 'string', description: 'Training/progress reflection prompt (max 30 words)' },
        prompt_2: { type: 'string', description: 'Profile-informed prompt (max 30 words)' },
        prompt_3: { type: 'string', description: 'Open/broader prompt (max 30 words)' },
      },
      required: ['prompt_1', 'prompt_2', 'prompt_3'],
    },
  };

  let toolInput = { prompt_1: 'How are you feeling about your training right now?', prompt_2: 'What\'s been on your mind lately outside of the gym?', prompt_3: 'What would make this week feel worthwhile?' };

  try {
    const claudeRes = await callSonnet(env, PROMPT_GENERATOR_SYSTEM, [
      { role: 'user', content: `Generate today's three journal prompts using this context:\n\n${contextParts.join('\n\n')}` },
    ], GENERATE_TOOL);

    for (const block of claudeRes.content ?? []) {
      if (block.type === 'tool_use' && block.name === 'generate_prompts') {
        toolInput = block.input;
      }
    }
  } catch (err) {
    console.error('Prompt generation error:', err);
    // Fall through to defaults
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO journal_prompts (userId, date, prompt_1, prompt_2, prompt_3, refresh_count_1, refresh_count_2, refresh_count_3, generatedAt)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)
     ON CONFLICT(userId, date) DO UPDATE SET prompt_1 = excluded.prompt_1, prompt_2 = excluded.prompt_2, prompt_3 = excluded.prompt_3, generatedAt = excluded.generatedAt`
  ).bind(userId, date, toolInput.prompt_1, toolInput.prompt_2, toolInput.prompt_3, now).run();

  return {
    prompt_1: toolInput.prompt_1, prompt_2: toolInput.prompt_2, prompt_3: toolInput.prompt_3,
    refresh_count_1: 0, refresh_count_2: 0, refresh_count_3: 0,
  };
}

/**
 * POST /journal/prompts/refresh
 * Regenerate a single prompt. Body: { date, prompt_number: 1|2|3 }
 */
async function handleJournalPromptsRefresh(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid body' }, 400); }

  const { date, prompt_number } = body ?? {};
  if (!date || ![1, 2, 3].includes(prompt_number)) return jsonResponse({ error: 'date and prompt_number (1/2/3) required' }, 400);

  const user = await env.DB.prepare('SELECT profile_text FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonResponse({ error: 'User not found' }, 404);

  // Generate fresh prompts for context then pick the one we need
  const fresh = await generateJournalPrompts(userId, date, user.profile_text, env);
  const newPrompt = fresh[`prompt_${prompt_number}`];

  const col = `prompt_${prompt_number}`;
  const countCol = `refresh_count_${prompt_number}`;

  await env.DB.prepare(
    `UPDATE journal_prompts SET ${col} = ?, ${countCol} = ${countCol} + 1 WHERE userId = ? AND date = ?`
  ).bind(newPrompt, userId, date).run();

  return jsonResponse({ prompt: newPrompt });
}

/**
 * POST /journal/entry
 * Save a submitted journal entry.
 * Body: { date, prompt_1_text, response_1, prompt_2_text, response_2, prompt_3_text, response_3 }
 */
async function handleJournalEntry(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid body' }, 400); }

  const { date, prompt_1_text, response_1, prompt_2_text, response_2, prompt_3_text, response_3 } = body ?? {};
  if (!date) return jsonResponse({ error: 'date required' }, 400);

  // At least one response required
  if (!response_1 && !response_2 && !response_3) {
    return jsonResponse({ error: 'At least one response is required' }, 400);
  }

  // Enforce 100-word limit per response
  const wordCount = (text) => text ? text.trim().split(/\s+/).length : 0;
  if (wordCount(response_1) > 100 || wordCount(response_2) > 100 || wordCount(response_3) > 100) {
    return jsonResponse({ error: 'Responses must be 100 words or fewer' }, 400);
  }

  // Safety check across all responses
  if (containsSafetyKeyword(response_1) || containsSafetyKeyword(response_2) || containsSafetyKeyword(response_3)) {
    return jsonResponse({ flagged: true, message: JOURNAL_SAFETY_REDIRECT });
  }

  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO journal_entries (userId, date, prompt_1_text, response_1, prompt_2_text, response_2, prompt_3_text, response_3, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, date, prompt_1_text ?? null, response_1 ?? null, prompt_2_text ?? null, response_2 ?? null, prompt_3_text ?? null, response_3 ?? null, now).run();
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('unique')) {
      return jsonResponse({ error: 'Journal entry already submitted for today' }, 409);
    }
    console.error('POST /journal/entry D1 error:', err);
    return jsonResponse({ error: 'Failed to save entry' }, 500);
  }

  // Trigger background profile update (non-blocking)
  env.waitUntil?.(updateUserProfile(userId, body, env));

  return jsonResponse({ ok: true });
}

async function updateUserProfile(userId, entryData, env) {
  try {
    const [user, wellnessHistory] = await Promise.all([
      env.DB.prepare('SELECT profile_text FROM users WHERE id = ?').bind(userId).first(),
      env.DB.prepare(
        'SELECT date, sleep_pre, feed_pre, stress_pre FROM daily_wellness WHERE userId = ? ORDER BY date DESC LIMIT 14'
      ).bind(userId).all(),
    ]);

    const currentProfile = user?.profile_text || '(no existing profile)';

    const wellnessSummary = wellnessHistory.results?.length
      ? wellnessHistory.results.map(w => `${w.date}: Sleep ${w.sleep_pre ?? '-'}/5, Feed ${w.feed_pre ?? '-'}/5, Stress ${w.stress_pre ?? '-'}/5`).join('\n')
      : 'No wellness data yet.';

    const entryText = [
      entryData.prompt_1_text && `Q: ${entryData.prompt_1_text}\nA: ${entryData.response_1 ?? '(no response)'}`,
      entryData.prompt_2_text && `Q: ${entryData.prompt_2_text}\nA: ${entryData.response_2 ?? '(no response)'}`,
      entryData.prompt_3_text && `Q: ${entryData.prompt_3_text}\nA: ${entryData.response_3 ?? '(no response)'}`,
    ].filter(Boolean).join('\n\n');

    const claudeRes = await callSonnet(env, PROFILE_UPDATE_SYSTEM, [{
      role: 'user',
      content: `Current profile:\n${currentProfile}\n\nNew journal entry (${entryData.date}):\n${entryText}\n\nWellness score history (last 14 days):\n${wellnessSummary}\n\nUpdate the profile.`,
    }], null);

    const updatedProfile = claudeRes.content?.[0]?.text ?? currentProfile;
    const now = new Date().toISOString();

    await env.DB.prepare(
      'UPDATE users SET profile_text = ?, profile_updated_at = ? WHERE id = ?'
    ).bind(updatedProfile, now, userId).run();
  } catch (err) {
    console.error('Profile update error:', err);
    // Non-fatal — previous profile is retained
  }
}

/**
 * GET /journal/history
 * Returns all past journal entries for the user, newest first.
 */
async function handleJournalHistory(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT date, prompt_1_text, response_1, prompt_2_text, response_2, prompt_3_text, response_3
     FROM journal_entries WHERE userId = ? ORDER BY date DESC`
  ).bind(userId).all();

  return jsonResponse(results ?? []);
}

/**
 * GET /profile
 * Returns the user's current profile text.
 */
async function handleGetProfile(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  const user = await env.DB.prepare('SELECT profile_text, profile_updated_at FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonResponse({ error: 'User not found' }, 404);

  return jsonResponse({ profile_text: user.profile_text, profile_updated_at: user.profile_updated_at });
}

/**
 * PUT /profile
 * Manual edit of the user's profile. Writes directly — no AI call.
 */
async function handlePutProfile(request, env) {
  const userId = getUserId(request);
  if (!userId) return jsonResponse({ error: 'X-User-Id header required' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid body' }, 400); }

  const { profile_text } = body ?? {};
  if (typeof profile_text !== 'string') return jsonResponse({ error: 'profile_text required' }, 400);

  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE users SET profile_text = ?, profile_updated_at = ? WHERE id = ?').bind(profile_text, now, userId).run();

  return jsonResponse({ ok: true });
}

// ── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === 'OPTIONS') return preflightResponse();

    // /user
    if (pathname === '/user') {
      if (method === 'POST') return handlePostUser(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /user/:id
    const userIdMatch = pathname.match(/^\/user\/(.+)$/);
    if (userIdMatch) {
      const id = decodeURIComponent(userIdMatch[1]);
      if (method === 'GET') return handleGetUser(id, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /exercises
    if (pathname === '/exercises') {
      if (method === 'GET') return handleGetExercises(request, env);
      if (method === 'POST') return handlePostExercises(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /exercises/:key
    const exerciseKeyMatch = pathname.match(/^\/exercises\/(.+)$/);
    if (exerciseKeyMatch) {
      const key = decodeURIComponent(exerciseKeyMatch[1]);
      if (method === 'DELETE') return handleDeleteExercise(key, request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /save
    if (pathname === '/save') {
      if (method === 'POST') return handlePostSave(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /history
    if (pathname === '/history') {
      if (method === 'GET') return handleGetHistory(url, request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /restore
    if (pathname === '/restore') {
      if (method === 'GET') return handleGetRestore(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /wellness
    if (pathname === '/wellness') {
      if (method === 'GET') return handleGetWellness(url, request, env);
      if (method === 'POST') return handlePostWellness(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /coaching/status
    if (pathname === '/coaching/status') {
      if (method === 'GET') return handleCoachingStatus(url, request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /coaching/start
    if (pathname === '/coaching/start') {
      if (method === 'POST') return handleCoachingStart(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /coaching/message
    if (pathname === '/coaching/message') {
      if (method === 'POST') return handleCoachingMessage(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /coaching/skip
    if (pathname === '/coaching/skip') {
      if (method === 'POST') return handleCoachingSkip(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /journal/onboarding/status
    if (pathname === '/journal/onboarding/status') {
      if (method === 'GET') return handleJournalOnboardingStatus(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /journal/onboarding/message
    if (pathname === '/journal/onboarding/message') {
      if (method === 'POST') return handleJournalOnboardingMessage(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /journal/status
    if (pathname === '/journal/status') {
      if (method === 'GET') return handleJournalStatus(url, request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /journal/prompts
    if (pathname === '/journal/prompts') {
      if (method === 'GET') return handleJournalPrompts(url, request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /journal/prompts/refresh
    if (pathname === '/journal/prompts/refresh') {
      if (method === 'POST') return handleJournalPromptsRefresh(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /journal/entry
    if (pathname === '/journal/entry') {
      if (method === 'POST') return handleJournalEntry(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /journal/history
    if (pathname === '/journal/history') {
      if (method === 'GET') return handleJournalHistory(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // /profile
    if (pathname === '/profile') {
      if (method === 'GET') return handleGetProfile(request, env);
      if (method === 'PUT') return handlePutProfile(request, env);
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
