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

## Feishu factory-quote parser — column-shift footgun (READ BEFORE TOUCHING FACTORY PRICING)

The factory quote sheet is a **live shared Feishu sheet**; the factory (or Eli)
can insert/rename columns anytime. `parseFactoryResponseRow` in
[lib/feishu/sheets.ts](lib/feishu/sheets.ts) reads by **fixed integer index**,
so any inserted column silently shifts every factory field one slot right and
corrupts the whole parse. This has bitten us **twice**:

- **2026-05** (a9dfd49): sheet auto-filled column C with a creation date.
- **2026-07-02** (ba1e88f): factory added a `数量` (quantity) formula at column
  **K** mirroring our request qty → unitCost read 5000 (=qty), cbm read 55
  (=height), weight read 0.15 (=cbm), supplier read "11" (=weight). 5 quotes
  flagged in FinalizeModal.

**Diagnostic signature:** FinalizeModal's "נתוני מפעל" panel shows
`⚠️ CBM לא תואם למידות` — cartonCbm is in the hundreds (actually a cm
dimension) while L×W×H imply ~0.0X m³; unitCost in the thousands; supplier is a
bare number. Panel's own `cbmWarn` check (`|cbm−dims|/dims > 0.25`) catches it.

**Current layout (row 5 = header):** `A 联系人 · B 报价单号 · C date · D 图片 ·
E 描述 · F 类型 · G 材质及克重 · H 尺寸 · I logo印刷 · J 表面处理 ·
K(10) 数量 (IGNORED — echoes our qty) · L(11) 人民币价格 unitCost · M(12) 装箱数量
cartonQty · N(13) 长 · O(14) 宽 · P(15) 高 · Q(16) 体积 cbm · R(17) 重量KG ·
S(18) 供应商 · T(19) 备注 remark · U(20) UNLABELED — plate fee
"printing cost: RMB350/COL" lives here` (it shifted T→U with the same K
insertion — `readRow`/`readAllRows` read through **U**, parser scans U then T).

**THREE parsers read this sheet by index — fix ALL of them together, or a
re-import silently re-corrupts what you just fixed:**
1. `parseFactoryResponseRow` — factory numeric fields (L..R) + plate fee (U).
2. `readRow` / `readAllRows` — the fetch ranges (must reach column **U**/20).
3. `parseFactoryRequestRow` — operator/product side (material←G(6), size←H(7),
   printing←I(8), finishing←J(9), quantity←K(10); skip F=类型/type). Used by
   `import-from-feishu`. Fixing only the response parser leaves this one shifted,
   so re-importing a quote rebuilds a SHIFTED productSpec (material=bag-type,
   printing=size-string, finishing=colours, dims/qty=0). Downstream the
   FinalizeModal derives logoColors from `productSpec.printing` via `/(\d+)/`,
   so "H35*..." → "35 colours" and the plate fee explodes (¥350 × 35 = ¥12,250).

**Fix recipe when it shifts again:**
1. Dump raw rows incl. row 5 (`readRow` + print each cell with its column
   letter) to see the new layout.
2. Shift the `row[N]` indices in BOTH `parseFactoryResponseRow` AND
   `parseFactoryRequestRow` + the fetch ranges + rewrite the layout comments.
   Commit + **push to prod FIRST** — the refresh crons + widget
   `/api/*/factory/refresh` + re-imports run the OLD parser and re-corrupt DB
   rows the moment anyone touches the tab, so a DB reparse before deploy gets
   overwritten.
3. Reparse the **response** side with a scratch script (model on
   `scripts/_reparse-after-col-shift.ts`): re-locate each row via
   `findRowByQuotationNo` (indices drift too), take fresh numerics **wholesale**
   (do NOT COALESCE — stored numerics are the corrupted ones), keep only
   `platePerColorCny` from stored. Dry-run, then `--go`.
4. For **productSpec** (request side): NEVER blanket-rewrite from Feishu — row
   indices drift and specs get hand-edited, so a blanket re-read corrupts good
   rows. Repair only rows matching the corruption signature (material is a bag
   type not a fabric, or printing matches a size pattern, or qty/dims=0).
