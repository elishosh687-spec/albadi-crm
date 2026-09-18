# Bot layer, setter, lead analyzer

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## The bot layer — who says what (rebuilt 2026-08-16/17)

**Read [bot design/09-bot-map.md](bot design/09-bot-map.md) first**, and the
LIVE map at מגרש בדיקות → "🗺 מפת הבוט", which reads the real settings and job
cursors on every open. A written map rots; that tab cannot.

**The division of labour, which is now the organising principle:**

| Job | Owner |
|---|---|
| Questionnaire + all price maths | **Code**, deterministic. Never move this. |
| WHEN to speak, to WHOM, how often | **Code** — cadence, attempt cap, quiet hours, Sabbath, `bot_paused` |
| WHAT is said | **The setter** (`lib/setter/`) — follow-ups, live replies, and the phrasing of the 14 state-change moments |
| Whether the transition happens | **Code** — the setter only supplies words |

"Code decides and executes, the sales brain talks." When adding a customer-facing
message, ask which half it belongs to — a sentence fused to a state change
(accept → ask for logo) splits: code does the transition, `phraseStateReply`
writes the sentence, and `mustMention` guarantees the operative ask survives.

**⚠️ Every LLM path degrades to a fixed fallback, by design.** Follow-ups fall
back to the canned template, `phraseStateReply` to the canned sentence,
transcription from ElevenLabs to OpenAI. This is not defensive padding: on
2026-08-17 the OpenAI account ran out of credits and every AI path went dead
for a full day — customers still got their follow-ups, in the old wording,
because the fallback held. **Never add an LLM send path without one.**

**⚠️ Failures here are SILENT.** Nothing errors; the system just gets stupider.
`setter_decisions.draft_text IS NULL` across a window means the LLM is dead —
that is how the credit exhaustion was found, and how the `temperature` bug was
found before it. When "the bot sounds dumb", check that column first.
`npx tsx scripts/_check-ai-health.ts` (with the neonctl `DATABASE_URL`) prints
all five jobs at once, so a partial recovery is visible rather than averaged.

**⚠️ Topping the credits back up does NOT self-heal the queue.** Recordings that
failed during the outage reached `attempts=3` and went terminal `failed`, which
excludes them from every stage forever. Re-queue only those —
`scripts/_reset-credit-failures.ts` matches on `last_error ILIKE '%no credits
remaining%'` and leaves genuine failures ("returned no text", timeouts) alone —
then POST `/api/bot/process-recordings` with `CALL_TRIGGER_SECRET`. Verified
2026-08-17: 8 rows re-queued, all 8 transcribed → analyzed → posted.

### ⚠️ Never put a concrete value in a prompt as an "example"

The appointment skill carried *"(למשל 'היום ב-17:00 או מחר ב-11:00')"*. The
generator copied it verbatim: 30/08–01/09/2026, **20 of 26** messages naming an
hour named exactly those two, to 18 customers, and **6 offered "היום ב-17:00"
after 17:00 had passed** (one at 19:20). An example is indistinguishable from
an instruction, and a value that must also be TRUE RIGHT NOW is doubly wrong —
the model has no clock.

Hours now come from [lib/setter/slots.ts](lib/setter/slots.ts)
(`proposeCallSlots`): real Israel working hours, never within 90 minutes, never
on a Sabbath or holiday, one slot per day over consecutive working days, and
**shifted per lead** so two customers don't hear the same slot. The generator
gets the exact strings, sees them ONLY when the goal is `book_call`/`revive`,
and `validateMessage` rejects any hour — **and any day** — that wasn't offered.
Validating the hour alone is not enough: "היום ב-17:00" at 19:20 uses an hour
that is perfectly legal tomorrow.

**Two things that make this class of fix fail silently:**
1. **The stored copy shadows the constant.** Every skill has an editable twin in
   `app_config → bot.settings`; fixing `skills.ts` alone changes nothing.
   `scripts/migrate-setter-skill-hours.ts` rewrites only text still matching the
   old default and reports anything hand-edited.
2. A rejected message is not sent — both send paths honour `validation.ok` and
   fall back to the canned template — so a too-strict rule costs the customer a
   real reply, not a wrong one. That is why the windows are hidden on non-booking
   turns.

### ⚠️ The setter must never name a superseded amount

`buildSalesContext` read `bot_quotes` — the questionnaire's own auto-estimate.
When Eli sends a real quote afterwards (a `factory_quote_requests` row with
`sent_to_customer_at`, or him pasting a price into WhatsApp) that number is
history. בתאל got "בהצעה של ₪2,610" for two days after Eli had sent her ₪4,470
and ₪5,800. `findNewerCustomerQuote` now checks both sources; when something
newer exists, `quote.totalIls` is **null on purpose** (he routinely sends two
quantities as options, so picking one would be a guess) and the money guard in
`validateMessage` then rejects any ₪ figure in the message.

### ⚠️ A file is never a spec change

