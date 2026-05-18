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
name             from contact info / manual
pipeline_stage   NEW | AWAITING_ESTIMATE | AWAITING_LOGO | WAITING_FACTORY | AWAITING_FINAL | WON | DROPPED
next_action      sub-state inside stage (e.g. awaiting_reason, awaiting_competitor_offer)
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
bridge POST /api/bridge/webhook
  │
  ├─ verify HMAC(BRIDGE_WEBHOOK_SECRET)
  ├─ check timestamp (5min replay window)
  ├─ insert bridge_events row (UNIQUE evt_id → dedupe)
  │
  ├─ if type=message.received:
  │    1. upsert leads row (auto-create from JID)
  │    2. insert messages row (sender=lead)
  │    3. stop-word check → if matched: pause + DM + log row + return
  │    4. clear bot_paused, log auto-unpause if bot was paused
  │    5. routeThroughSupervisor():
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

### Questionnaire engine

`lib/autoresponder/questionnaire.ts` — finite-state machine ב-9 שלבים. State persists ב-`leads.q_state` JSONB. Re-ask עד 3 פעמים, אחרי זה NEEDS_ELI.

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
| Follow-ups cron | rule-based cadence | — |
| Drafts queue (money moments) | — | OpenAI (draft generation) |

### Models בשימוש

| Model | Purpose | קובץ |
|---|---|---|
| `gpt-4o-mini` | intent classification | `lib/autoresponder/intent.ts` |
| `gpt-4o-mini` | spec-extractor (טקסט חופשי → שדות) | `lib/autoresponder/spec-extractor.ts` |
| `gpt-4o-mini` | unmatch agent (Stage 2/4 fallback) | `lib/autoresponder/unmatch-agent.ts` |
| `gpt-4o-mini` | **bot supervisor gate (every inbound, Phase 1)** | `lib/supervisor/supervise.ts` |
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
- Trigger: Vercel cron **hourly** (`0 * * * *`) + external cloud routine.
- Auth: Bearer `BOT_SECRET` (or fallback `CRON_SECRET`).
- Logic: query לידים, לכל אחד:
  1. Skip if `bot_paused` / quiet hours (unless `FOLLOWUPS_BYPASS_GATES=1`).
  2. **Hard limit:** if `follow_up_count >= MAX_FOLLOWUPS` (=3) → escalate, no send.
  3. Cadence check — has enough time elapsed since `lastFollowUpAt` per stage rule.
  4. **Pick candidate template** (`followupTemplate(stage, attempt)`).
  5. **Route through follow-up supervisor** (`lib/supervisor/followup-supervisor.ts`):
     - LLM sees: stage, qState, last 15 messages, lead notes, bot summary, candidate template, attempt#, cadence gap.
     - Returns: `approve_template` / `override_with_text` / `escalate_to_eli` / `silence` / `supervisor_error`.
  6. Execute verdict:
     - `approve_template` → send template verbatim, increment `follow_up_count`.
     - `override_with_text` → send LLM's Hebrew text, increment `follow_up_count`.
     - `escalate_to_eli` → no send, `generateAndQueueDraft` + `sendEliDM` + set NEEDS_ELI/bot_paused.
     - `silence` → no send, `lastFollowUpAt` updated but `follow_up_count` **not** incremented (lead gets another chance later).
     - `supervisor_error` → no send, DM already fired by supervisor.
  7. Write row to `bot_decision_log` with `metadata.trigger = "followup_cron"` + `prompt_version` + `template_label` + `attempt` + `gap_hours`.
- אחרי N follow-ups בלי תגובה → אוטומטית NEEDS_ELI + bot_paused (לא DROPPED — רק אלי).
- Kill switches: `SUPERVISOR_BYPASS=1` (skips supervisor, falls back to legacy template-only flow), `FOLLOWUPS_BYPASS_GATES=1` (skips quiet-hours/no-send-day).

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
- pipeline_stage ∈ {QUOTED, NEGOTIATING, AWAITING_FINAL, WAITING_CALL} (drift לעומת CUSTOMER-FLOW — ראה §10 below)
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

1. **Pipeline stages drift — RESOLVED 2026-05-16**
   - קוד יושר ל-7 stages לפי CUSTOMER-FLOW (מקור אמת). `QUOTED, IN_PROGRESS, NEGOTIATING, WAITING_CALL` הוסרו; `AWAITING_DECISION` הוחזר ל-`AWAITING_ESTIMATE`. סאב-state של מיקוח/שיחה זז ל-`qState.decisionState` + tag `ביקש_שיחה` + flag `NEEDS_ELI`. Migration ב-`scripts/migrate-stages-to-7.ts`.

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
   - When the LLM supervisor returns `override_with_text`, it sends the override text but skips the existing handler. Stage transitions (e.g. `AWAITING_ESTIMATE → AWAITING_LOGO` on accept) won't fire.
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
