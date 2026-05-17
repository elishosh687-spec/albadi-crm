# Albadi CRM — Changelog

> רק שינויים גדולים (pivots, מהפכות, ארכיטקטורה). שינויים יומיומיים = `git log`.
> פורמט: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + semver רופף.

---

## v3.5 — 2026-05-17 — "Bot Supervisor Phase 1 — LLM gate + decision log + Eli feedback"

### Added
- **LLM Supervisor** (`lib/supervisor/supervise.ts`) — gates EVERY inbound message BEFORE any reply leaves. Returns one of: `approve_code` / `override_with_text` / `escalate_to_eli` / `silence`. On error: `supervisor_error` → no send, Eli DM. System prompt v1.1.0 compresses CUSTOMER-FLOW.md decision matrix + BOT-COPY tone rules + price/date guardrails.
- **`bot_decision_log` table** — one row per inbound. Captures three lanes: (a) what the LLM supervisor recommended, (b) what the deterministic code actually did, (c) what Eli decided later. Schema includes `eli_correction_type` (routing / policy / content) for future Phase 2 rule mining.
- **Candidate predictor** (`lib/supervisor/candidate.ts`) — lightweight dry-run that maps (stage, qState, classified intent) to a description of what the existing handler would do. Used as context for the supervisor LLM.
- **Eli feedback hooks** — `attachEliFeedback()` called from `approveDraft`, `rejectDraft`, `sendManualReply`, `setLeadStage`, `setBotPaused`, and the direct-WhatsApp branch of the bridge webhook. Best-effort, never blocks.
- **Auto-send lane** — when supervisor escalates but the candidate is a known-safe canned reply (samples / delivery / format / company / inclusive) with high intent confidence and zero risk flags, the gate overrules the LLM and lets the handler send. Saves Eli draft-approval on no-brainers.
- **Replay metadata** — every log row's `metadata` carries `prompt_version`, `model`, and a candidate snapshot. Enables prompt-version analytics + replay of historical inbounds against new prompts.
- **"החלטות בוט" tab** in the v3 lead drawer — read-only 3-lane timeline. Divergence (LLM said one thing, code did another) and Eli overrides are highlighted.
- `GET /api/leads/[sid]/decisions` — Bearer-auth endpoint returning the latest 100 decision rows for a lead.
- `loadBotDecisionsAction` server action — same data, for in-dashboard use.

### Changed
- **`app/api/bridge/webhook/route.ts`** — full routing refactor. After message insert + stop-word + auto-unpause, every inbound now passes through `routeThroughSupervisor()`. Stop-word path, auto-unpause, and silent stages all write log rows so the timeline is complete.
- **`lib/drafts/index.ts`** — `approveDraft` / `rejectDraft` attach Eli feedback (approved_as_is / edited_draft / rejected_draft) to the most recent decision log row within a 24h window.
- **`app/actions/v2.ts`** — `sendManualReply`, `setLeadStage`, `setBotPaused` attach feedback similarly.
- **Vercel cron** for follow-ups → `0 * * * *` (hourly) instead of daily, so the 2h/12h/23h cadences encoded in `app/api/bot/followups/route.ts` actually fire on time.

### Migration notes
- `bot_decision_log` table + `eli_correction_type` column created via idempotent scripts (`scripts/_create-bot-decision-log.ts`, `scripts/_add-correction-type.ts`). Both applied to Neon.
- All new schema additions are additive; zero downtime.
- New ENV vars (all optional): `SUPERVISOR_MODEL` (default `gpt-4o-mini`), `SUPERVISOR_BYPASS=1` (emergency rollback — falls back to legacy flow without redeploy).

### Known limitations
- `override_with_text` does NOT apply the candidate's stage transition. Reserve for cases where stage doesn't need to advance (Phase 5 will add `stage_transition` to the supervisor JSON output).
- Langfuse integration deferred — `langfuse_trace_id` column is in the schema but not populated.
- Phase 2 (few-shot retrieval from `bot_decision_log` where `eli_action IS NOT NULL`) waits until ~50+ feedback rows accumulate (~1 week of operating data).