5. Verify: 0 rows flagged by a cbm-vs-dims scan; unitCost×qty + total CBM sane;
   logoColors sane (not pulled from a size string).

**Prevention idea (not built):** parse by header-name lookup on row 5 instead
of hardcoded indices → shift-proof. Deferred; the fix is ~10 min when it recurs.

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

- **Neon (DB):** `neonctl` lives at `~/.local/node/bin/neonctl` (npm global, not on `$PATH` by default) and is already authed. Project id: `fragrant-morning-71359670`. Org id: `org-frosty-star-50411125`. One-liner to feed any tsx script the live DATABASE_URL:
  ```bash
  DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/<name>.ts
  ```
  If `neonctl` is missing on a fresh machine: `npm i -g neonctl && neon auth` (OAuth browser flow).
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

**Active backend = GreenAPI (confirmed 2026-06-08).** WhatsApp send/receive
runs through GreenAPI, not the bridge tenant directly. ManyChat is fully
retired (only historical backfill scripts touch its API). The layering is two
nested flags:
- `USE_BRIDGE=1` routes `@/lib/messaging` → `lib/bridge/client.ts` (vs the dead
  ManyChat path).
- `USE_GREEN_API=1` then makes `sendBridgeMessage` delegate to
  `sendGreenMessage` (`lib/greenapi/client.ts`). Inbound arrives at
  [app/api/greenapi/webhook/route.ts](app/api/greenapi/webhook/route.ts).
The `whatsapp-bridge-node` tenant code still exists but is dormant while
`USE_GREEN_API=1`. Tags, custom fields, and pipeline state live in the DB.

**⚠️ Two JID namespaces — the #1 messaging footgun.** GreenAPI uses
`<phone>@c.us`; FB-import leads ([api/leads/facebook-import](app/api/leads/facebook-import/route.ts))
are stored under `<phone>@s.whatsapp.net`; the bridge also uses
`@s.whatsapp.net` + `@lid`. So a lead's `manychat_sub_id` (sid) and the Green
`chatId` for the SAME person often differ only by suffix. Any code that maps a
chatId back to a lead MUST canonicalise first — use
`resolveLeadSidForChatId` (green client) on the way in, and `loadLead`
(`integrations/ghl/sync.ts`) has a phone-digit fallback as the safety net.
Bug fixed 2026-06-08: the GHL outbound mirror passed the raw `@c.us` chatId →
`loadLead` missed → every bot/eli reply was dropped from the GHL Inbox
(`ghl_mirror.skip reason=no_lead`) while inbound (already canonicalised)
showed fine. Symptom: GHL thread shows only the customer side.

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

## FB Lead Ads form pipeline (Sheet → Apps Script → CRM)

Replaces the old Google Apps Script → ManyChat path. Three independent layers around a single Google Sheet; safe to re-run end-to-end.

**Sheet** — Meta Lead Ads native CRM connector writes rows directly. Current sheet: `1AnswoeBAFV-z4aN3KhqyJjb9DegyiDNH-0FcB8ry518` ("Albadi leads v2"). **Must be set to "Anyone with link → Viewer"** or the dashboard pill silently fetches an empty snapshot. Standard Meta column layout (0-indexed):

| idx | column | written by |
|-----|--------|------------|
| 0–11 | `id`, `created_time`, ad/adset/campaign/form metadata, `is_organic`, `platform` | Meta |
| 12 | `שם_מלא` | Meta |
| 13 | `phone` (with `p:` prefix) | Meta |
| 14–16 | `דוא"ל`, `שם_החברה`, `lead_status` | Meta |
| 18 | `SENT` marker (gates re-processing) | Apps Script |
| 19 | status string (`sent` / `tagged_only` / `BAD_PHONE: …` / `lead_created_send_failed` / `http_*` / `exception_*`) | Apps Script |
| 20 | returned `sid` | Apps Script |

**Apps Script** lives in the sheet itself (time-driven trigger every 5 minutes; not in this repo). Function `onNewLead` iterates rows, skips rows already marked `SENT` and rows whose phone contains `"test lead"`, normalizes via `fixPhone` (handles `p:` prefix, `0…` → `+972…` Israeli local, bare digits → country-coded), POSTs `{phone, fullName}` to `/api/leads/facebook-import` with `Bearer FB_IMPORT_SECRET`. BAD_PHONE rows write status but NOT SENT — eligible for retry after manual fix.

