# Albadi CRM — Architecture (How it's built today)

> נכתב 2026-05-13. מתאר את המערכת **כפי שהיא בקוד היום**, post-bridge-cutover.
> לא PRD (why) ולא feature list (what) — זה ה-**how**.
> מחליף את `archive/FOLLOWUP-SPEC.md` שתיעד את הגרסה הישנה.

---

## 1. System diagram

```
                  ┌─────────────────┐
                  │  WhatsApp user  │
                  └────────┬────────┘
                           │ DMs
                  ┌────────▼─────────┐
                  │  whatsapp-bridge │ (self-hosted Fly.io VPS)
                  │     tenant       │
                  └────────┬─────────┘
                           │ HMAC-signed webhooks
                  ┌────────▼──────────────────────────────┐
                  │  Next.js (Vercel)                     │
                  │  /api/bridge/webhook ──► autoresponder│
                  │  /api/bot/followups  ──► cron         │
                  │  /api/drafts/*       ──► Retool       │
                  │  /api/leads/*        ──► Retool       │
                  │  /dashboard/v3       ──► Eli          │
                  └────────┬──────────────────────────────┘
                           │ Drizzle ORM
                  ┌────────▼─────────┐
                  │  Neon Postgres   │
                  └──────────────────┘
                           ▲
                  ┌────────┴─────────┐
                  │  Retool console  │ (elishosh.retool.com)
                  └──────────────────┘
                           ▲
                  ┌────────┴─────────┐
                  │       Eli        │
                  └──────────────────┘
```

קישוריות נלוות:
- **Cloud routine** (claude.ai/code) — קורא ל-`/api/bot/followups` כל שעה (גיבוי ל-Vercel cron יומי).
- **OpenAI** — קריאת LLM אחת לכל הודעת לקוח (intent classification + draft generation).
- **Eli's WhatsApp** — escalation DMs מהבוט (`sendEliDM`).

---

## 2. Tech stack

| Layer | Tech | למה |
|---|---|---|
| App | Next.js App Router | server actions, file-based routes, easy Vercel deploy |
| Runtime | Vercel Hobby | free, integrated, no devops |
| DB | Neon Postgres | serverless, free tier, supports Drizzle |
| ORM | Drizzle | typesafe, no codegen, fast |
| WhatsApp | whatsapp-bridge-node (self-hosted) | no Cloud API 24h limit, full control |
| LLM | OpenAI | reliable intent classification |
| UI extras | Retool | quick supervisor UI for heavy flows |
| Auth | Cookie (`albadi_auth`) + Bearer | single-user, no SSO |

---

## 3. Database schema

| Table | מטרה |
|---|---|
| `leads` | Source of truth לכל מצב של ליד. כל הfields של ManyChat לשעבר חיים כאן. |
| `lead_tags` | רב-ל-רב: ליד → tag (שם בעברית). דחוף / עסקה_גדולה / etc. |
| `messages` | היסטוריית WhatsApp בשני הכיוונים. dedupe via `wa_message_id`. |
| `bridge_events` | Audit log של כל webhook envelope. unique by `evt_id` (dedupe retries). |
| `bot_drafts` | Money-moment drafts ממתינים לאישור. pending/approved/rejected/sent/failed. |
| `bot_config` | KV של feature flags / business thresholds עריך מהדאשבורד. |
| `app_config` | KV (JSONB value) לתמחור + shipping + FX. מופרד מ-bot_config (קהל עורכים שונה). |
| `factory_quote_requests` | Row לכל "שלח לפבריקה". lifecycle: pending → received → finalized. |
| `bot_quotes` | Append-only audit של כל הצעת מחיר שהבוט שלח. initial + requote. |
| `crm_contacts` | גוף contact (phone unique). נפרד מ-leads כי contact = אדם, lead = עסקה. |
| `crm_lead_episodes` | Episode = מחזור חיים של ליד (lifecycle_stage, operational_status, score). |
| `crm_tasks` | משימות follow-up לאלי (open/completed, due_at). |
| `crm_sla_timers` | SLA timers per lead — starts_at / due_at / breached_at / resolved_at. |
| `lead_score_snapshots` | Append-only snapshot של lead score (fit/intent/engagement/friction → total). |
| `source_touches` | Multi-touch attribution — ערוץ ראשון + detail. |
| `opportunities` | Opportunity per lead (pipeline_stage, value_ils, won_at/lost_at). |
| `consent_records` | Audit של הסכמת לקוח (type, status, captured_at/revoked_at). |
| `bot_decision_log` | **Phase 1 supervisor.** One row per inbound. Captures LLM supervisor verdict + what code did + Eli's later action. Foundation for Phase 2 few-shot + Phase 3 rule extraction. |

### עמודות עיקריות על `leads`

```
manychat_sub_id  PK (JID for bridge / numeric for legacy ManyChat)
wa_jid           E.164 → JID resolution
phone_e164       canonical phone
email            customer email (added 2026-05-22; GHL-mirrored)
name             from contact info / manual
pipeline_stage   NULL (pre-quote) | INITIAL_QUOTE_SENT | AWAITING_FIRST_RESPONSE | SHOWED_INTEREST | FACTORY_CHECK | FINAL_QUOTE_SENT | NEGOTIATING | WON | LOST
                 (LOST requires loss_reason; FACTORY_CHECK uses qState.subFlow=awaiting_logo|awaiting_factory_estimate)
next_action      sub-state inside stage (e.g. awaiting_reason, awaiting_competitor_offer)
last_response_at when the customer last replied
loss_reason      required when pipeline_stage=LOST — one of LOSS_REASONS (lib/manychat/stages.ts)
priority         low | normal | high | urgent
owner_id         denormalized from crm_lead_episodes.owner_id
bot_summary      LLM-generated summary for Eli
notes            free-text Eli notes
quote_total      ILS estimate (numeric)
quote_alt        alternative quote (numeric)
q_state          JSONB (questionnaire step + answers)
follow_up_count  cadence counter
last_follow_up_at  timestamp
bot_paused       boolean — bot silent if true (auto-resets on inbound)
pipeline_flag    NEEDS_ELI | NULL — escalation flag
```

