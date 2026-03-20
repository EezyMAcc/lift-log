# "LIFT LOG"

**Project Document — State of the App, Architecture & Roadmap**

*March 2026   —   Version 1.0*

---

## 1. Overview

"Lift Log" is a personal workout tracking web application built as a single HTML file with a Google Apps Script and Google Sheets backend. It was built through conversational AI collaboration with no prior coding experience, demonstrating the emerging ability for domain experts to build bespoke functional tools without traditional software development skills.

The app currently serves one user and is designed around a specific progressive overload methodology with warmup, working and back-off sets. It is a working, stable piece of software at Version 1.0.

---

## 2. Current Architecture — Version 1.0

### 2.1 Interface

- Single index.html file — no frameworks, plain JavaScript
- Runs entirely in the browser, no installation required
- Three views: Log, Progress, Last Session
- Dark theme, mobile optimised, installable as a web app on iOS
- Exercise management via a drawer menu
- Default exercises: Bench Press, Barbell Rows, Belt Squat, Incline Press (built specifically around the single user)
- Custom exercises can be added and removed under a "burger menu" on the top left corner of the main screen
- Set logging with warmup, working and back-off sections
- Weight, reps and partial reps per set
- Long press to delete individual sets

### 2.2 Backend

- Google Apps Script — acts as the server layer
- doPost: receives session data and writes one row per set to Google Sheets
- doGet: reads full history and returns it to the app
- Bidirectional push and pull mechanism in place
- Script URL is the only external dependency in the HTML file

### 2.3 Database

- Google Sheets — one row per set
- Columns: Date, Exercise, Set Type, Set Number, Weight, Reps, Partials
- Clean, portable, query able structure — already correct for future migration
- localStorage used for in-session state
- Exercises list and current session data persisted locally
- History stored under key: liftlog_hist_v4

### 2.4 Progress Dashboard

- Sessions until you can add weight — projection based on rep progression (target reps set at 9, app calculates deficit based on the reps recorded at working weight in the last session. Then calculates the trend based on the current session versus 3 sessions ago divided by 2. The deficit is then divided by the rate to form a prediction on how many sessions until the user should increase the weight of their main working set. If the deficit is already 0, i.e. you hit 9 reps last session, then the indicator will say 0 sessions and the user should increase the weight).
- Last working weight with delta versus the session before it
- Working set weight over time — SVG line chart
- Reps at working weight per session — SVG bar chart. Chart requires at least 2 working sessions recorded at the 'current' working weight, if the user increases their working weight, the graph will disappear until a second session at the new weight is recorded. This keeps the dashboard tidy and the SVG graph useful as it only displays data at the current working weight
- Session history — last 10 sessions with working and back-off sets displayed

### 2.5 Known Issues

- When a new exercise is added it initialises without a back-off array (backoff:[] array is missing) — minor bug to fix
- Line 447 — `addExercise()` — the primary bug. Change to `liftState[key] = { warmup:[], working:[], backoff:[] }`
- Line 375 — load-time safety check for existing exercises. Change to `liftState[e.key] = { warmup:[], working:[], backoff:[] }`
- Line 379 — legacy key migration. Change to `liftState[k] = { warmup:[], working:[], backoff:[] }`
- Line 847 — a second load-time safety check inside what appears to be the sync/pull function. Change to `liftState[e.key] = { warmup:[], working:[], backoff:[] }`
- Line 361 — the comment `// key -> {warmup:[], working:[]}` — not a functional fix but should be updated to reflect reality: `// key -> {warmup:[], working:[], backoff:[]}`
- Projection logic uses average reps across working sets, however dashboard is built on assumption that working set(s) are always the same weight. The user only has 1 working set and therefore the app should not allow the user to add additional sets. If the user was to add an additional set it could change the 'working weight' used in the 'average reps at working weight' visualisation and therefore the SVG graph would not display. Code should be updated to ensure that no additional working sets can be added.
- Line 229 — the Add working set button in the HTML. This button needs to be hidden once one working set row exists. The simplest fix is to modify the `addRow` function to check the current length before adding, and hide the button once the working array has one entry. Alternatively the button can be hidden via a condition in `renderSection` when `ls.working.length >= 1`.
- Line 537-539 — the `addRow` function itself. A guard should be added here as a belt-and-braces fix regardless of what the UI does. Javascript correction:

