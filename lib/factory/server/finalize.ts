/**
 * Shared finalize logic for a factory quote: price, render PDF, persist.
 * Used by:
 *   - POST /api/factory/finalize/[id]  (dashboard cookie)
 *   - POST /api/widget/factory/[id]/finalize  (widget_token)
 *
 * `hostHeader` is the inbound Host header so we can build a public PDF URL
 * for the on-demand render fallback (when BLOB_READ_WRITE_TOKEN is unset).
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import { renderCustomerQuotePdf, fetchImageDataUri } from "@/lib/factory/pdf";
import type {
  FactoryProductSpec,
  FactoryResponse,
  FactoryPricingResult,
  ShippingOption,
} from "@/lib/factory/types";

/**
 * Coerce a value to a plain text string at write boundaries. Catches three
 * historical failure modes:
 *   1. Feishu rich-text array ([{text, type, segmentStyle}, ...]) — concat texts
 *   2. Stringified `[object Object]` leftovers — null them out (treat as blank)
 *   3. Non-string primitives (numbers, booleans) — String()
 */
function toPlainString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    return v.includes("[object Object]") ? "" : v;
  }
  if (Array.isArray(v)) {
    let out = "";
    for (const seg of v) {
      if (seg && typeof seg === "object" && "text" in seg && typeof (seg as { text: unknown }).text === "string") {
        out += (seg as { text: string }).text;
      }
    }
    return out;
  }
  return String(v);
}

/** Defensively normalize the text fields on a FactoryProductSpec before
 *  persisting. Prevents "[object Object]" garbage from leaking into product_spec
 *  even if the client form was seeded with a Feishu rich-text value. */
function normalizeSpec(spec: FactoryProductSpec): FactoryProductSpec {
  return {
    ...spec,
    description: toPlainString(spec.description),
    material: toPlainString(spec.material),
    printing: toPlainString(spec.printing),
    finishing: toPlainString(spec.finishing),
    ...(spec.productName !== undefined ? { productName: toPlainString(spec.productName) } : {}),
    ...(spec.customerNotes !== undefined ? { customerNotes: toPlainString(spec.customerNotes) } : {}),
    ...(spec.notes !== undefined ? { notes: toPlainString(spec.notes) } : {}),
  };
}

export interface FinalizeInput {
  profitMarginOverride?: number;
  shippingOptionId?: string;
  /** One-time mold/tooling fee in CNY (amortized across the order). */
  moldsCostCny?: number;
  /** Manual overrides for the product spec (description, material, dims,
   *  quantity, printing, finishing, productName, customerNotes). Merged over
   *  the stored spec before the PDF is rendered, then persisted back to
   *  productSpec — so the boss can edit exactly what appears in the PDF. */
  specOverride?: Partial<FactoryProductSpec>;
}

export interface FinalizeOk {
  ok: true;
  id: string;
  pricing: FactoryPricingResult;
  pdfUrl: string | null;
  shippingOptions: ShippingOption[];
}

export interface FinalizeErr {
  ok: false;
  status: number;
  error: string;
  message?: string;
}

export async function finalizeQuote(
  id: string,
  body: FinalizeInput,
  hostHeader: string | null
): Promise<FinalizeOk | FinalizeErr> {
  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  const reqRow = rows[0];
  if (!reqRow) {
    return { ok: false, status: 404, error: "not_found" };
  }
  if (!reqRow.factoryResponse) {
    return {
      ok: false,
      status: 409,
      error: "factory_response_missing",
      message: "No factory response yet",
    };
  }

  const storedSpec = reqRow.productSpec as FactoryProductSpec;
  // Apply the boss's manual edits (if any) before pricing + PDF. A blank
  // override field would have been omitted client-side, so a spread is safe.
  // Then defensively normalize text fields so a Feishu rich-text leftover
  // (or "[object Object]") can never reach the customer PDF.
  const spec: FactoryProductSpec = normalizeSpec(
    body.specOverride
      ? { ...storedSpec, ...body.specOverride }
      : storedSpec
  );
  const resp = reqRow.factoryResponse as FactoryResponse;
  const config = await getFactoryConfig();

  const shippingOptionId =
    body.shippingOptionId ??
    config.shippingOptions.find((s) => s.enabled)?.id ??
    null;

  const pricing = priceFactoryQuote(
    {
      factoryUnitCostCny: resp.unitCostCny,
      quantity: spec.quantity,
      shippingOptionId,
      cartonSpec: {
        qty: resp.cartonQty,
        weightKg: resp.weightKg,
        cbm: resp.cartonCbm,
        lengthCm: resp.cartonLengthCm,
        widthCm: resp.cartonWidthCm,
        heightCm: resp.cartonHeightCm,
      },
      profitMarginOverride: body.profitMarginOverride,
      moldsCostCny: body.moldsCostCny,
    },
    config
  );

  const leadRow = await db
    .select({ name: leads.name })
    .from(leads)
    .where(eq(leads.manychatSubId, reqRow.manychatSubId))
    .limit(1);
  const customerName = leadRow[0]?.name ?? "";

  let pdfUrl: string | null = reqRow.pdfUrl ?? null;
  try {
    const picDataUri = await fetchImageDataUri(spec.picUrl);
    const buf = await renderCustomerQuotePdf({
      customerName,
      spec,
      pricing,
      breakdown: null,
      customerNotes: spec.customerNotes,
      picDataUri,
      quotationNo: reqRow.quotationNo ?? id.slice(-8).toUpperCase(),
    });

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import("@vercel/blob");
      // Fresh path per finalize (random suffix) so a re-render — e.g. after
      // adding/replacing the product image — never gets served stale from the
      // Blob CDN cache under a reused key.
      const blob = await put(`factory-quotes/${id}.pdf`, buf, {
        access: "public",
        contentType: "application/pdf",
        addRandomSuffix: true,
      });
      pdfUrl = blob.url;
    } else {
      const host = hostHeader ?? "albadi-crm.vercel.app";
      const proto = host.startsWith("localhost") ? "http" : "https";
      pdfUrl = `${proto}://${host}/api/factory/${id}/pdf`;
    }
  } catch (err) {
    console.error("[factory/finalize] PDF render/upload failed", err);
  }

  await db
    .update(factoryQuoteRequests)
    .set({
      factoryStatus: "finalized",
      finalPricing: pricing,
      productSpec: spec,
      pdfUrl,
      updatedAt: new Date(),
    })
    .where(eq(factoryQuoteRequests.id, id));

  // Factory row no longer "received" — clear the GHL task and re-evaluate
  // owner tag. Lazy import to avoid pulling GHL stack into bundles that
  // only need finalize.
  try {
    const { reconcileGHLTasksForLead } = await import(
      "@/lib/ghl-tasks/reconcile"
    );
    void reconcileGHLTasksForLead(reqRow.manychatSubId);
  } catch (e) {
    console.warn("[factory/finalize] ghl tasks reconcile failed", e);
  }

  return {
    ok: true,
    id,
    pricing,
    pdfUrl,
    shippingOptions: config.shippingOptions,
  };
}
