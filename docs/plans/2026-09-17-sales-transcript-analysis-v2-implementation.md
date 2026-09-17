# Sales Transcript Analysis V2 — Implementation Plan

**Date:** 2026-09-17  
**Status:** Ready for implementation  
**Approved design:** `docs/plans/2026-09-17-sales-transcript-analysis-v2-design.md`  
**Business source:** `/Users/eli/Projects/marketing/albadi/strategy/00-foundation/sales-transcript-analysis.md`

## Goal

Replace the current best-effort call summary and callback extraction with one
versioned, evidence-backed analysis pipeline for both GHL recordings and
ElevenLabs calls. The pipeline must preserve the analysis even when a later GHL
write fails, create only safe tasks automatically, send uncertain actions to
human approval, and expose every new behavior in the existing GHL Hub settings.

This document is an execution plan. Product implementation has not started.

## Non-negotiable constraints

- GHL is the source of truth for operational CRM fields and tasks.
- The Albadi DB stores transcripts, analyses, candidates, evidence, decisions,
  execution metadata, and analytics.
- The canonical UI is `/widget`; `/dashboard/v3` may only reuse the same widget
  implementation and must not receive a separate feature copy.
- A manual GHL task is never automatically edited, closed, or deleted.
- WON and LOST are recommendation-only at launch.
- A task is auto-created only when action, owner, due time, direct evidence, and
  confidence pass code-level checks.
- All new side effects have independent kill switches and safe defaults.
- Retries must reuse saved analysis and must not create duplicate notes, tasks,
  or approval candidates.
- Historical calls are not reprocessed by default.

## Delivery strategy

Build the system in ten reviewable phases. Keep each phase deployable behind
shadow/off settings. Do not enable automatic production task creation until the
evaluation and approval phases have completed.

## Phase 1 — Versioned analysis contract and evidence grounding

### Files

- Add `lib/calls/analysis-v2.ts`.
- Add `lib/calls/analysis-normalize.ts`.
- Add `lib/calls/evidence.ts`.
- Update `lib/autoresponder/call-analysis.ts`.
- Update `lib/bot-settings/analysis-defaults.ts` only for human-editable
  guidance; keep the machine contract in TypeScript.
- Add `lib/calls/analysis-v2.test.ts`.
- Add `lib/calls/evidence.test.ts`.

### Work

1. Define `CallAnalysisV2` with closed enums and explicit nullable/unknown
   values for:
   - customer and trigger;
   - needs and pains;
   - specification and readiness;
   - salesperson execution;
   - objections;
   - outcome and advance;
   - proposed action;
   - status recommendation;
   - confidence and analysis metadata.
2. Define a reusable evidence object containing the short quote, normalized
   quote, optional transcript offsets, and validation state.
3. Normalize absent arrays, unexpected enum values, malformed dates, and old V1
   output defensively. Preserve old analysis JSON for display but never let an
   unvalidated V1 result trigger a V2 task.
4. Normalize transcript whitespace before quote matching. Mark evidence invalid
   when the claimed quote cannot be found; do not silently replace it with a
   model-generated paraphrase.
5. Record schema version, model, guidance revision, call start time, timezone,
   and an input hash with each analysis.
6. Update the model prompt to return the V2 structure and to use `לא ידוע` or
   null when the transcript does not state a fact.
7. Recognize voicemail and too-short conversations and return a minimal result
   that cannot produce an action.

### Tests

- A fabricated quote is rejected.
- A quote survives harmless transcript whitespace differences.
- Missing information remains unknown rather than inferred.
- Unexpected enum values are normalized safely.
- Voicemail and short calls produce no proposed action.
- A V1 stored analysis can still be read without becoming executable.
- Identical transcript input produces the same input hash.

### Exit criteria

The analyzer produces a validated V2 object without any GHL side effects, and
all validation behavior is covered by deterministic unit tests.

## Phase 2 — Deterministic task and status policy

### Files

