/**
 * DELETE /api/widget/competitor-prices/:id — remove one logged data point.
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN> (or Bearer).
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { db } from "@/lib/db";
import { competitorPrices } from "@/drizzle/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): boolean {
  const token =
    req.nextUrl.searchParams.get("widget_token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;
  return verifyWidgetToken(token);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!auth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  try {
    await db.delete(competitorPrices).where(eq(competitorPrices.id, numId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[widget/competitor-prices] delete failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "delete failed" },
      { status: 500 }
    );
  }
}
