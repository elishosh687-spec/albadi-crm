# Albadi CRM — Claude Instructions

## Architecture

Next.js app deployed on Vercel. Neon PostgreSQL via Drizzle ORM. WhatsApp messaging via either ManyChat (legacy) or the whatsapp-bridge-node tenant — toggled by `USE_BRIDGE` env (see "Bridge migration" below).

**Deployed URL:** `https://albadi-crm.vercel.app`
**DB:** Neon (see `DATABASE_URL` in `.env`)
**ManyChat account:** see `MANYCHAT_TOKEN` in `.env`
**Bridge tenant:** see `BRIDGE_BASE` + `BRIDGE_TENANT_TOKEN` in `.env`

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

## Deploy

Push to `main` → Vercel auto-deploys. No manual steps needed.

## v2 Dashboard — client-bundle import rule (READ BEFORE EDITING /dashboard/v2)

**Every "crash" on /dashboard/v2 reported by Eli (PRs #28-30, #33-34) had the same root cause: a `throw` at module-load on the client bundle.**

[lib/manychat/config.ts](lib/manychat/config.ts) starts with:
```ts
if (!process.env.MANYCHAT_TOKEN) throw new Error("MANYCHAT_TOKEN is not set");
```
This is fine on the server. But the moment a `"use client"` component imports anything from that module — even just a constant like `V2_PIPELINE_STAGES` — the bundler inlines the whole module into the browser chunk. `process.env.MANYCHAT_TOKEN` is undefined in the browser, the module evaluation throws, and React unmounts the page tree. The Vercel runtime logs show 200 OK (server SSR is fine); only the DevTools console shows the actual error.

**Rule:** client components must NEVER import from `@/lib/manychat/config`. Client-safe constants live in [lib/manychat/stages.ts](lib/manychat/stages.ts) — `V2_PIPELINE_STAGES`, `V2PipelineStage`, `V2_FLAG_TAG_IDS`, `V2FlagName`, `V2_FLAG_NAMES`. Add new client-safe constants there, not in config.ts. Server-side code can keep importing from config.ts; it re-exports the same names for compatibility.

When you add or move a constant the classifier or dashboard depends on, double-check the import path in every `"use client"` file before merging.

**Stable shape today:**
- Inbox row: checkbox + Approve + Reject + a plain `<button>` that opens a single-instance `NotesModal` ([app/dashboard/v2/NotesModal.tsx](app/dashboard/v2/NotesModal.tsx)) mounted once at `InboxList` root.
- `NotesModal` holds the textarea, "+ הוסף תאריך עכשיו" stamper, and the stage-override `<select>`. Only one instance of all of those exists in the DOM at a time, regardless of how many leads are pending.
- `updateLeadNotes` in [app/actions/v2.ts](app/actions/v2.ts) writes the ManyChat `notes` custom field (id 14447147) via `setCustomFields`. The classifier skill reads it back via `getSubscriber` and weaves it into the suggestion `reason`.
- [lib/manychat/client.ts](lib/manychat/client.ts) wraps every ManyChat call with an 8-second `AbortController` timeout, so a hanging request cannot freeze SSR.

**Background note on conversation notes:** ManyChat's "Notes" panel (the per-conversation sidebar notes) is **not** exposed by the public API — every `getNotes`-style endpoint we tested returns 404. The `notes` custom field is separate from that panel; Eli writes to it via ManyChat's "Custom User Fields" section in the same conversation view, and it's the only ManyChat-side notes surface we can read.

**Debug playbook if /dashboard/v2 ever "crashes" again:**
1. Open DevTools → Console. The actual JS error (and the module path) will be the first uncaught exception.
2. Vercel runtime logs show only SSR — they will not surface client throws.
3. If the error mentions `MANYCHAT_TOKEN is not set` or similar module-load throw, find the new client component importing from config.ts (or any server-only module) and reroute the import to `stages.ts` (or a similar client-safe split).
4. If you see hydration mismatch errors instead, audit any locale/date/random-id values passed from server to client.

**Do not** assume "DOM weight" before reading the console. The previous CLAUDE.md entry chased that hypothesis through multiple PRs and never closed the bug.

## Bridge migration (READ BEFORE TOUCHING MESSAGING)

We are mid-migration off ManyChat onto a self-hosted whatsapp-bridge-node tenant. The bridge gives us send/receive + webhooks but **does not** know about tags, custom fields, or template ("Flow") sends — that state moved into the DB.

**Feature flag:** `USE_BRIDGE=1` flips every messaging call from the ManyChat HTTP path to the bridge + DB path. Default is `0` (ManyChat). Both paths coexist so we can revert instantly.

**Import rule:** all server-side code MUST import messaging helpers from `@/lib/messaging`, NOT from `@/lib/manychat/client` or `@/lib/bridge/client` directly. The adapter at [lib/messaging/index.ts](lib/messaging/index.ts) re-exports the active backend.

**State ownership when USE_BRIDGE=1:**
- `leads` row holds name, phone (E.164), wa_jid, and every custom field (`pipeline_stage`, `next_action`, `bot_summary`, `notes`, `quote_total`, etc.). DB is authoritative.
- `lead_tags(manychat_sub_id, tag)` holds tag membership by NAME (Hebrew keys from `TAG_IDS` / `V2_FLAG_TAG_IDS`). Numeric ids only live in code maps for backward compat with the legacy `addTag(id, tagId)` signature.
- `bridge_events(evt_id UNIQUE)` audits every signed webhook envelope and dedupes retries.
- `messages.wa_message_id` carries the bridge-side id for dedupe on inbound webhook retries.

**Identity:** for bridge-origin leads we store the chat JID (e.g. `972…@s.whatsapp.net`) in `leads.manychat_sub_id`. ManyChat-origin leads keep their numeric subscriber id. The two namespaces never collide (JIDs contain `@`).

**Webhook endpoint:** [app/api/bridge/webhook/route.ts](app/api/bridge/webhook/route.ts) verifies HMAC-SHA256 over `t.rawBody` against `BRIDGE_WEBHOOK_SECRET`, rejects >5min replay window, logs to `bridge_events`, and routes `message.received`/`message.sent` through `lib/bridge/client.ts`. Other event types (`delivered`/`read`/`failed`/`tenant.*`) are audit-logged only.

**What the bridge cannot do (yet):** WhatsApp business templates. ManyChat Flows (`albadi_followup_quote_sent`, etc.) used to send templates to leads outside the 24h customer-service window. The bridge only sends free-form text/media, which WhatsApp blocks outside that window. **`scripts/restart-send.ts` keeps hitting ManyChat sendFlow until we add a Cloud API integration.** Do not assume `sendMessage()` on a stale lead will reach the recipient.

**Cutover checklist:**
1. `npx tsx scripts/backfill-from-manychat.ts` (dry run, review).
2. `npx tsx scripts/backfill-from-manychat.ts --confirm`.
3. Register bridge webhook → `POST /v1/subscriptions` (tenant-scoped) with `url=https://albadi-crm.vercel.app/api/bridge/webhook`, `events=["message.received","message.sent","message.delivered","message.read","message.failed"]`. Store the returned signing secret in `BRIDGE_WEBHOOK_SECRET`.
4. Hit `POST /v1/subscriptions/:id/ping` to fire a synthetic event; verify it lands in `bridge_events` and `leads` (smoke test).
5. `USE_BRIDGE=1` in Vercel, redeploy.
6. Watch `/api/bot/cron` + dashboard for one full cycle.
7. Only after a clean week: disable ManyChat Flow webhooks, delete `MANYCHAT_TOKEN`, drop `lib/manychat/client.ts`.

**Rollback:** flip `USE_BRIDGE=0`, redeploy. DB state survives — ManyChat path resumes reading its own fields.

## Supervisor Console migration (READ BEFORE TOUCHING DASHBOARD UI OR THE DECISION FLOW)

We are mid-migration off `/dashboard/v2` onto a Retool app at `https://elishosh.retool.com` (see [docs/plans/2026-05-13-retool-supervisor-console-design.md](docs/plans/2026-05-13-retool-supervisor-console-design.md) for the full design). Retool is UI-only; all business logic stays in this Next.js repo.

**Feature flag:** `ENABLE_DRAFT_QUEUE=1` turns on the money-moment draft queue. Default `0`. When `0`, the decision flow behaves exactly as before — escalations DM Eli and pause the bot but generate no drafts. When `1`, money-related escalations (`negotiating` / `reject` / `spec_change`) ALSO call `generateAndQueueDraft` which uses the existing `suggestReplies` LLM helper to draft a customer reply and store it in `bot_drafts` for Eli's approval in Retool.

**Data model:**
- `bot_drafts` table — pending/approved/rejected/sent/failed proposals. Always sent via `lib/drafts/approveDraft` (which calls `sendBridgeMessage` under the hood). Never SQL-insert a row with `status='sent'` from outside `approveDraft`; the bridge send + outbound logging must run together.
- `messages.sender` — `'lead' | 'bot' | 'eli'`. `sendBridgeMessage` pre-inserts the outbound row before the bridge `message.sent` webhook fires (default `'bot'`, override via the new optional 4th arg from `sendManualReply` which passes `'eli'`). The webhook dedupes by `wa_message_id`, so manual replies from the bonded WA Business app reach the webhook first and get tagged `'eli'`. Legacy rows pre-migration are NULL.

**API surface (all auth `Bearer BOT_SECRET`):**
- `GET /api/drafts/pending` — Retool's queue feed, enriched with lead snapshot + last inbound message.
- `POST /api/drafts/:id/approve` — `{ edited_text? }` → bridge send + `bot_drafts.status='sent'`.
- `POST /api/drafts/:id/reject` — `{ reason? }` → `bot_drafts.status='rejected'`, no send.
- `POST /api/leads/:id/override` — `{ pipeline_stage?, flags?, notes?, bot_paused?, pipeline_flag? }`. `flags` replaces the full set in `lead_tags` for the lead. URL-encode the JID (`%40` for `@`).

**Retool setup:** see [retool/SETUP.md](retool/SETUP.md). Two resources required (`albadi_pg` PG + `albadi_api` REST). Hand-built — no JSON import.

**Test scripts:**
- `npx tsx scripts/seed-draft.ts [sub_id] [text]` — inject a pending draft for Retool smoke test.
- `BOT_SECRET=... npx tsx scripts/test-drafts-api.ts` — end-to-end API smoke test against prod (use `SKIP_APPROVE=1` to skip the real bridge send).

**Old `/dashboard/v2` is alive and is the fallback.** Do not delete it until Retool has been running stable for a full week. Server actions in `app/actions/v2.ts` continue to be the source of truth for in-app mutations and still get called from the existing dashboard pages.

**When you add a NEW write surface for the Retool console:**
1. Prefer a REST endpoint under `/api/...` over a server action — Retool needs HTTP.
2. Always require `Bearer BOT_SECRET`.
3. If it sends WhatsApp, route through `sendBridgeMessage` so the outbound row gets sender attribution automatically. Do NOT insert into `messages` directly — `sendBridgeMessage` already does it.
4. Add a row to [retool/api-cheatsheet.md](retool/api-cheatsheet.md).