- Add `lib/calls/action-types.ts`.
- Add `lib/calls/action-policy.ts`.
- Add `lib/calls/task-conflicts.ts`.
- Add `lib/calls/status-policy.ts`.
- Reuse `lib/clock/callback-window.ts` for Israel working-time rules.
- Add corresponding `*.test.ts` files beside each policy module.

### Work

1. Define the policy result as exactly one of `auto_create`,
   `needs_approval`, `no_action`, or `blocked`, with machine-readable reasons.
2. Define a closed set of action types and a single task-title/body mapper so
   the model cannot invent operational task categories.
3. Require all five approved gates before `auto_create`: concrete action, known
   salesperson owner, valid due time, grounded evidence, and sufficient
   confidence.
4. Convert customer commitments into salesperson follow-up tasks. For example,
   “I will send a logo tomorrow” becomes “Verify receipt of the logo tomorrow.”
5. Resolve relative dates against the call timestamp in `Asia/Jerusalem`, then
   apply the configured working calendar. Reject stale or implausibly distant
   dates.
6. Compare the proposal with open GHL tasks and the local `crm_tasks` mirror.
   Separate exact duplicates, probable duplicates, and contradictions.
7. Never modify a manual task. A newer call may supersede only an older task
   bearing this automation's source marker and only when the setting permits it.
8. Implement status recommendations separately from task decisions. LOST from
   non-response must consult cumulative CRM call and WhatsApp history; a single
   ordinary call is insufficient.

### Tests

- Full decision matrix for missing/invalid action, owner, due time, evidence,
  confidence, duplicates, contradictions, and allowed action types.
- Every missing-due-date mode: approval, configured default, and no task.
- Customer commitment conversion.
- Jerusalem time, weekends, and configured working hours.
- Exact duplicate remains idempotent; probable duplicate and contradiction go
  to approval.
- Manual task protection and automation-only supersession.
- Explicit refusal may recommend LOST; ordinary silence in one call may not.
- Three calls plus three WhatsApps can recommend LOST only from verified CRM
  history.

### Exit criteria

Given only normalized analysis, settings, and CRM history, policy output is
fully deterministic and does not call an LLM or write to GHL.

## Phase 3 — Additive persistence and migration

### Files

- Update `drizzle/schema.ts`.
- Add the next numbered SQL migration under `drizzle/migrations/`.
- Update `tests/integration/_db.ts` cleanup order.
- Add an integration test for candidate persistence and idempotency.

### Work

1. Add a `call_action_candidates` table containing at least:
   - source and source-record id;
   - lead sid and GHL contact id;
   - analysis version and input hash;
   - original proposal and human-edited proposal JSON;
   - policy decision and machine-readable reason;
   - candidate state: pending, approved, rejected, executed, failed, or
     superseded;
   - approver, decision reason, and timestamps;
   - GHL task id and execution status;
   - unique idempotency key;
   - attempts, last error, and last-attempt time.
2. Add indexes for pending-state age, lead plus state, source lookup, and unique
   idempotency.
3. Add only the minimal execution/version metadata needed to
   `call_recording_imports` and `elevenlabs_call_imports`. Prefer the candidate
   table over duplicating action state in both source tables.
4. Keep the migration additive and reversible. Do not use `drizzle-kit push`;
   apply the explicit migration only to a throwaway Neon branch during testing.

### Tests

- The same idempotency key cannot create two candidates.
- Original and edited proposals remain separately auditable.
- A failed execution retains its saved analysis and candidate.
- Integration cleanup removes candidate rows before parent lead/call rows.

### Exit criteria

The migration succeeds on a disposable database branch, rollback is documented,
and no production data migration or historical backfill has run.

## Phase 4 — Shared post-analysis pipeline

### Files

- Add `lib/calls/note-builder.ts`.
- Add `lib/calls/process-analysis.ts`.
- Add `lib/calls/candidate-repository.ts`.
- Update `app/api/bot/process-recordings/route.ts`.
- Update `app/api/elevenlabs/sync-calls/route.ts`.
- Add shared fixtures under `tests/fixtures/call-analysis/`.
- Add unit and integration tests for both route adapters.

### Work

