# Albadi CRM — Feature Inventory

> נכתב 2026-05-13. רשימת כל הפיצ'רים בשני הצדדים: **בוט** (אוטומטי מול הלקוח) + **דאשבורד** (פיקוח לאלי).
> Status: `shipped` = פעיל בייצור. `beta` = פעיל מאחורי flag / WIP. `deprecated` = קוד עוד בריפו אבל לא בשימוש. `planned` = לא נכתב.
> לכל פיצ'ר: בעלים בקוד (קובץ ראשי) + מסמך-מקור (PRD/CUSTOMER-FLOW/ARCHITECTURE).

---

## 1. Bot Features (WhatsApp-facing)

### 1.1 Lead Intake

| # | Feature | Status | קוד ראשי | מסמך |
|---|---|---|---|---|
| 1.1.1 | Inbound webhook (bridge → DB) | shipped | `app/api/bridge/webhook/route.ts` | ARCHITECTURE §webhook |
| 1.1.2 | HMAC-SHA256 signature verification + 5min replay window | shipped | `app/api/bridge/webhook/route.ts:290` | ARCHITECTURE §security |
| 1.1.3 | Auto-upsert lead from JID (no manual seeding) | shipped | `lib/bridge/client.ts` | ARCHITECTURE §leads |
| 1.1.4 | Bridge event audit log (`bridge_events`) | shipped | schema | ARCHITECTURE §db |
| 1.1.5 | Dedupe by `wa_message_id` | shipped | `app/api/bridge/webhook/route.ts` | — |
| 1.1.6 | ManyChat-origin lead support (legacy) | deprecated | `lib/manychat/client.ts` | — |
| 1.1.7 | New-lead webhook from ManyChat | deprecated | `app/api/bot/new-lead/route.ts` | — |

### 1.2 Questionnaire (Stage 1 — NEW)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.2.1 | 9-question flow (Q1-Q9: shipping, qty, product, handles, colors, …) | shipped | `lib/autoresponder/questionnaire.ts` | CUSTOMER-FLOW §1 |
| 1.2.2 | State persistence in `leads.q_state` (JSONB) | shipped | schema | ARCHITECTURE §db |
| 1.2.3 | Re-ask up to 3 times on invalid answer | shipped | `lib/autoresponder/questionnaire.ts` | CUSTOMER-FLOW §1.1 |
| 1.2.4 | Escalate to NEEDS_ELI after 3 failed re-asks / "אחר" | shipped | `lib/autoresponder/questionnaire.ts` | CUSTOMER-FLOW §1.1 |
| 1.2.5 | Calc-engine integration → estimate price | shipped | `lib/autoresponder/calc.ts` (TBD path) | CUSTOMER-FLOW §1.2 |
| 1.2.6 | Custom-spec → WAITING_FACTORY (אלי מתמחר ידני) | shipped | `lib/autoresponder/questionnaire.ts` | CUSTOMER-FLOW §2 |

### 1.3 Intent Classifier

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.3.1 | LLM intent classification (OpenAI, 8s timeout) | shipped | `lib/autoresponder/intent.ts` | ARCHITECTURE §llm |
| 1.3.2 | Intent enum: accept/reject/negotiating/samples_request/custom_size/question_*/other | shipped | `lib/autoresponder/intent.ts` | — |
| 1.3.3 | Money-moment detection (`is_money_moment`) | shipped | `lib/autoresponder/intent.ts` | ARCHITECTURE §drafts |
| 1.3.4 | Confidence score per classification | shipped | `bot_drafts.llm_confidence` | — |

### 1.4 Decision Flow (Stage 2-3 — AWAITING_ESTIMATE / AWAITING_LOGO)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.4.1 | Stage 2 sub-flows (accept/negotiate/reject) | shipped | `lib/autoresponder/decision.ts` | CUSTOMER-FLOW §2 |
| 1.4.2 | Canned answers for FAQ (delivery, payment, format, meeting) | shipped | `lib/autoresponder/decision.ts` | BOT-COPY |
| 1.4.3 | Logo request (Stage 3) on accept | shipped | `lib/autoresponder/decision.ts` | CUSTOMER-FLOW §3 |
| 1.4.4 | Logo received (image) → AWAITING_FINAL + NEEDS_ELI | shipped | `lib/autoresponder/decision.ts` | CUSTOMER-FLOW §3 |
| 1.4.5 | 3-strike drop-off rule per stage | shipped | `lib/autoresponder/decision.ts` | CUSTOMER-FLOW §4 |

