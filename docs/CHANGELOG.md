# Albadi CRM — Changelog

> רק שינויים גדולים (pivots, מהפכות, ארכיטקטורה). שינויים יומיומיים = `git log`.
> פורמט: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + semver רופף.

---

## 2026-05-21 — "GHL outbound mirror: include `sender='eli'`"

### Fixed
- **Business-side messages now appear in the GHL unified thread.** Phase 1F shipped outbound mirroring gated on `sender === 'bot'`, which silently dropped every Eli-originated path (dashboard manual reply, bulk personalized cron, factory send, supervisor override) from the GHL Inbox view. Gate inverted: mirror by default; only the GHL-Inbox-originated `/api/integrations/outbound` path opts out via `skipGhlMirror=true` to avoid duping the message GHL already recorded itself. ([lib/bridge/client.ts](lib/bridge/client.ts), [lib/greenapi/client.ts](lib/greenapi/client.ts))
- **WA Business app direct sends mirror to GHL.** `handleMessageSent` in the bridge webhook now captures the `insertBridgeMessage` return and forwards to GHL only on fresh inserts (i.e. when no `sendBridgeMessage` pre-insert claimed the `wa_message_id`). Covers the case where Eli replies from the bonded phone and bridge emits `message.sent` instead of `message.received(is_from_me)`. ([app/api/bridge/webhook/route.ts](app/api/bridge/webhook/route.ts))

---

## 2026-05-19 — "Factory prices update 2 (Kunming) — broad cuts + plate-fee drops"

### Changed
- **Factory unit prices for p2–p14 updated** from `newfactoryupdate2.xlsx` (Kunming Shengximengtai). 66 rows changed across 5 sized variants; mostly decreases (~10% avg). Notable per-product cuts: H35*D10*W40 laminated hot-press 5K ¥1.18→¥0.89 (-25%), H30*D12*W40 3-color non-lam 5K ¥1.09→¥0.93. Two upticks: H30*D10*W30 Non/1color non-lam 10K ¥0.55→¥0.58, H40*D15*W50 Handle laminated 10K ¥1.20→¥1.25. Eight products unchanged. ([lib/factory/calculator/constants.ts](lib/factory/calculator/constants.ts))
- **Plate fee (`laminationColorPlateFee`) cuts**: p2 ¥310→¥290, p3 ¥400→¥390, p4 ¥820→¥615 (-25%), p8 ¥460→¥405 (-12%), p9 ¥600→¥570.
- **Color addon averages re-computed** from 13 sheets (p1 excluded). 2-color: 5K 0.12→0.09, 10K 0.10→0.08. 3-color: 5K 0.25→0.21, 10K 0.20→0.18. ([DEFAULT_COLOR_ADDONS](lib/factory/calculator/constants.ts))

### Skipped (intentional)
- **p1 (H20*D8*W25) untouched** — factory renamed the sheet to `H20-D8（9）-W25` and inserted text like `￥0.45\nH20*D9*W25` in some cells, suggesting an ambiguous variant. Holding existing values until clarified with factory.
- **New factory size `H15*D9*W20` not adopted** — 28 fresh price rows in the file, but the dashboard stack stays at 14 products. Re-evaluate when the new size has real demand.

### Tooling
- **SheetJS 0.18 cannot read rich-text cells** the factory used in this file (qty cells store text in the `r` rich-text runs, leaving `v` empty). Added `scripts/_flatten-xlsx.py` (openpyxl-based, runs once) that rewrites rich-text cells to plain strings in place; `import-new-factory.ts` then sees them normally.
- **`SKIP_SHEETS` constant** added to `scripts/import-new-factory.ts` for the two skipped sheets; unknown EXISTING keys now `continue` instead of emitting fallback `pX*` ids.
- Re-import path is now: `python scripts/_flatten-xlsx.py && npx tsx scripts/import-new-factory.ts > _out.ts`, then splice into `constants.ts`.