### `lead_tags`

```
manychat_sub_id  FK → leads
tag              Hebrew name string (דחוף, עסקה_גדולה, ביקש_שיחה, אחרי_החג, מועדף)
set_at           timestamp
```
מספרי ה-ID הישנים של ManyChat שורדים ב-`lib/manychat/config.ts` ל-backward compat בלבד.

### `messages`

```
manychat_sub_id  FK
direction        inbound | outbound
text             body
payload          JSONB raw webhook
wa_message_id    UNIQUE (bridge id, used for dedupe)
sender           lead | bot | eli (NULL on legacy pre-migration rows)
received_at      WA timestamp
ingested_at      insert timestamp
```

### `bot_drafts`

```
id                  PK
manychat_sub_id     FK
draft_text          LLM output
edited_text         אופציונלי — אלי ערך לפני שליחה
status              pending | approved | rejected | sent | failed
money_reason        stage_gate | discount_request | price_question | negotiation | commitment | manual
llm_confidence      0-1
pipeline_stage_at_gen  snapshot של ה-stage כשנוצר
trigger_message_id  FK → messages
generated_at, decided_at, sent_at  timestamps
sent_wa_message_id  bridge id אחרי send
reject_reason       אופציונלי
```

---

## 3b. GHL ↔ DB sync direction

GHL = primary UI (pipeline, inbox, contact edits). DB = silent engine (bot
logic, quote calculations, `bot_quotes` history, messages). Two-way sync
with strict directionality per field.

```
                       ┌──────────────────────┐
                       │       GHL UI         │
                       │ pipeline / inbox /   │
                       │ notes / contact card │
                       └──────────┬───────────┘
                                  │
        ┌─────────────────────────┴───────────────────────────┐
        │ DB → GHL (push, integrations/ghl/sync.ts)           │
        │   • upsertGHLContact (name, phone, custom fields)   │
        │   • createOrUpdateGHLOpportunity (stage from bot)   │
        │   • forwardMessage (every WA in/out → GHL thread)   │
        │                                                     │
        │ GHL → DB (webhook, app/api/ghl/*)                   │
        │   • stage-changed   → leads.pipeline_stage          │
        │   • ghl-tag         → lead_tags add/remove delta    │
        │   • ghl-custom-field → bot_paused, follow_up_date   │
        │   • resync (catch-all) → full contact pull:         │
        │       name, phone, email, tags, customFields,       │
        │       notes, tasks, opportunity stage/status/value  │
        │   • outbound (Eli replies in GHL Inbox) →           │
        │     sendBridgeMessage(sender='eli') + messages row  │
        └─────────────────────────┬───────────────────────────┘
                                  │ Drizzle
                       ┌──────────▼───────────┐
                       │   Neon Postgres      │
                       │ leads, bot_quotes,   │
                       │ messages, drafts     │
                       └──────────────────────┘
```

**Quote-result ownership.** Bot calculator results live exclusively in DB:
- `leads.qState.quoteResult` — latest quote text (overwritten on requote).
- `bot_quotes` — append-only history (quoteTotalIls, quoteAltTotalIls,
  qState snapshot, source='initial'|'requote'). Written by `logBotQuote` in
  [lib/autoresponder/quote-log.ts](../lib/autoresponder/quote-log.ts).
- `leads.quoteTotal` — final quote price, written **only** when Eli sends
  the final quote via the dashboard (`app/actions/v2.ts` → `sendFinalQuote`).

GHL stores `quote_total` as a mirror custom field only; the calculator
widget reads/writes via the Albadi API.

**Loop guard.** DB→GHL push and GHL→DB webhook can fight when both fire on
the same lead. Resolution is by stage equality: when the bot updates DB and
pushes to GHL, GHL skips the no-op PUT if the resolved stage id matches.
When GHL pushes to DB and the bot's next cron run re-classifies to the
same stage, the push is also a no-op.

### Field-ownership matrix (2026-05-22)

**Rule of thumb: GHL is source of truth for everything Eli edits in the UI.
DB is source of truth for bot-internal state that GHL can't represent.**

Shared fields — GHL → DB on change (via resync webhook):

| GHL field            | DB target                          | sync direction |
|----------------------|-----------------------------------|----------------|
| Contact.name         | `leads.name`                      | GHL → DB       |
| Contact.phone        | `leads.phone_e164`                | GHL → DB       |
| Contact.email        | `leads.email`                     | GHL → DB       |
| Contact.tags         | `lead_tags(manychat_sub_id, tag)` | GHL → DB (diff)|
| Contact.customFields | `leads.bot_summary, quote_total, loss_reason, bot_paused, pipeline_flag` | GHL → DB |
| Contact.notes        | `leads.notes` (all notes concat)  | GHL → DB       |
| Contact.tasks        | `crm_tasks` (upsert by ghl_task_id)| GHL → DB      |
| Opportunity.stage    | `leads.pipeline_stage`            | GHL → DB       |
| Opportunity.status   | `leads.pipeline_stage` (WON/LOST) + `opportunities.won_at/lost_at` | GHL → DB |
| Opportunity.value    | `opportunities.value_ils`         | GHL → DB       |