```javascript
function addRow(type) {
    if (type === 'working' && getLiftState(currentLift).working.length >= 1) return;
    ...
}
```

This means even if the button is somehow still visible or called from elsewhere, a second working set row can never be added.

Once this is fixed the projection issue resolves itself — there will only ever be one working set so `ws[ws.length-1]` will always be the only set, and the average calculation becomes irrelevant.

One other thing worth flagging. Line 606:

```javascript
const lastW = parseFloat(ws[ws.length-1].weight);
```

The comment next to it says `// last logged working set weight`. Once the single working set fix is in place this will always be `ws[0].weight` — there will only ever be one. Not a bug, but the comment and the logic could both be simplified once the fix is made, which would make the code easier to read.

Nothing else found that looks like an active bug. The rest of the issues in the document are design considerations rather than code errors.

---

## 3. Design Philosophy

### 3.1 Audibility

Audibility is a core principle. This means two things: control over interactive processes, and control over how outputs are structured. Every decision in the architecture should be traceable — data is structured, logic is readable, and changes are deliberate rather than accepted blindly. This principle extends beyond the codebase to the relationship between the platform and its users.

### 3.2 Builder Retains Understanding

The builder maintains a working mental model of the codebase. Changes are made with understanding of what is being changed and why. AI is used as a collaborator, not a delegate. As the codebase grows the goal is to stay close enough that it remains genuinely owned rather than just operated.

### 3.3 Data Consistency Over Perfection

The data collected does not need to be perfect — it needs to be consistently derived. Systematic imprecision in a consistent system still produces useful patterns. This applies equally to workout data and the wellness indicators planned for Phase 2.

### 3.4 Build Simply — Let Complexity Justify Itself

No feature or architectural complexity is introduced until there is a real, experienced need for it. The current single-file architecture is appropriate for the current use case. Complexity is earned through demonstrated friction, not anticipated theoretically. This philosophy carries forward into future horizons and platform scale discussed later in this document.

---

## 4. Feature Backlog — Phase 2

The following features are in discussion and design, not yet built. Phase 2 represents the next meaningful iteration of the app.

### 4.1 Coaching Conversation — Coach Tab

- Third tab added to bottom navigation: Log, Progress, Coach
- Messaging UI — chat bubbles, user on the right, coach on the left
- Pre-session check in derives sleep, feed and stress scores from natural conversation
- Scores stored as integers 1 to 5
- Displayed to the user as emojis — sleep, food and stress indicators
- 5 is always optimal across all three indicators for data consistency
- Post-session reflection captures additional indicators — to be defined
- Pre-session sign-off message confirms scores before training begins
- Example: Sleep 3/5 — 6 hours, restless. Food 4/5. Stress 2/5 — busy day. Ready to train?
- Query and re-examine mechanic if user disagrees with a derived score
- User cannot simply override a score — must articulate disagreement
- Agent explains its reasoning, asks further questions, derives a revised score through the same process
- Maintains data consistency over time — scores are earned through evidence not preference
- Not talking to the coach does not break workout data collection — it is additive only
- Hard conversation limit of approximately 8 to 10 exchanges, but TBC depending on user challenge/disagreement needs — prevents scope creep

### 4.2 Sleep Score Rules - TBC

Rules are being developed through simulation before implementation. The principle is to anchor the extremes and allow the model to interpret the middle contextually:

- 5 — 8 or more hours, felt restorative, woke naturally
- 4 — 7 to 8 hours, mostly rested
- 3 — 6 to 7 hours, or longer but poor quality
- 2 — 5 to 6 hours or significantly disrupted
- 1 — under 5 hours or exhausted regardless of hours slept

Feeling tired overrides hours — score cannot exceed 3 if tiredness is reported

Feed and stress scoring rules to be developed through the simulation process.

### 4.3 Safety and Guardrails

The coaching conversation exists solely to generate pre and post session wellness scores. It is not a mental health tool, a wellbeing check-in, or a support service. The following guardrails are non-negotiable:

- System prompt explicitly constrains scope — scores only, no emotional support, with a view to triage user challenges in future versions
- Sensitive topic detection — certain keywords redirect immediately to human support
- The agent is disclosed as AI — users know what they are talking to
- Coaches retain clinical responsibility for their clients
- Hard message limit prevents conversations from going deep

