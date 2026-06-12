/**
 * POST /api/factory/[id]/pull-image
 *
 * Pulls the product image embedded in the quote's Feishu row (column D),
 * re-hosts it on Blob, saves it as productSpec.picUrl, and returns the URL.
 * The customer PDF then embeds the actual photo. Auth: cookie OR widget_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { readRow, findRowByQuotationNo } from "@/lib/feishu/sheets";
import { extractFeishuFileToken, feishuImageToBlobUrl } from "@/lib/feishu/media";
import type { FactoryProductSpec } from "@/lib/factory/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // Locate the Feishu row — prefer a quotationNo lookup (robust to drift),
  // fall back to the stored row index.
  let rowIndex = row.feishuRowIndex ?? null;
  if (row.quotationNo) {
    const found = await findRowByQuotationNo(row.quotationNo);
    if (found) rowIndex = found;
  }
  if (!rowIndex) {
    return NextResponse.json(
      { ok: false, error: "no_feishu_row" },
      { status: 409 }
    );
  }

  const cells = await readRow(rowIndex);
  const fileToken = extractFeishuFileToken(cells[3]);
  if (!fileToken) {
    return NextResponse.json(
      { ok: false, error: "no_image_in_sheet" },
      { status: 404 }
    );
  }

  const url = await feishuImageToBlobUrl(fileToken);
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "download_failed" },
      { status: 502 }
    );
  }

  const spec = row.productSpec as FactoryProductSpec;
  await db
    .update(factoryQuoteRequests)
    .set({ productSpec: { ...spec, picUrl: url }, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));

  return NextResponse.json({ ok: true, url });
}
