/**
 * POST /api/widget/factory-requests?widget_token=...
 *
 * Standalone "sales quote request" intake for the salesperson (Itay). He picks
 * an existing customer + fills a product spec; this parks it as a DRAFT row
 * (factory_quote_requests, status='draft', linked to the chosen lead) and DMs
 * Eli. Nothing touches Feishu here — Eli reviews the draft from the
 * "הצעות מהמפעל" tab (draft filter) and promotes it via the existing
 * /api/widget/factory/[id]/send-to-feishu.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { widgetAuthed } from "@/lib/widget/auth";
import { createFactoryDraft } from "@/lib/factory/create-request";
import { sendEliDM } from "@/lib/notify/eli";

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
  notes: z.string().optional(),
});

const BodySchema = z.object({
  manychatSubId: z.string().min(1),
  customerName: z.string().optional(),
  productSpec: ProductSpecSchema,
});

function buildEliSummary(
  customerName: string | undefined,
  spec: z.infer<typeof ProductSpecSchema>
): string {
  const dims = [spec.widthCm, spec.heightCm, spec.depthCm]
    .filter((n) => n > 0)
    .join("×");
  const lines = [
    "📋 בקשת הצעת מחיר חדשה ממכירות",
    customerName ? `לקוח: ${customerName}` : null,
    spec.description,
    `חומר: ${spec.material}`,
    dims ? `מידות: ${dims} ס"מ` : null,
    `כמות: ${spec.quantity}`,
    spec.printing ? `הדפסה: ${spec.printing}` : null,
    spec.finishing ? `גימור: ${spec.finishing}` : null,
    spec.notes ? `הערות: ${spec.notes}` : null,
    "",
    'לאישור ושליחה למפעל — טאב "הצעות מהמפעל", סינון "טיוטות".',
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

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
      customerName: body.customerName,
      productSpec: body.productSpec,
    });
    await sendEliDM(buildEliSummary(body.customerName, body.productSpec));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[widget/factory-requests] failed", err);
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