`handleDecisionInbound` passed only the caption to `handleDecisionStage`, so an
image's caption was classified as text. Eleven_Four_jeans sent his logo with the
caption "logo black boxer -2" — the extractor "read" a colour count out of it,
the bot cut the order from 2 print colours to 1 and re-sent the whole opening
block (quote + about-us + links) one minute after he had received it. He
answered "המחיר לא רלוונטי" and the lead is LOST. Media at the decision stage
now routes to `handleLogoStage` like everywhere else: acknowledge, DM Eli, pause
the bot. A wrong label on an escalation costs nothing next to a wrong requote.

### What is configurable (settings screen, `bot.settings`)

~30 fields across 10 groups, including: all editable customer copy, the
follow-up cadence per stage (`"2,12,23"` = hours per attempt, clamped so a `0`
cannot become a spam loop — see [followup-cadence.ts](lib/autoresponder/followup-cadence.ts)),
the auto-resume window, the setter's 10 tactics, **the two analyst briefs**,
and every model. Adding a field: schema → FIELD entry → **wire it**; an unwired
field is a lie.

**The analyst prompts split in two** ([analysis-defaults.ts](lib/bot-settings/analysis-defaults.ts)):
the BRIEF is editable, the JSON SCHEMA is not and is appended in code. Every
schema field is read by name downstream (GHL note, callback task, setter
dossier) — an edited schema would end analysis silently, not degrade it. The
defaults live in a pure client-safe module ON PURPOSE so the settings screen
can display them; importing them from the analysers would drag a server module
into the client bundle.

### Models — one job each, all in settings

| Job | Setting |
|---|---|
| Answers customers | `setterModel` |
| Transcribes calls | `transcribeProvider` + `transcribeModel` |
| Analyses the transcript | `analysisModel` |
| Writes "why it's stuck" | `analysisModel` |
| Understands the customer | `intentModel` |

**Speaker separation is a PROVIDER choice, not a model choice.** No OpenAI
transcription model diarizes. `transcribeProvider: "elevenlabs"` uses Scribe
(reusing the voice-agent key), returns "דובר 1 / דובר 2", and also clears
Whisper's 25MB ceiling. Falls back to OpenAI on any failure.

Three settings were LIES until 2026-08-17 — `analysisModel` did not reach call
analysis, `intentModel` did not reach reply suggestions, and transcription had
no setting. If a dropdown seems to do nothing, suspect this class of bug.

### bot_paused carries a reason and expires

A bare boolean left **81 of 117** active leads muted forever, so the setter
could reach 5 leads in the entire system. Leads now carry `bot_paused_at` /
`bot_pause_reason` / `bot_pause_sticky`, and an hourly sweep expires only the
reasons meaning "a human is driving this one": `human_reply`, `escalation`,
`logo_received`, `reengagement_reply`. `opt_out` and `human_handoff` are
promises to the customer and NEVER expire; `deal_won`, `no_reply` and
`manual_toggle` are deliberate.

**⚠️ GHL can un-pause, but not a customer's opt-out (fixed 2026-08-18).**
`bot_paused` is a GHL-owned shared field, so every resync pushes its value
back — and the three write sites set that one boolean bare while `pauseFields`
writes three columns. So a resync silently woke leads the bot had muted and
left `bot_pause_reason` behind as a ghost. Visible symptom: an escalated lead
came round again on the next tick, tripped the same cap, and DM'd Eli a second
time within the hour. `ghlPauseChange` / `applyGhlPause`
([bot-pause.ts](lib/autoresponder/bot-pause.ts)) now own that decision:
`opt_out` and `human_handoff` are **irrevocable from GHL** (promises to the
customer, not workflow bookkeeping), everything else stays Eli's to override,
and an un-pause clears the reason columns. `escalateLead` also suppresses its
DM when the lead is already `NEEDS_ELI`. If a pause "doesn't stick", this is
the first thing to check.

**Always pause via `pauseFields(reason)`** ([bot-pause.ts](lib/autoresponder/bot-pause.ts)).
A pause written by hand lands unattributed and becomes un-diagnosable again.
Resuming must reset `followUpCount` (else the first nudge trips the 3-strike
escalation and re-mutes instantly) and clear `botPauseSticky`.

### Scheduling reality

Sub-daily work runs on **GitHub Actions**, not `vercel.json` — the Vercel plan
fires crons once a day, which is why the follow-up cadence was fiction for
months (56 of 65 followed-up leads ever got exactly one nudge). GitHub disables
scheduled workflows after 60 days of repo inactivity; that is the expected way
this dies. `followups` claims a row in `app_config` for the length of a run so
overlapping triggers cannot double-send — **not** a pg advisory lock, which
Neon's per-query HTTP driver silently drops (verified: it granted the same lock
twice).

**The follow-ups tick runs to 120s, and three values must agree (2026-08-18).**
`maxDuration` in [app/api/bot/followups/route.ts](app/api/bot/followups/route.ts)
is **120**, and the workflow's `curl --max-time` is **150** — curl must OUTLAST
the function, or it aborts first and hands back an empty body that looks
identical to a timeout. The comments naming the ceiling (route + the workflow's
error text) are part of the same change; leaving them at 60 misinforms whoever
reads them next. The 5-minute run-lock still exceeds a 120s run, so a killed
lambda cannot wedge follow-ups shut.

