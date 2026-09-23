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

## What the daily refit actually learns — and where to see it (2026-09-22)

`/api/factory/refit-estimator` runs daily (04:00), rebuilds the estimator from
the Feishu catalog + the Feishu quote log + DB `received` quotes (80g only),
and publishes only if the LOO median stays ≤ 6% and not >2 pts worse.
**It does NOT learn from every quote.** In `buildModel`
([estimator-fit.ts](lib/factory/server/estimator-fit.ts)):

- **Plain (non-laminated) price = catalog only** — 6 fixed sizes (H20–40). Plain
  factory quotes only GRADE it (they are the LOO test set). Most orders are plain.
- **Laminated price** is the only line fitted from quotes (catalog + quote log + DB).
- **Area envelope** (1,520–5,950 cm²) comes from the catalog sizes, so it never
  widens no matter how many big/tall bags get quoted.
- **鼎驰/CHEN has no model** — its quotes (e.g. every H50×W50×D15 at ¥1.50) are dropped.
- **Carton model** has its own ≤10% gate; since 2026-09-10 it sits at 10.6%, so
  packing is frozen on the 09-10 fit.

Measured 2026-09-22 on tall bags: H45×W50×D10 −5% (fine); H50×W33×D9 −49% and
H36×W18×D9 −45% (narrow-tall — refused on purpose). No tall bag with D>10 inside
the envelope has a factory price, so e.g. 50×30×14's ¥1.53 is unverified.

**Settings → "דיוק המחשבון"** ([EstimatorHealthSection](components/settings/EstimatorHealthSection.tsx),
logic in [estimator-health.ts](lib/factory/estimator-health.ts), tests next to it)
shows: job ran · formulas published or kept (reason in Hebrew) · price accuracy ·
carton model frozen or not · what the quotes teach. The refit stores its last
outcome (incl. `quotesLearned` / `quotesGradingOnly` / `quotesUnmodelled`) in
`app_config` `estimator.last_refit_at.result`.

### Before/after: learning plain prices from quotes (measured 2026-09-22)

`scripts/estimator-before-after.ts` (read-only) scores every quote with a model
fitted without it. 33 unique quotes after dedupe (Feishu log ∩ DB overlap is
large — `dedupeQuotes`/`quoteKey`). On what the estimator agrees to price:

| | median | 90% within | worst | signed mean |
|---|---|---|---|---|
| now (plain from catalog) | 4.5% | 13.4% | 22% | −4.6% |
| `learnPlain` | 5.1% | 13.4% | 22% | −3.5% |

No gain → the live refit keeps `learnPlain` OFF. Feeding quotes naively was
worse (worst 62%) until flat/tray/narrow-tall quotes were kept out of the fit
(`learnable`). The 22% is factory spread, not the model: H40×W40×D10 was ¥1.30
from 亚森 and ¥1.85 from Mandy.

**Trust range — double-checked 2026-09-22** (Eli: "תעשה דאבלצ'ק, זה חשוב").
Cross-checked with a second code path (the live `estimateFactoryCny`, forced to
each quote's own factory): it reproduces the LOO errors quote-for-quote. Flat
bags are out of scope — the estimator refuses them (carton model).

| gusseted plain/lam quote | H/W | model vs factory |
|---|---|---|
| 11 "normal" plain bags, D 10–20, H 28–45, W 28–53 | 0.78–1.13 | −8%…+2%, one −22% (factory spread) |
| H36×W30×D15 lam, Mandy, 20k (5 quotes, ¥0.80) | 1.20 | +6% |
| H30×W20×D10 plain, 鼎驰 ¥0.82 (vs 亚森 line) | 1.50 | +2% |
| H50×W33×D9 plain, 亚森 ¥2.20 | 1.52 | **−49%** |
| H36×W18×D9 plain, 亚森 ¥1.55 | 2.00 | **−45%** |

So: accurate up to H/W 1.2 (one point above 1.13); at H/W ≥ 1.5 two of three
quotes are off by half. **Nothing between 1.2 and 1.5, and nothing ≥ 1.5 with a
gusset over 10.** 50×30×14 (1.67, D14) sits in that hole — unknown, not "wrong".

A first proposal ("refuse above 1.15× width") was WRONG and withdrawn: on the 95
distinct gusseted 80g sizes customers asked for, it would have blocked 17 more,
including H36×W30×D15 (verified +6%) and everyday H40×W30×D15-type bags.

The ½·D+35 rule does not follow the error boundary: of the 7 requested sizes it
blocks, 6 are below 1.5× width (e.g. H45×W35×D13); it also blocks H45×W50×D10,
priced within 5%. Its origin is unrecorded (Eli dictated it 2026-07-22; the
only written check is the factory example D10 → H40).

### The catalog has 15 sizes — the fit reads 6 (found 2026-09-22)

Feishu catalog `PBKystZ1dhCsZgtp4qgc2nzxnMf`: 15 size tabs, ~436 price rows.
`parseTab` names the factory ONLY by the price cell's fill colour
(`COLOR_FACTORY`: 70AD47 = Mandy, 5B9BD5 = 亚森). Tabs that quote a single
factory name it in the header (`Supplier供应商:` row, col D) and leave cells
unfilled (grey D9DCE1 = the laminated block), so **9 tabs / 214 rows are
dropped**: H15-D5-W20, H18-D9-W20 (Mandy), H50-D20-W60, and six flat tabs.
1,000-pc rows (56) are dropped on purpose (below MOQ).

Tried reading the header supplier (and keeping flat tabs out): accuracy on real
quotes got WORSE — median 4.5% → 8.7%, 亚森 H45×W50×D10 −5% → +20%. Cause: price
is a CURVE in area, not a line. 亚森 3k: the 6-size line says ¥1.72 for
H50-D20-W60, the catalog says ¥2.90; forcing the line through it overprices mid
bags. **Not deployed; parser unchanged.** Next step if pursued: a curved base
line (e.g. per-tier quadratic in area), measured with
`scripts/estimator-before-after.ts` before any publish.

**鼎驰 (CHEN) has no catalog tab at all** — every model needs a catalog price
list for its base line and add-ons, so `FACS` is Mandy/亚森 only and all 37 鼎驰
80g quotes (the most of any factory, incl. every tall bag it priced) are unused,
not even for grading. Also noted: the catalog shows 亚森 heat-press lamination
(H15-D5-W20, 热压 laminating) though `toCoeffs` assumes 亚森 laminates only by
sewing — unverified.