DB → GHL push (bot-originated, integrations/ghl/sync.ts):

| DB write                       | GHL target                       |
|--------------------------------|----------------------------------|
| pipeline_stage (LLM classify)  | Opportunity.pipelineStageId      |
| bot_summary (LLM)              | Contact.customFields[bot_summary]|
| quote_total (calculator)       | Contact.customFields[quote_total]|
| crm_tasks (signal-derived)     | Contact.tasks                    |
| messages (every WA in/out)     | Conversations thread             |

DB-only fields (GHL never sees or touches):

| Field                              | Why DB-only                              |
|------------------------------------|------------------------------------------|
| `leads.q_state`                    | Questionnaire FSM, JSON with 10 keys, bot reads/writes 20× per chat |
| `leads.quote_alt`                  | Alt-shipping tier price, internal calc   |
| `leads.factory_spec_draft`         | In-progress factory spec, JSON           |
| `messages`                         | Bot needs 60-day history for classification |
| `bot_quotes`                       | Append-only quote audit + analytics      |
| `bot_drafts`                       | Money-moment draft queue                 |
| `bot_decision_log`                 | LLM trace + verdict per inbound          |
| `bot_config`, `app_config`         | Bot tuning, pricing, FX, shipping rates  |
| `factory_quote_requests`           | Feishu integration state                 |
| `bridge_events`                    | Webhook dedupe + audit                   |
| `crm_sla_timers`, `lead_score_snapshots`, `source_touches` | Operational scoring/triage |
| `ghl_lead_tasks`                   | Signal-derived task cache (auto, not user-edit) |

### Resync endpoint

`POST /api/ghl/resync` — full-pull GHL → DB for one contact.

- **Trigger:** GHL Workflow on any Contact Changed or Opportunity Changed event.
- **Body:** `{ contactId }`.
- **Behavior:** parallel GETs (contact + notes + tasks + opportunities)
  followed by a single idempotent merge into `leads`, `lead_tags`,
  `crm_tasks`, `opportunities`. Records `lead_events('ghl_resync', …)`
  for audit.
- **Auth:** `Bearer ${BOT_SECRET}`.

The narrower webhooks (stage-changed, ghl-tag, ghl-custom-field) remain for
low-latency single-field updates. Resync is the catch-all reconciler — if
GHL fires it once per minute on every change, we're still fine.

### Native App webhook

`POST /api/ghl/app-webhook` — receives native webhook events from the GHL
Marketplace App (separate from Workflow-triggered webhooks).

- **Trigger:** GHL Marketplace App subscriptions: `ContactCreate`,
  `ContactUpdate`, `ContactDelete`, `ContactTagUpdate`,
  `OpportunityCreate`, `OpportunityUpdate`, `OpportunityStageUpdate`,
  `OpportunityStatusUpdate`, `OpportunityMonetaryValueUpdate`,
  `OpportunityDelete`, `NoteCreate/Update/Delete`,
  `TaskCreate/Update/Delete`.
- **Auth:** HMAC-SHA256 on `x-wh-signature` (header) over the raw body,
  signed with `GHL_APP_WEBHOOK_SECRET`. When the secret isn't configured
  the handler accepts unsigned + logs a warning (dev-only mode — switch
  on for prod).
- **Dedupe:** every event is audit-logged to `bridge_events` keyed by
  `evtId = "app:${webhookId}"`. The insert uses
  `onConflictDoNothing + returning` and short-circuits on duplicate so
  GHL retries can't double-fire.
- **Routing:**
  - `Contact*` / `OpportunityXxx` / `Note*` / `Task*` → call `resyncContact(contactId)` to pull fresh state.
  - `ContactTagUpdate` runs BEFORE the resync and checks for the
    "start over" tag aliases (see FEATURES 1.8.2). When matched:
    cooldown check, tag removal from GHL + local mirror, then
    `restartQuestionnaire(sid)`. Tags without that meaning fall through
    to the resync path.

### Pipeline stages — env mapping & drift risk

GHL pipeline ("albadi") stages are mapped to local enum strings via
`GHL_STAGE_IDS` (`integrations/ghl/config.ts`) sourced from env vars.
Direction matters in both directions:

- **GHL → DB (resync):** `reverseLookupStage(stageId)` reads the env map
  in reverse. If the live GHL stage id isn't in the map,
  `resyncContact` silently skips the `pipeline_stage` write
  (`if (localStage) updateSet.pipelineStage = localStage`) — DB stays
  at the prior value.
- **DB → GHL (sync):** `pickStageId(lead)` reads the same map forward,
  pushing back to `Opportunity.pipelineStageId`.

**Failure mode (recurring):** if Eli adds a NEW stage in the GHL UI
without adding the matching env var, dragging an opportunity into that
stage reverts overnight. The webhook reads it → can't translate → DB
stays at the old stage → next `syncLeadToGHL` push (cron or inbound
message) pushes the old stage id back to GHL.

Current map (must match GHL exactly):