The motivation for these guardrails comes from direct personal experience of AI dependency in difficult periods. This is not theoretical risk management — it is a known failure mode being designed against from the start.

### 4.4 Infrastructure — Cloudflare Workers

- Google Apps Script replaced with Cloudflare Workers as the server layer
- Always on — no cold start delays unlike Replit free tier
- Proper streaming support — messaging UI feels natural
- API key stored server-side — never exposed in the browser
- Free tier covers approximately 3,000 to 5,000 daily users before paid tier at $5 per month
- Anthropic API proxied through Cloudflare — key never touches the browser
- Claude Haiku for development and testing, Sonnet recommended for production
- Google Sheets replaced with Cloudflare D1 as the database
- D1 is SQLite running natively inside Cloudflare — no separate service, no separate account, everything in one place
- Never pauses — no inactivity behaviour unlike Supabase free tier
- Free tier: 5 million row reads per day, 100,000 writes per day, 5GB storage — effectively unlimited at personal and Stage 2 scale
- Wellness scores added as additional columns per session
- Session history queried at conversation start and passed to the coach as context
- Migration path to Supabase (PostgreSQL) is clean when platform scale requires it — identical schema, data exports as CSV, Worker connection is the only code change

### 4.5 Coaching Logic — Markdown Prompt File

The coaching conversation is driven by a structured markdown file rather than a fully autonomous agent. This is a deliberate choice for auditability and control — the conversation flow is defined in plain language, readable and editable without touching application code. The file lives in the Cloudflare Worker, never in the HTML file.

### 4.6 AI Model Selection

- Claude Haiku — development and testing only. Sufficient for structured tasks, weakest on nuance and personality consistency.
- Claude Sonnet — recommended for production with real clients. Significantly better at interpreting ambiguous emotional language, handling sensitive topics, and maintaining consistent personality. Cost difference is negligible at coaching scale.
- Model is specified in the Cloudflare Worker — switching is a one-line change, not an architectural decision.
- UI generation uses configuration objects not raw code generation. Sonnet interprets a coach profile and outputs structured JSON. A fixed tested template renders from that configuration.

### 4.7 Version Control — GitHub

- GitHub to be set up before any further code changes are made. This is the natural trigger point for moving from chat-based development to Claude Code for more complex work.
- Every commit is additive — no previous versions are ever lost
- Branching allows safe experimentation without risking the working version
- Naming convention: V1.0 is the current stable release. Minor versions (V1.1, V1.2) for feature additions. Patches (V1.1.1) for bug fixes.
- Google Drive used in the interim for context documents — project summary, coaching markdown, feature backlog
- Folder structure: Code / Context / Coaching / Archive

---

## 5. Staging

The vision is coherent and the architecture is sound. But there is a meaningful difference between a well-designed roadmap and a realistic one. Staging the build around genuine human absorption — of both the builder and the eventual consumer — is the right approach.

**Stage 1 — Personal PoC**

What exists now plus the coaching conversation. One user. Validate that the concept works in practice. Learn the codebase properly. Set up GitHub. Migrate data to Cloudflare Workers (Cloudflare D1) The build is weeks. Stage 1 validated through real use is longer — and that distinction matters.

**Stage 2 — First Practitioner Pilot**

One coach, a handful of clients, manual onboarding, a basic practitioner view. Not a product yet — a structured experiment. Learn what a coach actually needs before building it properly. Evaluate whether real use validates the concept sufficiently to justify serious investment of time and potentially capital.

**Stage 3 — Evaluate**

Is this worth building properly? Is there a co-founder? Is there a go-to-market? Does Stage 2 data validate the concept? What does the practitioner desktop application need to look like before the platform is genuinely shippable to coaches?

**Stage 4 — Build Properly**

With the right people, the right infrastructure, the right sequencing. AI tooling will keep improving — what requires significant engineering effort today may require substantially less within a year. That is a reason not to over-hire or over-invest prematurely.

---

## 6. Long-Term Vision — Platform Scale

### 6.1 The Concept

