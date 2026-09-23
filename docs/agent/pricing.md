# Pricing — payment terms, plates, negotiation buffer

> Moved verbatim from CLAUDE.md on 2026-09-18 to keep the always-loaded context small. Index: [CLAUDE.md](../../CLAUDE.md).

## Payment-details template — VAT + schedule + bank (built 2026-07-28)

Every **manually sent** quote ends with what the customer owes and how to pay:
`מע״מ → סה״כ לתשלום → פריסת תשלומים → פרטי העברה בנקאית`. Header is
`*פרטי תשלום ופירוט חשבון*` (replaced the plain quote header; the 14-day footer
is gone).

**[lib/factory/payment-terms.ts](lib/factory/payment-terms.ts) is the single
source of truth** — client-safe (no server imports, per the client-bundle rule).
It owns `VAT_PCT = 18` and `BANK_DETAILS`, and **[lib/zoho/write.ts](lib/zoho/write.ts)
imports them** instead of its old private copies, so an invoice and the WhatsApp
message can never quote different numbers. Don't re-hardcode 18% or the bank
details anywhere.

**Two money rules — deliberate, don't "fix" them:**
1. The deposit is a share of the **VAT-INCLUSIVE** total (matches `buildTerms`
   and Eli's own example: 50% of ₪21,977, not of ₪18,625).
2. The **last installment absorbs the rounding remainder**, so the parts always
   sum to the printed total (30/40/30 → 6,593.31 + 8,791.08 + **6,593.32**).
   Same rule as `customerRoundedTotalIls` / `splitCustomerView`.

**Default since 2026-09-02: ON, at `30_70`** (`paymentTerms.includeByDefault`
+ `defaultPlanId` in `factory_pricing`). This REVERSES the 2026-08-03 "default
off" — Eli asked for it back after quotes went out bare for two weeks. It
governs BOTH sending and simply viewing a PDF: with no `?plan=`, the route
resolves the settings plan, so an ad-hoc view now prints the block too (and the
stale finalize Blob is never served, since `renderPlan` is no longer null).

⚠️ The toggle used to be a lie on the calculator screen: it hard-coded
`NO_PAYMENT_PLAN_ID` and POSTed it, and an EXPLICIT "none" is read as a
deliberate refusal — so the setting could not win no matter what it said.
`usePaymentPlanDefault` now seeds the picker from the config (a manual pick is
never overwritten when the fetch lands). The quotes list already read the
config, which is why only quotes sent from the calculator came out bare.

**Plans:** `50_50` · `30_70` · `30_40_30` (30% התחלה / 40% לפני משלוח / 30%
בהגעה) + `custom_NN`. Default in `factory_pricing.paymentTerms.defaultPlanId`
(backfilled by `normalizeConfig` — no migration), edited in the widget settings
"תנאי תשלום"; a picker on the quotes list overrides per send. Both
`send-whatsapp` routes accept an optional `paymentPlanId`; absent = the default.

**Wired into the FOUR MANUAL builders only** — finalized+PDF, combined,
calculator text, estimate. ⚠️ **The bot's questionnaire auto-quote
(`buildQuoteMessage`) is deliberately EXCLUDED** (Eli: a cold lead must not get
bank details). **Each builder feeds the block the total it actually PRINTED**
(`splitCustomerView(...).grandTotalIls` on a split) — never a recomputed one.

**One customer total, everywhere — `customerTotalExVat`
([lib/factory/customer-total.ts](lib/factory/customer-total.ts)).** The same
quote used to print THREE totals: the WhatsApp/PDF/payment block quoted
`round2(unit) × qty + molds` (what the customer agreed to pay) while the quotes
list, the deal card and the Zoho invoice read the engine's `totalSellingPrice`
(the UNROUNDED unit × qty) — ₪8,160 vs ₪8,106 on one line, so a deal contradicted
its own payment schedule and the invoice under-billed the quote. `customerTotalExVat`
is now the single definition (split-aware, molds included) and every
customer-facing/billing surface reads it; `memberDisplayTotalExVat` delegates to
it. **Internal cost/profit figures keep using the engine's exact totals.** For a
COMBINED deal the deal-level number is `grandTotalExVat` (the frozen combined
offer) — see "Combined deal" above.

The PDF prints the SAME payment block as the caption (VAT + amount due +
installments + bank) — [pdf.tsx](lib/factory/pdf.tsx) gated on `paymentPlanId`.
**Footgun fixed 2026-07-31:** `/api/factory/[id]/pdf` served the stored Blob
(`row.pdfUrl`) FIRST when set — but that Blob was rendered at finalize time,
BEFORE any plan existed, so it had NO payment block. Both the send and every UI
view got the stale ex-VAT PDF (Eli: "I don't see payment terms in the PDF"). The
route now re-renders fresh whenever a plan is resolvable (always — config carries
a default); the Blob is only a legacy no-plan fallback. So the customer PDF always
carries the payment terms now.

The עסקאות (deals) tab shows, per product in each closed deal: an inline preview
of that customer PDF (`?stream=1`, fresh render) PLUS the full "פירוט מלא לבוס"
breakdown — the sent quote and the internal numbers side by side.

## Printing plates — ¥1,000 per colour, one definition (2026-09-06)

[lib/factory/molds.ts](lib/factory/molds.ts) is the only place the number
lives; the calculator screen, the sales form and the bot all import it. It had
been two separate literals and **nothing at all in the bot**, so the
questionnaire's auto-quote was the one path that never charged the plates —
₪4,020 where the calculator said ₪4,467 for the same 3,000 bags in one colour.

The fee is one-time per ORDER, never per unit: the engine adds it to
`totalOrderPriceIls` and leaves `sellingPricePerUnitIls` alone. So any message
that prints the fee must ALSO print it as its own line, or the customer's own
"ליחידה × כמות" will not reach the total — `buildQuoteMessage` takes `moldsIls`
and renders "🧩 תבניות / מולדים (חד פעמי)", worded exactly as the manual
caption words it. The alternative-shipping block carries the same figure;
plates are ordered once whichever way the goods travel.

⚠️ **It is negotiating room, not a cost we defend** (Eli: "זה רק מחיר מיקוח").
Customer-facing quotes carry it; the competitor comparison does NOT count it by
default, because measuring ourselves against a rival with our own padding
included makes us look dearer than we close at. See [[competitor-price-tab]].

## Negotiation buffer — "מרווח מיקוח" (built 2026-08-03)

Settings knob (רווחיות ועמלות section) `negotiationBufferAgorot` — X **agorot per
bag** added to EVERY customer per-bag price as room to discount while haggling and
still hit target. **Global** (Eli: "בוט כן") — applies to the bot auto-quote, the
manual calculator, AND factory-finalized quotes. Added to the per-bag price BEFORE
the round-up (`ceilAgorot`) in BOTH pricing engines
([lib/factory/calculator/engine.ts] via `adminSettings.negotiationBufferAgorot` +
[lib/factory/pricing.ts] via `config.negotiationBufferAgorot`), so message/PDF/
invoice/totals all derive from it. It **flows into profit** (price − cost) like the
round-up gain. The boss breakdown (`buildBreakdownView` → `DetailedBreakdown`)
shows a labelled "מרווח מיקוח (N אג׳/שקית) = ₪Y" line, threaded via
`negotiationBufferPerUnitIls` on QuoteResult / FactoryPricingResult / BreakdownInput.
0 = off. **Stacks** with the older mold padding (¥500/color). See memory
[[negotiation-buffer]].

## Send quotes WITH or WITHOUT payment terms (built 2026-08-03)

Eli confirms payment terms per-call and doesn't want them auto-attached. A quote
can now be sent with or without the payment block:
- **Sentinel** `NO_PAYMENT_PLAN_ID = "none"` + `resolveEffectivePlanId(explicit, cfg.paymentTerms)`
  in [payment-terms.ts] — explicit `"none"` → null (no terms); explicit id → that id;
  no pick → the settings default ONLY when `paymentTerms.includeByDefault` is on.
  **Default OFF** — a quote goes out clean unless a plan is chosen.
  ⚠️ SUPERSEDED 2026-09-02: the default is ON at `30_70` — see "Default since
  2026-09-02" above.
- **Every manual builder** gates its payment block on the resolved plan and reverts
  its header to a plain `*הצעת מחיר*` when omitted: `sendWhatsapp`, `sendCombinedWhatsapp`,
  `sendEstimateToCustomer`, the calculator caption ([CalculatorView]), and the single +
  combined PDF routes (`/api/factory/[id]/pdf`, `/api/factory/combine/pdf`).
- **Picker** ([CalculatorView] `PaymentPlanPicker`) gains "⛔ ללא תנאי תשלום" and
  defaults to it. **Settings** toggle "צרף תנאי תשלום להצעות כברירת מחדל"
  (`paymentTerms.includeByDefault`, persisted).
- **The bot is UNCHANGED** — `buildQuoteMessage` never sends payment terms, independent
  of this setting (a cold lead must not get bank details).
- Deals keep THEIR own stored terms (`row.paymentPlan`) on an ad-hoc PDF view —
  the "off" default only governs fresh manual sends.
- **Rule:** any hand-built engine/send path that attaches payment MUST route the plan
  through `resolveEffectivePlanId`. See memory `docs/agent/pricing.md`.

## Why a size doesn't get a price — and the escape hatch (2026-09-22)

Three independent gates, in order. Only the first one blocks *before* the
estimator even runs:

1. **Machine geometry** ([lib/factory/bag-geometry.ts](lib/factory/bag-geometry.ts)) —
   `9 ≤ D ≤ 39`, `W > D`, `W ≤ 53`, `18 ≤ H ≤ min(½·D+35, 55)`. The `½·D+35`
   ceiling is what a tall bag trips: H50 needs D≥30, H55 needs D≥40 (impossible,
   D caps at 39). Red box "מידה לא תקינה".
2. **Estimator refusals** ([lib/factory/estimator.ts](lib/factory/estimator.ts)) —
   qty < 3,000 / > 200,000, narrow-and-tall (D ≤ 10 and H ≥ 1.5·W), no modelled
   factory for the construction, area outside the factory envelope. Amber box.
3. **Carton envelope** (area 1,500–5,400 cm²) — shipping CBM not estimable → refuse.

Every one of those states now carries **"בקש מחיר מהמפעל למידה הזו"**, a deep link
to `/widget/factory-request` prefilled with the spec, the lead and the refusal
reason. In that form the geometry rules are a **warning, not a block, for Eli**
(they stay a hard block in `salesMode` so Itay can't forward an impossible size).

## Estimator design — read the research BEFORE changing or judging it

The estimator is one formula per **(factory × structure)** cell — 🟢 Mandy × 3D,
🔵 亚森 × 3D; 2D blocked — each with a base price + shipping, agreed with Eli on
2026-07-03. The envelope (area 1,520–5,950, gusseted, 3k–10k), dropping 2D,
reading only the two-supplier catalog tabs, and leaving 鼎驰 out all have
recorded reasons: **[docs/archive/research/estimator/](../archive/research/estimator/)**
— start with `SUMMARY.md`, `FACTORY-MODEL-PROGRESS.md`, `TWO-PROBLEMS.md`. What
looks like a bug there may be a decision; ask Eli before "fixing" it.
The 2026-09-22 measurements (trust range by shape, before/after of learning
plain prices from quotes, catalog read counts, open questions) are in
[2026-09-22-OBSERVATIONS.md](../archive/research/estimator/2026-09-22-OBSERVATIONS.md) —
observations, not decisions.

**Settings → "דיוק המחשבון"** ([EstimatorHealthSection](components/settings/EstimatorHealthSection.tsx),
logic + tests in [estimator-health.ts](lib/factory/estimator-health.ts)): refit ran ·
published or kept (reason in Hebrew) · price accuracy vs the 6% gate · carton
model vs its 10% gate · what the formula is built from. The refit stores its last
outcome in `app_config` `estimator.last_refit_at.result`.
**Decision (Eli, 2026-09-22): nothing to change in the estimator's formulas,
envelope or refusals** — "יש סיבה שהוא מחשב את מה שביקשתי". Only MANDY and
WEIWEI (亚森) have price formulas; each is built from its own master rows only.
The nightly refit judges and publishes **each factory on its own quotes**
(`gateFactory`, per-factory `accuracy`/`fittedAt` in the coefficients);
`refitEstimator({ dryRun: true })` fits and judges without writing or sending.
`scripts/estimator-before-after.ts` (read-only) re-runs the leave-one-out
comparison; `FitOpts.learnPlain` exists and is OFF (no measured gain).
