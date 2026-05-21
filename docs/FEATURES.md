# Albadi CRM — Feature Inventory

> עודכן 2026-05-20. רשימת כל הפיצ'רים: **בוט** (אוטומטי מול הלקוח) + **דאשבורד** (פיקוח לאלי) + **אינטגרציות** (WhatsApp, פייסבוק, פייג'ו, גרין-API).
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
| 1.2.7 | LLM fallback ב-matchAnswer ("לא חייב"→false, "דחוף"→s1, "אלפיים"→custom) | shipped (v3.1) | `lib/autoresponder/spec-extractor.ts` | ARCHITECTURE §5b |
| 1.2.8 | Step 9 confirmation gate — סיכום + "מעולה/רוצה לשנות" | shipped (v3.1) | `lib/autoresponder/questionnaire.ts:handleConfirmationStep` | CHANGELOG v3.1 |
| 1.2.9 | Free-text spec revision (LLM merge) — max 2 סיבובים | shipped (v3.1) | `lib/autoresponder/questionnaire.ts:mergeExtracted` | CHANGELOG v3.1 |
| 1.2.10 | `orderNotes` — הערות לקוח מועברות לאלי ב-DM | shipped (v3.1) | `lib/autoresponder/questionnaire.ts:summarizeForFactory` | — |

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
| 1.4.6 | Unmatch-agent — `intent=other`/`question_other` → LLM מנסה לפתור לפני escalate | shipped (v3.1) | `lib/autoresponder/unmatch-agent.ts` | ARCHITECTURE §5b |
| 1.4.7 | Rich HANDOFF DM — `llmAnalysis` + `recommendation` ב-`escalateToEli` | shipped (v3.1) | `lib/messaging/templates.ts:eliDecisionEscalationTemplate` | ARCHITECTURE §HANDOFF |
| 1.4.8 | Price-citation post-validation (LLM reply עם מחיר → downgrade ל-escalate) | shipped (v3.1) | `lib/autoresponder/unmatch-agent.ts:containsPriceLike` | — |

### 1.5 Follow-ups (Cadence)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.5.1 | Hourly Vercel cron @ `/api/bot/followups` | shipped | `app/api/bot/followups/route.ts` | — |
| 1.5.2 | Cloud routine fallback (hourly) | shipped | external (claude.ai/code routine) | — |
| 1.5.3 | Cadence per stage (per CUSTOMER-FLOW v2) | shipped | `app/api/bot/followups/route.ts` | CUSTOMER-FLOW §cadence |
| 1.5.4 | Quiet-hours gate (no sends night/weekend) | shipped | `app/api/bot/followups/route.ts` | — |
| 1.5.5 | Bypass gates flag (`FOLLOWUPS_BYPASS_GATES`) | shipped | env | — |
| 1.5.6 | Auto-drop after N follow-ups (hard limit, supervisor cannot bypass) | shipped | `leads.follow_up_count` | CUSTOMER-FLOW §drop |
| 1.5.7 | Cron health check GET endpoint | shipped | `app/api/bot/followups/route.ts:327` | — |
| 1.5.8 | **LLM follow-up supervisor** — context-aware override / escalate / silence per cycle | shipped (v3.6) | `lib/supervisor/followup-supervisor.ts` | CHANGELOG v3.6 |

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

