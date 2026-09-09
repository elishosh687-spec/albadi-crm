/**
 * POST /api/widget/factory/quote-draft?widget_token=...
 *
 * Body: { manychatSubId, productSpec, customerName? }. Creates a draft row
 * (status='draft') without touching Feishu.
 */

import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { z } from "zod";
import { widgetAuthed } from "@/lib/widget/auth";
import { createFactoryDraft, updateFactoryDraft } from "@/lib/factory/create-request";

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
  shippingOptionId: z.string().optional(),
  // The manual-calculator inputs (¥ unit cost + master carton). Zod strips
  // unknown keys, so a field missing here is silently dropped on save — which is
  // how manual quotes lost everything the operator typed (Eli 2026-09-09).
  customInput: z
    .object({
      unitCostCny: z.number().positive(),
      cartonQty: z.number().positive().optional(),
      cartonWeightKg: z.number().nonnegative().optional(),
      cartonLengthCm: z.number().nonnegative().optional(),
      cartonWidthCm: z.number().nonnegative().optional(),
      cartonHeightCm: z.number().nonnegative().optional(),
    })
    .optional(),
});

const BodySchema = z.object({
  manychatSubId: z.string().min(1),
  customerName: z.string().optional(),
  productSpec: ProductSpecSchema,
  // Self-calculated pricing snapshot from the calculator ("שמור כטיוטה").
  // Passthrough — validated structurally by the FactoryPricingResult type at
  // the call site; stored as-is in final_pricing.
  finalPricing: z.record(z.string(), z.unknown()).optional(),
  // When present, UPDATE this existing draft in place (recalculate) instead of
  // creating a new row.
  draftId: z.string().optional(),
});

export const POST = withRequestLog("factory", async (req: NextRequest, log) => {
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
    const finalPricing = body.finalPricing as
      | import("@/lib/factory/types").FactoryPricingResult
      | undefined;
    if (body.draftId) {
      const updated = await updateFactoryDraft(body.draftId, {
        productSpec: body.productSpec,
        finalPricing,
      });
      if (!updated) {
        return NextResponse.json({ ok: false, error: "draft_not_found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ...updated, updated: true });
    }
    const result = await createFactoryDraft({
      manychatSubId: body.manychatSubId,
      productSpec: body.productSpec,
      customerName: body.customerName,
      finalPricing,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    log.error("quote_draft.failed", err, { sid: body.manychatSubId, draftId: body.draftId });
    return NextResponse.json(
      {
        ok: false,
        error: "db_insert_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
});
