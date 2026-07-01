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
import { readRow, parseFactoryResponseRow, hasCartonMasterData } from "@/lib/feishu/sheets";
import type {
  FactoryProductSpec,
  FactoryResponse,
  FactoryPricingResult,
  ShippingOption,
} from "@/lib/factory/types";

/** Pick the first defined+non-empty+non-zero value. Used for merging fresh Feishu
 *  data over a stored factory_response — fresh wins when present, stored is the
 *  fallback. */
function pickNum(...vals: (number | undefined | null)[]): number | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== 0 && Number.isFinite(v)) return v;
  }
  return undefined;
}
function pickStr(...vals: (string | undefined | null)[]): string | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Merge a fresh Feishu factory response with the stored one. Fresh wins for
 *  any field where it has a real value; stored is the fallback. Returns the
 *  merged response and a boolean for whether anything actually changed. */
function mergeFactoryResponse(
  stored: FactoryResponse,
  fresh: ReturnType<typeof parseFactoryResponseRow>
): { merged: FactoryResponse; changed: boolean } {
  const merged: FactoryResponse = {
    unitCostCny: pickNum(fresh.unitCostCny, stored.unitCostCny) ?? 0,
    cartonQty: pickNum(fresh.cartonQty, stored.cartonQty),
    cartonLengthCm: pickNum(fresh.cartonLengthCm, stored.cartonLengthCm),
    cartonWidthCm: pickNum(fresh.cartonWidthCm, stored.cartonWidthCm),
    cartonHeightCm: pickNum(fresh.cartonHeightCm, stored.cartonHeightCm),
    cartonCbm: pickNum(fresh.cartonCbm, stored.cartonCbm),
    weightKg: pickNum(fresh.weightKg, stored.weightKg),
    supplier: pickStr(fresh.supplier, stored.supplier),
    notes: pickStr(fresh.notes, stored.notes),
    platePerColorCny: pickNum(fresh.platePerColorCny, stored.platePerColorCny),
  };
  // Compare scalar fields only — JSON.stringify is good enough here.
  const changed = JSON.stringify(merged) !== JSON.stringify(stored);
  return { merged, changed };
}

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
  /** Escape hatch: finalize even when the factory hasn't filled carton master
   *  data (qty/weight/CBM). Off by default — finalize blocks with a clear
   *  error so a shipping-less quote can't be sent by accident. */
  allowMissingCarton?: boolean;
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
  // Re-pull factory_response fresh from Feishu before pricing. Why: the cron
  // flips a row to 'received' as soon as unitCost is present in column K, but
  // the carton/weight/cbm fields (L..Q) may not be filled yet — and refresh
  // skips 'received' rows. Without this re-pull, finalize would price on the
  // partial stored response (totalCbm=0, totalWeightKg=0), which inflates the
  // sea-shipping floor and gives the customer a deeply under-charged shipping.
  let resp = reqRow.factoryResponse as FactoryResponse;
  if (reqRow.feishuRowIndex) {
    try {
      const cells = await readRow(reqRow.feishuRowIndex);
      const fresh = parseFactoryResponseRow(cells);
      const { merged, changed } = mergeFactoryResponse(resp, fresh);
      if (changed) {
        resp = merged;
        // Persist the enriched response so the boss view + future pricing see
        // it too (don't wait for the next cron, which might not happen).
        await db
          .update(factoryQuoteRequests)
          .set({ factoryResponse: resp, updatedAt: new Date() })
          .where(eq(factoryQuoteRequests.id, id));
      }
    } catch (err) {
      console.warn(
        `[factory/finalize] re-pull from Feishu failed for id=${id} row=${reqRow.feishuRowIndex}:`,
        err
      );
    }
  }

  // GUARD: never finalize on incomplete carton master data. Pricing shipping
  // without cartonQty/weight/CBM silently falls back to the sea 1-CBM floor /
  // 0 kg, producing a deeply under-charged quote (the TZYXNDEW bug). Block here
  // so the boss gets a clear error instead of a wrong PDF. allowMissingCarton
  // lets the operator override for genuinely carton-less items if ever needed.
  if (!body.allowMissingCarton && !hasCartonMasterData(resp)) {
    return {
      ok: false,
      status: 409,
      error: "carton_master_missing",
      message:
        "המפעל עדיין לא מילא את נתוני הקרטון (כמות באריזה / משקל / נפח). לא ניתן לתמחר שילוח עד שהם קיימים — בדוק את ההצעה ב-Feishu.",
    };
  }

  const config = await getFactoryConfig();

  const shippingOptionId =
    body.shippingOptionId ??
    config.shippingOptions.find((s) => s.enabled)?.id ??
    null;

  // Extract colour count from spec.printing ("3 color(s)", "2 colors" etc).
  // Falls back to 1 when unparseable — matches the factory's default for
  // a single-colour print. Only used when the factory also quoted a plate
  // fee in column T (resp.platePerColorCny).
  const printingMatch = /(\d+)/.exec(spec.printing ?? "");
  const logoColors = printingMatch ? Math.max(1, parseInt(printingMatch[1], 10)) : 1;

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
      platePerColorCny: resp.platePerColorCny,
      logoColors,
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
