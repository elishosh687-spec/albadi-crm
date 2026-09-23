---
paths:
  - "lib/factory/**"
  - "components/calculator/**"
  - "components/factory-flow/**"
  - "app/api/factory/**"
  - "lib/autoresponder/quote*"
---

# Pricing: payment terms, plates, negotiation buffer
- `lib/factory/payment-terms.ts` (client-safe) owns `VAT_PCT = 18` and `BANK_DETAILS`; `lib/zoho/write.ts` imports them. Never re-hardcode 18% or bank details.
- Deliberate: deposit is a share of the VAT-INCLUSIVE total; the last installment absorbs the rounding remainder.
- `customerTotalExVat` (`lib/factory/customer-total.ts`) is the one customer total for every customer-facing/billing surface (else: three totals for one quote); internal profit keeps engine totals.
- Payment block only in the four manual builders, never the bot's `buildQuoteMessage`. Feed it the total actually printed (`splitCustomerView(...).grandTotalIls` on a split).
- Resolve plans via `resolveEffectivePlanId`; explicit `NO_PAYMENT_PLAN_ID` ("none") overrides the default. Default is ON at `30_70` (since 2026-09-02).
- `/api/factory/[id]/pdf` re-renders when a plan resolves; the stored `row.pdfUrl` Blob lacks the payment block.
- Plate fee lives only in `lib/factory/molds.ts`; one-time per order (in `totalOrderPriceIls`, not `sellingPricePerUnitIls`), so print it as its own line (`buildQuoteMessage` takes `moldsIls`).
- `negotiationBufferAgorot` is added per bag before `ceilAgorot` in BOTH engines (`calculator/engine.ts`, `pricing.ts`).
- Estimator (`lib/factory/estimator.ts`) REFUSES narrow-tall bags (`isNarrowTall`) and qty < `MIN_QTY`; picks factory by construction (`allowedFactoriesFor`); shipping buffers are settings (`estimatorShippingBufferPct`, `estimatorShippingBufferLamPct`) — detail in `docs/agent/jobs.md` (refit gate).
- Estimator design (per factory × 3D/2D cell, envelope, 2D/鼎驰 out) has recorded reasons in `docs/archive/research/estimator/` — read it and ask Eli before calling any of it a bug. 2026-09-22 measurements: `2026-09-22-OBSERVATIONS.md` there. Settings → "דיוק המחשבון" shows the refit health.

Full detail: `docs/agent/pricing.md` — read it before non-trivial changes here.