| Local key | env var | GHL stage name |
|---|---|---|
| INITIAL_QUOTE_SENT | `GHL_STAGE_INITIAL_QUOTE_SENT` | INITIAL_QUOTE_SENT |
| AWAITING_FIRST_RESPONSE | `GHL_STAGE_AWAITING_FIRST_RESPONSE` | AWAITING_FIRST_RESPONSE |
| SHOWED_INTEREST | `GHL_STAGE_SHOWED_INTEREST` | SHOWED_INTEREST |
| FACTORY_CHECK | `GHL_STAGE_FACTORY_CHECK` | FACTORY_CHECK |
| FINAL_QUOTE_SENT | `GHL_STAGE_FINAL_QUOTE_SENT` | FINAL_QUOTE_SENT |
| NEGOTIATING | `GHL_STAGE_NEGOTIATING` | NEGOTIATING |
| WON | `GHL_STAGE_WON` | WON |
| LOST | `GHL_STAGE_LOST` | LOST |
| FUTURE_FOLLOW_UP | `GHL_STAGE_FUTURE_FOLLOW_UP` | FUTURE_FOLLOW_UP |
| NO_RESPONSE_REENGAGE | `GHL_STAGE_NO_RESPONSE_REENGAGE` | NO_RESPONSE_REENGAGE |
| (virtual) NEEDS_ELI | `GHL_STAGE_NEEDS_ELI` | (not used today — `pipelineFlag = "NEEDS_ELI"` instead, no stage push) |

