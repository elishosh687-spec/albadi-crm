/**
 * Canonical invoice-line naming for a deal's product.
 *
 * ONE source of truth so the Zoho invoice the CRM creates and the deal data the
 * read API (`/api/widget/deals`) hands to an external automation can never
 * describe the same product differently. Both call these helpers.
 */

import type { FactoryProductSpec } from "@/lib/factory/types";

/** `H35*D20*W30` — the size label used in invoice line names. */
export function dealSizeLabel(spec: FactoryProductSpec | null | undefined): string {
  if (!spec) return "";
  return [
    spec.heightCm && `H${spec.heightCm}`,
    spec.depthCm && `D${spec.depthCm}`,
    spec.widthCm && `W${spec.widthCm}`,
  ]
    .filter(Boolean)
    .join("*");
}

/** Invoice line name, e.g. `שקית אלבד ממותגת — H35*D20*W30`. */
export function dealLineName(spec: FactoryProductSpec | null | undefined): string {
  const size = dealSizeLabel(spec);
  return `שקית אלבד ממותגת — ${size || spec?.productName || ""}`.trim();
}

/** Invoice line description: material · printing · finishing (+ customer when given). */
export function dealLineDescription(
  spec: FactoryProductSpec | null | undefined,
  customerName?: string | null
): string {
  return [spec?.material, spec?.printing, spec?.finishing, customerName ? `לקוח: ${customerName}` : null]
    .filter(Boolean)
    .join(" · ");
}