**CRM endpoint** [app/api/leads/facebook-import/route.ts](app/api/leads/facebook-import/route.ts):
- Phone stored in DB **without `+`** (`leads.phoneE164 = "972525755705"`). The endpoint uses `digitsOnly()` for both inbound normalization and dedupe lookup — DB and endpoint agree on the no-`+` form.
- Dedupe by `phoneE164 OR waJid`. Existing lead → adds `ליד_חדש` tag (idempotent), sets `leadSource="facebook"` if null, returns `tagged_only`. **Does NOT re-send OPENING.**
- New lead → inserts with `source="facebook_import"` (pipeline marker, distinguishes from `greenapi_webhook`) and `leadSource="facebook"` (attribution), sends OPENING + kicks off the questionnaire, returns `sent`.

**Dashboard consumer** [lib/sheets/lead-gaps.ts](lib/sheets/lead-gaps.ts):
- Env var `GOOGLE_SHEETS_FB_LEADS_ID`. Fetches `https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=0` — no auth, soft-fails to empty snapshot on any error.
- Column constants `COL_NAME=12, COL_PHONE=13, COL_SENT=18, COL_LAST_STATUS=19, COL_SID=20` match the Apps Script writes exactly. Classification: SENT → not a gap; BAD_PHONE prefix → bad_phone; `lead_created_send_failed` → send_failed; `http_*`/`exception_*` → other_error; else → pending.
- Consumed by [app/dashboard/v3/leads/page.tsx](app/dashboard/v3/leads/page.tsx) ("פערי טופס" pill) and [app/api/bot/followups/route.ts](app/api/bot/followups/route.ts) (cron DMs Eli about stuck rows).

**Rotating the sheet:** to swap to a new form, update Vercel env `GOOGLE_SHEETS_FB_LEADS_ID` + share the new sheet "Anyone with link" + redeploy. Apps Script lives in the sheet so each new sheet needs its own copy of the script. Code requires zero changes as long as the Meta column layout stays standard.

## GHL-gap audit (leads missing from GHL)

For "לידים שנופלים בין הכיסאות" — active leads with WhatsApp activity (msgs / jid / phone) and `ghl_contact_id IS NULL`. Two ways to run, both already in the repo:

- **HTTP** (recommended): `GET /api/admin/audit-ghl-gap` with `Authorization: Bearer $BOT_SECRET`. Query params: `?limit=N` (1..500, default 100), `?onlyBotTouched=1`. Returns `{summary, leads}`. Source: [app/api/admin/audit-ghl-gap/route.ts](app/api/admin/audit-ghl-gap/route.ts).
- **CLI**: [scripts/audit-ghl-gap.ts](scripts/audit-ghl-gap.ts). Run with the neonctl one-liner above.

## Deleting a lead end-to-end (test cleanup pattern)

Sixteen tables reference a lead by `manychat_sub_id` (or `lead_sid` in `bot_quotes` / `ghl_lead_tasks`). None have FK constraints, so deletes never cascade or block. For a clean test reset:

1. **Delete the GHL contact via UI first** — otherwise the next GHL resync recreates the DB row from GHL state.
2. Run a scoped script that deletes from each table where the sid matches. The full table list is in `scripts/_purge-eli-lead.ts` (scratch, underscore-prefixed). Order doesn't matter — no FKs.
3. Verify with a phone/sid lookup against `leads`.

The bot-side effect: after a fresh insert via the FB-import path, the new lead has `ghl_contact_id=NULL` until the first inbound triggers a GHL sync.

## GHL call recording analysis pipeline

Every completed GHL call gets transcribed (Whisper), analyzed for sales signals (GPT), and posted back to the contact as a structured Hebrew note. Polls every 5 min, no GHL webhook needed.