"Lift Log" has the potential to become a platform used by practitioners of many kinds to onboard clients into a customised, AI-assisted experience. The core insight is that the coaching logic is portable — it does not care whether the front end is an HTML file, a Swift iOS app, or a React web application. The practitioner amplifies their methodology through the platform rather than being replaced by it.

### 6.2 Beyond Fitness

The three wellness indicators — sleep, feed, stress — are not specific to exercise. They are universal human performance indicators. Many users may never touch the workout tracking module. Wellbeing more broadly is the domain, with fitness as the first and most concrete expression of it. Founder suggests fitness industry more likely first movers for this type of product but market research and iteration will confirm. Suggestion that with uptick in GLP-1 prescriptions, the market for consumer grade workout tracking and agentic coaching will expand over the coming years. A research document already produced which outlines some initial market research performed by Claude Sonnet.

### 6.3 A Personal Operating System

The longer-term vision is a platform where all data about a person's life — health, training, sleep, stress, work, finances, goals — is connected, visible and queryable. MCP servers are the connective tissue that makes this possible without requiring the user to manually consolidate data from disparate apps.

The coaching conversation evolves from a pre-workout check-in into a daily or weekly reflective practice that synthesises across all domains and surfaces patterns no single app could reveal.

### 6.4 The Practitioner Layer at Scale

Different practitioners see different slices of a user's data under explicit user consent. A personal trainer sees fitness and recovery data. A therapist sees stress and sleep patterns. A nutritionist sees the feed indicators. A life coach sees across everything the user chooses to share. The platform becomes the shared record that connects a person's support network around their actual data rather than self-reported session summaries.

### 6.5 Coach Profile Model

Rather than rebuilding the UI per user, coaches create a profile once. All clients inherit that baseline. Client-level flags modify specific behaviours:

- Eating disorder flag — suppresses certain nutrition questioning, adjusts feed score interpretation
- GLP-1 or obesity flag — adjusts progression metrics and wellness interpretation
- Goal flags — weight loss, performance, rehabilitation and others

The UI is consistent across clients. Configuration drives the variation. The coach's intellectual property is encoded into the platform experience rather than lost between sessions.

### 6.6 Practitioner Desktop Application

A desktop application for practitioners is not a nice-to-have — it is a prerequisite for the platform being genuinely shippable to coaches. A practitioner recommending this platform to a client is only credible if they have a richer view than the client does. Without it there is a consumer app. With it there is a platform.

R Shiny is the natural technology for this surface. Practitioners sit at a desk, review client progress unhurriedly, and need sophisticated visualisation rather than fast mobile interactions. R produces the quality of analytical output that supports professional judgement in a way that JavaScript browser charts do not.

A first version requires only: a client roster with last session date and current working weights, individual client progress and wellness trend charts, and basic flagging for clients who have not logged recently or show sustained low wellness scores. That is enough to make the professional relationship feel properly supported.

### 6.7 Data Architecture at Scale

Google Sheets is replaced with Supabase in phase 2. Shared tables with user IDs as the key: users, sessions, sets, wellness, coaches. Every query filters by user ID. Coach permissions are separate from client permissions. Supabase includes authentication — no additional service required.

### 6.8 Cost Model Per User

- Claude Haiku: approximately 10 to 30 pence per user per month
- Claude Sonnet: approximately 40 pence to £1.00 per user per month
- Cloudflare Workers and Supabase: free tier until meaningful scale
- A coach subscription of £50 to £100 per month covering 20 to 50 clients makes the unit economics comfortable even at Sonnet pricing.

---

## 7. Founding Principles

These principles are established now to retain optionality as the platform grows. They do not require immediate build work but should inform every future architectural decision.

### 7.1 User Data Sovereignty

The user owns their data. Every data connection is explicitly consented to. Practitioners see only what the user has actively granted them access to. Consent is granular and revocable at any time. This principle maps directly to GDPR compliance, clinical data frameworks, and enterprise data governance standards. It is motivated by values rather than regulatory box-ticking — which produces better outcomes and stronger trust.

### 7.2 Stable Identity

Every user has a system-generated unique identifier from first authentication. All data — workout, wellness, and any future domain — connects to that identifier. Email addresses and any changeable attribute must never serve as the primary key. Supabase handles this correctly by default. The principle needs documenting now because migrating an identifier later is one of the most painful problems in software.

