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

- GHL calls are POLLED, never pushed: `process-recordings` stage 1 polls `searchCallMessages`; if the cron stops, calls are not ingested at all. Trigger is GitHub Actions `.github/workflows/process-recordings.yml` with `CALL_TRIGGER_SECRET` — NOT `vercel.json` (Vercel crons run once/day, a `*/5` never fires).
- `call_recording_imports`, `ghl_message_id` UNIQUE; status `pending → transcribing → analyzing → posted`, terminals `failed` (`MAX_ATTEMPTS=3`), `skipped_oversize` (>25MB Whisper limit), `skipped_voicemail`, `no_answer`. `failed` rows are excluded from every stage until manually reset.
- Stages run independently, per-row gated, cap 5/stage/tick (`maxDuration=300s`).
- Cursor `app_config` `call_recordings.last_polled_at`; each tick rewinds 30min and relies on the UNIQUE constraint for dedupe.
- GHL quirks: `/conversations/messages/search` rejects `type=TYPE_CALL` (422) — use `/conversations/search?lastMessageType=TYPE_CALL` then `/conversations/{id}/messages` (array nested `messages.messages`). `startAfterDate` is a pagination cursor, not a date filter.
- Post-back idempotency: note's first line is marker `[CALL-ANALYSIS v1] msg=<ghl_message_id>`; check `listContactNotes` before `addContactNote`. Keep the marker stable.
- "Last Call Date" (`GHL_FIELD_LAST_CALL_AT`) = `MAX(call_started_at)` incl. unanswered; `stampLastCall` runs in stages 1 and 4.
- Transcript exports (`scripts/export-call-transcripts.ts`, `scripts/export-whatsapp.ts`) write to `content/albadi/...` OUTSIDE the repo — real customer conversations must never reach a git working tree.
- ElevenLabs sync (`app/api/elevenlabs/sync-calls/route.ts`) is an additive sibling — never touches `process-recordings`' table. `elevenlabs_call_imports`, `conversation_id` UNIQUE, cursor `elevenlabs.last_polled_unix`, marker `[CALL-ANALYSIS-11L v1] conv=<id>`. It runs only via a non-fatal `fetch` at the end of `process-recordings`.
- Editing the agent: never send `conversation_config.agent.language` in `PATCH /v1/convai/agents/{id}` — it 400s.
- Recording proxy `app/api/elevenlabs/recording/[id]/route.ts` needs `ELEVENLABS_API_KEY` in prod or it 502s and the audio attach silently fails (note still posts).
- Callback-time flow (`lib/autoresponder/callback-request.ts`) is OFF behind `CALLBACK_REQUESTS_ENABLED=1`; enabling sends real customer messages — needs Eli's OK. Its reply→task hook sits in `app/api/greenapi/webhook/route.ts` BEFORE the normal handlers; state `qState.callbackFlow`. `?dry=1` on the detector sends nothing.

Full detail: `docs/agent/calls.md` — read it before non-trivial changes here.