### 1.9 Bot Supervisor (Phase 1)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 1.9.1 | LLM supervisor gate on every inbound (`approve_code` / `override_with_text` / `escalate_to_eli` / `silence`) | shipped (v3.5) | `lib/supervisor/supervise.ts` | binary-chasing-dawn.md |
| 1.9.2 | Candidate predictor (dry-run of existing handler) | shipped (v3.5) | `lib/supervisor/candidate.ts` | — |
| 1.9.3 | `bot_decision_log` table with 3 lanes (LLM / Code / Eli) | shipped (v3.5) | schema | ARCHITECTURE §db |
| 1.9.4 | Eli feedback hooks (drafts approve/edit/reject, manual reply, stage override, pause, direct WA) | shipped (v3.5) | `lib/supervisor/log.ts` | — |
| 1.9.5 | `eli_correction_type` classification (routing / policy / content) | shipped (v3.5) | `lib/supervisor/log.ts:inferCorrectionType` | — |
| 1.9.6 | Auto-send lane (overrule conservative escalate on safe canned replies) | shipped (v3.5) | `app/api/bridge/webhook/route.ts` | — |
| 1.9.7 | Replay metadata (`prompt_version` + `model` + candidate snapshot per log row) | shipped (v3.5) | `app/api/bridge/webhook/route.ts` | — |
| 1.9.8 | "החלטות בוט" tab in v3 lead drawer | shipped (v3.5) | `app/dashboard/v3/_components/BotDecisionsTab.tsx` | — |
| 1.9.9 | `loadBotDecisionsAction` server action + `GET /api/leads/[sid]/decisions` | shipped (v3.5) | `app/actions/v2.ts` + `app/api/leads/[sid]/decisions/route.ts` | — |
| 1.9.10 | `SUPERVISOR_BYPASS=1` emergency kill switch | shipped (v3.5) | env | — |
| 1.9.11 | Auto-ack to customer on every escalate_to_eli / safety-net | shipped (v3.7) | `app/api/bridge/webhook/route.ts` | CHANGELOG v3.7 |
| 1.9.12 | Safety-net escalation when handler silently no-ops after approve_code | shipped (v3.7) | `app/api/bridge/webhook/route.ts` | CHANGELOG v3.7 |
| 1.9.13 | Bailed-questionnaire awareness in candidate predictor | shipped (v3.7) | `lib/supervisor/candidate.ts` | CHANGELOG v3.7 |
| 1.9.14 | Per-row 👍/👎 feedback on LLM verdict + intent override picker | shipped (v3.7) | `app/dashboard/v3/_components/BotDecisionsTab.tsx` + `app/actions/v2.ts` | CHANGELOG v3.7 |
| 1.9.15 | Per-row 👍/👎 feedback on stage transitions + corrective stage move | shipped (v3.7) | `BotDecisionsTab.tsx` + `correctStageDecisionAction` | CHANGELOG v3.7 |
| 1.9.16 | Followups queue page (`/dashboard/v3/followups`) with quiet-hours deferral | shipped (v3.7) | `app/dashboard/v3/followups/page.tsx` | CHANGELOG v3.7 |
| 1.9.17 | New leads default to `pipeline_stage='NEW'` (no more null middle state) | shipped (v3.7) | `lib/bridge/client.ts:upsertLeadFromBridgeEvent` | CHANGELOG v3.7 |
| 1.9.18 | Direct full-card link from chat header + order summary | shipped (v3.7) | `ConversationsLayout.tsx`, `OrderSummary.tsx` | CHANGELOG v3.7 |
| 1.9.19 | Whole-card click on leads tab + always-visible action buttons | shipped (v3.7) | `LeadsView.tsx` | CHANGELOG v3.7 |
| 1.9.20 | Company template 3-tier fallback (video → cta_url → text) + verbose error logging | shipped (v3.7) | `lib/bridge/client.ts:sendCompanyTemplate` | CHANGELOG v3.7 |
| 1.9.21 | Langfuse integration (trace_id column ready, code deferred) | planned | — | binary-chasing-dawn.md §Phase 1.6 |
| 1.9.22 | Few-shot retrieval from past Eli feedback | planned | — | binary-chasing-dawn.md §Phase 2 |
| 1.9.23 | Deterministic rule extraction from log patterns | planned | — | binary-chasing-dawn.md §Phase 3 |
| 1.9.24 | Bot QA aggregated stats page | planned | — | binary-chasing-dawn.md §Phase 4 |
| 1.9.25 | Override stage transitions (LLM returns `stage_transition` in JSON) | planned | — | binary-chasing-dawn.md §Phase 5 |

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
| 2.2.12 | Calculator (transparent price breakdown, read-only) | shipped | `app/dashboard/v3/calculator/CalculatorView.tsx` | — |
| 2.2.13 | Reverse-target pricing widget (calculator + FinalizeModal): רווח₪ / סכום כולל / ליחידה → implied % | shipped | `app/dashboard/v3/calculator/CalculatorView.tsx`, `app/dashboard/v3/_components/factory/FinalizeModal.tsx` | — |
| 2.2.14 | Custom-quantity input in calculator (snaps margin + price to lower tier) | shipped | `app/dashboard/v3/calculator/CalculatorView.tsx`, `lib/factory/calculator/engine.ts` | — |
| 2.2.15 | FinalizeModal margin slider widened to 0-300% | shipped | `app/dashboard/v3/_components/factory/FinalizeModal.tsx` | — |
| 2.2.16 | **פיל "פערי טופס"** — ספירת לידים מהטופס של Meta שלא הגיעו ל-CRM; לחיצה מציגה טבלה + לינק לשורה בשיט | shipped (v3.7) | `app/dashboard/v3/leads/LeadsView.tsx`, `lib/sheets/lead-gaps.ts` | — |