**Data model:** [drizzle/schema.ts](drizzle/schema.ts) → `call_recording_imports`. One row per recording, keyed on `ghl_message_id` UNIQUE. State machine in `status` column: `pending` → `transcribing` → `analyzing` → `posted` (terminal happy path); branch terminals: `failed` (>= 3 attempts), `skipped_oversize` (>25MB), `skipped_voicemail`. `(status, attempts)` composite index for cron query efficiency.

**Pipeline stages**, each runs independently per cron tick — partial failures in one stage don't block others. Per-row gating in [app/api/bot/process-recordings/route.ts](app/api/bot/process-recordings/route.ts):

| Stage | Selector | Tools used |
|-------|----------|------------|
| 1 — discover | poll GHL `messages/search?type=TYPE_CALL&startAfterDate=<cursor−30min>`, filter `meta.call.status=='completed'` AND `dateAdded > 60s ago` | `searchCallMessages` in `integrations/ghl/client.ts` |
| 2 — transcribe | `transcript IS NULL AND status NOT IN (failed/skipped_*)` | `downloadRecording` + `transcribeAudio` ([lib/transcription/whisper.ts](lib/transcription/whisper.ts)) |
| 3 — analyze | `transcribed_at IS NOT NULL AND analyzed_at IS NULL` | `analyzeCall` ([lib/autoresponder/call-analysis.ts](lib/autoresponder/call-analysis.ts)) |
| 4 — post back | `analyzed_at IS NOT NULL AND posted_back_at IS NULL` | `listContactNotes` (dedupe via marker) + `addContactNote` |

**Cursor:** `app_config` key `"call_recordings.last_polled_at"` (JSON `{iso}`). First run looks back 24h. Each tick rewinds by 30min as a belt-and-suspenders overlap; unique `ghl_message_id` constraint handles dedupe.

**GHL endpoint quirks (validated empirically 2026-06):**
- `GET /conversations/messages/search` rejects `?type=TYPE_CALL` with 422 ("type must be a valid enum value"). It doesn't accept type-based filtering at all on this endpoint.
- Correct path is two-stage: `GET /conversations/search?lastMessageType=TYPE_CALL` → enumerate conversation ids; then `GET /conversations/{id}/messages` per conversation and filter to call-type messages (`type === "TYPE_CALL"` or `meta.call` present).
- `/conversations/{id}/messages` nests the array oddly: response shape is `{messages: {messages: [...], nextPage, lastMessageId}}`.
- `startAfterDate` on `/conversations/search` is a **pagination cursor** (search_after on last_message_date), not a date filter. Polling-style "give me everything since X" doesn't work — we just take the newest 20 every tick and rely on the unique constraint.
- Recording download: `GET /conversations/messages/{messageId}/locations/{locationId}/recording` returns the binary directly (`audio/x-wav` or `audio/mpeg`), not a signed URL.

**Note format and idempotency.** Stage 4 posts a Hebrew-structured note whose first line is the stable marker `[CALL-ANALYSIS v1] msg=<ghl_message_id>`. Before posting, stage 4 lists existing notes via `listContactNotes` and skips if the marker is already present — survives crashes between API call and DB write.

**Retry policy.** Per-row `attempts` increments on every failure; row goes to `status='failed'` after `MAX_ATTEMPTS=3` and is excluded from all subsequent stages until manually reset. `last_error` / `last_error_at` capture the most recent failure for triage.

