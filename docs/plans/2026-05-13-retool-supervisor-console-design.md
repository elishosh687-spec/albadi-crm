# Bot Supervisor Console (Retool) — Design

**Date:** 2026-05-13
**Status:** Approved (brainstorming complete, ready for implementation plan)

## Context

Current state:
- Custom Next.js dashboard at `/dashboard/v2` works but feels "not built well" — overwhelming, hard to know what is urgent.
- Bot classifies leads hourly (cron) → writes `pipelineStage`, `nextAction`, `botSummary`, `notes` to Neon DB.
- whatsapp-bridge-node sends/receives WhatsApp via the connected business number; Eli also replies manually from WhatsApp Business app.
- Chatwoot installed but standalone — not connected and not needed (solo operator, no agents to assign to).

Goal: a fast, mobile-friendly bot supervisor console that lets Eli (a) approve money-related drafts before they go out, (b) audit autonomous bot decisions, (c) see today's pulse, (d) override anything when needed. Build the UI in **Retool**, keep all business logic in the existing Next.js backend.

## Workflow the dashboard must serve

```
Lead message in ──► Bridge webhook ──► messages table
                                          │
                                          ▼
                                 Bot cron classifies
                                          │
                  ┌───────────────────────┴────────────────────┐
                  │ money_moment?                              │
                  ▼                                            ▼
        NO  →  bot sends auto                       YES  →  bot generates draft,
               via bridge                                    stores in bot_drafts (pending)
                                                              │
                                                              ▼
                                                  Retool "Approval queue"
                                                  Eli approves / edits / rejects
                                                              │
                                              approve ──► /api/drafts/:id/approve
                                                          → bridge send → status=sent
```

**money_moment detection (hybrid):**
- Layer A — stage gate: `pipelineStage IN ('QUOTED','NEGOTIATING','AWAITING_FINAL','WAITING_CALL')`
- Layer B — LLM flag: classifier returns `is_money_moment: boolean` + `money_reason`
- Pause for approval if EITHER fires.

## Architecture

```
[Retool] (UI only — desktop + Retool Mobile app)
    │
    │ REST (BOT_SECRET bearer)
    ▼
[Next.js @ albadi-crm.vercel.app] (existing — business logic, sole source of truth)
    ├── /api/bot/cron               (upgraded: emits drafts instead of auto-send for $ moments)
    ├── /api/drafts/pending         (NEW: queue feed)
    ├── /api/drafts/:id/approve     (NEW: send via bridge + mark sent)
    ├── /api/drafts/:id/reject      (NEW: mark rejected)
    ├── /api/leads/:id/override     (NEW: stage/flags/notes manual override)
    ├── /api/bridge/webhook         (existing)
    └── /api/bot/new-lead           (existing)
        │
        ▼
[Neon Postgres] + [whatsapp-bridge] + [LLM provider]
```

**Decision:** Retool talks only to Next.js (Approach B). Business logic stays in git-versioned code; Retool is pure presentation. No direct Retool→bridge or Retool→LLM connections.

## Data model changes

### New table: `bot_drafts`

```ts
bot_drafts (
  id              uuid PK,
  lead_id         text NOT NULL REFERENCES leads(manychat_sub_id),
  draft_text      text NOT NULL,
  edited_text     text,                 -- set if Eli edited before approving
  status          text NOT NULL,        -- 'pending' | 'approved' | 'rejected' | 'sent' | 'failed'
  money_reason    text,                 -- 'discount_request' | 'price_question' | 'negotiation' | 'commitment' | null
  llm_confidence  real,                 -- 0..1
  generated_at    timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  sent_at         timestamptz,
  sent_wa_message_id text,
  reject_reason   text
)
CREATE INDEX bot_drafts_status_idx ON bot_drafts(status, generated_at DESC);
```

### Schema fix: sender attribution on `messages`

Add `sender` column to distinguish bot vs Eli (currently both = `direction='out'`):

```ts
messages.sender: 'lead' | 'bot' | 'eli'  -- NOT NULL with default
```