### 2.6 הצעות מפעל (Factory Quotes)

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 2.6.1 | רשימת הצעות מפעל (`/dashboard/v3/factory`) — כל הבקשות לפי סטטוס (pending/received/finalized) | shipped | `app/dashboard/v3/factory/page.tsx`, `FactoryQuotesView.tsx` | — |
| 2.6.2 | "שלח לפבריקה" — שולח לאלי DM עם מפרט המוצר + פרטי הליד; שומר שורה ב-`factory_quote_requests` | shipped | `lib/factory/sendToFactory.ts`, `app/api/factory/send/route.ts` | — |
| 2.6.3 | Feishu integration — ייצוא הצעת מחיר ישירות לשיט הסיני של המפעל (`feat/feishu-export`) | shipped | `lib/feishu/client.ts`, `scripts/_import-factory-quotes-feishu.ts` | — |
| 2.6.4 | Import מחירים מ-Excel של המפעל (`newfactory.xlsx`) — parsing של 14 מוצרים + per-product plate fees | shipped | `scripts/import-new-factory.ts`, `lib/factory/calculator/constants.ts` | — |
| 2.6.5 | מנוע תמחור — חישוב עלות CNY → ILS (FX + shipping + מרווח) לכל קומבינציה של מוצר × כמות × גמר | shipped | `lib/factory/calculator/engine.ts` | — |
| 2.6.6 | Finalize modal — אלי קובע מחיר סופי, מרווח, shipping (sea/air), כותב הערות; יוצר PDF ושולח ללקוח | shipped | `app/dashboard/v3/_components/factory/FinalizeModal.tsx`, `app/api/factory/finalize/[id]/route.ts` | — |
| 2.6.7 | PDF הצעת מחיר ללקוח — Hebrew-only, branded "שקית אלבדי", מחיר סופי בלבד (ללא breakdown פנימי) | shipped | `app/api/factory/[id]/pdf/route.ts`, `lib/factory/pdf/render.tsx` | — |
| 2.6.8 | תצוגה מקדימה של הצעת המחיר ("בוס מוד") — customer view + פירוט פנימי (FX, CNY, רווח, shipping) | shipped | `app/dashboard/v3/factory/_components/QuoteHtmlPreview.tsx`, `DetailedBreakdown.tsx` | — |
| 2.6.9 | Dark theme לכל modal הצעת המפעל | shipped | `QuoteHtmlPreview.tsx` | — |

### 2.7 GHL Widgets (iframe inside GoHighLevel)

GHL = ממשק תפעולי יחיד אחרי השלמת המעבר. dashboard v3 ייעלם. Widgets פר-iframe תחת `/widget/*`, auth ע"י `GHL_WIDGET_TOKEN` (query או Bearer). כל ה-business logic ב-`lib/factory/server/*` כך ש-routes גם של dashboard וגם של widget רק wrappers דקים — הפרדה מוחלטת.

| # | Feature | Status | קוד | URL |
|---|---|---|---|---|
| 2.7.1 | 🧮 מחשבון מחיר — iframe sidebar | shipped (2026-05) | `app/widget/calculator/page.tsx`, `components/calculator/CalculatorView.tsx` | `/widget/calculator?widget_token=<T>` |
| 2.7.2 | 📋 סיכום הזמנה (read-only) — iframe sidebar | shipped (2026-05-21) | `app/widget/order-summary/page.tsx`, `components/order-summary/OrderSummaryView.tsx` | `/widget/order-summary?widget_token=<T>` |
| 2.7.3 | 🏭 הצעות מפעל (factory-flow) — **sidebar widget עם contact picker**. flow מלא: בחר ליד → Order Summary → שלח Feishu → Refresh → Finalize (margin slider + shipping + DetailedBreakdown ¥→$→₪) → שלח WhatsApp עם PDF | shipped (2026-05-21) | `app/widget/factory-flow/page.tsx`, `components/factory-flow/*.widget.tsx`, `lib/factory/server/{list,refresh,finalize,sendWhatsapp}.ts`, `app/api/widget/factory/*` | `/widget/factory-flow?widget_token=<T>` |
| 2.7.4 | ⚙️ Settings widget — תוכנן, לא נחת | planned | — | `/widget/settings?widget_token=<T>` |
| 2.7.5 | 🤖 Bot Decisions widget — תוכנן, לא נחת | planned | — | `/widget/bot-decisions?widget_token=<T>` |

**Architecture:** [docs/migration-to-ghl/PLAN.md](migration-to-ghl/PLAN.md) Phase 1G. Contact Detail placement לא זמין ב-tier הנוכחי של GHL → כל הויג'טים פר-לקוח חיים ב-Sidebar עם contact picker פנימי (debounced search על name/phone/sid).

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

## 3. אינטגרציות חיצוניות

### 3.1 Meta Lead Ads → CRM (FB Lead Form pipeline)

