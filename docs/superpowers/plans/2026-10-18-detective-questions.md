# Detective Questions and Two Verdicts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Replace the shared daily investigation choice with one question per day and two independent verdicts per case, with two distinct starting answers from all nine clue categories.

**Architecture:** New live/practice cases explicitly opt into `detectiveVersion: 2`; existing serialized cases without that flag retain their previous rules. A shared projected-information filter governs questions and verdicts in both the UI and server. Keep rulesVersion 4, flowVersion 2, seven days, existing identities and end conditions.

**Tech Stack:** Existing dependency-free CommonJS/UMD engine, Korean responsive JavaScript UI, authenticated server API, GitHub and Vercel.

**Spec:** User instructions and clarification on 2026-10-18: one question per round, two verdicts for the whole game, two nonduplicate initial answers across all categories; suspect stays in the anonymous target list and answers memory unknown.

## Global Constraints

- No SEARCH ability in new cases. Original public reference cards and already-recorded evidence stay readable.
- QUESTION or explicit question skip completes the daily question; AUDIT does not consume or finish the question opportunity.
- AUDIT allowed for the detective during investigate/discussion, using a shared case budget of two; not while another player's answer is pending.
- Suspect answers are always null (memory unknown), without spending criminal refusal or making any public suspect-role assertion. All non-detective names remain eligible.
- Initial clues are two distinct categories from all nine; preserve the true case and at least two distinct possible culprit characters after the detective's initial knowledge and own innocence.
- Reject already audited statements and any claim whose truth/falsity is already determined by permitted information. Reject malformed/duplicate mutations without spending budget.
- Preserve existing saves and account/room access, role privacy, seven-day final accusation and replay.

## Review Focus

1. A past statement audited before today's question must leave the question available and preserve seal resolution timing.
2. Two different speakers repeating the same proved claim must not spend another verdict.
3. A false multi-value claim excludes only that value; other unresolved claims remain verifiable.
4. New clue pairs including tool/time must generate valid routes without immediate automatic identification or leakage.
5. Legacy serialized rooms and every practice role must finish seven days without illegal bot moves or deadlock.

### Task 1: Rule engine and projection

**Files:** lib/seven-engine.cjs; tests/seven-detective-v2.test.cjs.
**Interfaces:** explicit makeGame(..., {detectiveVersion:2}); public/private `detectiveVersion`; `Actions.auditAllowed(view, statementId)` consumes only projected knowledge.

- [x] Add/run failing tests for clue pairs, two verdicts, question independence, removed SEARCH, suspect memory unknown, no second daily question and legacy compatibility.
- [x] Implement the versioned contract and coherent protected routes.
- [x] Run scoped engine tests and seed checks.

### Task 2: Shared filters and online activation

**Files:** public/seven-actions.js; lib/game-service.cjs; tests/seven-actions.test.cjs; new service contract tests.
**Interfaces:** `options(view).audits` returns eligible statements; `auditAllowed(view,id)` validates duplicate/known truth claims; new service starts opt into version 2 while explicit legacy fixtures remain supported.

- [x] Add/run failing tests for same-claim duplicates, initial clues, inferred known truth, unknown/malformed claims and multi-value exclusions.
- [x] Implement projected filters and activate new online starts.
- [x] Run filter/service tests, checking replayed request idempotency.

### Task 3: Korean UI, practice and rules

**Files:** public/seven-app.js/css; public/seven-practice.js; public/party-rules.html; docs/ONLINE-RULES.md; README.md; relevant UI/practice tests.
**Interfaces:** detectiveVersion 2 selects question + independent verdict UI; `Actions.options(g).audits` and `auditAllowed` are shared with server.

- [x] Update new-case controls, remaining verdict labels, private starting answers and memory-unknown response text. Preserve legacy controls.
- [x] Make bots/practice opt into and obey the new contract; no SEARCH in new cases.
- [x] Update current rules and run UI/practice tests.

### Task 4: Review and authorized release

- [x] Review changed rules, privacy, filtering and bot completion independently; fix findings.
- [ ] Build and run full automated tests plus security/auth checks and actual local/live API and mobile browser flows.
- [ ] Commit tested source, publish to GitHub main, verify matching Vercel production deployment and actual live behavior.
- [ ] Provide a current source ZIP, Korean verification notes and balance opinion under outputs.

## Execution ledger

- Confirmed clean checkout main equals origin/main at start; user explicitly requested immediate update, commit and deployment.
- Ruling: use a separate detectiveVersion flag and opt in new runtime starts, preserving all prior serialized rooms.
- Ruling: suspect remains an anonymous question target with memory-unknown formal response, per explicit user clarification.

- Task 1-3 complete: engine, projected filters, service activation, UI/practice and rules verified.
- Final full suite: 284/284; security 20; auth races 5; local real HTTP 660 requests.
- Review P2 corrected: an independently audited current statement renders its real verdict even if the preserved review flag is stale.
- Mobile adjustment: question/verdict tabs fit 390x844 and 360x640 with 44px actions; long reference lists use internal reading areas.

- Manual projected policy: 500 complete cases, 40,930 actions, 40,430 truth checks, no illegal actions/deadlocks or unique-at-start cases. Two-seat reference-policy detective wins 98/100; not a human win rate.