**Limits and caps.** Hard cap of 5 recordings per tick per stage (keeps the cron under `maxDuration=300s` and well within Whisper's 50 RPM tier). Whisper rejects >25MB audio — oversized rows are immediately moved to `skipped_oversize` (Phase B will add ffmpeg downcompression before this cap).

**Env vars (Vercel prod):**
- `OPENAI_API_KEY` — required (shared with autoresponder)
- `OPENAI_TRANSCRIBE_MODEL` — optional, defaults `whisper-1`
- `OPENAI_ANALYSIS_MODEL` — optional, defaults to `OPENAI_MODEL` (`gpt-4o-mini`)
- `BOT_SECRET` — auth (shared with other crons)
- All `GHL_*` — already configured

**Trigger.** Register a Vercel Cloud Routine that hits `POST /api/bot/process-recordings` every 5 min with `Authorization: Bearer $BOT_SECRET`. Same pattern as the existing followups routine documented above.

**Dry-run before going live.** `npx tsx scripts/_test-call-pipeline.ts` (with `DATABASE_URL` set) runs all four stages inline against a real recent call and prints the note body that WOULD be posted — DB is touched (cursor stays untouched), but `addContactNote` is NOT called. Use this to validate Hebrew analysis quality before flipping the cron on.

**Upgrade path for analysis quality.** If `gpt-4o-mini` underperforms on spoken Hebrew nuance, swap the LLM in `lib/autoresponder/call-analysis.ts` to a Claude-Sonnet wrapper (~30 line change behind the same `analyzeCall` signature). Don't pre-optimize — see real outputs first.

## ElevenLabs voice agent (Twilio telephony → GHL)

A Conversational-AI phone agent that calls/answers leads in Hebrew, plus an
**additive sibling** of the GHL call-recording pipeline above that mirrors each
agent call into GHL as a note + playable recording. Built 2026-06-09. It does
**not** touch `process-recordings` (the GHL-native dialer path) — both run side
by side, keyed on different tables.

**The agent.** "Marketing Lead Capture Agent", `agent_id =
agent_2101ktmrrw08ef29qty75p1qqpc3`. Hebrew system prompt + first message
(outbound "you left details → we call you back" flow), grounded in the real
questionnaire (`lib/autoresponder/questionnaire.ts`) and 52 analyzed past
calls. `platform_settings.summary_language = "he"` so ElevenLabs' own summary
is Hebrew (the note's fallback when `analyzeCall` returns null). Agent LLM is
`glm-45-air` (small/cheap — upgrade for better Hebrew nuance); analysis LLM is
`gemini-2.5-flash`. Edit the agent via `PATCH /v1/convai/agents/{id}` (do NOT
send `conversation_config.agent.language` — it 400s against the TTS model;
language is already `he`).

**Telephony.** Twilio number **+972 3-382-2538** (`+97233822538`,
`phone_number_id = phnum_6701ktmwg1dcebr9w659vms6dc6y`), imported via
`POST /v1/convai/phone-numbers` (Twilio SID+token) and assigned to the agent —
`supports_inbound` + `supports_outbound`. ElevenLabs auto-sets the Twilio
voice webhook to `api.elevenlabs.io/twilio/inbound_call`. A GHL number can NOT
double as the agent's line (one voice webhook per number; GHL owns its
numbers' Twilio). Outbound calls: `POST /v1/convai/twilio/outbound-call`
`{agent_id, agent_phone_number_id, to_number}` — currently manual; auto-dial
of new leads is NOT built yet.

**Sync pipeline** — [app/api/elevenlabs/sync-calls/route.ts](app/api/elevenlabs/sync-calls/route.ts), 4 stages, per-row gated, cap 5/stage/tick:

| Stage | Selector | Action |
|-------|----------|--------|
| 1 discover | list conversations since cursor | insert rows (`conversation_id` UNIQUE) |
| 2 enrich | `transcript IS NULL` | pull transcript + `metadata.phone_call.external_number` + ElevenLabs summary |
| 3 analyze | `enriched_at NOT NULL AND analyzed_at IS NULL` | `analyzeCall` (Hebrew, reused) |
| 4 post | `analyzed_at NOT NULL AND posted_back_at IS NULL` | resolve GHL contact by phone → note + recording attachment |

**Data model:** `elevenlabs_call_imports` ([drizzle/schema.ts](drizzle/schema.ts)),
`conversation_id` UNIQUE. Status: `pending → enriched → analyzed → posted`;
branch terminals `skipped_no_contact` (web/widget call, no phone to bind),
`skipped_empty`, `failed` (>= 3 attempts). Cursor: `app_config` key
`elevenlabs.last_polled_unix`.

**Recording attachment.** ElevenLabs audio needs the `xi-api-key`, but GHL
fetches attachment URLs unauthenticated — so
[app/api/elevenlabs/recording/[id]/route.ts](app/api/elevenlabs/recording/[id]/route.ts)
proxies it as `<conv_id>.mp3` (injects the key). Stage 4 uploads that proxy
URL via `uploadMediaFromUrl` and attaches it with `postOutboundMessage`
(type `Custom`, the same conversation provider as the WhatsApp mirror) so it
renders as a playable bubble in the GHL contact.

**Idempotency:** stage 4 checks existing notes for the marker
`[CALL-ANALYSIS-11L v1] conv=<id>` before posting (survives crashes); the
`conversation_id` UNIQUE constraint dedupes discovery.

**Trigger.** No dedicated routine yet (claude.ai scheduler was down 2026-06-09).
Instead **piggybacked on the existing `process-recordings` 5-min Cloud
Routine** — its POST handler ends with a non-fatal internal `fetch` to
`/api/elevenlabs/sync-calls`. To decouple later: remove that block and register
a dedicated routine hitting `POST /api/elevenlabs/sync-calls` with
`Authorization: Bearer $BOT_SECRET`.

**Env vars (Vercel prod):** `ELEVENLABS_API_KEY` (required), `ELEVENLABS_AGENT_ID`
(optional — scopes discovery to one agent). Auth on the cron: `BOT_SECRET` /
`CALL_TRIGGER_SECRET` (shared with other crons).

**Manual verify:** [scripts/_verify-11l-e2e.ts](scripts/_verify-11l-e2e.ts) runs
the full pipeline against one conversation with inline env (`ELEVENLABS_API_KEY`
+ `GHL_LOCATION_ID` + `GHL_CONVERSATION_PROVIDER_ID` + `DATABASE_URL`) — it
posts a real note + recording, so use a disposable contact. Analysis (OpenAI)
only runs where `OPENAI_API_KEY` is present (prod), so a local run falls back to
the Hebrew ElevenLabs summary.

**Footguns.** (1) Web/widget calls have no phone → `skipped_no_contact` (can't
bind a GHL contact) — expected, only telephony calls sync. (2) Editing the
agent with `language` in the payload 400s (see above). (3) The recording proxy
needs `ELEVENLABS_API_KEY` in the **prod** runtime, else it 502s and the audio
attach silently fails (note still posts).

## Pipeline audit — "יישור הלידים" (built 2026-07-01)

Two panels on the ניתוח tab (widget), both auto-load on mount. Deterministic
SQL + LLM verdict, no separate LLM for the audit itself.

**"נפלו בין הכיסאות"** — every lead in an ACTIVE stage (NULL / INTAKE /
DISCAVERY / FACTORY_WAIT / CONSIDERATION — anything except WON/LOST) with
zero open `crm_tasks`. Eli opens each in GHL, adds a task by hand.

**"שלב לא תואם"** — leads whose `pipeline_stage` lags behind the [lead-analyzer]
verdict, gated on `commitment_scorecard.score_1_5`. Rules in
[lib/analysis/pipeline-audit.ts](lib/analysis/pipeline-audit.ts):
- **DISCAVERY**: call analyzed + commitment ≥ 2
- **FACTORY_WAIT**: `factory_quote_requests` row exists + not cold
- **CONSIDERATION**: `sent_to_customer_at` set + commitment ≥ 3 OR blocker
  ∈ {price, payment_terms, moq, spec_open}
- Cold verdict (insufficient_data / commitment ≤ 1) → no suggestion

Per-row ✓ אשר / ✗ דחה + a dropdown to override to any of the 6 canonical
stages (קליטה / אפיון / מחכה למפעל / שוקל / משא ומתן / נסגר / אבוד). Apply
goes through `setLeadStage` — DB + GHL + `ensureAutoTaskForStage`.

**Cron ([/api/cron/analyze-active-leads](app/api/cron/analyze-active-leads/route.ts))**:
daily 03:30 UTC (06:30 IL). Runs `analyzeLead` on every active lead with a
stale/missing verdict (cap 40/tick, concurrency 3), then a `sweepOrphanTasks`
pass that finds every open `crm_tasks` row without an assignedTo, sets it
to Itay in DB, and PATCHes GHL for rows that carry a `ghl_task_id`.

## Bot never auto-advances pipeline stage (2026-07-01 rule)

The bot USED to write `pipelineStage: "FACTORY_WAIT"` from five sites in the
autoresponder — questionnaire routing to factory, calc-API fallback, customer
"accept" intent, logo-image inbound, logo-URL inbound. **All five now write
`INTAKE`.** `qState.subFlow` still tracks `awaiting_logo` /
`awaiting_factory_estimate` so the autoresponder knows what to do next;
`NEEDS_ELI` flag and Eli DM still fire so nothing gets lost. **Only the
pipeline stage stays put** — Eli moves it himself via the audit UI or GHL.

`ensureAutoTaskForStage` in [lib/crm-tasks/auto-task.ts](lib/crm-tasks/auto-task.ts)
is now called from every stage-write site (setLeadStage, questionnaire
completion, configurator upsert), so the "נפלו בין הכיסאות" list stays at
zero for future leads.

## Task ownership — every task defaults to Itay (2026-07-01 rule)

Every `crm_tasks` row defaults to `assignedTo = GHL_SALESPERSON_USER_ID`
(Itay's GHL user id). Four sites enforce this:

| Path | File |
|---|---|
| Auto-task on stage entry | [lib/crm-tasks/auto-task.ts](lib/crm-tasks/auto-task.ts) |
| Push to GHL (create + update) | [integrations/ghl/sync.ts](integrations/ghl/sync.ts) |
| Manual UI create | [app/actions/v2.ts](app/actions/v2.ts) `createCrmTaskAction` |
| Pull from GHL (resync) | [lib/ghl/resync-helper.ts](lib/ghl/resync-helper.ts) |

The nightly cron sweep (above) catches any row that slipped through. No
manual "reassign" button in the UI — the fix is automatic.

## Display labels: use Eli's working vocabulary

Only stage labels changed 2026-07-01 — the internal keys (`INTAKE` /
`DISCAVERY` / `FACTORY_WAIT` / `CONSIDERATION` / `WON` / `LOST`) are
untouched. Every UI surface reads:

  INTAKE        → **קליטה**              (was: שאלון + הצעה אוטומטית)
  DISCAVERY     → **אפיון**              (was: שיחת בירור)
  FACTORY_WAIT  → **מחכה למפעל**          (was: בדיקת מפעל)
  CONSIDERATION → **שוקל / משא ומתן**    (was: שוקל הצעה / מו״מ)
  LOST          → **אבוד**               (was: לא נסגר)

Source of truth: `V2_STAGE_LABELS` in
[lib/manychat/stages.ts](lib/manychat/stages.ts). NULL and INTAKE both
render as "קליטה" in the audit — Eli doesn't distinguish "still in
questionnaire" from "questionnaire done + auto-quote".

## Lead analyzer — the "נתח" button (built 2026-06-26)

Per-lead **bottom-up** sales analysis to understand why leads stall, surfaced
inside GHL. Replaces ad-hoc "read a few calls and guess". Lives in
[lib/analysis/](lib/analysis/).

**Engine ([lib/analysis/analyze-lead.ts](lib/analysis/analyze-lead.ts)):**
`analyzeLead(sid, {force})` →
1. **dossier** ([build-dossier.ts](lib/analysis/build-dossier.ts)) — assembles
   ONE lead's full data: all call transcripts+analyses (GHL calls join
   `ghl_contact_id`, ElevenLabs join phone digits), full WhatsApp timeline
   (`messages`), quote history (`bot_quotes`). Hebrew render + `hashDossier`.
2. **cache** — `input_hash` (hash of the dossier). If the latest `lead_analyses`
   row matches → return it (no LLM, no cost). New message/call → hash differs →
   re-analyze. This is why repeat clicks are instant + free.
3. **judge** — gpt-4o (`LEAD_ANALYSIS_MODEL` || `OPENAI_ANALYSIS_MODEL` ||
   "gpt-4o") fills a strict structured verdict (`LeadAnalysis`): root_cause,
   `primary_blocker` (closed enum), objections w/ verbatim quotes,
   price_forensics, commitment_scorecard, etc.
4. **grounding self-check (the anti-cherry-pick guardrail)** — `isGrounded()`
   drops any objection whose quote isn't actually present in the dossier.
   DETERMINISTIC, not a second LLM pass.
5. **persist** `lead_analyses` + **post GHL contact note** (marker
   `[LEAD-ANALYSIS v1] sid=<sid> h=<hash8>`, dedup via `listContactNotes`).

**Data model:** `lead_analyses` (manychat_sub_id, verdict jsonb, input_hash,
model, version, created_at) — created via direct DDL, NOT `drizzle-kit push`
(push hangs on a create-vs-rename TUI prompt re: orphan `configurator_*`
tables). Latest row per sid is the current verdict.

**Surfaces (both frontends):**
- **Per-lead:** "🔍 נתח" tile in the widget inbox
  ([components/inbox/LeadAnalysisInline.tsx](components/inbox/LeadAnalysisInline.tsx))
  + "ניתוח" tab in v3 `ExpandedLead`. Endpoint
  [/api/widget/analyze-lead](app/api/widget/analyze-lead/route.ts) +
  `analyzeLeadAction`.
- **Filtered bulk + aggregate:** "🔍 ניתוח" hub tab
  ([components/analysis/AnalysisScreen.tsx](components/analysis/AnalysisScreen.tsx))
  + `/dashboard/v3/analysis`. Filter by stage/date/has-calls/batch, run+continue
  with progress, then a **deterministic rollup** of blockers/objections — a pure
  groupby over stored verdicts ([aggregate.ts](lib/analysis/aggregate.ts)), no
  second LLM → can't cherry-pick. Lib: [batch.ts](lib/analysis/batch.ts)
  (`analyzeBatch`, skip-already-analyzed). Endpoints
  `/api/widget/analyze-batch`, `/api/widget/analysis-aggregate`,
  `/api/admin/analyze-leads`, `/api/admin/analysis-aggregate`.

**Blocker → play (the salesperson script).** The verdict's `primary_blocker`
maps to a "play" (what to say now) — driven by the ANALYSIS, not the often-stale
manual `pipeline_stage`. Plays are **editable from the UI** ("✏️ ערוך פליז" in
the analysis tab) → stored in `app_config` key `sales.plays`
([plays-store.ts](lib/sales/plays-store.ts)), merged over `DEFAULT_PLAYS`
([stage-plays.he.ts](lib/sales/stage-plays.he.ts)). Full 6-stage reference:
[docs/SALES-PLAYBOOK.he.md](docs/SALES-PLAYBOOK.he.md). Objection→reply taxonomy:
[lib/sales/objection-playbook.he.ts](lib/sales/objection-playbook.he.ts).

**Core lesson — never let the LLM guess a fact the DB knows.** Two corrections
proved this:
- The judge's `followup_verdict` ("promised but didn't deliver") read **92%** —
  false. It conflated bot messages and missed delivered quotes. Replaced with a
  DETERMINISTIC rule in [aggregate.ts](lib/analysis/aggregate.ts): a drop = the
  CUSTOMER sent the last message and it's been >3 days. Real number **~13%**.
- Same principle as the quote grounding check. If a metric smells wrong, it's
  probably an LLM read that should be a direct query.

**Footguns:**
- **Prod-keys-only.** Engine needs OPENAI + GHL keys → only runs in prod.
  Locally `vercel env pull` masks them to empty, so `analyzeLead` soft-fails
  (and the soft-fail path does NOT persist → those leads retry next run). Test
  deterministic parts with `scripts/_test-lead-analysis.ts` (stubbed judge).
- **OpenAI 30K TPM tier.** Big dossiers (~46k chars) at concurrency 3 hit 429s.
  `build-dossier` trims render to ~14k chars and keeps summaries+messages first
  (transcripts are the trimmable tail). Bulk-seed paced: `scripts/_run-analysis-paced.ts`.
- **No physical samples (business rule).** Albadi does NOT send samples (delays
  the sale). The `sample_trust` play uses photos/video/social-proof, and the
  aggregate labels "asked to see product" as a SIGNAL, not a failure.
- To **seed all leads**: `POST /api/admin/analyze-leads` (BOT_SECRET, in prod)
  or click "נתח הכל" on the screen. Each gpt-4o call costs money.