### Risks / follow-ups
- p10 (H50*D20*W60) laminationPrices remain incomplete (only 1000/3000 stitched keys; hot-pressed 5K/10K never were in the data) — calculator already tolerates missing keys.
- In-flight quotes in `factory_quote_requests` keep their stored `factoryResponse` snapshot; new prices apply only to future quotes.

---

## 2026-05-19 — "Lead card 'פתח כרטיס' + in-app PDF preview"

### Changed
- **Lead card primary button now opens the lead card itself, not the conversation.** The old "פתח שיחה" button took users to `/dashboard/v3/conversations?lead=X`, but clicking anywhere else on the same card opened `/dashboard/v3/leads?lead=X` (ExpandedLead with internal tabs). Confusing — same card = two destinations. Renamed to "פתח כרטיס" and pointed at the same `fullCardHref` the rest of the card uses, so every click on a lead card now lands in the same place. ([LeadsView.tsx](app/dashboard/v3/leads/LeadsView.tsx))

### Added
- **In-app HTML quote preview for factory quotes.** "צפה בהצעה" button opens a modal with a Hebrew-styled HTML rendering of the quote — no PDF plugin needed (initial iframe-PDF attempt blank-rendered in some browsers). Mirrors the PDF layout (header, hero price, spec table, price breakdown, VAT note, terms). New component `QuoteHtmlPreview.tsx`. Added in both per-lead FactoryQuotePanel and the global FactoryQuotesView list ("צפה" pill on each finalized row). ([QuoteHtmlPreview.tsx](app/dashboard/v3/_components/factory/QuoteHtmlPreview.tsx), [FactoryQuotePanel.tsx](app/dashboard/v3/_components/factory/FactoryQuotePanel.tsx), [FactoryQuotesView.tsx](app/dashboard/v3/factory/_components/FactoryQuotesView.tsx))
- **`?stream=1` mode on `/api/factory/[id]/pdf`** — proxies the PDF bytes through this endpoint instead of 302-redirecting to the Blob URL. The redirect target sets `X-Frame-Options` which blocks `<iframe>` embedding, so the preview modal opted out of the redirect. ([pdf/route.ts](app/api/factory/[id]/pdf/route.ts))

---

## 2026-05-19 — "Sea shipping: $319/CBM + 1 CBM floor + detailed boss breakdown"

### Changed
- **Sea shipping rate $500/CBM → $319/CBM** (forwarder renegotiation). Updated in `app_config.factory_pricing.shippingOptions[type=sea].seaRate` via Settings UI. Code default in `lib/factory/config.ts` left at 500 (DB is source of truth; default only used when seeding an empty install).
- **Minimum 1 CBM floor on sea shipping.** Even a 0.1 CBM order is billed for 1 full CBM. Two one-line changes:
  - `lib/factory/calculator/engine.ts:117` (bot questionnaire): `(Math.max(totalCbm, 1) * shippingOption.seaRate) / quantity`
  - `lib/factory/pricing.ts:40` (FinalizeModal): same. Air shipping unaffected (weight-based).
  - Rationale: audit (`scripts/_audit-cbm-by-product.ts`) showed 63% of product × qty combos ship at <1 CBM, where the "consolidation will share the LCL container" assumption no longer holds — Albadi pays the carrier's 1 CBM floor regardless.

### Added
- **DetailedBreakdown component** (`app/dashboard/v3/_components/factory/DetailedBreakdown.tsx`) — collapsible "פירוט מלא לבוס" panel wired into 3 surfaces: FinalizeModal live calc, FactoryQuotePanel finalized state, CalculatorView preview. Shows: FX rates (USD↔ILS, USD↔CNY, derived CNY↔ILS), factory cost in ¥ → $ → ₪, per-component CNY breakdown (base/handles/lamination/plate fee/logo — only when caller has `QuoteResult`), plate fee amortization, sea shipping formula with floor highlight, low-CBM utilization warning (<50%), profit as % of cost AND as % of revenue, air/sea side-by-side comparison.
- **`lib/factory/breakdown.ts`** — pure `buildBreakdownView()` helper. No JSX. Reused by all three surfaces.
- **`/api/factory/config` merge in CalculatorView page** — page was passing `DEFAULT_CONFIG.shippingOptions` (hardcoded $500) to the client; now merges DB shipping rates so the live preview matches reality.

