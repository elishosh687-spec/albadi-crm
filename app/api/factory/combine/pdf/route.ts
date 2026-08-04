/**
 * GET /api/factory/combine/pdf?ids=fq_a,fq_b,fq_c
 *
 * Renders ONE customer PDF that contains a section per finalized quote, with a
 * single grand total at the end. All quotes must be finalized and belong to the
 * same client. Re-rendered on demand (deterministic for a given id set) and
 * streamed — so the URL is shareable (the same link we paste into WhatsApp).
 *
 * Public GET: matches the middleware's `/api/factory/<seg>/pdf` allowlist
 * (here <seg> = "combine"), same non-enumerable-by-id model as the single PDF.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import {
  renderCombinedQuotePdf,
  fetchImageDataUri,
  type CombinedQuoteItem,
} from "@/lib/factory/pdf";
import { allocateCombined, resolveMergedShippingOption } from "@/lib/factory/combined";
import { getFactoryConfig } from "@/lib/factory/config";
import type { StoredDealPlan } from "@/lib/factory/payment-terms";
import { resolveEffectivePlanId } from "@/lib/factory/payment-terms";
import type {
  FactoryProductSpec,
  FactoryPricingResult,
} from "@/lib/factory/types";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: "no_ids" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(inArray(factoryQuoteRequests.id, ids));
  if (rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Every selected quote must carry a price — finalized (factory-confirmed) or a
  // self-calculated DRAFT. Requiring "finalized" locked a customer who only has
  // estimates out of combined offers entirely (Eli 2026-08-02); the draft's own
  // price snapshot is exactly what allocateCombined needs.
  const notPriced = rows.find(
    (r) => !r.finalPricing || (r.factoryStatus !== "finalized" && r.factoryStatus !== "draft")
  );
  if (notPriced) {
    return NextResponse.json(
      { error: "not_priced", message: `Quote ${notPriced.id} has no price yet` },
      { status: 409 }
    );
  }
  // …and all belong to the same client.
  const sub = rows[0].manychatSubId;
  if (rows.some((r) => r.manychatSubId !== sub)) {
    return NextResponse.json(
      { error: "mixed_clients", message: "All quotes must belong to the same client" },
      { status: 400 }
    );
  }

  // Preserve the caller's requested order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => Boolean(r));

  const leadRow = await db
    .select({ name: leads.name })
    .from(leads)
    .where(eq(leads.manychatSubId, sub))
    .limit(1);
  const customerName = leadRow[0]?.name ?? "";

  // One shipment → recompute shipping on the merged CBM/weight (cheaper: the
  // sea 1-CBM floor is counted once) and fold the combined shipping back into
  // each product's price by its CBM share. Profit is unchanged — only the
  // pass-through shipping drops, so the customer's combined price is lower.
  const config = await getFactoryConfig();

  // Optional split shipment: `airIds` = which quotes ship by air; `airShip` /
  // `seaShip` = the chosen options. Allocation (single or split) is shared with
  // the WhatsApp caption via allocateCombined so their totals reconcile.
  const sp = req.nextUrl.searchParams;
  const airIds = (sp.get("airIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const airShipId = sp.get("airShip");
  const seaShipId = sp.get("seaShip");
  const split =
    airIds.length > 0 && airShipId && seaShipId
      ? { airIds, airShippingOptionId: airShipId, seaShippingOptionId: seaShipId }
      : undefined;
  // Manual merged-CBM override (grouped orders) — must match the on-screen calc.
  const cbmParam = parseFloat(sp.get("cbm") ?? "");
  const cbmOverride = Number.isFinite(cbmParam) && cbmParam > 0 ? cbmParam : undefined;
  // Resolve with a fallback — a draft's snapshot often has no shippingOptionId,
  // and a null option prices the merged shipment at ₪0.
  const singleOpt = resolveMergedShippingOption(
    ordered.map((r) => ({ pricing: r.finalPricing as FactoryPricingResult })),
    config
  );
  if (!singleOpt) {
    return NextResponse.json(
      { error: "no_shipping_option", message: "אין שיטת שילוח פעילה — לא ניתן לתמחר משלוח מאוחד" },
      { status: 409 }
    );
  }

  const alloc = allocateCombined(
    ordered.map((r) => ({ id: r.id, pricing: r.finalPricing as FactoryPricingResult })),
    singleOpt,
    config,
    split,
    cbmOverride
  );
  const adjustedById = new Map(alloc.perProduct.map((x) => [x.id, x.adjusted]));

  const items: CombinedQuoteItem[] = await Promise.all(
    ordered.map(async (r) => {
      const spec = r.productSpec as FactoryProductSpec;
      return {
        spec,
        pricing: adjustedById.get(r.id) ?? (r.finalPricing as FactoryPricingResult),
        picDataUri: await fetchImageDataUri(spec.picUrl),
      };
    })
  );

  try {
    // Payment terms: ?plan= from the send (so caption and PDF match), else the
    // PRIMARY member's stored plan, else the configured default.
    const primary = [...ordered].sort((a, b) => +a.createdAt - +b.createdAt)[0];
    const planParam = sp.get("plan");
    const cfg = config;
    const primaryStored = (primary?.paymentPlan as StoredDealPlan | null) ?? null;
    // none → no terms; explicit id → that; else the primary's stored plan, else
    // the settings default ONLY when include-by-default is on (Eli 2026-08-03 → OFF).
    const effectivePlanId = resolveEffectivePlanId(planParam, cfg.paymentTerms);
    const buf = await renderCombinedQuotePdf({
      customerName,
      items,
      paymentPlan: planParam ? null : primaryStored,
      paymentPlanId: planParam ? effectivePlanId : primaryStored ? null : effectivePlanId,
      vatPct: cfg.paymentTerms?.vatPct,
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="albadi-quote-${ids.length}-products.pdf"`,
      },
    });
  } catch (err) {
    console.error("[factory/combine/pdf] render failed", { ids, err });
    return NextResponse.json(
      {
        error: "pdf_render_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
