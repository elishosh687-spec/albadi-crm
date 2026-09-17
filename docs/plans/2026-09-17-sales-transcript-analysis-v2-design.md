# Sales Transcript Analysis V2 — Design

**Date:** 2026-09-17  
**Status:** Approved  
**Source requirement:** `/Users/eli/Projects/marketing/albadi/strategy/00-foundation/sales-transcript-analysis.md`

## Goal

Upgrade Albadi's existing call-analysis pipeline so every completed sales call
produces a reliable, evidence-backed CRM summary and the correct next action,
without requiring the salesperson to type the call into GHL.

The system must reduce two current failure modes:

1. a real commitment in the call is missed and no task is created;
2. an ambiguous statement is converted into the wrong task.

Every operational behavior introduced by this project must be configurable in
the existing GHL Hub settings. Routine tuning must not require code changes.

## Scope

This project covers:

- GHL call recordings and ElevenLabs phone-agent calls;
- structured transcript analysis;
- evidence grounding and normalization;
- GHL notes;
- proposed and automatically created CRM tasks;
- recommended pipeline stages;
- salesperson execution scoring;
- approvals UI, settings, observability, retries, and tests.

Moving every existing CRM feature into settings is a separate project. This
project establishes the configuration pattern that future work can reuse.

## Existing System

The current system already provides most of the ingestion infrastructure:

- GHL calls are discovered, transcribed, analyzed, stored, and posted as notes
  by `app/api/bot/process-recordings/route.ts`;
- ElevenLabs calls are discovered, enriched, analyzed, stored, and posted by
  `app/api/elevenlabs/sync-calls/route.ts`;
- both use `analyzeCall` in `lib/autoresponder/call-analysis.ts`;
- the current JSON covers a short summary, needs, objections, price, next
  steps, sentiment, signals, urgency, red flags, and callback time;
- a GHL callback task is created only when `callback_at` is extracted;
- the two pipelines duplicate their GHL-note formatting;
- callback task policy lives inside the GHL-recording route rather than in a
  reusable decision layer.

The missing layer is a complete sales-analysis contract and a deterministic
policy that decides what the extracted facts are allowed to do in GHL.

## Approved Operating Model

The approved model is hybrid automation:

- analysis and persistence happen automatically;
- a task is created automatically only when action, owner, due time, evidence,
  and confidence pass deterministic checks;
- ambiguous actions become approval candidates;
- the user can approve, edit and approve, or reject a candidate;
- WON and LOST remain recommendation-only by default;
- GHL remains the source of truth for tasks and operational CRM fields;
- Albadi DB owns analyses, action candidates, evidence, decisions, and audit
  history.

## Architecture

```text
Call source
  -> existing discovery/transcription pipeline
  -> shared CallAnalysisV2 analyzer
  -> normalization and evidence grounding
  -> persist analysis
  -> shared GHL note builder
  -> deterministic action policy
       -> auto-create task in GHL
       -> queue candidate for approval
       -> no action
       -> block with a recorded reason
  -> optional stage recommendation
```

GHL and ElevenLabs keep their source-specific ingestion stages, but everything
from analysis onward uses shared modules.

Analysis, note posting, action evaluation, approval, and GHL task execution
have independent statuses. A GHL failure must not discard a paid analysis or
force another LLM call.

## CallAnalysisV2 Contract

The V2 contract stores the following groups.

### Customer and trigger

- why the customer is checking bags now;
- what the business sells and what goes into the bag;
- whether an existing bag exists and what is wrong with it;
- prior supplier experience and what failed;
- required date, event, or campaign.

### Needs and pains

- every identified need;
- desired outcome;
- what the customer does not want to get wrong;
- priority order: appearance, strength, size, price, deadline, or other;
- a short transcript quote for every material need.

### Specification and readiness

- quantity, size, colors, and every discussed specification field;
- whether the specification was approved and what is missing;
- whether a logo exists and whether it was sent;
- whether price or a quote was presented;
- whether the lead fits the 3,000-unit minimum;
- decision maker and other participants.

### Salesperson execution

- asked why now;
- explored several needs rather than only specification;
- asked a follow-up before presenting a solution;
- summarized the understood needs and received confirmation;
- tailored the recommendation;
- asked what still blocks the customer;
- asked for payment when specification and price fit;
- agreed on action, owner, and due time;
- learning-only score out of 10 using the approved rubric.

### Objections

Each objection stores:

- type and customer wording;
- verbatim supporting quote;
- whether the representative clarified and isolated it;
- how it was handled;
- resolution state: resolved, open, or unclear;
- resulting next step.

### Outcome and advance

- call outcome;
- the concrete advance achieved;
- next action;
- responsible party;
- precise due time;
- recommended CRM status;
- evidence and confidence.

Unknown information is represented explicitly. The model must not infer a fact
that was not said.

## Evidence and Validation

The LLM extracts candidate facts. Code determines whether they are valid.

- Every material conclusion may carry a quote and transcript span.
- A quote that is not present in the normalized transcript is rejected.
- Enum values are normalized against closed lists.
- Missing arrays and optional values are safely normalized.
- Relative dates are anchored to the call start and resolved in
  `Asia/Jerusalem`.
- Invalid, stale, or implausibly distant dates are rejected.
- Short calls and voicemail produce a minimal result and no task.
- The analysis records schema version, model, guidance revision, and input
  hash.

The editable settings control business guidance, not the machine schema.

## Task Decision Policy

The task policy is deterministic and returns one of:

- `auto_create`;
- `needs_approval`;
- `no_action`;
- `blocked`.

A task can be automatically created only when:

1. the action is concrete;
2. the responsible party is clear;
3. the due time is explicit or may be generated under the configured missing-
   due-date policy;
4. supporting evidence exists in the transcript;
5. confidence meets the configured threshold;
6. no open GHL task is a duplicate or contradiction;
7. the action type is allowed for automatic execution.

A customer commitment is translated into a salesperson follow-up. For example,
`I will send the logo tomorrow` becomes `Verify that the logo was received`,
not `Send the logo`.

Manual GHL tasks are never automatically deleted or overwritten. A newer call
may supersede only an older task created by this automation, and only under the
configured replacement policy. Contradictions go to approval.

Every created task carries a source marker derived from call identity and action
type, providing idempotency across retries.

## Status Policy

- Negotiation may be recommended when the call actively discusses price,
  specification, or terms.
- Future follow-up requires an actual future request or a valid ongoing
  no-response sequence.
- A single call never marks a lead lost unless it contains an explicit refusal,
  another-supplier decision, or stop request.
- The cumulative three-call and three-WhatsApp no-response rule is evaluated
  from CRM history, not inferred from one transcript.
- WON and LOST default to recommendation-only.
- Every recommendation includes a reason and evidence.

Each group can be configured as off, recommendation-only, approval-required,
or automatic where safety rules allow it.

## Data Ownership and Persistence

The existing call rows continue to store the raw transcript and analysis. V2
adds versioned execution metadata and a dedicated action-candidate record.

An action candidate stores:

- call source and source record id;
- lead sid and GHL contact id;
- analysis version and input hash;
- proposed action, owner, due date, status recommendation, evidence, confidence;
- decision result and reason;
- original proposal and human-edited values;
- approver and timestamps;
- GHL task id and execution status;
- idempotency key, retry count, and last error.

Candidate states are `pending`, `approved`, `rejected`, `executed`, `failed`,
and `superseded`.

## Settings

The existing settings tab gains a section named `Call analysis and tasks`.

### General

- master enable switch;
- GHL-source switch;
- ElevenLabs-source switch;
- analysis model;
- editable analysis guidance;
- dry test against a supplied transcript.

### Notes and summaries

- publish GHL note;
- include full transcript;
- select note sections;
- enable salesperson score;
- permit reanalysis without automatic reposting.

### Tasks

- mode: off, always approve, hybrid, automatic;
- confidence threshold;
- missing due-date behavior: approval, configured default, or no task;
- default delay and working calendar;
- assignee policy: GHL lead owner or fixed user;
- duplicate window;
- automatic supersession policy;
- allowed automatic action types;
- action types that always require approval.

### Statuses

- independent mode per status group: off, recommend, approve, automatic;
- WON and LOST cannot silently become automatic through a default migration.

Defaults ship safely: analysis on, candidates stored, task execution in shadow
mode, and status changes recommendation-only.

## Approvals UI

The canonical GHL Hub `Approvals` tab gains a `Call actions` filter or sub-tab.
The standalone site receives the same UI from the shared widget code.

Each card shows:

- lead and call time;
- short summary;
- proposed task;
- owner and due time;
- optional status recommendation;
- confidence;
- exact transcript evidence;
- duplicate or contradiction warning.

Actions are approve, edit and approve, reject with reason, open full call, and
open the GHL contact. Execution is considered successful only after GHL accepts
the task; failed execution remains retryable.

## Rollout

1. **Shadow:** analyze and persist every eligible call, create candidates, and
   write no task or status.
2. **Evaluation:** manually label at least 30 representative calls and measure
   detected actions, misses, false actions, owner accuracy, and due-date
   accuracy.
3. **Always approve:** execute only after human approval for several days.
4. **Hybrid:** automatically execute only proposals passing every strict rule;
   queue all others.
5. **Statuses:** keep recommendation-only until evaluated separately.

Historical calls are not automatically reanalyzed. A bounded, explicit
backfill can be added after the live path is validated.

## Testing

- unit tests for V2 normalization and evidence grounding;
- policy matrix tests for all four decisions;
- relative-date and Jerusalem work-window tests;
- customer-commitment-to-follow-up tests;
- duplicate, contradiction, supersession, and manual-task protection tests;
- retry/idempotency tests;
- shared fixtures proving GHL and ElevenLabs produce the same downstream
  result;
- integration tests on a throwaway Neon branch with GHL stubbed;
- route-gate coverage for every new endpoint;
- widget-first desktop and 390px mobile smoke tests;
- standalone alias smoke test;
- tests proving every settings switch actually disables its behavior.

LLM quality is evaluated with a labeled transcript set rather than brittle
unit assertions against live model prose.

## Observability

The existing call jobs remain under the job watchdog. Structured logs add:

- analysis V2 successes and failures;
- candidates created by decision type;
- automatic tasks created;
- approval backlog size and age;
- GHL execution failures and retries;
- duplicate and contradiction blocks.

WhatsApp alerts fire for system failure, a stuck queue, or an abnormal GHL
write failure rate, not for ordinary approval candidates.

Pilot quality metrics are approval-without-edit rate, edited approval rate,
rejection rate, false-action rate, missed-action rate, owner accuracy, and
due-date accuracy.

## Error Handling

- analysis persistence precedes external writes;
- each side effect has its own status and retry path;
- an existing analysis is reused on retry;
- external failures are logged with call, lead, and candidate identifiers;
- repeated failures become visible in approvals/health UI and the watchdog;
- no failure silently falls back to a guessed task.

## Non-goals

- replacing GHL as the operational CRM;
- automatically editing manual tasks;
- automatic WON/LOST on launch;
- moving every existing product feature into settings;
- using salesperson score for compensation or punishment during the pilot.
