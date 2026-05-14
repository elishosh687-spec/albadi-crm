/**
 * POST /api/factory/quote-request
 *
 * Body: { manychatSubId, productSpec, customerName?, quotationNo? }
 *
 * Inserts a `factory_quote_requests` row (status=pending), then appends the
 * row to the Feishu sheet (A..I). Persists the returned `feishuRowIndex` so
 * the refresh endpoint can read the matching row later. Clears the lead's
 * factorySpecDraft on success (this is the "send-from-draft" path).
 *
 * Auth: dashboard cookie (enforced by middleware.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createFactoryRequest } from "@/lib/factory/create-request";

export const runtime = "nodejs";
export const maxDuration = 30;

const ProductSpecSchema = z.object({
  description: z.string().min(1),
  material: z.string().min(1),
  widthCm: z.number().nonnegative(),
  heightCm: z.number().nonnegative(),
  depthCm: z.number().nonnegative().default(0),
  quantity: z.number().int().positive(),
  printing: z.string().default(""),
  finishing: z.string().default(""),
  picUrl: z.string().optional(),
  notes: z.string().optional(),
});

const BodySchema = z.object({
  manychatSubId: z.string().min(1),
  customerName: z.string().optional(),
  quotationNo: z.string().optional(),
  productSpec: ProductSpecSchema,
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }

  try {
    const result = await createFactoryRequest({
      manychatSubId: body.manychatSubId,
      productSpec: body.productSpec,
      customerName: body.customerName,
      quotationNo: body.quotationNo,
      clearDraft: true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[factory/quote-request] failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "feishu_append_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