### 1.5 Follow-ups (Cadence)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.5.1 | Daily Vercel cron @ `/api/bot/followups` (Hobby limit) | shipped | `app/api/bot/followups/route.ts` | — |
| 1.5.2 | Cloud routine fallback (hourly) | shipped | external (claude.ai/code routine) | — |
| 1.5.3 | Cadence per stage (per CUSTOMER-FLOW v2) | shipped | `app/api/bot/followups/route.ts` | CUSTOMER-FLOW §cadence |
| 1.5.4 | Quiet-hours gate (no sends night/weekend) | shipped | `app/api/bot/followups/route.ts` | — |
| 1.5.5 | Bypass gates flag (`FOLLOWUPS_BYPASS_GATES`) | shipped | env | — |
| 1.5.6 | Auto-drop after N follow-ups | shipped | `leads.follow_up_count` | CUSTOMER-FLOW §drop |
| 1.5.7 | Cron health check GET endpoint | shipped | `app/api/bot/followups/route.ts:327` | — |

### 1.6 Money-Moment Drafts (Human-in-Loop)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.6.1 | Feature-flagged via `ENABLE_DRAFT_QUEUE` | beta | env | PRD §scope |
| 1.6.2 | Auto-generate draft on money intent | beta | `lib/drafts/index.ts` | — |
| 1.6.3 | Persist to `bot_drafts` with reason+confidence | beta | schema | — |
| 1.6.4 | Approve endpoint (`POST /api/drafts/:id/approve`) | beta | `app/api/drafts/[id]/approve/route.ts` | — |
| 1.6.5 | Reject endpoint (`POST /api/drafts/:id/reject`) | beta | `app/api/drafts/[id]/reject/route.ts` | — |
| 1.6.6 | Edited-text path (אלי עורך לפני שליחה) | beta | approve route | — |
| 1.6.7 | Money-reason tagging (stage_gate/discount/price/negotiation/commitment) | beta | `lib/drafts/index.ts` | — |

### 1.7 Bot State Management

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.7.1 | DB-authoritative state (USE_BRIDGE=1) | shipped | `lib/messaging/index.ts` | ARCHITECTURE §messaging |
| 1.7.2 | Adapter pattern (bridge vs ManyChat) | shipped | `lib/messaging/index.ts` | ARCHITECTURE §adapter |
| 1.7.3 | Bot pause flag (`leads.bot_paused`) | shipped | schema | CUSTOMER-FLOW §flags |
| 1.7.4 | Auto-unpause on customer inbound | shipped | `app/api/bridge/webhook/route.ts` | — |
| 1.7.5 | NEEDS_ELI flag + auto-DM to Eli | shipped | `leads.pipeline_flag`, `sendEliDM` | CUSTOMER-FLOW §flags |
| 1.7.6 | Tag system by Hebrew name (`lead_tags`) | shipped | schema | ARCHITECTURE §db |

### 1.8 Restart / Re-engagement

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.8.1 | Batch send re-engagement (ManyChat templates) | deprecated | `app/api/bot/restart-send/route.ts` | CLAUDE.md §bridge migration |
| 1.8.2 | Bridge-based re-engagement (free-form) | planned | — | — |

---

## 2. Dashboard Features (Supervisor — Eli only)

### 2.1 Auth + Shell

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 2.1.1 | Password-only login → `albadi_auth` cookie | shipped | `app/api/auth/login/route.ts` | — |
| 2.1.2 | Logout | shipped | `app/api/auth/logout/route.ts` | — |
| 2.1.3 | Auth guard middleware | shipped | `app/dashboard/layout.tsx` | — |
| 2.1.4 | Nav (v2 / v3 / instructions) | shipped | `app/dashboard/layout.tsx` | — |

### 2.2 Dashboard v3 (Primary, current)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 2.2.1 | 4-bucket Kanban leads board | shipped | `app/dashboard/v3/page.tsx` + `_components/LeadsBoard.tsx` | — |
| 2.2.2 | WhatsApp-style chat view + composer | shipped | `app/dashboard/v3/conversations/page.tsx` | — |
| 2.2.3 | Order summary panel (collapsible) | shipped | `app/dashboard/v3/conversations/_components/ConversationsLayout.tsx` | — |
| 2.2.4 | Pipeline metrics view | shipped | `app/dashboard/v3/pipeline/page.tsx` | — |
| 2.2.5 | Analytics (conversion funnel + stage breakdown) | shipped | `app/dashboard/v3/analytics/page.tsx` | — |
| 2.2.6 | In-app drafts queue (mirror Retool) | shipped | `app/dashboard/v3/drafts/page.tsx` | — |
| 2.2.7 | Settings (bot_config editor) | shipped | `app/dashboard/v3/settings/page.tsx` | — |
| 2.2.8 | Lead hover preview | shipped | `app/dashboard/v3/_components/LeadsBoard.tsx` | — |
| 2.2.9 | In-place expanded lead view | shipped | `app/dashboard/v3/_components/ExpandedLead.tsx` | — |
| 2.2.10 | Manual name+phone editing (lid JIDs) | shipped | commit 15245f1 | — |
| 2.2.11 | Dark-mode theme | shipped | v3 layout | — |

