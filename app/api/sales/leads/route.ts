/**
 * GET /api/sales/leads?token=<WIDGET_SALES_TOKEN>&q=<search>
 *
 * Existing-customer search for the sales screen. Returns ONLY {sid, name, phone}
 * — no pipeline/stage/quote/boss data. Matches name or phone digits.
 */
import { NextRequest, NextResponse } from "next/server";
import { salesAuthed } from "@/lib/widget/sales-auth";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { or, ilike, sql, desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!salesAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  try {
    const rows = await db
      .select({
        sid: leads.manychatSubId,
        name: leads.name,
        phone: leads.phoneE164,
      })
      .from(leads)
      .where(
        q
          ? or(
              ilike(leads.name, `%${q}%`),
              ilike(leads.phoneE164, `%${q.replace(/\D/g, "")}%`)
            )
          : sql`true`
      )
      .orderBy(desc(leads.updatedAt))
      .limit(20);
    return NextResponse.json({ ok: true, leads: rows.filter((r) => r.name || r.phone) });
  } catch (err) {
    console.error("[sales/leads] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