- Lead inbound = `'lead'`
- Bot autonomous send = `'bot'`
- Approved draft send = `'bot'` (it's bot-authored even if Eli approved)
- Eli replied directly from WA Business = `'eli'` (heuristic: bridge `message.sent` event with no matching API call within ±5s = eli)

## Retool screens

| Screen | Purpose | Mobile? |
|---|---|---|
| **Home** | 3 sections stacked: (a) ⚠️ Pending approvals count + top 3 drafts inline. (b) 📊 Today's pulse — sent autos, new leads, money in approval, money-stage count. (c) 📋 Mini pipeline by stage. | yes |
| **Approval queue** | Full queue. Per-item: lead info card + last 5 messages thread + editable draft textarea + Approve / Edit & Approve / Reject buttons + keyboard shortcuts (j/k navigate, Enter approve, e edit, x reject). | yes (swipe-to-approve/reject) |
| **Pipeline** | Kanban (one column per pipelineStage) + Table view toggle. Drag-and-drop moves stage (calls `/api/leads/:id/override`). Click → Lead detail. | partial |
| **Lead detail** | Conversation thread with sender markers (Lead / Bot / Eli colors) + override panel (stage, flags, notes, bot pause toggle) + bot decision history. | yes |
| **Analytics** | Today / week / month: leads in, conversions per stage, $quoted total, avg time-in-stage, bot accuracy (approved vs rejected ratio). | yes |

**Push notifications:** Retool Mobile → trigger on new pending draft. Tap notification → opens Approval queue at that draft.

## Implementation phases (1 week)

### Phase 1 — Backend foundation (days 1–2)
- Drizzle migration: `bot_drafts` table + `messages.sender` column.
- Backfill `messages.sender` heuristic (existing rows → `'lead'` if direction=in, `'bot'` if direction=out).
- `lib/drafts/` module: createDraft, getPending, approveDraft (calls bridge send), rejectDraft.
- New API routes: `/api/drafts/pending`, `/api/drafts/:id/approve`, `/api/drafts/:id/reject`, `/api/leads/:id/override`.
- All routes guarded by `BOT_SECRET` bearer (same as existing).

### Phase 2 — Classifier upgrade (days 2–3)
- Update bot prompt to emit `is_money_moment` + `money_reason` + `draft_reply` (when money).
- `/api/bot/cron` logic:
  - If money_moment (stage OR LLM) → create draft in `bot_drafts`, do NOT send.
  - Else → send autonomously via bridge as today.
- Backfill `messages.sender='bot'` when sending.
- Bridge webhook: tag `message.sent` with `sender='eli'` if no matching draft within window (manual reply heuristic).

### Phase 3 — Retool build (days 4–6)
- Create Retool app. Configure resources: Postgres (Neon) read-only for analytics + REST (Next.js) for actions.
- Build Home → Approval Queue → Lead Detail → Pipeline → Analytics screens.
- Set up Retool Mobile companion app with push notifications.
- RTL CSS tweaks.

### Phase 4 — Cutover (day 7)
- Test side-by-side: old `/dashboard/v2` and new Retool app on the same DB.
- Run for a day in parallel.
- Once stable, redirect dashboard route or simply use Retool URL.
- Old dashboard code stays in repo (not deleted) for fallback during week 2.

## Files to be modified or created

**Backend (Next.js):**
- `drizzle/schema.ts` — add `bot_drafts`, add `messages.sender`
- `drizzle/migrations/` — new migration file
- `lib/drafts/index.ts` — NEW
- `app/api/drafts/pending/route.ts` — NEW
- `app/api/drafts/[id]/approve/route.ts` — NEW
- `app/api/drafts/[id]/reject/route.ts` — NEW
- `app/api/leads/[id]/override/route.ts` — NEW
- `app/api/bot/cron/route.ts` — UPDATE (draft branch)
- `app/api/bridge/webhook/route.ts` — UPDATE (sender heuristic on message.sent)
- `lib/bridge/client.ts` — UPDATE (tag outbound with sender)
- LLM prompt config — UPDATE (new fields)

**Frontend (Retool):**
- Retool app (config lives in Retool, not in this repo)
- Export Retool JSON to `retool/supervisor-console.json` for version control snapshots

**Cleanup later (week 2+):**
- `app/dashboard/v2/*` — keep until Retool proven stable, then remove

## Verification

End-to-end checks once built:

1. **Auto path:** lead asks "how long until delivery" → bot classifies → not money → sends auto reply → Retool Pulse shows +1 auto reply.
2. **Approval path:** lead asks "can you give me a discount?" → bot classifies money_moment → draft appears in Retool Approval Queue within 1 hour (next cron). Mobile push fires.
3. **Approve action:** tap Approve in Retool → bridge sends → WA Business shows outbound → `bot_drafts.status='sent'`, `messages.sender='bot'`.
4. **Edit-then-approve:** edit draft text → Approve → bridge sends edited text → `bot_drafts.edited_text` populated.
5. **Reject action:** Reject → no message sent → status='rejected' → bot does not retry the same draft.
6. **Manual override:** open lead in Retool → change stage → calls override API → DB updates → bot's next cycle respects the override.
7. **Eli manual reply:** reply in WA Business app → bridge webhook `message.sent` arrives → no matching draft → `sender='eli'` → Retool lead detail shows in conversation thread as "Eli".
8. **Analytics:** Approval Queue shows 5 pending, after 4 approves + 1 reject the day analytics shows approval rate 80%.

## Out of scope (explicit non-goals)

- Multi-agent assignment, SLA tracking, macros — solo, not needed.
- Email / web chat channels — WhatsApp only.
- Chatwoot integration — installed but unused; left alone.
- Migrating off whatsapp-bridge-node — bridge stays.
- Rebuilding `/dashboard/v2` UI — being replaced by Retool, not improved.

## Open items to decide during implementation

- LLM prompt: exact JSON schema for `is_money_moment`, `money_reason`, `draft_reply`.
- Heuristic for "Eli sent manually" detection — confirm bridge webhook reliably emits `message.sent` for app-originated sends. If not, add a separate poll/sync.
- Retool Mobile push delivery latency — verify acceptable (target <1 min from draft creation).
- Whether to keep `botPaused` toggle as kill-switch alongside the new draft flow, or retire it.
