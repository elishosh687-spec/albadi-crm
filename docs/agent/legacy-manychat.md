---
paths:
  - "lib/manychat/**"
  - "app/dashboard/**"
  - "app/api/bot/restart-send/**"
  - "app/api/bot/new-lead/**"
  - "app/api/drafts/**"
  - "app/actions/v2.ts"
  - "scripts/restart-send.ts"
  - "scripts/seed-leads.ts"
---

# Legacy ManyChat-era routes, flows, dashboard v3

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## Key API Routes

| Route | Purpose |
|-------|---------|
| `POST /api/bot/cron` | Hourly bot — classify leads, save decisions. Called by cloud routine every hour. |
| `POST /api/bot/restart-send` | One-time batch — send re-engagement WhatsApp templates to all stuck leads via ManyChat Flows. |
| `POST /api/bot/new-lead` | Register new lead in DB. Called by ManyChat Flow when new subscriber enters. |

All routes require: `Authorization: Bearer <BOT_SECRET>`

## Cloud Routine

URL: `https://claude.ai/code/routines/trig_01VWAWDtdHXqMMProUCseKbj`
Calls `/api/bot/cron` every hour.

## ManyChat Flows (WhatsApp Templates)

Templates sent via `sendFlow` (not `sendContent` — ManyChat API does not support direct template sending).

| Flow name | flow_ns | Template |
|-----------|---------|---------|
| send_followup_quote_sent | content20260508151701_091472 | albadi_followup_quote_sent |
| send_after_holiday | content20260508152934_109626 | albadi_after_holiday |
| send_price_too_high | content20260508180816_402346 | albadi_price_too_high |
| send_call_request_followup | content20260508152941_860840 | albadi_call_request_followup |
| send_questionnaire_incomplete | content20260508152940_284953 | albadi_questionnaire_incomplete |
| send_last_attempt | content20260508152938_498910 | albadi_last_attempt |

## Leads Table

Leads stored in `leads` table — NOT hardcoded. To add leads manually:
```bash
npx tsx scripts/seed-leads.ts
```

New leads auto-register via ManyChat webhook → `/api/bot/new-lead`. Must configure HTTP Request action in each ManyChat entry Flow.

## Common Commands

```bash
# DB migration after schema change
npx drizzle-kit push

# Seed leads table
npx tsx scripts/seed-leads.ts

# Dry run batch send (no actual send)
npx tsx scripts/restart-send.ts

# Actually send batch
npx tsx scripts/restart-send.ts --confirm
```

## Known Hardcoded Values (still to fix)

- `TAG_IDS` / `FIELD_IDS` in `lib/manychat/config.ts` — should come from ManyChat API
- `FLOW_NS` in `app/api/bot/restart-send/route.ts` — should move to `.env`
- Business thresholds: `10000` NIS high-value, `5` days no-contact (in `cron/route.ts`)
- Phone numbers in `legacy/daily_calls.py` — security risk, do not commit

## Dashboard v3 (the only dashboard)

`/dashboard/v3` is the live supervisor console. v2 was removed on
2026-05-14; the bare `/dashboard` URL redirects to v3. See
[app/dashboard/README.md](app/dashboard/README.md) for structure and
[app/dashboard/v3/README.md](app/dashboard/v3/README.md) for conventions.

**Feature flag:** `ENABLE_DRAFT_QUEUE=1` is on in prod. Money-related
escalations (`negotiating` / `reject` / `spec_change`) generate a draft
reply via `generateAndQueueDraft` (LLM-tuned for money moments) and store
it in `bot_drafts` for Eli to approve from `/dashboard/v3/drafts`.

**Data model:**
- `bot_drafts` — pending/approved/rejected/sent/failed. Always sent via
  `lib/drafts/approveDraft` (calls `sendBridgeMessage` under the hood).
- `messages.sender` — `'lead' | 'bot' | 'eli'`. `sendBridgeMessage`
  pre-inserts with `sender='bot'`; `sendManualReply` passes `'eli'`. The
  webhook handles races by upserting text+sender on existing rows so the
  late copy with real content wins.

**API surface (all auth `Bearer BOT_SECRET`):**
- `GET /api/drafts/pending`
- `POST /api/drafts/:id/approve` — `{ edited_text? }`
- `POST /api/drafts/:id/reject` — `{ reason? }`
- `POST /api/leads/:id/override` — `{ pipeline_stage?, flags?, notes?, bot_paused?, pipeline_flag? }`

**Server actions:** `app/actions/v2.ts` (filename historical) — used
directly by v3 client components. Includes `setLeadStage`,
`updateLeadNotes`, `setBotPaused`, `snoozeLead`, `sendManualReply`,
`suggestRepliesAction`, `approveDraftAction`, `rejectDraftAction`,
`updateLeadContactAction`, `saveBotConfigAction`.

**Test scripts:**
- `npx tsx scripts/seed-draft.ts [sub_id] [text]` — inject a pending draft.
- `BOT_SECRET=... npx tsx scripts/test-drafts-api.ts` — API smoke test.

**Adding a new write surface:** prefer server actions in
`app/actions/v2.ts`. Add a REST endpoint only when external tooling needs
HTTP access. If it sends WhatsApp, route through `sendBridgeMessage` so
the outbound row gets sender attribution automatically.
