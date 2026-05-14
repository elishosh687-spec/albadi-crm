/**
 * POST /api/factory/finalize/[id]
 *
 * Body: { profitMarginOverride?, shippingOptionId? }
 *
 * Loads the request, runs priceFactoryQuote against the factory's response +
 * Eli's chosen margin / shipping option, generates a customer-facing PDF, and
 * persists everything. Sets status='finalized'.
 *
 * The PDF is rendered server-side and stored:
 *   - If BLOB_READ_WRITE_TOKEN is set → Vercel Blob (public URL).
 *   - Otherwise → in-memory only; the GET /api/factory/[id]/pdf endpoint
 *     re-renders on demand from finalPricing + productSpec.
 *
 * Auth: dashboard cookie (middleware).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import { getFactoryConfig } from "@/lib/factory/config";
import { renderCustomerQuotePdf } from "@/lib/factory/pdf";
import type {
  FactoryProductSpec,
  FactoryResponse,
} from "@/lib/factory/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  profitMarginOverride: z.number().min(0).max(200).optional(),
  shippingOptionId: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }

  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  const req_row = rows[0];
  if (!req_row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!req_row.factoryResponse) {
    return NextResponse.json(
      { error: "factory_response_missing", message: "No factory response yet" },
      { status: 409 }
    );
  }

  const spec = req_row.productSpec as FactoryProductSpec;
  const resp = req_row.factoryResponse as FactoryResponse;
  const config = await getFactoryConfig();

  // Resolve shipping option: explicit override → first enabled.
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
    },
    config
  );

  // Customer name from linked lead.
  const leadRow = await db
    .select({ name: leads.name })
    .from(leads)
    .where(eq(leads.manychatSubId, req_row.manychatSubId))
    .limit(1);
  const customerName = leadRow[0]?.name ?? "";

  // Render PDF + (optionally) upload to Blob.
  let pdfUrl: string | null = req_row.pdfUrl ?? null;
  try {
    const buf = await renderCustomerQuotePdf({
      customerName,
      spec,
      pricing,
      quotationNo: req_row.quotationNo ?? id.slice(-8).toUpperCase(),
    });

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { put } = await import("@vercel/blob");
      const blob = await put(`factory-quotes/${id}.pdf`, buf, {
        access: "public",
        contentType: "application/pdf",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      pdfUrl = blob.url;
    } else {
      // No blob configured; the GET /pdf route re-renders on demand.
      pdfUrl = null;
    }
  } catch (err) {
    console.error("[factory/finalize] PDF render/upload failed", err);
    // Don't fail the whole finalize — the GET /pdf route can retry.
  }

  await db
    .update(factoryQuoteRequests)
    .set({
      factoryStatus: "finalized",
      finalPricing: pricing,
      pdfUrl,
      updatedAt: new Date(),
    })
    .where(eq(factoryQuoteRequests.id, id));

  return NextResponse.json({
    ok: true,
    id,
    pricing,
    pdfUrl,
    shippingOptions: config.shippingOptions,
  });
}