1. Move duplicated Hebrew note formatting into one builder with selectable
   sections and version markers.
2. Add one shared service that performs, in order:
   - reuse or run analysis;
   - persist analysis;
   - build and optionally post the note;
   - evaluate action and status policy;
   - persist the candidate and decision;
   - execute only when the active mode allows it.
3. Keep source-specific discovery, recording download, transcription, enrichment,
   and attachment logic in their existing routes.
4. Remove the route-local callback-task decision. Route all callback and other
   proposed actions through the same policy.
5. Give analysis, note posting, candidate creation, and task execution separate
   statuses. A later failure must retry that step without paying for another
   model call.
6. Keep recognizing old note markers during deduplication while writing new V2
   markers for new notes.
7. Preserve existing funnel events and ensure retries do not count the same
   event twice.

### Tests

- The same fixture entering through GHL and ElevenLabs produces the same V2
  downstream decision and note sections.
- A note failure does not erase analysis or create a duplicate analysis retry.
- A task failure leaves a retryable candidate.
- Repeated route execution creates no duplicate note, candidate, task, or
  funnel event.
- Disabling notes still stores analysis and candidates.

### Exit criteria

Both call sources use the same V2 analysis, note, policy, and candidate modules;
their remaining differences are limited to source ingestion.

## Phase 5 — Settings contract, API, and dry preview

### Files

- Update `lib/bot-settings/schema.ts`.
- Update `lib/bot-settings/schema.test.ts`.
- Reuse `lib/bot-settings/store.ts`.
- Update `app/api/widget/bot-settings/route.ts` if validation or logging changes
  are required.
- Add `components/settings/CallAnalysisSettingsSection.tsx`.
- Update `components/settings/SettingsView.tsx`.
- Add `app/api/widget/call-analysis/preview/route.ts`.
- Update route-gate tests only if the new route is not recognized automatically.

### Settings shape

Add a versioned `callAnalysisV2` section with:

- master enable;
- GHL and ElevenLabs source switches;
- model and editable business guidance;
- note publishing, transcript inclusion, selected sections, and score switch;
- task mode: off, shadow, always approve, hybrid, or automatic;
- confidence threshold;
- missing due-date policy and default delay;
- working calendar;
- assignee policy: GHL owner or fixed user;
- duplicate window and automation-only supersession policy;
- allowed automatic action types and always-approval action types;
- per-status mode: off, recommend, approve, or automatic.

### Work

1. Ship safe defaults: analysis on, candidates stored, task mode shadow, and all
   statuses recommendation-only.
2. Normalize old `bot.settings` JSON without resetting existing user choices.
3. Prevent a migration from enabling automatic WON or LOST.
4. Add a dry-preview endpoint that accepts a supplied transcript and returns the
   normalized analysis, evidence validation, note preview, and policy result.
   It must never write DB rows, notes, tasks, statuses, or funnel events.
5. Protect the route with `widgetAuthed` and wrap it with
   `withRequestLog("widget", ...)`.
6. Make kill switches obvious and label which changes affect future calls only.

### Tests

- Old settings normalize to safe V2 defaults.
- Every source and side-effect switch suppresses exactly its own behavior.
- Off and shadow modes cannot write a GHL task.
- WON/LOST remain non-automatic after all migration paths.
- Preview is authenticated and has zero persistence/external-write calls.

### Exit criteria

Every new operational behavior is adjustable from GHL Hub settings without a
code change, and the preview safely explains what the system would do.

## Phase 6 — GHL task execution and approval APIs

### Files

- Add `lib/calls/task-executor.ts`.
- Add `lib/calls/candidate-service.ts`.
- Reuse the GHL assignee resolver used by existing CRM-task flows.
- Add `app/api/widget/call-actions/pending/route.ts`.
- Add `app/api/widget/call-actions/[id]/route.ts` for detail.
- Add `app/api/widget/call-actions/[id]/approve/route.ts`.
- Add `app/api/widget/call-actions/[id]/reject/route.ts`.
- Add `app/api/widget/call-actions/[id]/retry/route.ts`.
- Add unit and integration tests for authorization, transitions, and execution.

