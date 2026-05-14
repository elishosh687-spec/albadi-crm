/**
 * POST /api/factory/quote-request
 *
 * Body: { manychatSubId, productSpec, customerName?, quotationNo? }
 *
 * Inserts a `factory_quote_requests` row (status=pending), then appends the
 * row to the Feishu sheet (A..I). Persists the returned `feishuRowIndex` so
 * the refresh endpoint can read the matching row later.
 *
 * Auth: dashboard cookie (enforced by middleware.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { appendRow, buildFactoryRow } from "@/lib/feishu/sheets";
import type { FactoryProductSpec } from "@/lib/factory/types";

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

function sizeLabel(spec: FactoryProductSpec): string {
  const parts: string[] = [];
  if (spec.heightCm) parts.push(`H${spec.heightCm}`);
  if (spec.depthCm) parts.push(`D${spec.depthCm}`);
  if (spec.widthCm) parts.push(`W${spec.widthCm}`);
  return parts.join("*");
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

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

  const id = `fq_${Date.now()}_${shortId()}`;
  const quotationNo = body.quotationNo ?? id.slice(-8).toUpperCase();
  const spec = body.productSpec as FactoryProductSpec;

  // Resolve customer name: prefer body, fallback to lead.name
  let customerName = body.customerName ?? "";
  if (!customerName) {
    const leadRow = await db
      .select({ name: leads.name })
      .from(leads)
      .where(eq(leads.manychatSubId, body.manychatSubId))
      .limit(1);
    customerName = leadRow[0]?.name ?? "";
  }

  // 1. Insert the DB record first so we have an id to reference even if the
  // Feishu call fails (we can retry append later).
  await db.insert(factoryQuoteRequests).values({
    id,
    manychatSubId: body.manychatSubId,
    quotationNo,
    productSpec: spec,
    factoryStatus: "pending",
  });

  // 2. Append to Feishu (A..I).
  let feishuRowIndex = "";
  try {
    feishuRowIndex = await appendRow(
      buildFactoryRow({
        customer: customerName,
        quotationNo,
        pic: spec.picUrl ?? "",
        description: spec.description,
        material: spec.material,
        size: sizeLabel(spec),
        printing: spec.printing,
        finishing: spec.finishing,
        quantity: spec.quantity,
      })
    );

    await db
      .update(factoryQuoteRequests)
      .set({ feishuRowIndex, updatedAt: new Date() })
      .where(eq(factoryQuoteRequests.id, id));
  } catch (err) {
    // DB row remains (status=pending, no rowIndex). The UI can show a retry
    // affordance and we don't lose the customer's spec.
    console.error("[factory/quote-request] feishu append failed", err);
    return NextResponse.json(
      {
        ok: false,
        id,
        error: "feishu_append_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    id,
    quotationNo,
    feishuRowIndex,
  });
}
