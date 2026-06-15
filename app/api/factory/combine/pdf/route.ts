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
import { combinedShippingIls } from "@/lib/factory/combined";
import { getFactoryConfig } from "@/lib/factory/config";
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

  // Every selected quote must be finalized…
  const notFinal = rows.find(
    (r) => r.factoryStatus !== "finalized" || !r.finalPricing
  );
  if (notFinal) {
    return NextResponse.json(
      { error: "not_finalized", message: `Quote ${notFinal.id} is not finalized` },
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
  const pricings = ordered.map((r) => r.finalPricing as FactoryPricingResult);
  const combinedCbm = r2(pricings.reduce((s, p) => s + (p.totalCbm || 0), 0));
  const combinedWeight = r2(pricings.reduce((s, p) => s + (p.totalWeightKg || 0), 0));
  const shipOpt =
    config.shippingOptions.find((s) => s.id === pricings[0]?.shippingOptionId) ?? null;
  const combinedShipping = combinedShippingIls(
    combinedCbm,
    combinedWeight,
    shipOpt,
    config.usdToIls
  );

  const items: CombinedQuoteItem[] = await Promise.all(
    ordered.map(async (r) => {
      const spec = r.productSpec as FactoryProductSpec;
      const p = r.finalPricing as FactoryPricingResult;
      const share = combinedCbm > 0 ? (p.totalCbm || 0) / combinedCbm : 1 / pricings.length;
      const allocShipping = r2(combinedShipping * share);
      // p.totalSellingPrice is the grand total (bags + mold + shipping). Strip
      // both the original shipping AND the mold one-time before reallocating
      // shipping, so per-unit ends up bag-only (matches the single-quote PDF).
      // Older quotes finalized before the mold-split deploy won't have
      // moldsTotalSellingPriceIls — treat undefined as 0.
      const moldOneTime = p.moldsTotalSellingPriceIls ?? 0;
      const bagsSellingTotal = r2(p.totalSellingPrice - p.totalShipping - moldOneTime);
      const newBagsTotal = r2(bagsSellingTotal + allocShipping);
      const newUnit = p.quantity > 0 ? r2(newBagsTotal / p.quantity) : newBagsTotal;
      const newGrand = r2(newBagsTotal + moldOneTime);
      const adjusted: FactoryPricingResult = {
        ...p,
        unitShipping: p.quantity > 0 ? r2(allocShipping / p.quantity) : allocShipping,
        totalShipping: allocShipping,
        unitSellingPrice: newUnit,      // bag-only — CombinedQuotePDF renders the mold as its own row
        totalSellingPrice: newGrand,    // grand total: bags + reallocated shipping + mold one-time
      };
      return {
        spec,
        pricing: adjusted,
        picDataUri: await fetchImageDataUri(spec.picUrl),
      };
    })
  );

  try {
    const buf = await renderCombinedQuotePdf({ customerName, items });
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