### Work

1. Resolve the GHL contact owner by default; allow a configured fixed owner.
2. Validate action type, owner, due time, evidence, current candidate state, and
   current CRM task conflicts immediately before every external write.
3. Create the GHL task first, then mirror the accepted task into `crm_tasks`.
   Store the returned GHL task id and automation marker.
4. Make approval state transitions compare-and-set so two browser clicks cannot
   execute the same candidate twice.
5. Permit edit-and-approve while retaining original proposal, edited values,
   approver, and decision reason.
6. Rejecting a candidate is permanent audit history, not deletion.
7. Retry only failed external execution; do not rerun analysis or erase a human
   edit.
8. Protect every route with `widgetAuthed` and `withRequestLog` and include it in
   architecture/route-gate coverage.

### Tests

- Concurrent approval calls produce at most one GHL task.
- Approving a stale or superseded candidate is rejected clearly.
- A newly discovered manual-task conflict blocks execution.
- Edited approval preserves both proposal versions.
- Retry reuses the same idempotency key.
- Unauthorized requests perform no reads beyond authentication and no writes.

### Exit criteria

An approved or safe automatic candidate creates exactly one GHL task and one
local mirror; every failure remains visible and retryable.

## Phase 7 — GHL Hub approvals UI

### Files

- Add `components/drafts/CallActionApprovals.tsx`.
- Update `components/drafts/DraftsWithDecisions.tsx`.
- Reuse `app/widget/drafts/page.tsx` and its shared widget shell.
- Add focused component tests where the repository's existing UI-test setup
  supports them.

### Work

1. Add `Call actions` as a filter or sub-tab inside the existing Approvals area,
   with pending and failed counts.
2. Show lead, call time, summary, proposed task, owner, due time, optional status
   recommendation, confidence, exact evidence, and any conflict warning.
3. Support approve, edit and approve, reject with reason, retry failed execution,
   open full transcript, and open the GHL contact.
4. Include loading, empty, stale-data, save-in-progress, failed, and retry states.
5. Keep edit controls explicit: action, owner, due time, and rejection reason.
6. Design and verify the GHL embedded width first, including 390 px mobile. The
   standalone dashboard gets the same component through the existing alias and
   receives no separate implementation.

### Exit criteria

Eli can resolve every uncertain call action from GHL Hub without opening code,
and the standalone route visibly matches because it renders the same component.

## Phase 8 — Observability, health, and failure alerts

### Files

- Update structured logging in both call-job routes and shared services.
- Add `lib/calls/health.ts` and tests if queue calculations are not kept in the
  approvals query service.
- Extend the approvals/settings UI with a compact health summary.
- Update the existing watchdog only if its current job/backlog model cannot
  express candidate failures.

### Work

1. Emit structured events for analysis completed/failed, each policy decision,
   candidate created, task auto-created, task approval, block reason, GHL
   execution failure, retry, and recovery.
2. Add job-summary counters for analyzed calls, invalid evidence, pending
   approvals, auto-created tasks, duplicates, blocks, and failures.
3. Show approval backlog count, oldest pending age, and failed-execution count.
4. Keep the existing heartbeat checks for `process-recordings` and `sync-calls`.
   Add a new scheduled job only if retries cannot safely occur through those
   existing jobs or explicit UI retry.
5. Alert WhatsApp only for an actually stuck queue, repeated job failure, or an
   abnormal GHL write-failure rate. Do not alert for normal pending approvals.
6. Deduplicate alerts and emit a recovery event when health returns to normal.

### Tests

- Health thresholds distinguish normal pending work from a stuck queue.
- One incident produces one alert until its state changes.
- Recovery clears the incident and is observable.
- Logs contain ids and reasons but no full transcript or sensitive credentials.

### Exit criteria

Failures are visible in GHL Hub, queryable in Axiom, and alerted through the
existing watchdog without noisy messages for normal work.

## Phase 9 — Labeled evaluation and controlled rollout

### Files