### 2.3 Dashboard v2 (Fallback, deprecated soon)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 2.3.1 | Inbox by pipeline_stage | shipped | `app/dashboard/v2/stage/[stage]/page.tsx` | — |
| 2.3.2 | Lead detail (notes, tags, messages, conversation) | shipped | `app/dashboard/v2/lead/[sid]/page.tsx` | — |
| 2.3.3 | Pending drafts page | shipped | `app/dashboard/v2/drafts/page.tsx` | — |
| 2.3.4 | NotesModal (textarea + date stamper + stage override) | shipped | `app/dashboard/v2/NotesModal.tsx` | CLAUDE.md §v2 |
| 2.3.5 | Server actions for v2 (`app/actions/v2.ts`) | shipped | `app/actions/v2.ts` | — |
| 2.3.6 | Approve/Reject inline buttons | shipped | v2 InboxList | — |

### 2.4 Retool Console (External UI)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 2.4.1 | REST API for drafts queue (pending feed) | shipped | `app/api/drafts/pending/route.ts` | retool/api-cheatsheet.md |
| 2.4.2 | Approve/reject from Retool | shipped | `app/api/drafts/[id]/{approve,reject}/route.ts` | — |
| 2.4.3 | Manual state override from Retool | shipped | `app/api/leads/[id]/override/route.ts` | — |
| 2.4.4 | Retool resource setup guide | shipped | `retool/SETUP.md` | — |

### 2.5 Stats / Visibility

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 2.5.1 | Home stats (needs_eli count, active, msgs/24h, pending drafts) | shipped | `app/dashboard/page.tsx`, `v2/page.tsx` | — |
| 2.5.2 | Conversion funnel chart | shipped | v3 analytics | — |
| 2.5.3 | Stage progression metrics | shipped | v3 pipeline | — |

---

## 3. Cross-cutting / Infrastructure

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 3.1 | Drizzle ORM + Neon Postgres | shipped | `lib/db/schema.ts` | ARCHITECTURE §db |
| 3.2 | DB migrations (`drizzle-kit push`) | shipped | `drizzle.config.ts` | — |
| 3.3 | Vercel auto-deploy on `main` push | shipped | `vercel.json` | — |
| 3.4 | Daily cron via Vercel | shipped | `vercel.json` | — |
| 3.5 | External cron (claude.ai/code routine) | shipped | external | CLAUDE.md |
| 3.6 | Bridge webhook signing | shipped | `app/api/bridge/webhook/route.ts` | ARCHITECTURE §security |
| 3.7 | Bearer auth on all `/api/*` (except `/api/auth/*`) | shipped | per-route check | — |
| 3.8 | Sender attribution (`messages.sender`: lead/bot/eli) | shipped | schema | ARCHITECTURE §db |

---

## 4. Deprecated / To remove

| Feature | קוד | למה deprecated |
|---|---|---|
| ManyChat HTTP client | `lib/manychat/client.ts` | bridge cutover complete |
| ManyChat new-lead webhook | `app/api/bot/new-lead/route.ts` | bridge handles intake |
| ManyChat inbound-message webhook | `app/api/bot/inbound-message/route.ts` | bridge webhook replaced |
| restart-send (ManyChat Flows) | `app/api/bot/restart-send/route.ts` | needs bridge replacement, not yet built |
| `MANYCHAT_TOKEN` env | env | bot_paused once bridge stable a full week |

מתי למחוק: אחרי שבוע יציב על bridge + Retool + drafts queue, ולפני שמחליטים על v4.

---

## 5. Planned (not yet shipped)

| Feature | למה | מתי |
|---|---|---|
| Bridge-native re-engagement (replace restart-send) | סגירת deprecation לוף | אחרי מחיקת ManyChat |
| Automated test coverage לכל pipeline stage | סיכון רגרסיה (ראה PRD §risks) | טרם תוכנן |
| Bot self-correction (override audit + retrain) | למנוע סיווגים שגויים חוזרים | טרם תוכנן |
| Bridge failover / health alert | אם VPS נופל — אין WA | טרם תוכנן |