**Why the failure emails looked like a bug and weren't.** A tick that composes
several LLM messages crossed the old 60s ceiling, Vercel killed the lambda, and
curl returned nothing — which the old workflow piped straight into `json.load`,
so it surfaced as `JSONDecodeError: Expecting value: line 1 column 1`, naming
neither the endpoint nor the timeout. The step now captures body and status
separately, **retries once after 30s** (safe: the run-lock returns
`already_running`, so nobody is nudged twice), prints the actual response when
it isn't JSON, and treats `ok:false` as failure. Genuine breakage still fails
loudly — the inbox should mean something. If failures become *routine* rather
than a blip, the fix is fewer leads per tick, not a bigger timeout.

### "להתקשר בעתיד" — the parked bucket books calls (built 2026-08-17)

`FUTURE_FOLLOW_UP` held **45 active leads** — the largest non-terminal bucket in
the system, 25 holding a quote we wrote — and **nothing touched them**: no rule
matched the stage, `pipeline-audit` listed it under `HANDS_OFF_STAGES`,
`ghl-tasks/derive` left it out of `ACTIVE_STAGES`, and `lib/ghl/next-action.ts`
mapped it to `schedule_callback`, a string no code reads. Every tick they landed
in `no_rule` and were dropped.

**The objective is a booked phone call, not a reply.** The setter already knew
how (`goal: revive` → `ghost_recovery` + `appointment_booking`), and
`handleCallbackReply` was already the only text→task bridge in the codebase.
What was missing was a rule to reach them and a bridge to catch the answer.

- **Rule** in `STAGE_RULE_SHAPES` — cadence `168,168,336,504` (widening on
  purpose), **bounded** at 4 (unlike RE_ENGAGEMENT, which may run forever because
  Eli fills it one deliberate decision at a time). `gate` + `maxAttemptsKey` +
  `dailyCapKey` are new per-rule fields; the gate lives in
  [lib/autoresponder/future-followup.ts](lib/autoresponder/future-followup.ts).
- **Entry is MANUAL** (Eli, 17.8). Exhausting the normal follow-ups still freezes
  a lead at `NEEDS_ELI` + a permanent `no_reply` pause, exactly as before.
- **Ships OFF** — `futureFollowupEnabled`, plus five knobs (cadence, attempts,
  daily cap, min silence, max age). A **dry run ignores the master switch** so
  the messages can be reviewed without handing the 15-minute cron a live
  population of cold customers.
- Every message carries the opt-out footer via `withOptOutFooter`, so enabling
  this **will produce some LOST leads** — that is correct, a decided lead beats a
  frozen one, but it should not be a surprise.

**Four things would have made it inert, and each is a trap worth recognising:**
1. **The 7-day restart ate the reply.** `isNewConversation` restarts the
   questionnaire for anyone silent that long — which is every lead this loop
   targets. A customer answering "מחר ב-11" would have been asked their quantity
   again. Both revival stages and any lead with `callbackFlow='awaiting_reply'`
   are now exempt, in **both** webhooks.
2. **`revive` is gated on a quote existing**, and 20 of the 45 have none. They
   fell to `hold_back`, whose messages `validateMessage` **forbids** from naming
   a time — the bot was mechanically barred from its one job. A parked-stage
   branch in [strategy.ts](lib/setter/strategy.ts) books the call anyway.
3. **`follow_up_count` was never reset on a stage change**, so a lead dragged in
   from an exhausted INTAKE arrived with its budget spent (22 of 45).
   `enterFutureFollowUp` fixes entry; `scripts/_prepare-parked-bucket.ts`
   backfilled the residents.
4. **A non-time reply reached no handler at all** — the routing chain covers
   INTAKE/FACTORY_WAIT/CONSIDERATION/DISCAVERY only, so a cold lead who finally
   wrote back got silence. It now routes to `handleReengagementInbound` with
   `openTask`.

**⚠️ `leads.last_response_at` is a dead column** — readers in
`ghl-tasks/derive.ts` + `reconcile.ts`, **zero writers** anywhere. Any gate built
on it passes everything. (Which also means `derive.ts`'s `idle_active_lead` task
has never fired — separate ticket.) Silence age is computed from `messages`.

**The `skipped_*` buckets are the point.** Everything unhandled used to collapse
into `no_rule` (34 of 120), and that one undifferentiated bucket is how 45 leads
stayed invisible for months. A dry run now separates "the rule said not yet"
(`skipped_snoozed` / `too_fresh` / `too_cold` / `quota` / `internal`) from "nobody
wrote a rule". Verified 17.8: `no_rule` 34 → 13, exactly the 21 unpaused parked
leads.

**The daily cap is not optional.** On the first enabled tick every parked lead is
due at once (their `last_follow_up_at` is null), and the 15-minute cron would
drain the backlog in an afternoon. `claimFutureDailySlot` is the same
`app_config` row-claim as the run lock, atomic under a Jerusalem-day reset. A dry
run counts against it **in memory only** — otherwise the preview both lies about
the day and blows the 60s route budget composing 40+ LLM messages.

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
