/**
 * Server-side loader for the shipment-consolidation screen: the real,
 * finalized SEA orders (each tied to a customer contact card) that are
 * candidates to be merged into one shipment. Shared by the widget API and the
 * v3 dashboard server page so both front-ends show the same list.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { desc, sql, isNotNull } from "drizzle-orm";
import { getFactoryConfig } from "./config";
import type { FactoryPricingConfig, FactoryPricingResult, FactoryProductSpec } from "./types";

export interface ConsolidationCandidate {
  id: string;
  leadSid: string | null;
  customerName: string | null;
  phone: string | null;
  ghlContactId: string | null;
  stage: string | null;
  productName: string | null;
  quantity: number | null;
  cbm: number;
  shippingOptionId: string | null;
  shippingOptionName: string | null;
}

/** Is this quote's chosen shipping a SEA option (per the active config)? */
function isSeaOrder(
  finalPricing: FactoryPricingResult | null,
  spec: FactoryProductSpec | null,
  config: FactoryPricingConfig
): boolean {
  const optId = finalPricing?.shippingOptionId ?? spec?.shippingOptionId ?? null;
  if (!optId) return false;
  const opt = config.shippingOptions.find((o) => o.id === optId);
  if (opt) return opt.type === "sea";
  // Fallback heuristic when the option id no longer exists in config.
  const name = finalPricing?.shippingOptionName ?? "";
  return /ים|sea/i.test(name);
}

/**
 * Finalized orders with a known CBM and SEA shipping, not lost — the pool the
 * boss picks from to plan a combined shipment. Newest first.
 */
export async function loadConsolidationCandidates(opts?: {
  limit?: number;
}): Promise<{ candidates: ConsolidationCandidate[]; config: FactoryPricingConfig }> {
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500);
  const config = await getFactoryConfig({ fresh: true });

  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      leadSid: factoryQuoteRequests.manychatSubId,
      productSpec: factoryQuoteRequests.productSpec,
      finalPricing: factoryQuoteRequests.finalPricing,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      ghlContactId: leads.ghlContactId,
    })
    .from(factoryQuoteRequests)
    .leftJoin(
      leads,
      sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`
    )
    .where(
      sql`${factoryQuoteRequests.factoryStatus} = 'finalized' and ${isNotNull(
        factoryQuoteRequests.finalPricing
      )}`
    )
    .orderBy(desc(factoryQuoteRequests.createdAt))
    .limit(limit);

  const candidates: ConsolidationCandidate[] = [];
  for (const r of rows) {
    const fp = (r.finalPricing as FactoryPricingResult | null) ?? null;
    const spec = (r.productSpec as FactoryProductSpec | null) ?? null;
    const cbm = fp?.totalCbm ?? 0;
    if (!(cbm > 0)) continue; // can't consolidate without a volume
    if (r.stage === "LOST") continue;
    if (!isSeaOrder(fp, spec, config)) continue;
    candidates.push({
      id: r.id,
      leadSid: r.leadSid ?? null,
      customerName: r.name ?? null,
      phone: r.phone ?? null,
      ghlContactId: r.ghlContactId ?? null,
      stage: r.stage ?? null,
      productName: spec?.productName ?? spec?.description ?? null,
      quantity: spec?.quantity ?? null,
      cbm,
      shippingOptionId: fp?.shippingOptionId ?? spec?.shippingOptionId ?? null,
      shippingOptionName: fp?.shippingOptionName ?? null,
    });
  }

  return { candidates, config };
}
