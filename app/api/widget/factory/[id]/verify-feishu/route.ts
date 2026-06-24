/**
 * Live Feishu verification for one factory quote (widget).
 *   GET  /api/widget/factory/[id]/verify-feishu?widget_token=...  → compare stored vs live row (read-only)
 *   POST /api/widget/factory/[id]/verify-feishu?widget_token=...  → pull the live row into the stored response
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import {
  verifyQuoteAgainstFeishu,
  forceRefreshSingleQuote,
} from "@/lib/factory/server/verify-feishu";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const result = await verifyQuoteAgainstFeishu(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "verify_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const result = await forceRefreshSingleQuote(id);
    const status = result.ok ? 200 : 422;
    return NextResponse.json(result, { status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "refresh_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
