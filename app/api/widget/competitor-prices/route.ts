/**
 * GET  /api/widget/competitor-prices — list every logged competitor data point,
 *      newest first. Consumed by the "מחיר מתחרים" hub tab.
 * POST /api/widget/competitor-prices — log one head-to-head:
 *      { product, competitor, ourPrice?, ourLeadDays?, competitorPrice?,
 *        competitorLeadDays?, quantity?, leadSid?, notes? }
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN> (or Bearer for external callers).
 */
import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
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

/** Coerce a form value to a finite number or null (empty string → null). */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Coerce to a trimmed non-empty string or null. */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export async function GET(req: NextRequest) {
  if (!auth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const rows = await db
      .select()
      .from(competitorPrices)
      .orderBy(desc(competitorPrices.createdAt));
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    console.error("[widget/competitor-prices] list failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "list failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!auth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }

  const product = str(body.product);
  const competitor = str(body.competitor);
  if (!product || !competitor) {
    return NextResponse.json(
      { ok: false, error: "product and competitor are required" },
      { status: 400 }
    );
  }

  try {
    const [row] = await db
      .insert(competitorPrices)
      .values({
        product,
        competitor,
        quantity: num(body.quantity) ?? undefined,
        size: str(body.size),
        handles: str(body.handles),
        logoColors: num(body.logoColors),
        lamination: str(body.lamination),
        ourPrice: num(body.ourPrice),
        ourLeadDays: num(body.ourLeadDays),
        ourPlateFee: num(body.ourPlateFee),
        competitorPrice: num(body.competitorPrice),
        competitorLeadDays: num(body.competitorLeadDays),
        competitorPlateFee: num(body.competitorPlateFee),
        leadSid: str(body.leadSid),
        notes: str(body.notes),
      })
      .returning();
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    console.error("[widget/competitor-prices] insert failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "insert failed" },
      { status: 500 }
    );
  }
}
