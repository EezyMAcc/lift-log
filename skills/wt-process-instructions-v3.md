# Code Walkthrough — Process Instructions

*How to initiate and run each walkthrough stage correctly.*

---

## Purpose

This document defines the process for running a structured code walkthrough across multiple sessions. It governs how each session is initiated, how prior decisions are carried forward, and how notes are written. It is intended to be portable across projects and data architectures.

---

## Before Any Analysis Begins — Required Reading

At the start of every walkthrough session, the following must be read in full before any analysis is produced:

1. **The project reference document** — contains the design philosophy, known issues, architecture decisions, and any confirmed constraints. Every proposed change should be consistent with the principles established here.

2. **The walkthrough notes document** — the living record of confirmed changes, design decisions, and pending flags for every completed part. This is the primary source of truth for what has already been decided. Read every completed part before beginning the current one.

3. **The source code for the current part** — read the specific lines carefully before writing anything.

No analysis or change proposals for the current part should be written until all three sources have been read.

---

## Session Structure

### Step 1 — Prior-stages summary

Before any analysis of the current part, produce a consolidated prior-stages summary at the top of the current part's notes. This is a single list covering every confirmed change and design decision from all previous parts that is relevant to understanding the current part.

This summary must be written **before** the code analysis begins, so it is visible in one place and confirms that the full context has been absorbed. It is not a repeat of the full notes — it is a distilled list of what matters for the current part.

Where a decision from an earlier part affects a function in the current part, name the part and the specific decision explicitly. Do not treat earlier decisions as background knowledge — make them visible in the text.

### Step 2 — Code analysis

Walk through the code for the current part, function by function, in line order. For each function:

- State the line numbers covered
- State whether changes are required or not
- If changes are required, explain what changes and why — tracing back to the source decision where relevant
- If no changes are required, say so briefly and explain why the function is stable

### Step 3 — Change summary table

At the end of each part, produce a change summary table with columns: **Line(s) | Current | After migration | Origin**. This is the canonical record of what changes in this part and why.

---

## Note-Writing Style

Notes should be **change-focused, not explanatory**. The purpose is to record what changes and why at the line level — not to explain how the code works for the first time.

Where code is not changing, a brief note confirming stability is sufficient. Extended explanation of unchanged code is only warranted when the logic is architecturally significant and understanding it is required to reason about a dependent change.

**Correct note style:**
> Line 562 — `saveToHistory()` call — REMOVE. Writes to a key that is being removed from the architecture. The server POST becomes the single write path.

**Incorrect note style:**
> `saveToHistory()` is called on line 562. It takes the current state and serialises it into a history entry, then reads the existing history from the local store, pushes the new entry onto the array, and writes it back. This is how history was accumulated before the migration...

Notes are written for someone who already understands the code and wants to know what is changing and why.

---

## Design Philosophy — What This Governs

Every proposed change must be consistent with the principles established in the project reference document. The most relevant constraints for any walkthrough are:

**Understand before applying.** Changes are explained at the line level before being applied. The builder maintains a working mental model of the codebase. Skipping explanation to reach working output is a failure mode — not a shortcut.

**Complexity must earn its place.** No new pattern or abstraction is introduced unless there is a demonstrated need for it. If a simpler approach works, it is preferred.

**Sequencing matters.** Infrastructure before code changes. Prerequisites before dependent features. The walkthrough identifies the correct sequence and flags dependencies explicitly.

---

## Handling Propagating Changes

Some changes introduced in one part propagate structurally through multiple functions across multiple subsequent parts — for example, a synchronous function becoming asynchronous, or a data source changing shape. When a function in the current part is affected by a propagating change:

- State which upstream function introduced the requirement
- Name the part in which that decision was made
- Show the specific change required
- Note any further propagation downstream

Do not treat propagating changes as a side note. They are structural changes that touch every function in the call chain and must be tracked explicitly through each part. Where a propagating change was flagged in an earlier part but could not be fully specified at the time, confirm and resolve it when the relevant function is reached.

---

## Accumulating Architectural Outputs

As the walkthrough progresses, architectural decisions accumulate into outputs that are larger than any single part — for example, a complete API surface specification, a data schema, or a list of deprecated dependencies. These should be maintained as a running list in the general notes section of the walkthrough document, with each entry attributed to the part in which it was identified.

The goal is that completing the walkthrough produces not just a set of code changes but a complete specification of the new architecture, assembled incrementally.

---

## Updating the Walkthrough Notes Document

The walkthrough notes document is the living record of the project and must be kept up to date at the end of each stage. However, the notes must never be prepared or output until the user has explicitly confirmed that they have reviewed the stage in full.

### Mandatory confirmation before notes are prepared

After the walkthrough analysis for a stage is complete — including the prior-stages summary, the function-by-function analysis, and the change summary table — the process stops. The notes document is not updated until the user confirms they have reviewed the proposed changes and design decisions for that stage.

The confirmation must be explicit. Phrases such as "yes, go ahead", "confirmed", or "update the notes" are sufficient. The following are not sufficient and must not be treated as confirmation:

- The user asking a follow-up question about the analysis
- The user requesting clarification on a specific point
- The user moving on to discuss the next stage
- Any ambiguous acknowledgement that does not clearly signal full review and approval

If there is any doubt about whether the user has confirmed, ask before proceeding.

### What the notes update covers

When the user confirms, update the walkthrough notes document to add the completed part's notes in full, including:

1. The prior-stages summary
2. The function-by-function analysis
3. The change summary table
4. Any propagating changes and their downstream effects
5. Any new architectural outputs added to the accumulating list
6. Any explicit instructions or decisions given by the user during the chat for the current stage — these must be captured in the notes verbatim in intent, not paraphrased or omitted. If the user specified a particular approach, flagged something to include in future stages, or gave an instruction that affects the architecture or process, it belongs in the notes. Review the full conversation for the current stage before writing the notes to ensure nothing is missed.

When updating the document, read the current file first, make targeted edits to only the current part's section, and preserve all other parts exactly. Do not rewrite or reformat sections that have not changed.

The updated document is then presented to the user for review before the session continues.

---

## What a Completed Stage Looks Like

A stage is complete when:

1. The prior-stages summary has been written and is visible at the top of the current part's notes
2. Every function in the current part has been covered with a clear change/no-change determination
3. The change summary table is complete and accurate
4. Any propagating changes have been tracked and their downstream effects noted
5. Any new architectural outputs (API endpoints, schema changes, deprecated keys, etc.) have been added to the accumulating list in the general notes
6. The user has explicitly confirmed they have reviewed the stage in full
7. The walkthrough notes document has been updated and presented to the user