### 7.3 Modularity

Workout tracking and the coaching conversation are independent modules. Neither depends on the other. A user can be purely a tracker, purely a coaching conversation user, or both. The coach configures which modules their clients see. New domains can be added without redesigning existing ones.

### 7.4 Auditability

Every decision in the architecture should be traceable. Data is structured. Logic is readable. Changes are deliberate. The coaching conversation is driven by a readable markdown file, not a black box. Scores are derived through a consistent documented process. The system can be inspected and understood by a human at every layer.

---

## 8. Deployment Architecture and Continuous Delivery

At Stage 1, deployment is trivial. One user, one file, a conversation to make changes. The question of how changes reach users is not yet a real problem. But the architectural decisions made now either enable or constrain what becomes possible at scale — and the philosophical questions that surround continuous deployment are worth examining early, because they connect directly to the principles already established in this document.

### 8.1 What the Current Tech Stack Allows

Cloudflare Workers deploys in seconds. A change pushed to a GitHub repository can be live globally in under a minute. The infrastructure is not the bottleneck and never really was — deployment pipelines have been fast for years. The bottleneck has always been the human processes wrapped around deployment: review cycles, QA gates, staged rollouts, sign-off procedures.

At the speed code can now be generated, those human processes become the constraint almost immediately. The question is not whether to remove them — some are essential — but which ones serve genuine safety and which ones are legacy overhead from a world where shipping was slow and infrequent.

### 8.2 The Architecture of Continuous Deployment

The infrastructure patterns that enable multiple daily updates without chaos are well established. They need to be built in rather than retrofitted:

- Feature flags — changes are deployed to production but switched off until deliberately enabled. Code ships continuously. Exposure to users is controlled separately. A productive afternoon of building can push something live but invisible, turned on only when confidence is established.
- Automated testing — the stress testing question is the critical one. If a human reviews every change before it ships the bottleneck is immediate. Tests that run automatically on every push — checking that core functions work, data saves correctly, coaching scores derive and store as expected — replace the human gate for the things that can be checked mechanically.
- Rollback capability — inherent in GitHub. A broken production deployment reverts to the previous commit in seconds. The safety net is structural rather than procedural.
- Canary deployments — a change ships to a small percentage of users first. If nothing breaks it rolls to everyone. If something breaks it affects almost nobody and is reversed instantly.
- Observability — rather than testing everything before it ships, you watch what happens after it ships. Error rates, unexpected behaviours, user patterns that suggest something is wrong. Monitoring catches what tests miss. This requires the owner dashboards discussed elsewhere in this document.

### 8.3 Configuration vs Code — The Most Elegant Answer

The most important deployment insight for this platform specifically is that the thing that changes most frequently — how the experience feels for a specific coach and their clients — is not code. It is configuration. And configuration updates carry no deployment risk at all.

A coach refines their client progression logic, adjusts the coaching personality, adds a new wellness indicator. That is a configuration update. It is live immediately. No deployment pipeline. No tests to run. No rollback required. The configuration object approach, established as an architectural principle in this document, turns out to be the most practical answer to the continuous deployment question for the largest category of changes.

Code deployments — changes to the application logic, the coaching markdown, the server layer — happen less frequently and carry more risk. Those are the ones that need the automated testing and observability layer. Keeping that distinction clear in the architecture keeps the fast path fast and the careful path careful.

### 8.4 The Bottleneck Question

Stress testing and review processes do become a bottleneck — but only if they are designed for a world where deployment was infrequent and significant. Redesigned for continuous delivery they become something different: lightweight automated checks that run in seconds rather than heavyweight human processes that take days.

The residual human review that remains is not eliminated — it is elevated. Rather than checking that every line of code is correct, the human is checking that the change is the right thing to build at all. That is a more valuable use of human judgement. The machine handles correctness. The human handles direction.

At Stage 1 none of this infrastructure is necessary. At Stage 2, with real practitioners and real clients, basic automated tests and a rollback habit become important. At platform scale, the CI/CD pipeline is foundational. Building it early is straightforward. Adding it to a mature platform is painful. The decision of when to invest is a staging question more than a technical one.

### 8.5 The Philosophical Questions

Continuous deployment raises questions that go beyond infrastructure. They sit at the intersection of the founding principles already established and the broader questions about pacing that run through this document.