### Rationale
Eli reported leads falling between the chairs — bot answers some, ghosts others, no visibility into bot decisions. Original ask was a multi-section rule engine + QA dashboard + suggested rules queue (~2 weeks). We deliberately shipped a measurement-first MVP: every decision is captured (LLM verdict + code action + Eli's eventual override) so future phases (Phase 2 few-shot, Phase 3 deterministic rule extraction) are driven by real data, not theory.

See `docs/binary-chasing-dawn.md` for architecture, files, ENV, smoke-test, and Phase 1.5–6 roadmap.

---

## v3.4 — 2026-05-16 — "Dashboard v3 command center + CRM operating layer"

### Added
- **Dashboard v3 command center** (`/dashboard/v3`) — redesigned supervisor console. Commit `9599a4f`. See `app/dashboard/v3/README.md`.
- **CRM operating-layer schema** — 8 new tables migrated to Neon 2026-05-16:
  - `crm_contacts` — contact entity (phone unique, separate from lead episodes)
  - `crm_lead_episodes` — lifecycle + operational status + score + owner + queue per lead
  - `crm_tasks` — open/completed follow-up tasks with due_at
  - `crm_sla_timers` — SLA breach tracking per lead
  - `lead_score_snapshots` — append-only fit/intent/engagement/friction score history
  - `source_touches` — multi-touch attribution
  - `opportunities` — deal record (value_ils, pipeline_stage, won/lost timestamps)
  - `consent_records` — WA consent audit trail
- **`app_config` table** — JSONB KV for pricing + shipping + FX (factory use case, separate from `bot_config`).
- **`factory_quote_requests` table** — factory quote lifecycle: pending → received → finalized. Feishu row index + factory response + final pricing snapshot.
- **`bot_quotes` table** — append-only audit of every WA quote sent by bot (initial + requote). Indexed `(lead_sid, sent_at)`.

### Migration notes
- `npx drizzle-kit push` run manually 2026-05-16 after Vercel deploy.
- All new tables are additive — no existing columns dropped. Zero downtime.
- CRM table APIs / server actions not yet wired; tables ready for next phase.

---

## v3.3 — 2026-05-16 — "WA-native polls + bot quote history"

### Added
- **WhatsApp native polls** for the entire bag-quote questionnaire — shipping / quantity / size / handles / lamination / colors + the step-9 confirmation gate. Customers tap option chips instead of typing. Free-text only when picking "אחר" (custom quantity / dimensions / color count) or "רוצה לשנות" in the confirmation flow.
  - `sendBridgeMessage` (`lib/bridge/client.ts`) gained a `poll` param emitting `type=poll` against `wa-bridge-yehuda.fly.dev`. Capped at 12 options per WA.
  - Webhook (`app/api/bridge/webhook/route.ts`) unwraps inbound `data.media_type=poll_vote` events: parses the JSON `content`, takes `selected_options[0]` as plain text, so `matchAnswer` sees "בינוני" instead of raw JSON. `mediaPresent=false` for vote payloads.
  - `POLLS_ENABLED=true` replaces `BUTTONS_DISABLED` as the active widget mode; the buttons kill-switch stays as a fallback if polls ever regress.
- **Bot quote history** — append-only `bot_quotes` table captures every WhatsApp quote the bot sends (initial questionnaire completion + auto-requote after spec change). Each row: `lead_sid, source ('initial'|'requote'), q_state snapshot, quote_text, quote_total_ils, quote_alt_total_ils, sent_at`. Indexed `(lead_sid, sent_at DESC)`.
  - `GET /api/leads/:sid/quotes` returns the timeline (auth: dashboard cookie, capped at 50).
  - `DELETE /api/leads/:sid` cascades `bot_quotes`.
  - `QuoteHistory` accordion in OrderSummary renders source badge + price + ILS delta vs. the previous quote; expand a row to see full message text + alt total.

### Changed
- `fetchQuote` now returns `{ text, totalIls, altTotalIls }` (was raw `string`). `routeToQuoted` and `requoteWithUpdatedSpec` both adopted the structured shape so they can log calc totals into `bot_quotes` without re-running the engine.

### Fixed
- **Bridge webhook signing-secret bug** — Yehuda's bridge `sub_01KRHJD89E3FQ288S5SRK5MBGT` started returning `"signing secret unavailable (server-side bug)"` on every delivery (status_code/latency both null = never reached our endpoint). Rotated the subscription secret via `POST /v1/subscriptions/:id/rotate-secret`, updated `BRIDGE_WEBHOOK_SECRET` locally + in Vercel production env, and re-deployed. Synthetic ping now delivers 200/1.8s. Also corrected `BRIDGE_SUBSCRIPTION_ID` in `.env` (was pointing at the unrelated albadi22 subscription).

---

## v3.2 — 2026-05-16 — "Factory swap: Kunming Shengximengtai"

### Changed
- **`lib/factory/calculator/constants.ts`** — `DEFAULT_PRODUCTS` rewritten from `newfactory.xlsx` (Kunming Shengximengtai Trading). 14 sizes, all 14 ids preserved (p1..p14, matched by canonical dimension multiset). Mean unit-price reduction ~13% vs prior factory.
- **`laminationColorPlateFee`** — unified at ¥300/color across all products (was per-product, ranging 345–943).
- **`DEFAULT_COLOR_ADDONS`** — values verified identical to prior factory (recomputed deltas across all 14 sheets matched current literals exactly), so kept as-is.
- **Dimension labels** — re-axed where the same physical bag was labeled differently (e.g. `H25*D8*W20` → `H20*D8*W25`). Same multiset, different orientation.

### Added
- **`scripts/import-new-factory.ts`** — xlsx → TypeScript literal emitter. Re-run when factory provides updated price sheet.
- **`scripts/verify-new-factory.ts`** — round-trip check: parses xlsx, calls `calculateQuote`, asserts CNY unit-cost match for every (handle × finishing × color × qty) combination. 580 cells covered.

### Unchanged
- Engine formula (`engine.ts`), types (`types.ts`), shipping options, quantity tiers, exchange rates (`usdToCny=7.2`, `usdToIls=3.6`), profit margin (40%). Pricing **method** identical — only **values**.

### Notes
- Production-method dimension (`热压` heat-press vs `车缝` stitched) is implicit in the new xlsx: 1000pcs tier uses stitched (more expensive per unit), 3000+ uses heat-press, laminated splits at 3000/5000. Schema unchanged because `prices[qty]` indexing already represents the chosen method per tier.
- Source file kept in repo root (`newfactory.xlsx`) for re-import.

---

## v3.1 — 2026-05-15 — "LLM integration: spec-extractor + unmatch-agent + rich HANDOFF"

### Added
- **`lib/autoresponder/openai-client.ts`** — shared OpenAI Chat Completions wrapper. Soft-fail, retry-once, JSON-mode by default. כל קריאות ה-LLM החדשות בבוט עוברות דרכו.
- **`lib/autoresponder/llm-context.ts`** — `buildLLMContext(sid)` טוען היסטוריה (20 הודעות) + qState + profile + tags + FAQ + business rules. ~3K tokens.
- **`docs/PRODUCT-FAQ.md`** — FAQ נטען אוטומטית לכל קריאת LLM (חומרים, אספקה, תשלום, אחריות).
- **`lib/autoresponder/spec-extractor.ts`** — מיפוי טקסט חופשי עברי לשדות שאלון קנוניים. שירות לשני call sites: (1) matchAnswer fallback ("לא חייב"→handles=false, "דחוף"→s1, "אלפיים"→custom+"2000"); (2) step 9 free-text revision.
- **`lib/autoresponder/unmatch-agent.ts`** — agent שמנסה לטפל ב-3 fallback paths ב-decision.ts לפני escalation. מחזיר reply / escalate / noop. אם reply — לעולם לא יצטט מחיר (post-validation).
- **Step 9 confirmation gate** ב-`questionnaire.ts` — אחרי הקיום השאלון, סיכום + כפתורים "מעולה, נמשיך / רוצה לשנות". free-text → spec-extractor → merge → re-confirm. max 2 revisions → factory route.
- **`orderNotes`** ב-qState + ב-DM של אלי ב-factory route.
- **Rich HANDOFF DM** — `eliDecisionEscalationTemplate` תומך ב-`llmAnalysis` + `recommendation`. כש-LLM היה ב-path, אלי מקבל ניתוח + המלצה במקום סיכום גנרי.
- **Test script** — `scripts/test-spec-extractor.ts` — bank of 17 Hebrew phrasings.

### Changed
- **`decision.ts` — 5 fallback paths** עברו ל-unmatch-agent: intent=`other` (Stage 2+4), intent=`question_other` (Stage 2+4), `awaiting_competitor_offer` ambiguous (Stage 2). פחות escalations סה"כ.
- **`escalateToEli()`** — signature מורחב (positional נשמר ל-backward compat): `escalateToEli(ctx, reason, { kind, llmAnalysis, recommendation, llmSummary? })`.
- **`questionnaire.ts` matchAnswer** — null → ניסיון נוסף עם spec-extractor (gpt-4o-mini); רק אז reask.
- **QState** — שדות חדשים: `confirmationStep`, `confirmationAttempts`, `orderNotes`. שלב terminal עבר מ-`step=9` ל-`step=10` (9 = confirmation gate).

### Migration notes
- כל ה-LLM calls soft-fail → אם OpenAI נופל, fallback לקוד הישן ללא breakage.
- Kill switches: `LLM_UNMATCH_DISABLED=1`, `LLM_SPEC_EXTRACTOR_DISABLED=1` ב-Vercel envs (redeploy ~30s).
- שום DB migration. שדות חדשים ב-qState (JSONB), backward compat אוטומטי.
- Models: כולם `gpt-4o-mini` (זול, מהיר). שדרוג עתידי ל-`gpt-4o` אם edge cases יציפו.

---

## v3 — 2026-05 — "Dashboard v3 + Retool supervisor console"

### Added
- **Dashboard v3** (`/dashboard/v3/*`) — Kanban 4-bucket leads board, WhatsApp-style chat view, analytics, pipeline metrics, settings editor.
- **In-app drafts queue** (`/dashboard/v3/drafts`, `/dashboard/v2/drafts`).
- **Retool supervisor console** (external — `elishosh.retool.com`) — pending drafts feed + state override.
- **REST API for Retool** — `/api/drafts/pending`, `/api/drafts/:id/approve`, `/api/drafts/:id/reject`, `/api/leads/:id/override`.
- **Money-moment drafts** (`bot_drafts` table) — feature-flagged via `ENABLE_DRAFT_QUEUE`.
- **Sender attribution** on `messages` table (`lead | bot | eli`).
- **Manual name+phone editing** on lead detail (workaround for bridge lid JIDs without contact info).
- **Dark-mode v3 theme**.

### Changed
- **`/dashboard/v2/lead/[sid]/page.tsx`** — conversation view + manual reply + LLM drafts + quick actions.
- **Bot copy** rewritten in Eli's voice (closes v2 gaps).
- **Follow-up cadence** aligned to CUSTOMER-FLOW v2.

### Migration notes
- v2 dashboard still live (fallback). v3 is the new primary.
- Retool resources: hand-built per `retool/SETUP.md`. No JSON import.

---

## v2 — 2026-04 — "Bridge cutover (off ManyChat)"

### Added
- **whatsapp-bridge-node tenant** — self-hosted Fly.io VPS for WhatsApp send/receive.
- **`/api/bridge/webhook`** — HMAC-signed inbound, 5-min replay window.
- **`bridge_events` table** — audit log per webhook envelope (UNIQUE `evt_id` for dedupe).
- **`USE_BRIDGE` feature flag** — flips messaging adapter between ManyChat and bridge.
- **DB-authoritative state** — `leads` row holds all custom fields previously in ManyChat (`pipeline_stage`, `next_action`, `bot_summary`, etc.).
- **`lead_tags` table** — tag membership by Hebrew name (numeric IDs retained for backward compat only).
- **`messages.wa_message_id`** — dedupe key for bridge inbound retries.
- **`lib/messaging/index.ts`** — adapter layer; server code imports from here, not from bridge/manychat clients directly.

### Removed (deprecated, still in code)
- ManyChat templates / Flows path (`restart-send`) — bridge has no 24h limit, no template need.
- ManyChat new-lead webhook + inbound webhook — bridge handles intake.

### Migration steps
1. `npx tsx scripts/backfill-from-manychat.ts --confirm`
2. Register bridge webhook subscription via `POST /v1/subscriptions`.
3. `USE_BRIDGE=1` in Vercel envs.
4. Watch one full cycle.
5. (pending) Delete `MANYCHAT_TOKEN`, `lib/manychat/client.ts`, deprecated routes.

---

## v1 — 2026-03 — "Dashboard v2 + supervisor inbox"

### Added
- **`/dashboard/v2/*`** — inbox by pipeline_stage, lead detail (notes + tags + conversation), pending drafts.
- **NotesModal** — single-instance modal at InboxList root (textarea + date stamper + stage override). Fixes the v2 client-bundle crash (PRs #28-30, #33-34) caused by importing from `lib/manychat/config.ts` in client components.
- **`lib/manychat/stages.ts`** — client-safe constants (V2_PIPELINE_STAGES, V2PipelineStage, V2_FLAG_TAG_IDS, V2FlagName). Client code MUST import from here, never from config.ts (which throws on missing `MANYCHAT_TOKEN` at module-load).
- **`updateLeadNotes`** in `app/actions/v2.ts` — writes ManyChat `notes` custom field (id 14447147) via `setCustomFields`.
- **8s AbortController timeout** on every ManyChat HTTP call (`lib/manychat/client.ts`) — prevents SSR freeze.

### Changed
- Followup cron downgraded to **daily** (Vercel Hobby plan limit).

### Lessons
- **Module-load throws in client bundle** = silent React unmount. Server SSR logs are 200 OK; only DevTools console shows the actual error. See CLAUDE.md §v2 for the debug playbook.

---

## v0 — 2026-02 — "Initial ManyChat-based bot"

### Added
- ManyChat-based WhatsApp bot — Flows for re-engagement templates, custom fields for state.
- LLM classifier as **separate cron job** (hourly, posts decisions to `pipeline_suggestions`).
- Initial Drizzle schema: `leads`, `messages`, `pipeline_suggestions` (dropped in v1).
- Vercel cron `/api/bot/cron`.
- Hardcoded `TAG_IDS`, `FIELD_IDS` in `lib/manychat/config.ts`, `FLOW_NS` in restart-send route.

### Notes
- Architecture: ManyChat = state. App = thin classifier + dashboard.
- Replaced by v2 (bridge takes over state ownership).

---

## Naming convention for future entries

- One section per major release (`vN — YYYY-MM — "title"`).
- Sub-sections: **Added / Changed / Removed / Deprecated / Fixed / Migration notes / Lessons**.
- Day-to-day commits live in `git log` only; don't pollute changelog.
- Cross-link ADRs (`adr/000N-*.md`) and PRD/FEATURES/ARCHITECTURE updates.
