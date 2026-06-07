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

## Pipeline stages (post 2026-06-07 funnel rename)

4-active-stage funnel, 6 total + WON/LOST/sides. Internal names match GHL exactly — no translation layer.

| Stage | Hebrew | When | Who sets |
|---|---|---|---|
| `NULL` | בשאלון | first inbound, questionnaire active | bot (`upsertLeadFromBridgeEvent` leaves NULL) |
| `INTAKE` | שאלון + הצעה אוטומטית | questionnaire complete + auto-quote sent; includes the 24h+ silent state | bot (`handleInbound`) |
| `DISCAVERY` | שיחת בירור | customer engaged, salesperson runs discovery / commitment-signal call | bot or salesperson |
| `FACTORY_WAIT` | בדיקת מפעל | non-standard spec, factory check in flight | bot (`routeToFactory`) / Eli (subFlow=awaiting_factory_estimate) |
| `CONSIDERATION` | שוקל הצעה / מו״מ | final quote in customer's hands; haggling lives here | bot (`handleDecisionInbound`) |
| `WON` / `LOST` | terminal | customer confirmed payment / explicit refusal | bot or Eli (LOST requires `loss_reason`) |

Side stages (operator drags manually, bot doesn't transition): `FUTURE_FOLLOW_UP`, `NO_RESPONSE_REENGAGE`.

Source of truth: `V2_PIPELINE_STAGES` in [lib/manychat/stages.ts](lib/manychat/stages.ts). Full transition table: [docs/CUSTOMER-FLOW.md](docs/CUSTOMER-FLOW.md).

**Rename rule.** When renaming or merging a stage: ADD the old name to `LEGACY_STAGE_MAP` (don't remove existing entries). Pattern proven 2026-06-07 — stale DB rows, log entries, and external API payloads keep normalizing cleanly. Run the DB backfill (`UPDATE leads SET pipeline_stage = ...`) AFTER the code lands, never before.

## Known Hardcoded Values (still to fix)

- `TAG_IDS` / `FIELD_IDS` in `lib/manychat/config.ts` — should come from ManyChat API
- `FLOW_NS` in `app/api/bot/restart-send/route.ts` — should move to `.env`
- Business thresholds: `10000` NIS high-value, `5` days no-contact (in `cron/route.ts`)
- Phone numbers in `legacy/daily_calls.py` — security risk, do not commit

## Deploy

Push to `main` → Vercel **usually** auto-deploys via GitHub integration.

**Gotcha (seen 2026-06-07):** the GitHub→Vercel webhook silently doesn't fire sometimes. After pushing, run `vercel ls` and check the top deployment age. If it's older than your last commit, trigger manually:

```bash
~/.local/node/bin/vercel deploy --prod --yes   # or: vercel deploy --prod
```

The CLI deploy uses the linked project from `.vercel/project.json` — no need to specify the project name. Build runs on Vercel (not local).

## Working with Vercel + Neon from the CLI

**Vercel env vars are encrypted by default.** Running `vercel env pull .env` produces a file where sensitive values (`DATABASE_URL`, all `GHL_*`, all `BRIDGE_*`, etc.) come back as empty strings — the CLI cannot decrypt them. The masking is silent: there's no error, the file looks complete.

To actually query the DB or call GHL from local:

- **Neon (DB):** install `neonctl` (`npm i -g neonctl`), run `neon auth` (OAuth browser flow), then `neon connection-string --project-id <id> --org-id <id>` returns the real DATABASE_URL. Project id is in `neon projects list`.
- **GHL API:** the OAuth access tokens live in `ghl_oauth_tokens` table — pull from the DB connection above (`SELECT access_token, location_id FROM ghl_oauth_tokens ORDER BY updated_at DESC LIMIT 1`) and hit `services.leadconnectorhq.com` directly.
- **Vercel env writes:** `vercel env add NAME production` reads value from stdin (`echo VALUE | vercel env add ...`). `vercel env rm NAME production --yes` for removal. Production writes require explicit user authorization in this harness — auto-approve is blocked.

## Client-bundle import rule (READ BEFORE TOUCHING SHARED CONSTANTS)

`"use client"` components must NEVER import from server-only modules that
throw on missing env vars. The historical offender is
[lib/manychat/config.ts](lib/manychat/config.ts) which starts with:
```ts
if (!process.env.MANYCHAT_TOKEN) throw new Error("MANYCHAT_TOKEN is not set");
```
Server: fine. Client: the bundler inlines the whole module → process.env is
undefined in the browser → module evaluation throws → React unmounts the
tree. Vercel runtime logs show 200 OK (SSR was fine); only DevTools console
shows the actual error.

**Rule:** client-safe constants live in [lib/manychat/stages.ts](lib/manychat/stages.ts) —
`V2_PIPELINE_STAGES`, `V2PipelineStage`, `V2_FLAG_TAG_IDS`, `V2FlagName`,
`V2_FLAG_NAMES`. Add new client-safe constants there, not in config.ts.

**Debug playbook for a "blank/crashed" dashboard page:**
1. DevTools → Console. First uncaught exception is the answer.
2. Vercel runtime logs only cover SSR — they will not show client throws.
3. If the error mentions a server-only env var, the import path is wrong.

Do NOT chase "DOM weight" or "hydration" before reading the console.

## GHL is single source of truth (READ BEFORE TOUCHING ANY SHARED FIELD)

**Decision 2026-05-22:** every field that Eli edits in the GHL UI is owned by
GHL. DB just follows. No two-source-of-truth drift.

**Shared fields (GHL owns, DB mirrors via webhook):**
- `leads.name`, `leads.phone_e164`, `leads.email`
- `lead_tags.tag` (Contact.tags)
- `leads.bot_summary`, `leads.quote_total`, `leads.loss_reason`,
  `leads.bot_paused`, `leads.pipeline_flag` (Contact.customFields)
- `leads.notes` (Contact.notes, concat of all)
- `crm_tasks` rows (Contact.tasks, upserted by `ghl_task_id`)
- `leads.pipeline_stage` (Opportunity.pipelineStageId, mapped via `GHL_STAGE_IDS`)
- `opportunities.value_ils` (Opportunity.monetaryValue)
- `opportunities.won_at` / `lost_at` (Opportunity.status)

**DB-only fields (GHL never touches):**
- `leads.q_state` (questionnaire FSM), `leads.quote_alt`, `leads.factory_spec_draft`
- `messages`, `bot_quotes`, `bot_drafts`, `bot_decision_log`
- `bot_config`, `app_config`, `factory_quote_requests`, `bridge_events`
- `crm_sla_timers`, `lead_score_snapshots`, `source_touches`, `ghl_lead_tasks`

**Webhook map (GHL → DB):**
| Endpoint | Trigger | Scope |
|---|---|---|
| `/api/ghl/stage-changed` | Opportunity Stage Changed | `leads.pipeline_stage` only |
| `/api/integrations/inbound/ghl-tag` | Contact Tag Added/Removed | `lead_tags` delta |
| `/api/integrations/inbound/ghl-custom-field` | Custom Field Changed | `bot_paused`, `follow_up_date` only |
| `/api/ghl/resync` | Contact Changed + Opportunity Changed | **catch-all full pull** — name, phone, email, tags, customFields, notes, tasks, opps |

**Rule:** if you add a new shared field or webhook, update the matrix in
[docs/ARCHITECTURE.md §3b](docs/ARCHITECTURE.md). If GHL doesn't have a
trigger for what you need, prefer extending the resync endpoint over
making another narrow webhook.

**Loop guard:** when the bot writes a shared field to DB, `syncLeadToGHL`
pushes to GHL. The resync webhook will then fire and re-read the same
value — but the merge is idempotent (`COALESCE` semantics for nullable
fields, stage equality check for pipeline_stage), so no infinite loop.

## Bridge messaging (READ BEFORE TOUCHING MESSAGING)

All WhatsApp I/O runs through the self-hosted whatsapp-bridge-node tenant.
ManyChat was retired — only legacy backfill scripts still hit its API. The
bridge gives us send/receive + webhooks; tags, custom fields, and pipeline
state live in the DB.

**Feature flag:** `USE_BRIDGE=1` is permanent. Setting it to `0` would route
through `lib/manychat/client.ts` which is deprecated and unmaintained.

**Import rule:** all server-side code MUST import messaging helpers from `@/lib/messaging`, NOT from `@/lib/manychat/client` or `@/lib/bridge/client` directly. The adapter at [lib/messaging/index.ts](lib/messaging/index.ts) re-exports the active backend.

**State ownership when USE_BRIDGE=1:**
- `leads` row holds name, phone (E.164), wa_jid, and every custom field (`pipeline_stage`, `next_action`, `bot_summary`, `notes`, `quote_total`, etc.). DB is authoritative.
- `lead_tags(manychat_sub_id, tag)` holds tag membership by NAME (Hebrew keys from `TAG_IDS` / `V2_FLAG_TAG_IDS`). Numeric ids only live in code maps for backward compat with the legacy `addTag(id, tagId)` signature.
- `bridge_events(evt_id UNIQUE)` audits every signed webhook envelope and dedupes retries.
- `messages.wa_message_id` carries the bridge-side id for dedupe on inbound webhook retries.

**Identity:** for bridge-origin leads we store the chat JID (e.g. `972…@s.whatsapp.net`) in `leads.manychat_sub_id`. ManyChat-origin leads keep their numeric subscriber id. The two namespaces never collide (JIDs contain `@`).

**Webhook endpoint:** [app/api/bridge/webhook/route.ts](app/api/bridge/webhook/route.ts) verifies HMAC-SHA256 over `t.rawBody` against `BRIDGE_WEBHOOK_SECRET`, rejects >5min replay window, logs to `bridge_events`, and routes `message.received`/`message.sent` through `lib/bridge/client.ts`. Other event types (`delivered`/`read`/`failed`/`tenant.*`) are audit-logged only.

**Templates are out.** The bridge only sends free-form text/media inside the
WA 24-hour customer-service window. Outside it, WhatsApp blocks the send.
There is currently no template fallback — `scripts/restart-send.ts` is
historical and not in use.

**Contact enrichment:** the bridge `message.received` event does NOT carry
name/phone for `@lid` JIDs. `upsertLeadFromBridgeEvent` calls
`GET /v1/contacts/<jid>` and merges via `COALESCE` so manual edits are
preserved. `scripts/backfill-contact-info.ts` re-enriches in bulk.

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
