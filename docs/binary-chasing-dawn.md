# binary-chasing-dawn — Bot Supervisor Phase 1

Branch: `binary-chasing-dawn`
Plan: `~/.claude/plans/binary-chasing-dawn.md`

## Goal

LLM supervisor gate on every inbound + decision log + Eli feedback capture + Langfuse observability.

## Architecture

```
WhatsApp → bridge webhook
  → store message + upsert lead
  → stop-word check (early exit if matched)
  → auto-unpause (log this)
  → build context (stage, qState, last 20 msgs)
  → precomputeCandidateAction()  ← dry-run existing handler, no send
  → langfuse.trace() opens
  → supervisor LLM call (JSON output): approve_code | override_with_text | escalate_to_eli | silence
  → execute verdict
       approve_code      → existing handler runs for real
       override_with_text → send LLM text + apply candidate's stage transition
       escalate_to_eli   → generateAndQueueDraft + sendEliDM
       silence           → log only
  → write bot_decision_log row with langfuse_trace_id
  → langfuse.score() when Eli acts later (approve/edit/reject/manual reply/stage override)
```

## Files

**New:**
- `lib/supervisor/supervise.ts`
- `lib/supervisor/candidate.ts`
- `lib/supervisor/log.ts`
- `lib/supervisor/langfuse.ts` (client init)
- `app/api/leads/[sid]/decisions/route.ts`
- `app/dashboard/v3/_components/lead/BotDecisionsTab.tsx`
- `scripts/_test-supervisor.ts`

**Modify:**
- `drizzle/schema.ts` (append `botDecisionLog`)
- `app/api/bridge/webhook/route.ts` (route through supervisor)
- `lib/drafts/index.ts` (approveDraft/rejectDraft → attachEliFeedback + langfuse.score)
- `app/actions/v2.ts` (sendManualReply / setLeadStage / setBotPaused → attachEliFeedback)

## ENV vars

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL` (default cloud)
- `SUPERVISOR_MODEL` (default `claude-sonnet-4-6`)
- Optional kill switch: `SUPERVISOR_BYPASS=1` → skip supervisor, run existing flow (for emergencies)

## Decision log columns

```
id, created_at, manychat_sub_id, message_id,
inbound_text, stage_before, stage_after,
langfuse_trace_id,
decided_by, action, reply_text, draft_id, escalation_kind, metadata,
eli_action, eli_edit_text, eli_reject_reason, eli_manual_reply,
eli_stage_from, eli_stage_to, eli_decided_at
```

## Verification (final)

1. `npx drizzle-kit push` creates table
2. `npx tsx scripts/_test-supervisor.ts` — all path assertions pass
3. Test JID end-to-end on prod with 4 cases (accept / haggle with competitor / silent-stage inbound / supervisor down)
4. Dashboard tab visible with 3-lane timeline

## Progress

- [x] Branch + tracking doc
- [x] Schema + migration (`scripts/_create-bot-decision-log.ts`)
- [x] log.ts (logDecision, attachEliFeedback)
- [x] candidate.ts (lightweight predictor — no full handler dry-run; uses classifyIntent + stage/qState mapping)
- [ ] langfuse.ts — DEFERRED to follow-up; `langfuse_trace_id` column ready in schema
- [x] supervise.ts (OpenAI gpt-4o-mini via fetch, JSON output, SUPERVISOR_BYPASS=1 escape hatch)
- [x] webhook refactor (stop-word + unpause + supervisor + 4 verdicts)
- [x] Eli feedback hooks: drafts approve/reject, sendManualReply, setLeadStage, setBotPaused, direct WhatsApp
- [x] API endpoint `/api/leads/[sid]/decisions` + server action `loadBotDecisionsAction`
- [x] BotDecisionsTab UI (3 lanes: LLM / Code / Eli)
- [x] Smoke test (`scripts/_test-supervisor.ts`) — all pass

## ENV needed for production

```
OPENAI_API_KEY=<existing>      # reused — same key powers classifyIntent + supervisor
SUPERVISOR_MODEL=gpt-4o-mini   # optional override (default gpt-4o-mini)
SUPERVISOR_BYPASS=              # emergency kill switch; set to "1" to skip supervisor and run legacy flow
```

Langfuse env vars (deferred): `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`.

## Manual verification on prod after deploy

1. Message the test JID with "אקבל" at AWAITING_ESTIMATE → expect supervisor → approve_code → handler transitions to AWAITING_LOGO → row logged with `decided_by='code'`, `action='stage_transition'`.
2. Message with "יקר לי, יש לי הצעה ב-1500" → expect `llm_recommended='escalate_to_eli'`, draft queued, DM received, no auto-send.
3. At WAITING_FACTORY: message with "מה קורה?" → expect supervisor → escalate_to_eli or override → draft / DM. Critically, no silent ghost.
4. Set `OPENAI_API_KEY=invalid` → next inbound logs `decided_by='supervisor_error'`, DM sent, no customer reply. Restore key.
5. Open `/dashboard/v3/leads/<sid>` → "החלטות בוט" tab → see the 3-lane timeline.
6. Approve a draft with edits in `/dashboard/v3/drafts` → return to the lead's decisions tab → see `eli_action='edited_draft'` on the relevant row.
