/**
 * POST /api/factory/import-feishu/assign   { quotationNo, leadSid }
 *
 * Manually re-import one Feishu quote and attach it to a chosen lead — used for
 * rows whose customer name didn't auto-match. Auth: cookie OR ?widget_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { assignImportedQuote } from "@/lib/factory/server/import-from-feishu";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const quotationNo = String(body?.quotationNo ?? "").trim();
  const leadSid = String(body?.leadSid ?? "").trim();
  if (!quotationNo || !leadSid) {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }
  try {
    const result = await assignImportedQuote(quotationNo, leadSid);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (e) {
    console.error("[factory/import-feishu/assign] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "assign_failed" },
      { status: 500 }
    );
  }
}
