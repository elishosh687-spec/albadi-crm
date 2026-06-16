/**
 * POST /api/widget/factory/[id]/finalize?widget_token=...
 * Body: { profitMarginOverride?, shippingOptionId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { widgetAuthed } from "@/lib/widget/auth";
import { finalizeQuote } from "@/lib/factory/server/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  profitMarginOverride: z.number().min(0).max(99.9).optional(),
  shippingOptionId: z.string().optional(),
  moldsCostCny: z.number().min(0).optional(),
  specOverride: z
    .object({
      description: z.string().optional(),
      material: z.string().optional(),
      productName: z.string().optional(),
      picUrl: z.string().optional(),
      widthCm: z.number().min(0).optional(),
      heightCm: z.number().min(0).optional(),
      depthCm: z.number().min(0).optional(),
      quantity: z.number().int().positive().optional(),
      printing: z.string().optional(),
      finishing: z.string().optional(),
      customerNotes: z.string().optional(),
    })
    .optional(),
  allowMissingCarton: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }
  const result = await finalizeQuote(id, body, req.headers.get("host"));
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.message ? { message: result.message } : {}) },
      { status: result.status }
    );
  }
  return NextResponse.json(result);
}