Whenever the GHL pipeline shape changes: run a stage diff diag
(`npx tsx scripts/_diag-ghl-stages.ts` style — script is one-shot, recreate
when needed), add the env var to Vercel (Production + Development; Preview
is gated on a non-main git branch which we don't use), update the table
above, redeploy via empty commit so the running runtime picks up the new
env.

---

## 4. Messaging adapter

קובץ יחיד: `lib/messaging/index.ts`. כל server-side code חייב לייבא דרכו.

```
USE_BRIDGE=1  →  re-export מ-lib/bridge/client.ts (DB-authoritative)
USE_BRIDGE=0  →  re-export מ-lib/manychat/client.ts (legacy)
```

Public API משותף לשני backends:
- `getSubscriber(id)` → `{ tags, custom_fields }`
- `addTag(id, tagId)` / `removeTag(id, tagId)`
- `setCustomFields(id, [{name, value}])`
- `getFieldValue(fields, name)`
- `getActiveSubscriberIds()`

Bridge-only:
- `sendMessage(recipient, message, mediaPath?)` → `{ wa_message_id }`
- `resolveJidFromPhone(phone)` → `jid | null`

**`sendBridgeMessage`** wraps `sendMessage` ומבטיח:
1. Insert outbound row ב-`messages` עם `sender='bot'` (default) או `'eli'` (manual reply).
2. Bridge send.
3. Webhook המאוחר יותר עושה dedupe ב-`wa_message_id`.

---

## 5. Bot flow (inbound → outbound)

```
bridge POST /api/bridge/webhook    (or /api/greenapi/webhook — same logic)
  │
  ├─ verify HMAC(BRIDGE_WEBHOOK_SECRET)
  ├─ check timestamp (5min replay window)
  ├─ insert bridge_events row (UNIQUE evt_id → dedupe)
  │
  ├─ if type=message.received:
  │    1. upsert leads row (auto-create from JID)
  │    2. insert messages row (sender=lead)
  │    3. forward inbound to GHL Inbox via after()  — non-blocking
  │    4. stop-word check → if matched:
  │         set pipeline_stage = "LOST", loss_reason = "opt_out",
  │         bot_paused = true; STOP_WORD_REPLY; DM Eli; syncLeadToGHL; return.
  │    5. clear bot_paused, reset followUpCount, log auto-unpause if bot was paused
  │    6. NO_RESPONSE_REENGAGE branch — if stage == "NO_RESPONSE_REENGAGE":
  │         handleReengagementInbound(): classify (interest/removal/ambiguous),
  │         pause bot, DM Eli, leave stage for Eli to move manually; return.
  │    7. questionnaireActive predicate (qState.step <= 9 && !doneAt && !bailed)
  │         — used in two places:
  │         a. supervisor hard-bypass (dispatchSupervisor returns approve_code
  │            instantly — no LLM call) so poll-vote replies don't pay 1-3s.
  │         b. legacy router prefers handleInbound (questionnaire FSM) over
  │            handleDecisionInbound regardless of pipeline_stage.
  │    8. routeThroughSupervisor():
  │         a. precomputeCandidateAction() — dry-run prediction of existing handler
  │         b. superviseIncomingMessage() — LLM gate (gpt-4o-mini)
  │              verdict ∈ {approve_code | override_with_text | escalate_to_eli | silence | supervisor_error}
  │         c. auto-send lane: if escalate + safe canned reply + high conf + zero risk → overrule to approve_code
  │         d. execute verdict:
  │              approve_code        → run handleInbound / handleDecisionInbound (legacy)
  │              override_with_text  → sendBridgeMessage(LLM text)  — NOT touching stage
  │              escalate_to_eli     → generateAndQueueDraft + sendEliDM (no auto-send)
  │              silence             → log only
  │              supervisor_error    → DM Eli, no send
  │         e. logDecision() — write row to bot_decision_log with LLM + code + replay metadata
  │
  ├─ if type=message.sent:
  │    1. dedupe by wa_message_id
  │    2. insert/update messages row (sender = inferred from sent_wa_message_id linkage)
  │
  └─ if type=delivered|read|failed|tenant.*:
       audit-log only (bridge_events). no state change.
```

### Latency budget (per poll-vote reply)

Optimized 2026-05-24 with three changes — see CHANGELOG. Target: server-side
under 500 ms on the happy path.

| Step | Type | Latency |
|---|---|---|
| Webhook ingress + JSON parse | net | 50–200 ms |
| Upsert lead + insert inbound message | DB | 20–150 ms |
| GHL inbox mirror (inbound) | net | **0 ms blocking** — fired via `after()` |
| Supervisor LLM | LLM | **0 ms** during questionnaire (hard-bypass) |
| `matchAnswer` | CPU | 1–5 ms |
| Spec-extractor LLM fallback (on `matchAnswer = null`) | LLM | 0 if matched; ≤1.5 s if fallback fires (timeout was 7 s) |
| `saveState` + `sendBridgeMessage` | DB + net | **parallel via Promise.all** (~200–500 ms) |
| GHL inbox mirror (outbound) | net | **0 ms blocking** — fired via `after()` |
| WhatsApp cloud → phone | net | 1–5 s (external SLA) |

### Background work via Next 16 `after()`

Pattern: any I/O that doesn't gate the HTTP response should run inside
`after(() => …)` so the lambda returns the response to the customer
immediately, then keeps running just long enough to finish the background
work. Failures stay logged in `bridge_events` so we can audit silently
dropped mirrors.

CLI scripts (tsx, cron-via-curl) fall through a try/catch — when
`next/server` import fails or `after()` isn't available, the call reverts
to inline `await` so we don't silently drop the side-effect.

Current background-work surfaces:

| Surface | What runs in background |
|---|---|
| `sendBridgeMessage` | outbound GHL inbox mirror |
| `app/api/greenapi/webhook` inbound | inbound GHL inbox mirror + `syncLeadToGHL` |
| `app/api/greenapi/webhook` outbound (eli manual) | outbound GHL inbox mirror |
| `app/api/ghl/app-webhook` | nothing yet — all inline (low traffic, OK) |

### Questionnaire engine

`lib/autoresponder/questionnaire.ts` — finite-state machine ב-10 שלבים. State persists ב-`leads.q_state` JSONB.

Step layout:
- 3 = shipping (poll)
- 4 = quantity (poll + "אחר" free-text)
- 5 = product/size (poll + page 2 + "אחר" free-text)
- 6 = handles (poll)
- 7 = lamination (poll)
- 8 = colors (poll)
- **9 = confirmation gate** (handleConfirmationStep — "מעולה נמשיך" / "רוצה לשנות")
- 10 = terminal done (`doneAt` set; routes to FACTORY_CHECK or sends quote)

Re-ask up to 3 times per question, then NEEDS_ELI. Custom-spec branch
(product = "custom" or quantity = "custom" < 1000) → FACTORY_CHECK with
`subFlow = "awaiting_factory_estimate"` + Eli DM. Standard path →
`fetchQuote` (local calculator) → INITIAL_QUOTE_SENT.

### Intent classifier

`lib/autoresponder/intent.ts`:
- Input: רצף ההודעות האחרונות (תלוי ב-stage).
- Output: `{ intent, confidence, is_money_moment, reason }`
- Timeout: 8s (AbortController). Failure → NEEDS_ELI.

### Decision sub-flow

`lib/autoresponder/decision.ts` — switch על intent × stage. Stage 2 ↔ Stage 3 transitions בלבד; כל מה שלא מוכר → NEEDS_ELI.

---

## 5b. LLM vs deterministic code — איפה מה רץ

> **Source of truth** למפת ה-AI בבוט. עדכן כאן בכל פעם שמזיזים גבול בין קוד ל-LLM.

### עיקרון מנחה

הקוד הדטרמיניסטי מטפל ב-happy path וב-flows מסודרים. LLM נכנס רק שם שהקוד נכשל
(unmatch) או שצריך הבנת שפה טבעית עמוקה. כל escalation לאלי מתועד עם
`llmAnalysis + recommendation` כשהיה LLM ב-path.

### מפה לפי שלב

| שלב / מקום בקוד | קוד דטרמיניסטי | LLM |
|---|---|---|
| `questionnaire.ts` — `matchAnswer()` (Q1-Q6) | מספר / value / substring | fallback: spec-extractor כשמחזיר null |
| `questionnaire.ts` — step 9 confirmation | כפתור "מעולה, נמשיך / רוצה לשנות" | "רוצה לשנות" → טקסט חופשי → spec-extractor → merge |
| `questionnaire.ts` — pendingCustomField (Q2/Q3 "אחר") | קולט raw text | spec-extractor ב-matchAnswer fallback מזהה inline ("7500 יחידות") |
| `routeToQuoted()` / `routeToFactory()` | קוד בלבד (calc API) | — |
| `decision.ts` — intent classification (Stage 2-4) | — | OpenAI gpt-4o-mini (12 categories) |
| `decision.ts` — intent ידוע (accept/reject/negotiating/question_*) | switch/case מלא | — |
| `decision.ts` — intent=`other` (Stage 2 + 4) | — | unmatch-agent — מנסה לפתור; אחרת escalate עשיר |
| `decision.ts` — intent=`question_other` (Stage 2 + 4) | — | unmatch-agent — מנסה לענות מה-FAQ; אחרת escalate |
| `decision.ts` — `awaiting_competitor_offer` ambiguous | — | unmatch-agent — מבין "לא ממש אבל יקר" |
| `decision.ts` — Logo stage (media detect, link detect) | regex + media flag | — |
| Follow-ups cron | rule-based cadence | follow-up supervisor (LLM) reviews every send; NO_RESPONSE_REENGAGE body is LLM-built per send |
| Drafts queue (money moments) | — | OpenAI (draft generation) |
| `re-engagement.ts` — `buildReEngagementMessage` | fallback static body if LLM errors | LLM writes personalized re-engagement body from notes + summary + history |
| `re-engagement.ts` — `classifyReengagementReply` (on inbound at NO_RESPONSE_REENGAGE) | stop-word substring match (in `templates.ts`) — fast path → LOST | LLM classifies softer language → `interest / removal / ambiguous` + reason + recommendation for Eli DM |

### Models בשימוש

| Model | Purpose | קובץ |
|---|---|---|
| `gpt-4o-mini` | intent classification | `lib/autoresponder/intent.ts` |
| `gpt-4o-mini` | spec-extractor (טקסט חופשי → שדות) — single-field timeout 1.5 s, full-extract 7 s | `lib/autoresponder/spec-extractor.ts` |
| `gpt-4o-mini` | unmatch agent (Stage 2/4 fallback) | `lib/autoresponder/unmatch-agent.ts` |
| `gpt-4o-mini` | **bot supervisor gate (every inbound, Phase 1)** — hard-bypassed during questionnaire (`qState.step <= 9 && !doneAt && !bailed`) | `lib/supervisor/supervise.ts` |
| `gpt-4o-mini` | follow-up supervisor (every cron send) | `lib/supervisor/followup-supervisor.ts` |
| `gpt-4o-mini` | re-engagement body builder + reply classifier | `lib/autoresponder/re-engagement.ts` |
| OpenAI | draft generation | `lib/drafts/index.ts` |

כל LLM calls שותפים ל-`OPENAI_API_KEY` + `OPENAI_MODEL` (default `gpt-4o-mini`).

### Shared infra

| Module | Purpose |
|---|---|
| `lib/autoresponder/openai-client.ts` | thin Chat Completions wrapper. soft-fail, retry-once, 10s timeout, JSON mode. כל קריאה ב-bot עוברת דרכו. |
| `lib/autoresponder/llm-context.ts` | `buildLLMContext(sid)` + `renderContextForPrompt(ctx)` — היסטוריה / qState / profile / tags / FAQ / business rules. ~3K tokens. |
| `docs/PRODUCT-FAQ.md` | תוכן FAQ. נטען בזמן ריצה ב-`llm-context`. עדכון שם → deploy הבא ה-LLM יראה את החדש. |

### Context שכל LLM call מקבל

נטען מ-`buildLLMContext` ב-`llm-context.ts`:
1. היסטוריית שיחה אחרונה (20 הודעות)
2. qState מלא של הליד
3. ליד profile (name, phone, stage, flags, notes, quoteTotal)
4. tags של הליד
5. FAQ מוצר (`docs/PRODUCT-FAQ.md`)
6. כללי עסק (שעות פעילות, חגים, תשלום, אספקה)

### HANDOFF — escalation עם LLM

`escalateToEli()` ב-`decision.ts` מקבל שתי signatures:
- **Legacy** (positional): `escalateToEli(ctx, reason, llmSummary?, kind?)` — נשאר עובד לכל callers ישנים.
- **Enriched** (options): `escalateToEli(ctx, reason, { kind, llmAnalysis, recommendation, llmSummary? })` — בשימוש מ-unmatch-agent.

ה-DM של אלי (`eliDecisionEscalationTemplate`) — כשיש `llmAnalysis` / `recommendation` מציג אותם כ:
```
🤖 ניתוח: <llmAnalysis>
💡 המלצה: <recommendation>
```
אחרת fallback לתבנית הישנה עם `summary`.

### Kill switches (rollback מהיר)

| ENV var | אפקט |
|---|---|
| `SUPERVISOR_BYPASS=1` | **bot supervisor disabled** — every inbound runs through the legacy flow as if Phase 1 never shipped. Most important kill switch. |
| `SUPERVISOR_MODEL` | override model (default `gpt-4o-mini`). |
| `LLM_UNMATCH_DISABLED=1` | unmatch-agent בכל call → escalate מיד (legacy behavior) |
| `LLM_SPEC_EXTRACTOR_DISABLED=1` | spec-extractor מחזיר null → matchAnswer reask כרגיל; step 9 confirmation → factory route |
| `OPENAI_API_KEY` חסר | כל LLM softfail (זה גם kill switch effective) |

Toggle ב-Vercel envs → redeploy (~30s).

---

## 6. Follow-ups (cadence)

`app/api/bot/followups/route.ts`:
- Trigger: Vercel cron **daily** at `0 9 * * *` UTC (= 12:00 Asia/Jerusalem). See `vercel.json`.
- Auth: Bearer `BOT_SECRET` (or fallback `CRON_SECRET`).
- Logic: query לידים, לכל אחד:
  1. Skip if `bot_paused` / quiet hours (unless `FOLLOWUPS_BYPASS_GATES=1`).
  2. **Hard limit:** if `!rule.unbounded && follow_up_count >= MAX_FOLLOWUPS` (=3) → escalate, no send.
  3. Cadence check — has enough time elapsed since `lastFollowUpAt` per stage rule.
  4. **Pick candidate text:**
     - Standard rules → `followupTemplate(stage, attempt)`.
     - `RE_ENGAGEMENT` template → `buildReEngagementMessage(sid)` (LLM-personalized; see §6b).
  5. **Route through follow-up supervisor** (`lib/supervisor/followup-supervisor.ts`):
     - LLM sees: stage, qState, last 15 messages, lead notes, bot summary, candidate text, attempt#, cadence gap.
     - Returns: `approve_template` / `override_with_text` / `escalate_to_eli` / `silence` / `supervisor_error`.
  6. Execute verdict:
     - `approve_template` → send text verbatim, increment `follow_up_count`.
     - `override_with_text` → send LLM's Hebrew text, increment `follow_up_count`.
     - `escalate_to_eli` → no send, `generateAndQueueDraft` + `sendEliDM` + set NEEDS_ELI/bot_paused.
     - `silence` → no send, `lastFollowUpAt` updated but `follow_up_count` **not** incremented (lead gets another chance later).
     - `supervisor_error` → no send, DM already fired by supervisor.
  7. Write row to `bot_decision_log` with `metadata.trigger = "followup_cron"` + `prompt_version` + `template_label` + `attempt` + `gap_hours`.
- אחרי N follow-ups בלי תגובה (standard rules only) → אוטומטית NEEDS_ELI + bot_paused (לא LOST — רק אלי).
- Kill switches: `SUPERVISOR_BYPASS=1` (skips supervisor, falls back to legacy text-only flow), `FOLLOWUPS_BYPASS_GATES=1` (skips quiet-hours/no-send-day).

### Stage rules

| Stage | Cadences | Template | Bounded? | Notes |
|---|---|---|---|---|
| (NULL + qState mid-flight) | 1h × 3 | MID_QUESTIONNAIRE | 3 attempts | Pre-quote leads who started but didn't finish the questionnaire. |
| INITIAL_QUOTE_SENT | 2h / 12h / 23h | INITIAL_QUOTE_SENT | 3 attempts | Quote sent, waiting on decision. |
| FACTORY_CHECK (subFlow=awaiting_logo) | 2h / 12h / 23h | AWAITING_LOGO | 3 attempts | Bot waiting for the customer's logo file. |
| FINAL_QUOTE_SENT | 2h / 12h / 23h | FINAL_QUOTE_SENT | 3 attempts | Final price sent, waiting on decision. |
| NO_RESPONSE_REENGAGE | 3d (repeats) | RE_ENGAGEMENT | **unbounded** | Manual stage Eli drags into. LLM body per send. Loop stops only on customer reply / opt-out / manual drag. |
| FUTURE_FOLLOW_UP | — | — | — | No rule. Manual hold. Bot does not touch. |
| WON / LOST | — | — | — | Terminal. No cron action. |

### 6b. NO_RESPONSE_REENGAGE re-engagement loop

`lib/autoresponder/re-engagement.ts` — covers both the outbound build and the inbound handler.

- `buildReEngagementMessage(sid)`: GPT-4o-mini, temperature 0.7, 8 s timeout. System prompt voices Eli (first-person singular, no "we"). User prompt = lead name + `notes` + `bot_summary` + last 20 messages. Returns 1-2 sentence Hebrew nudge. Always appends `RE_ENGAGEMENT_OPT_OUT_FOOTER` ("השב/י 'הסר' ולא אטריד שוב"). Soft-fails to a static `FALLBACK_BODY` + same footer if the LLM call errors.
- `classifyReengagementReply(sid, text)`: GPT-4o-mini, temperature 0, 5 s timeout. Returns `{ intent: "interest" | "removal" | "ambiguous", reason, recommendation }`.
- `handleReengagementInbound({ sid, text })`: pauses the bot (`bot_paused = true`), DMs Eli with intent emoji + verdict + reason + recommendation + the inbound text. **Does not change `pipeline_stage`** — Eli is the sole authority for the next move.

Hookup: both `app/api/greenapi/webhook/route.ts` and `app/api/bridge/webhook/route.ts` short-circuit to `handleReengagementInbound` when `stage === "NO_RESPONSE_REENGAGE"` BEFORE the supervisor dispatch (the supervisor decision tree doesn't know NO_RESPONSE_REENGAGE → would no-op or wrongly escalate).

Stop-words ("הסר", "stop", "תפסיק", "להסיר", "תוריד אותי", "די לי", …) bypass this path entirely — the webhook's stop-word check fires first, moves the lead straight to LOST with `loss_reason = "opt_out"`, DMs Eli, and pushes to GHL.

---

## 7. Drafts queue (money moments)

Gate: `ENABLE_DRAFT_QUEUE=1`.

```
intent classifier sets is_money_moment=true
  → instead of auto-send: generateAndQueueDraft()
  → INSERT bot_drafts (status=pending)
  → no WA send happens

Eli sees draft (Retool feed OR /dashboard/v3/drafts OR /dashboard/v2/drafts)
  ├─ Approve  → POST /api/drafts/:id/approve
  │              → optional edited_text
  │              → sendBridgeMessage (sender=bot)
  │              → UPDATE bot_drafts status=sent
  │
  └─ Reject   → POST /api/drafts/:id/reject
                 → UPDATE bot_drafts status=rejected
                 → no send
```

Money triggers (per `lib/drafts/index.ts`):
- pipeline_stage ∈ {INITIAL_QUOTE_SENT, FINAL_QUOTE_SENT, NEGOTIATING}
- OR LLM returns `is_money_moment=true`

---

## 8. Security

| Surface | Mechanism |
|---|---|
| `/api/bridge/webhook` | HMAC-SHA256 (BRIDGE_WEBHOOK_SECRET) + 5min replay window |
| `/api/bot/*`, `/api/drafts/*`, `/api/leads/*` | `Authorization: Bearer <BOT_SECRET>` |
| `/dashboard/*` | cookie `albadi_auth` set by `/api/auth/login` (ADMIN_PASSWORD) |
| Dashboard layout | `auth guard middleware` redirects to login if missing |

**Known risk:** `BOT_SECRET` משותף לכל endpoint. אין rotation. Single-user, low blast radius.

---

## 9. Deployment

- Push ל-`main` → Vercel auto-deploy.
- DB migration: `npx drizzle-kit push` ידנית (אין CI/CD למיגרציה).
- Env vars: 11 משתנים (ראה PRD §5). 4 חיוניים, 3 bridge, 2 feature gates, 1 התראות, 1+ optional.
- Rollback: revert commit + push. DB state survives.
- Feature rollback: flip `USE_BRIDGE=0` או `ENABLE_DRAFT_QUEUE=0` ב-Vercel envs, redeploy.

---

## 10. Known drift / debt

> מה ש-code אומר אבל המוצר/PRD לא — או הפוך.

1. **Pipeline stages refactor — 10-stage journey model — RESOLVED 2026-05-24**
   - Current map (must match GHL exactly — see §3b "Pipeline stages — env mapping & drift risk"): `INITIAL_QUOTE_SENT, AWAITING_FIRST_RESPONSE, SHOWED_INTEREST, FACTORY_CHECK, FINAL_QUOTE_SENT, NEGOTIATING, WON, LOST, FUTURE_FOLLOW_UP, NO_RESPONSE_REENGAGE` (pre-questionnaire = `pipeline_stage IS NULL`). שלבים מתארים מצב מכירה; pulse פנימי של ה-autoresponder ב-`qState.subFlow`. Loss reason חובה ב-LOST. Migration ב-`scripts/_migrate-stage-rename.sql` (original 8 stages); FUTURE_FOLLOW_UP + NO_RESPONSE_REENGAGE added 2026-05-24 via env vars only (no schema change needed).
   - **Open recurring risk** (not yet automated): any new GHL stage that doesn't get an env entry will silently break the "drag in GHL = saved" round-trip. See §3b.

2. **ManyChat path עוד חי**
   - `lib/manychat/client.ts`, `app/api/bot/new-lead/route.ts`, `app/api/bot/inbound-message/route.ts`, `app/api/bot/restart-send/route.ts` עוד קיימים.
   - `USE_BRIDGE=1` בייצור, אבל הקוד עוד מתחזק את שני המסלולים.
   - **תוכנית:** למחוק אחרי שבוע יציב על bridge.

3. **CRM operating-layer טבלאות בפרודקשיין — קוד מוכן, UI בבנייה**
   - טבלאות `crm_*` + `lead_score_snapshots` + `source_touches` + `opportunities` + `consent_records` עלו ב-migration 2026-05-16.
   - Dashboard v3 command center (`9599a4f`) צורך חלק מהנתונים; שאר ה-endpoints טרם נכתבו.
   - **תוכנית:** server actions / API routes לכל CRM entity לפי priority.

4. **שני דאשבורדים חיים במקביל**
   - v2 (`/dashboard/v2/*`) — production, יציב.
   - v3 (`/dashboard/v3/*`) — primary.
   - **תוכנית:** v3 → sole dashboard, v2 → archive.

4. **Restart-send בלי bridge**
   - `app/api/bot/restart-send/route.ts` עדיין דרך ManyChat Flows (templates).
   - bridge עכשיו תומך free-form בכל זמן, אז template fallback לא נדרש — צריך לכתוב מחדש.

5. **אין test coverage אוטומטי**
   - יש `scripts/test-stage{1-4}.ts` ידניים בלבד.
   - PRD §risks: סיכון רגרסיה.

6. **Hardcoded values**
   - `TAG_IDS` / `FIELD_IDS` ב-`lib/manychat/config.ts` — לא מקור הקובץ (legacy).
   - `FLOW_NS` ב-`restart-send` — צריך לעבור ל-`.env`.
   - Business thresholds (10000 NIS high-value, 5d no-contact) hardcoded במקום `bot_config`.

7. **Bot Supervisor — `override_with_text` doesn't apply stage transitions**
   - When the LLM supervisor returns `override_with_text`, it sends the override text but skips the existing handler. Stage transitions (e.g. `INITIAL_QUOTE_SENT → FACTORY_CHECK` on accept, with subFlow=awaiting_logo) won't fire.
   - Mitigated by the supervisor prompt telling the LLM not to override on stage-transition intents (accept, logo received).
   - Phase 5 will fix: add `stage_transition` to the supervisor JSON output.

8. **Bridge media TTL** (operational)
   - The bridge tenant evicts uploaded media (videos / images for cta_url headers) after some period. When this happens, `sendCompanyTemplate` Tier 1 fails with `status=404, body="header.media_id not found for tenant"` and falls back to Tier 2 (cta_url with no header — still has Instagram CTA button).
   - Workaround: re-upload via `npx tsx scripts/_upload-company-video.ts <path>` and update `COMPANY_VIDEO_MEDIA_ID` in `lib/bridge/client.ts`.
   - Long-term: bridge maintainer needs to raise media TTL or whitelist company-intro media.

9. **Vercel Hobby cron limit**
   - Vercel Hobby rejects sub-daily cron schedules (`"Hobby accounts are limited to daily cron jobs"`).
   - `vercel.json` set to `"0 9 * * *"` (daily 09:00 UTC). External Claude cloud routine triggers `/api/bot/followups` hourly to compensate.

---

## 11. Scripts (operational)

| Script | Purpose |
|---|---|
| `seed-leads.ts` | seed initial 39 known subscriber_ids |
| `backfill-from-manychat.ts` | one-time pull leads → DB (during bridge cutover) |
| `backfill-message-sender.ts` | one-time fill `messages.sender` for legacy rows |
| `backfill-lead-names.ts` | one-time hydrate `leads.name` |
| `test-stage{1-4}.ts` + `test-cadence.ts` | manual E2E flow validation |
| `test-drafts-api.ts` | draft queue smoke test |
| `setup-manychat-v2.ts` | (deprecated) configure legacy ManyChat webhook |
| `eval-llm.ts` | classifier confidence on sample intents |
| `check-stages.ts`, `check-recent.ts`, `check-mali.ts` | quick state queries |
| `debug-*.ts`, `trace-inbound.ts`, `inspect-bridge-event.ts` | webhook + DB inspection |
| `wipe-test-lead.ts`, `reset-test-lead.ts` | test-lead cleanup |
| `manual-stale-refresh.ts`, `migrate-silent.ts` | state-patch maintenance |
| `scan-factory-notes.ts` | bulk note scan |

All scripts run via `npx tsx scripts/<name>.ts`. Most respect `BRIDGE_DRY_RUN=1`.
