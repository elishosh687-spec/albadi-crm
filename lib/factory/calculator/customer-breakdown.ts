/**
 * Customer-safe per-unit ILS price breakdown, shared by every customer-facing
 * surface (public website, the "send offer" message, the PDF logic). Itemises
 * ONLY what the customer chose — base bag, handles, lamination, logo colours.
 * Exposes NO factory cost, margin, profit, or a separate shipping line:
 * shipping is folded silently into `productIls`. The four parts always sum to
 * the unit selling price.
 *
 * Derived purely from a QuoteResult: each CNY production component is converted
 * at the same implied FX + margin the engine used (usdToIls recovered as
 * finalUnitCostIls / finalUnitCostUsd), so the parts reconcile to the price.
 */
import type { QuoteResult } from "./types";

export interface CustomerBreakdownIls {
  /** Base bag + shipping, folded together (the reconciling line). */
  productIls: number;
  /** Handles up-charge (0 when no handles). */
  handlesIls: number;
  /** Lamination up-charge incl. per-colour plate fee (0 when no lamination). */
  laminationIls: number;
  /** Logo-colour up-charge for non-laminated bags (0 when laminated or 1 colour). */
  logoColorsIls: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function customerBreakdownIls(result: QuoteResult): CustomerBreakdownIls {
  const unitPrice = result.sellingPricePerUnitIls;
  const usdToIls =
    result.finalUnitCostUsd > 0
      ? result.finalUnitCostIls / result.finalUnitCostUsd
      : 0;
  const shippingPerUnitIls = result.shippingPerUnitUsd * usdToIls;
  const productionSellingIls = unitPrice - shippingPerUnitIls;
  const factor =
    result.unitProductionCny > 0
      ? productionSellingIls / result.unitProductionCny
      : 0;

  const handlesIls = round2(result.handlesAddonCny * factor);
  const laminationIls = round2(
    (result.laminationAddonCny + result.plateFeeCny) * factor
  );
  const logoColorsIls = round2(result.logoAddonCny * factor);
  // Base absorbs the remainder (base bag + folded shipping) so the parts
  // always sum exactly to the displayed unit price.
  const productIls = round2(
    unitPrice - handlesIls - laminationIls - logoColorsIls
  );

  return { productIls, handlesIls, laminationIls, logoColorsIls };
}