The first is consent and expectation. A user who opens an app today and finds it different from yesterday has not been consulted. For a personal tool with one user that is trivial — the builder and the user are the same person. At platform scale it is not. Practitioners have built workflows around the tool. Clients have developed habits. Continuous change without communication is disorienting regardless of whether each individual change is an improvement. The cadence of change needs to be communicated, not just technically managed.

The second is the relationship between speed and quality. The temptation of continuous deployment is to conflate the ability to ship fast with the wisdom of shipping fast. They are not the same thing. A founder feeling especially productive on a Tuesday afternoon has generated code quickly. That is not the same as having thought carefully about whether the change serves the user, fits the product direction, or introduces edge cases that surface three weeks later. Speed of generation has outpaced speed of considered judgement. The review process that matters most is not the automated test — it is the question of whether this should be built at all.

The third connects to the singularity conversation. If the platform is pushing multiple updates daily to practitioners and their clients, each of whom is trying to build a stable professional relationship with the tool, the pace of the technology is once again running ahead of human capacity to absorb it. The guardrails on deployment cadence are not just technical — they are the same guardrails on overall pace. The technology can move as fast as it likes. The question is always whether the humans in the system can move with it.

The answer that sits consistently with everything else in this document is that deployment speed is a capability to be used deliberately, not a default to be celebrated. The ability to ship ten times a day does not mean you should. It means you have the option when the moment calls for it — a critical bug fix, a time-sensitive feature, a response to something breaking in production. For everything else, the cadence of change should be set by the user capacity to absorb it, not the builder capacity to generate it.

---

## 9. Immediate Next Steps

- Fix known issues outlined in section 2.5 of this document
- JavaScript walkthrough of the current codebase in a fresh project chat
- Set up GitHub repository and tag current version as V1.0
- Set up Google Drive connector in Claude project — folder structure: Code, Context, Coaching, Archive
- Simulate the sleep score coaching conversation using Claude Haiku — test prompt, refine scoring rules, validate tone
- Extend simulation to feed and stress scores
- Define post-session indicators
- Draft the coaching markdown files (one planned for each pre- and post- interactions with a central "core" coach markdown file
- Set up Cloudflare Workers infrastructure
- Build Phase 2 coaching feature on new infrastructure

---

## 10. Glossary

Terms used throughout this document and in development conversations:

- **State** — the current in-session data for each exercise (warmup, working and back-off set arrays). Held in memory and localStorage, cleared after saving.
- **Push** — the app sending session data to Google Sheets via Apps Script (doPost)
- **Pull** — the app fetching history from Google Sheets via Apps Script (doGet)
- **Token** — the unit of measurement for AI API usage. Roughly 0.75 words. Pricing is per million tokens.
- **Proxy** — a server that sits between the app and an external service, keeping credentials secure and never exposing them to the browser.
- **Configuration object** — a structured JSON data object that drives UI or behaviour, as opposed to generating code directly. More auditable and reliable.
- **Cloudflare Workers** — server infrastructure running code on Cloudflare servers with no cold start delays and a generous free tier.
- **Vibe coding** — building software conversationally through AI prompts rather than traditional top-down design. The origin of this codebase.
- **Commit** — a saved snapshot of code in GitHub. Every commit is permanent — nothing is lost by committing a change or deletion.
- **Context window** — the amount of conversation an AI model can hold in memory at once. Long chats can cause earlier details to drop out.
- **R Shiny** — a framework for building interactive data applications in R. The proposed technology for the practitioner desktop application.
- **MCP** — Model Context Protocol. A standard for connecting AI models to external data sources and services.

---

## 10. Conclusion

"Lift Log" began as a personal workout tracker built through conversation. By the end of the first serious design session it had become the foundation of a considered platform architecture with sound founding principles, a realistic staging plan, and a distant horizon that is genuinely interesting.

The decisions made today — the portable coaching layer, the modular design, the clean data structure, the founding principles — are compatible with both the immediate personal tool and the longer term platform vision. No doors have been closed. The architecture earns its complexity rather than inheriting it.

The next step is not to build faster. It is to understand what has already been built, use it through real sessions, and let the genuine needs of the tool surface before adding to it. The horizon takes care of itself if each next step is done well.
