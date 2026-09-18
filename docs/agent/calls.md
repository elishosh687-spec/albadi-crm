---
paths:
  - "app/api/bot/process-recordings/**"
  - "app/api/elevenlabs/**"
  - "lib/transcription/**"
  - "lib/autoresponder/call-analysis.ts"
  - "lib/autoresponder/callback-request.ts"
  - "scripts/export-call-transcripts.ts"
  - "scripts/export-whatsapp.ts"
---

# Calls — GHL recordings, ElevenLabs agent, callback flow

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

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

**Trigger (2026-07-08 — CHANGED, read this).** `process-recordings` is triggered
by a **GitHub Actions cron** (`.github/workflows/process-recordings.yml`,
`*/5 * * * *`) that POSTs the prod endpoint with the `CALL_TRIGGER_SECRET` repo
Actions secret (which `authorized()` accepts alongside BOT_SECRET). NOT a
vercel.json cron — **the Vercel plan only runs crons once/day, so a `*/5` vercel
cron never fires** (verified 2026-07-08: cursor didn't advance in 8 min). It was
ORIGINALLY an external claude.ai routine that **silently died on 2026-07-06**
(likely the Vercel spend-pause → 402) and stalled the WHOLE pipeline for 2 days —
no transcription/analysis/notes AND no "Last Call Date" stamps. If calls stop
processing again, check: (1) is the GitHub Action running/enabled (Actions tab —
GitHub disables scheduled workflows after 60d of repo inactivity)? (2) is the
deployment spend-paused (curl the prod URL → 402)? (3) has the
`call_recordings.last_polled_at` cursor in `app_config` gone stale? Manual kick:
`gh workflow run process-recordings.yml`, or POST the endpoint with
`CALL_TRIGGER_SECRET` (retrievable via `vercel env pull` — it's non-sensitive).

**GHL calls are POLLED, not pushed.** Unlike WhatsApp (bridge webhook, real-time),
GHL never webhooks us a call — stage 1 polls `searchCallMessages` every tick. So
if the cron isn't running, calls are never ingested AT ALL (the field/notes gap
is an ingestion gap, unrelated to transcription). Manual catch-up: a scratch
script calling `searchCallMessages({limit:100})` + inserting rows
(completed→`pending`, non-answered→`no_answer`), dedupes on `ghl_message_id`.

**"Last Call Date" GHL field (2026-07-08).** Calls-only, sortable column in GHL
Contacts (GHL's native "Last activity" mixes calls + WhatsApp/SMS). GHL custom
field `GHL_FIELD_LAST_CALL_AT` (id `VGXhVbDq8sfjmxvvOo0U`, DATE). Stamped to
`MAX(call_started_at)` over ALL a contact's calls — answered AND unanswered
(stage 1 now ingests non-answered calls as terminal `no_answer` rows; `stampLastCall`
runs in stage 1 on new calls + stage 4 on post-back). Backfilled via
`scripts/backfill-last-call-field.ts`. To add the column: GHL Contacts → Manage
fields → "Last Call Date".

**Reading the transcripts outside the CRM.** They live only in
`call_recording_imports.transcript` (+ `.analysis` jsonb) and
`elevenlabs_call_imports`. `npx tsx scripts/export-call-transcripts.ts` writes
them out as markdown — **a file per customer** by default (every call oldest
first, the analysis above each transcript) or `--by call`, plus an `index.md`.
Output goes to `content/albadi/call-transcripts/`, deliberately OUTSIDE the
repo: it is 2.8MB of real customer conversation and must never reach a git
working tree. The run wipes and rewrites the folder, so it is always current
and never half-stale.

**The WhatsApp side exports too** — `npx tsx scripts/export-whatsapp.ts
--with-calls` writes a file per customer to `content/albadi/whatsapp/`: every
message AND every call transcript in ONE chronological timeline, opening with
that lead's latest analyst verdict. That combined view is the actual story of a
customer (the quote on WhatsApp, the call where he pushed back, the silence
after) and is what to reach for; the calls-only export is the narrower tool.
Eli's own alert thread is excluded unless `--include-eli`.

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

## Callback-time flow — "מתי נוח לכם לדבר?" (built 2026-07-14, DORMANT/OFF)

When a lead goes quiet **recently** (30 min – 6h) in a trigger state, the bot
sends ONE context-aware WhatsApp asking when's a good time to talk; when the
customer replies with a time, a task opens for Itay + the bot confirms. Turns a
silent lead into a scheduled call.

**Gated OFF** behind `CALLBACK_REQUESTS_ENABLED=1` (not set in prod → deployed
but inert: the detector sends nothing, the inbound hook is dormant until a lead
carries `qState.callbackFlow`). Respects quiet hours + no-send days.

- **Triggers** (silent 30min–6h, once/lead): quote sent (INTAKE), questionnaire
  incomplete (NULL), brand-new lead never replied, GHL call `no_answer`. Windowed
  30min–6h so it does NOT blast the months-old backlog; internal/test leads
  excluded (name ~ אלבדי/test/config/בדיקה).
- **Code:** [lib/autoresponder/callback-request.ts](lib/autoresponder/callback-request.ts).
  Detector `POST /api/bot/callback-requests` (`?dry=1` = compose + return
  candidates, send nothing — safe review). Inbound reply→task hook is in
  [app/api/greenapi/webhook/route.ts](app/api/greenapi/webhook/route.ts) BEFORE
  the normal handlers. State: `qState.callbackFlow` (awaiting_reply/answered/declined).
- **To enable (needs Eli's OK — sends real customer messages):** (1) set
  `CALLBACK_REQUESTS_ENABLED=1` in Vercel prod; (2) add a ~30-min trigger (GitHub
  Action, like process-recordings) POSTing the detector; (3) test on ONE
  disposable lead first (reply with a time → task appears).
