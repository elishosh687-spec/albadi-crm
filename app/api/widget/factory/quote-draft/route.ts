/**
 * POST /api/widget/factory/quote-draft?widget_token=...
 *
 * Body: { manychatSubId, productSpec, customerName? }. Creates a draft row
 * (status='draft') without touching Feishu.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { widgetAuthed } from "@/lib/widget/auth";
import { createFactoryDraft } from "@/lib/factory/create-request";

export const runtime = "nodejs";

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
  productSpec: ProductSpecSchema,
});

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
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
    const result = await createFactoryDraft({
      manychatSubId: body.manychatSubId,
      productSpec: body.productSpec,
      customerName: body.customerName,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[widget/factory/quote-draft] failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "db_insert_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