### Fixed
- **FinalizeModal `invalid_body` when margin slider > 200%.** Zod schema in `app/api/factory/finalize/[id]/route.ts:36` capped at 200; slider in `FinalizeModal.tsx:53` allowed up to 300. Bumped schema to `.max(300)`.

### Audit scripts
- `scripts/_audit-recent-quotes.ts` — replays recent `bot_quotes` rows against current config to flag drift between sent prices and current policy.
- `scripts/_audit-cbm-by-product.ts` — enumerates all 14 products × 4 qty tiers × handles variants, prints which combos fall under 1 CBM and crossover quantities.

### Notes
- All code reads from existing `FactoryPricingResult` / `QuoteResult`; no new persisted state. DB migration not required.
- "Profit as % of revenue" surfaces a real gap: a 174% markup on cost lands at ~40% of revenue once shipping pass-through is in the denominator.

---

## 2026-05-18 — "Factory plate fees: per-product from xlsx"

### Fixed
- **Plate fee (`版费`) was uniform ¥400/color across all 14 products in `lib/factory/calculator/constants.ts` — incorrect.** The `newfactory.xlsx` source-of-truth has per-product fees ranging ¥300–820/color (encoded in each sheet's col 6 `1color:￥N…` and col 14 Remark `版费：N元/色`). Bot lamination quotes were over/under-charging by up to ¥460/color. Updated all 14 `laminationColorPlateFee` values to match xlsx. Verified against 12 user-supplied test cases (11/12 pass; case 12 stale assumption, see commit body).
- **Importer (`scripts/import-new-factory.ts`) hardcoded plate fee to 300 instead of reading from xlsx** — would silently regress the fix on next re-import. Importer now parses col 14 Remark first (authoritative when col 6 contradicts, e.g. H35×W50), falls back to col 6.

### Notes
- Plate fees live in code (catalog data), not DB (`app_config.factory_pricing`). DB still owns only admin-tweakables (FX rates, margin matrix, shipping rates). Bot picks up new values automatically via `buildMergedConfig`.

---

## 2026-05-18 — "Company template: video + Instagram button"

### Fixed
- **Company-intro video now actually arrives.** `https://albadi.ecobrotherss.com/company-intro.mp4` previously returned the SPA `index.html` (Vercel fallback), so Green API forwarded an HTML payload to WhatsApp as a broken attachment. Added the real 8.84 MB MP4 at `public/company-intro.mp4` so the URL serves `Content-Type: video/mp4`.
- **Instagram button now appears.** `lib/greenapi/client.ts:sendGreenCompanyTemplate` was sending only `sendFileByUrl` + caption (no buttons) — the WhatsApp link card was unreliable and Eli reported "no Instagram button." Refactored to send two messages: video via `sendFileByUrl`, then `sendInteractiveButtons` with one `type: "url"` button to `instagram.com/simonsostri`. `SendInteractiveButtons` has no media-header support so the split is mandatory. Plain-text path kept as last-resort fallback.

### Notes
- The earlier in-code comment claiming "Green API's button endpoint is unreliable since WhatsApp deprecated it" is correct only for the deprecated `SendButtons` endpoint. `SendInteractiveButtons` (current, 3-button cap, 25 chars each) is supported and is what we now use.

---

## v3.8 — 2026-05-18 — "Settings drives the bot: per-qty margin + restart template + nav polish"

### Added
- **Per-quantity profit-margin matrix in Settings** — `FactoryPricingConfig` now carries `profitMarginByQuantity: { "1000": …, "3000": …, "5000": …, "10000": … }`. The WhatsApp questionnaire calculator reads margin from this map (falling back to `defaultProfitMargin` for free-form quantities). Settings page (`/dashboard/v3/settings`) has a new "אחוזי רווחיות לפי כמות" section with four numeric inputs.
- **`restart_questionnaire` template type** — `message_templates.type` now accepts a third value. A row of this type resets the lead's `qState`, then sends: (a) the row's `body` as a transition note, (b) the hardcoded OPENING, (c) the first shipping-method poll. Surfaces:
  - Settings UI: third type button next to "טקסט"/"CTA" with an explanatory note + amber "שאלון מחדש" badge in the templates table.
  - Composer "תבנית" dropdown: amber ↻ icon + JS `confirm()` dialog before send (state reset is destructive — Eli must explicitly OK).
  - Action plumbing: `restartQuestionnaire(sid, transitionText?)` exported from `lib/autoresponder/questionnaire.ts`; dispatched from `sendTemplateAction` when `tmpl.type === 'restart_questionnaire'`. Replaces the ad-hoc `scripts/_restart-questionnaire.ts` for the common case.
- **Prev/next lead navigation inside the conversation card** — `ChatHeader` shows two new chevron buttons (RTL: right=prev, left=next) computed from the currently filtered list (`search` + `filter` aware). Lets Eli sweep through the queue without bouncing back to the list.
- **Phone number displayed beneath name in conversations list** — when a lead has both a name and a phone, the list row renders the name on top and the E.164 phone (LTR, tabular) underneath as a second line. Falls back to single-line behaviour when only one is known.

### Changed
- **`calculateQuoteByCodes` is now async.** Internally it calls `buildMergedConfig` which fetches `app_config.factory_pricing` from the DB and merges admin-editable values (margin matrix + `globalProfitMargin`, USD↔CNY/USD↔ILS rates, shipping `seaRate`/`airRates` matched by `type` between hardcoded `s1`/`s2` and DB options) into the hardcoded catalog (`DEFAULT_CONFIG`). Catalog data — 14 products, qty tiers `q0..q3`, color addons, features — stays in code because it's keyed to the factory's CNY price sheet.
- **`questionnaire.ts:fetchQuote`** awaits `calculateQuoteByCodes`. No other call sites — `priceFactoryQuote` (manual FinalizeModal) keeps using `getFactoryConfig` directly as before.
- **`lib/factory/config.ts:normalizeConfig`** — back-compat shim that auto-populates `profitMarginByQuantity` from `defaultProfitMargin` whenever an older row is read. Eliminates the need for a migration script.
- **`DEFAULT_FACTORY_CONFIG`** seeds the matrix at `{1000:40, 3000:40, 5000:40, 10000:40}` so a brand-new install matches the previously hardcoded behaviour exactly.
- **Calculator page (`/dashboard/v3/calculator`)** — transparent breakdown view that previews the questionnaire's quote per product/qty/shipping/colors. Same-day refinement (commit `329ae86`): the margin-matrix editor that briefly lived inside the calculator was removed; Settings is now the sole place to edit margins. Calculator reads `initialMargins` from the DB and renders read-only.
- **Calculator — custom quantity + reverse-margin check + profit-anchor mode.** Three same-day additions:
  - "כמות מותאמת" number input next to the tier select. Engine `findClosestPrice` already snapped CNY prices to the lower tier for arbitrary quantities; engine now also snaps the margin matrix the same way (e.g. qty=2500 → uses the 1000-tier margin), so the price/margin treatment is consistent. API route `quote-preview` accepts `qtyOverride`.
  - "תמחור לפי יעד" section with a three-mode toggle:
    - **רווח קבוע (₪)** *(default)* — type target total profit in NIS (e.g. 500). Returns per-unit price = totalCost + profit/qty, total order price, implied % vs the configured matrix. Use case: small deals where Eli wants a flat NIS profit regardless of qty.
    - **סכום כולל** — type total deal price, returns implied % + per-unit profit.
    - **מחיר ליחידה** — type per-unit price, returns implied % + total profit.
  - All modes share the same client-side reversal of `selling = (totalCost − shipping) × (1 + m/100) + shipping`. Result row greens when implied % meets/exceeds the configured matrix margin.
- **FinalizeModal — reverse-target widget + widened margin slider.** Same reverse-target panel (רווח ₪ / סכום כולל / ליחידה) now lives below the slider in the manual factory-quote modal (`/dashboard/v3/factory` → "חשב"). The hardcoded 30-50% slider clamp was incompatible with small-deal flat-profit usage, so the slider was widened to **0-300%** (ticks 0/100/200/300). "החל על סליידר" button writes the implied % back to the slider, which drives the live pricing + final PDF. Note: the modal's `priceFactoryQuote` uses a different formula convention from the catalog engine (`unitCost` is production-only, margin-base; `unitShipping` is separate). The reverse panel computes `base = unitCost` directly — do not copy the calculator's formula here without that conversion.

### Fixed
- **Settings page sometimes appeared not to save** (commit `ff9b3a9`). `getFactoryConfig` held a 60s in-process cache; on Vercel the PUT invalidated only the writing container's cache, and a subsequent SSR landing on a different warm container returned the pre-write snapshot until that container's TTL expired. Mitigation: `getFactoryConfig({ fresh: true })` is now used by all admin paths (settings/calculator pages + `/api/factory/config` GET + `/api/factory/quote-preview`), so the DB is the immediate source of truth there. Bot/cron paths still use the 60s cache. `FactoryPricingForm` also calls `router.refresh()` after a successful save, so the RSC re-runs and the `initial` prop reflects the saved value — the dirty check resets and the button shows "נשמר".

### Why this change
Until v3.7, the WhatsApp questionnaire ran on a *hardcoded* `DEFAULT_CONFIG` in `lib/factory/calculator/constants.ts` — Settings page edits only affected the manual FinalizeModal. Two parallel pricing universes that drifted (e.g. air rate 13$/kg in code vs 8.5$/kg in DB). v3.8 collapses them: Settings = single source of truth for margin + rates + shipping; catalog stays in code (it's a snapshot of the factory's price sheet that re-imports through `scripts/import-new-factory-bag-quote.ts`).

### Operator action required
- Open `/dashboard/v3/settings`, scroll to "אחוזי רווחיות לפי כמות", set the four percentages and Save. Saved value invalidates the 60-second in-memory cache.
- If you want a "התחל שאלון מחדש" button to be available from the chat composer, create the template in Settings → "+הוסף תבנית" → choose the "התחל שאלון מחדש" type → name it (e.g. "שאלון מחדש") → body = the transition sentence ("סליחה על הבלבול…") → Save. There is no auto-seed: the row exists only after you create it.

---

## v3.7 — 2026-05-18 — "Supervisor hardening + dashboard surfaces + media refresh"

### Added
- **Per-row feedback in "החלטות בוט" tab** — every supervisor decision now has explicit thumbs-up/down buttons:
  - 👍 *הLLM צדק* — sets `eli_action='approved_as_is'`, `eli_correction_type=null` (positive training signal).
  - 👎 *הLLM טעה* — opens a 10-intent picker (or free-text), saves `eli_intent_override` + `eli_correction_type='routing'`.
  - 👍/👎 also on stage transitions (`stage_before` → `stage_after`). The "fix stage" action writes the override AND physically moves the lead via `setLeadStage`.
- **New column `eli_intent_override`** (and `eli_correction_type` from v3.5 already in use) — explicit Phase 2 training signal, separate from implicit "Eli replied manually".
- **Auto-ack to customer on every `escalate_to_eli` and safety-net escalation** — the customer immediately sees "תודה על ההודעה 🙏 אבדוק ואחזור אליכם בהקדם" while Eli gets the DM/draft. No more silent ghosts when supervisor hands off.
- **Safety-net escalation in `app/api/bridge/webhook/route.ts`** — when the deterministic handler silently no-ops after `approve_code` (e.g. questionnaire bailed, unknown stage edge case), the system auto-escalates: draft queued + Eli DM + customer auto-ack. Log row marked `escalationKind='safety_net_silent_handler'`.
- **Follow-ups queue page** (`/dashboard/v3/followups`) — surfaces every lead waiting for a cron nudge with stage, attempt #, next eligible time (in Israel TZ), and "deferred by quiet hours" badge when the math-eligible time falls inside 21:00–09:00 IL. Sidebar entry "תור פולואפים".
- **Direct full-card access from conversations tab** — `LayoutDashboard` icon in `ChatHeader` and a "כרטיס מלא + החלטות בוט" button in `OrderSummary` both link to `/dashboard/v3?lead=<sid>` so the Bot Decisions timeline is one click away from the chat view.
- **Whole-card click on leads tab** — clicking anywhere on a lead card opens the full lead drawer. Action buttons (פתח שיחה / תצוגה מקדימה) now always visible (no more hover-only on desktop).

### Changed
- **`upsertLeadFromBridgeEvent`** now creates new leads with `pipeline_stage='NEW'` instead of NULL. Existing rows are also promoted via `coalesce(pipeline_stage, 'NEW')` on conflict. Eliminates the "no stage" middle state that was confusing in the UI. Backfill script `scripts/_backfill-null-stage.ts` ran once and promoted 7 historical rows.
- **`candidate.ts` (supervisor candidate predictor)** — now detects `qState.bailed === true` and returns `kind: "no_op"` with an explicit description, so the supervisor escalates instead of approving a handler that will silently refuse.
- **`mapHandlerResultToAction` (webhook)** expanded to recognize all 11+ action names emitted by the questionnaire engine (`started`, `reasked`, `answered`, `custom_prompt`, `custom_captured`, `size_page_2`, `confirmation_sent`, `confirmation_freetext_prompt`, `confirmation_revised`, `completed_standard`, `completed_factory`). Previously these all fell through to `no_op`, which falsely triggered the safety net + an extra auto-ack on top of the legit bot reply.
- **`SUPERVISOR_PROMPT_VERSION = "supervisor-v1.1.0"`** — system prompt now embeds the CUSTOMER-FLOW.md policy matrix per stage, BOT-COPY.md tone rules (first-person Eli, plural "אתם", 0-1 emoji), and the scheme.txt price/date guardrails ("never quote a price", "never confirm a delivery date"). Replaces the generic v1.0.0 guidance.
- **Company template 3-tier fallback** in `sendCompanyTemplate` — Tier 1 cta_url+video → Tier 2 cta_url no header (text + Instagram CTA button still works) → Tier 3 plain text. Each tier failure logs the actual bridge error body (`status` + `body`) for diagnosis.
- **Company video media_id refreshed** — old `mu__3tEVay0D703wO3cSxoPpg` was rejected by the bridge tenant (`"header.media_id not found for tenant"`); uploaded a fresh copy of the factory-walk video as `mu_HA4cbJxkZN7Hfcb-4QMkjA`. Bridge tenant TTL on media is the root cause — operations note: re-upload when bridge logs show 404.
- **Customer-facing URLs migrated to `albadi.ecobrotherss.com`** — in the bot quote message (`questionnaire.ts:appUrl`), the `COMPANY_TEMPLATE` text fallback, and `sendCompanyTemplate`. Old `bag-quote-app.vercel.app` references removed from customer-facing copy.
- **UI default stage fallback `'UNCLASSIFIED'` → `'NEW'`** in OrderSummary / ConversationsLayout / ExpandedLead — defensive against any future null slipping through.

### Fixed
- **"הLLM צדק" button not saving the verdict state** — `confirmLLMDecisionAction` used `COALESCE` which preserved any prior `eli_action` (e.g. `direct_whatsapp_reply`), so the success label never appeared. Now overwrites to `'approved_as_is'` because the explicit thumb is the stronger signal.
- **`scripts/_merge-lid-duplicates.ts` invalid Drizzle call (`.not()`)** — replaced with `ne()`. Was blocking Vercel TypeScript builds.
- **Vercel cron schedule** reverted from hourly (`0 * * * *`) to daily (`0 9 * * *`) — Hobby plan rejects sub-daily crons (`"Hobby accounts are limited to daily cron jobs"`). Hourly trigger continues via the external Claude routine. Vercel cron is a backup.

### Migrations
- Idempotent column add: `scripts/_add-intent-override.ts` (adds `eli_intent_override TEXT`).
- One-shot backfill: `scripts/_backfill-null-stage.ts` (7 leads NULL → NEW).

### Diagnostic scripts added
`_audit-history.ts`, `_audit-followup-gap.ts`, `_audit-old-crm-leads.ts`, `_check-cta-failure.ts`, `_check-lead-7716.ts`, `_check-log.ts`, `_check-media.ts`, `_extract-pairs.ts`, `_leads-overview.ts`, `_test-cta-url.ts`, `_test-cta-video.ts`, `_test-supervisor.ts`, `_upload-company-video.ts`. All read-only or one-shot, none on the production code path.

### Notes for operators
- **Bridge media TTL** — the tenant evicts uploaded media after a period (exact TTL unknown). When Vercel logs show `tier1 (video) failed: status=404 body=header.media_id not found for tenant`, re-upload via `npx tsx scripts/_upload-company-video.ts <path>` and update `COMPANY_VIDEO_MEDIA_ID` in `lib/bridge/client.ts`. Track in operational TODO with bridge maintainer.
- **Legacy CRM leads (~7 rows)** — `_audit-old-crm-leads.ts` identifies them; cold-outreach is OPTIONAL and not automated. Use `scripts/_send-reengagement-3.ts` style for one-shot batches.

---

## v3.6 — 2026-05-17 — "Follow-up Supervisor (Phase 1.5) — LLM gate on cron nudges"

### Added
- **Follow-up Supervisor** (`lib/supervisor/followup-supervisor.ts`) — the same supervisor pattern from Phase 1, now applied to the cron-triggered follow-up loop. Every eligible nudge passes through an LLM gate before sending. Verdicts:
  - `approve_template` — send the legacy canned template verbatim (happy path).
  - `override_with_text` — send a personalized Hebrew message (LLM-authored, references the lead's actual context: notes, date asked for, last reply).
  - `escalate_to_eli` — don't send; queue draft + DM Eli.
  - `silence` — skip this cycle, **attempt counter NOT consumed** (lead gets another chance later).
  - `supervisor_error` — LLM down, DM Eli, no send.
- `FOLLOWUP_SUPERVISOR_PROMPT_VERSION = "followup-v1.0.0"` (independent version tag from inbound supervisor).

### Changed
- `app/api/bot/followups/route.ts:processCustomerLead` — full refactor. After cadence check, candidate template + lead context (notes, bot summary, last 15 messages) feed the supervisor. Verdict drives execution + writes a row to `bot_decision_log` (same table as inbound, `metadata.trigger = "followup_cron"`).
- Cron handler queries now hydrate `notes` + `botSummary` for supervisor context.

### Safety
- **Hard limit preserved: 3 attempts (`MAX_FOLLOWUPS`).** Supervisor cannot bypass. After 3 → escalate regardless of LLM verdict.
- `SUPERVISOR_BYPASS=1` kill switch reused — disables both inbound and follow-up supervisors.

### Cost
- ~$0.5/month at current volume (15 leads × ~5 follow-up cycles × $0.002 per LLM call). Trivial.

### Why
Generic templates ("חוזר אליכם כמובטח") sent uniformly to every lead lose conversions. With LLM-personalized nudges referencing each lead's actual situation, response rates materially improve. Concrete example: a lead whose notes say "אמר ליצור איתו קשר ב-18.5.26" now gets "אסף, היום ה-18.5 כמו שביקשת — אפשר להתקשר עכשיו?" instead of the generic template.

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