- Add anonymized fixtures under `tests/fixtures/call-analysis/`.
- Add a bounded evaluation script under `scripts/` only if the preview UI is
  insufficient for labeling.
- Add `docs/plans/2026-09-17-sales-transcript-analysis-v2-rollout.md` when the
  pilot starts, recording actual metrics and promotion decisions.

### Work

1. Deploy with task mode `shadow` and statuses recommendation-only.
2. Label at least 30 representative calls, including no-task calls, customer
   promises, vague callbacks, objections, short calls, duplicate follow-ups,
   and contradictory commitments.
3. Measure action precision and misses, owner accuracy, due-time accuracy,
   evidence validity, and proposed-status accuracy.
4. Move to `always approve` only after reviewing the labeled set and recording
   accepted thresholds in the rollout document.
5. Track approval-without-edit, edited approval, rejection, and execution-failure
   rates for several days.
6. Move to `hybrid` only for action types that show safe performance. Keep
   unknown or risky categories approval-only.
7. Evaluate status automation independently; leave WON and LOST as
   recommendations until explicitly approved in a later decision.
8. Do not run a historical backfill. If later requested, build a bounded,
   dry-run-first tool with an explicit date range and per-call audit output.

### Exit criteria

Promotion from shadow is based on recorded pilot results rather than intuition,
and settings can immediately return the system to shadow/off.

## Phase 10 — Verification, deployment, and rollback

### Verification order

1. Run focused unit tests while implementing each phase.
2. Run `npm test`.
3. Run `npm run typecheck`.
4. Run route wrapper and route-gate tests explicitly.
5. Apply the migration and run `npm run test:integration` only on a throwaway
   Neon branch; delete that branch after verification.
6. Run `npm run build`.
7. Start the local production build and smoke-test the GHL widget first, then
   the standalone alias, at desktop and 390 px widths.
8. Verify every kill switch and mode using the dry preview and stubbed external
   writes.
9. Deploy the reviewed commit to production, wait for Vercel ready state, then
   smoke-test through the existing authenticated Chrome/GHL context.
10. Observe the first live shadow runs in Axiom and verify the existing cron
    watchdog remains healthy.

### Rollback

- Immediate behavioral rollback: disable the master switch or set task mode to
  shadow/off in settings.
- External-write rollback: disable notes, tasks, or individual sources without
  disabling stored analysis.
- Code rollback: revert the deployment commit. The schema is additive, so old
  code can ignore the new table and columns.
- Do not drop candidate/audit data during rollback.

## Final acceptance checklist

- [ ] GHL and ElevenLabs share one V2 downstream pipeline.
- [ ] Every material conclusion has validated evidence or is explicitly unknown.
- [ ] No automatic task is possible without all five approved gates.
- [ ] Customer promises become salesperson follow-up tasks.
- [ ] Manual GHL tasks are never overwritten or deleted.
- [ ] Duplicate retries create no duplicate note, candidate, task, or event.
- [ ] Ambiguous and conflicting actions appear in GHL Hub Approvals.
- [ ] An approved task exists in GHL before it is considered executed locally.
- [ ] WON and LOST remain recommendation-only.
- [ ] Every new side effect and source can be disabled in settings.
- [ ] Analysis survives note/task failures and retries without another model call.
- [ ] Backlog age and execution failures are visible and alert only when abnormal.
- [ ] The GHL widget and standalone alias render the same implementation.
- [ ] Unit, type, route-gate, integration, build, desktop, and mobile checks pass.
- [ ] Shadow evaluation includes at least 30 labeled calls before hybrid mode.

## Suggested commit sequence

1. `Add call analysis V2 contract and evidence validation`
2. `Add deterministic call action and status policies`
3. `Persist call action candidates and audit state`
4. `Unify GHL and ElevenLabs post-analysis processing`
5. `Add call analysis settings and dry preview`
6. `Add idempotent GHL task execution and approval APIs`
7. `Add call action approvals to GHL Hub`
8. `Add call analysis health metrics and alerts`
9. `Document pilot evaluation and production rollout`

Each commit should include its tests and must exclude unrelated working-tree
changes.
