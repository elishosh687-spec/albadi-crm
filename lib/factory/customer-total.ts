/**
 * THE customer-facing total of a quote (ex-VAT) — one definition, every screen.
 *
 * Why this exists (Eli 2026-07-31): the same quote printed three different
 * totals. The WhatsApp message and the PDF quote `rounded per-bag × qty + molds`
 * (customerRoundedTotalIls) — that IS what the customer agreed to pay — while
 * the quotes list, the deal card and the Zoho invoice all read the engine's
 * `totalSellingPrice`, which multiplies the UNROUNDED per-bag price. On
 * יוסי גולד בייבי that gap was ₪8,160 vs ₪8,106 and ₪6,050 vs ₪6,023 — so a
 * combined deal looked like it held different money than the two quotes it was
 * built from, and the invoice under-billed what was quoted.
 *
 * Rule: any screen that shows a customer what they owe — or bills them — uses
 * this. Internal cost/profit figures keep using the engine's exact totals.
 *
 * Client-safe: pure maths, no server-only imports.
 */
import { customerRoundedTotalIls } from "@/lib/factory/calculator/customer-breakdown";
import { splitCustomerView } from "@/lib/factory/shipping-split";
import type { ShippingSplit } from "@/lib/factory/types";

/** Loose shape so both typed (FactoryPricingResult) and untyped
 *  (Record<string, unknown> straight off the API) callers can pass their row. */
export interface CustomerTotalInput {
  unitSellingPrice?: unknown;
  quantity?: unknown;
  moldsTotalSellingPriceIls?: unknown;
  shippingSplit?: unknown;
  totalSellingPrice?: unknown;
  totalOrderPriceIls?: unknown;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The ex-VAT total this quote PRINTED for the customer.
 *  - split shipment → per-leg rounded unit prices (splitCustomerView)
 *  - otherwise      → round2(unit) × qty + one-time molds
 *  - no usable unit/qty → fall back to the stored order total.
 * Returns null when the pricing carries nothing usable.
 */
export function customerTotalExVat(fp: CustomerTotalInput | null | undefined): number | null {
  if (!fp) return null;
  const moldsRaw = num(fp.moldsTotalSellingPriceIls) ?? 0;
  const molds = moldsRaw > 0 ? Math.round(moldsRaw * 100) / 100 : 0;

  const split = fp.shippingSplit as ShippingSplit | null | undefined;
  if (split) return splitCustomerView(split, molds).grandTotalIls;

  const unit = num(fp.unitSellingPrice);
  const qty = num(fp.quantity);
  if (unit !== null && qty !== null && qty > 0) {
    return customerRoundedTotalIls(unit, qty, molds);
  }
  // Legacy rows (drafts saved before unit/qty were stored on the snapshot).
  return num(fp.totalOrderPriceIls) ?? num(fp.totalSellingPrice);
}