| # | Feature | Status | קוד | הערות |
|---|---|---|---|---|
| 3.1.1 | Meta Lead Ads → Google Sheets אוטומטי (Meta native) | shipped | Google Sheets (Meta sync) | ללא קוד מצידנו |
| 3.1.2 | Apps Script — נורמליזציה של טלפון לE.164 (05X → +972X), סינון BAD_PHONE | shipped | Google Apps Script ב-Sheets | `fixPhone()` + regex guard |
| 3.1.3 | Apps Script — POST ל-`/api/leads/facebook-import` לכל שורה חדשה; כותב SENT / BAD_PHONE בעמודות הביקורת | shipped | Google Apps Script + `app/api/leads/facebook-import/route.ts` | — |
| 3.1.4 | `facebook-import` endpoint — upsert ליד ב-DB עם `pipelineStage=NEW`, source=facebook_import | shipped | `app/api/leads/facebook-import/route.ts` | — |
| 3.1.5 | **פערי טופס** — קריאת הShיט ב-CSV ציבורי, סיווג שורות שלא הגיעו ל-CRM (pending / bad_phone / send_failed / other_error) | shipped (v3.7) | `lib/sheets/lead-gaps.ts` | cache 5 דקות, soft-fail |
| 3.1.6 | DM לאלי בכל ריצת cron אם יש פערים > 0 (ספירה + לינק לדשבורד) | shipped (v3.7) | `app/api/bot/followups/route.ts` | — |

### 3.2 WhatsApp Bridge (messaging)

| # | Feature | Status | קוד | הערות |
|---|---|---|---|---|
| 3.2.1 | self-hosted `whatsapp-bridge-node` על Fly.io — שליחה/קבלה ללא 24h limit | shipped | `BRIDGE_BASE` env | מחליף ManyChat לחלוטין |
| 3.2.2 | Webhook HMAC-SHA256 + replay window 5 דקות | shipped | `app/api/bridge/webhook/route.ts` | — |
| 3.2.3 | שליחת הודעות free-form (טקסט / מדיה) | shipped | `lib/bridge/client.ts:sendBridgeMessage` | — |
| 3.2.4 | תבנית company intro — 3-tier fallback: (1) וידאו+כפתור Instagram (2) CTA URL (3) טקסט בלבד | shipped | `lib/bridge/client.ts:sendCompanyTemplate` | — |
| 3.2.5 | `sendEliDM` — DM לאלי לכל escalation / gap / factory reminder | shipped | `lib/notify/eli.ts` | מבוסס `ELI_NOTIFY_JID` |

### 3.3 Feishu (飞书) — שיתוף מסמכים עם המפעל הסיני

| # | Feature | Status | קוד | הערות |
|---|---|---|---|---|
| 3.3.1 | Auth — App ID + App Secret → access token | shipped | `lib/feishu/client.ts` | — |
| 3.3.2 | קריאת שיט Feishu (factory quote rows) | shipped | `lib/feishu/client.ts` | — |
| 3.3.3 | ייצוא הצעות מחיר לשיט Feishu (כתיבה לשורות) | shipped | `scripts/_import-factory-quotes-feishu.ts` | — |

### 3.4 Green API (WhatsApp — legacy / company template)

| # | Feature | Status | קוד | הערות |
|---|---|---|---|---|
| 3.4.1 | שליחת וידאו company intro דרך Green API | shipped | `lib/greenapi/client.ts:sendFileByUrl` | — |
| 3.4.2 | שליחת כפתור Instagram (Interactive Buttons) | shipped | `lib/greenapi/client.ts:sendInteractiveButtons` | — |
| 3.4.3 | Fallback לטקסט בלבד אם Green API נכשל | shipped | `lib/greenapi/client.ts` | — |

---

## 4. Cross-cutting / Infrastructure

| # | Feature | Status | קוד | מסמך |
|---|---|---|---|---|
| 4.1 | Drizzle ORM + Neon Postgres | shipped | `lib/db/schema.ts` | ARCHITECTURE §db |
| 4.2 | DB migrations (`drizzle-kit push`) | shipped | `drizzle.config.ts` | — |
| 4.3 | Vercel auto-deploy on `main` push | shipped | `vercel.json` | — |
| 4.4 | Daily cron via Vercel | shipped | `vercel.json` | — |
| 4.5 | External cron (claude.ai/code routine) | shipped | external | CLAUDE.md |
| 4.6 | Bridge webhook signing | shipped | `app/api/bridge/webhook/route.ts` | ARCHITECTURE §security |
| 4.7 | Bearer auth on all `/api/*` (except `/api/auth/*`) | shipped | per-route check | — |
| 4.8 | Sender attribution (`messages.sender`: lead/bot/eli) | shipped | schema | ARCHITECTURE §db |

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
