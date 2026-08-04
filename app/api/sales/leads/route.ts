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
  const digits = q.replace(/\D/g, "");
  try {
    // Match by name always; add the phone clause ONLY when the query has digits.
    // Otherwise `%${digits}%` = `%%` matches every phone → the filter returned
    // everyone (Eli 2026-08-04: "החיפוש לא עובד").
    const conds = [ilike(leads.name, `%${q}%`)];
    if (digits) conds.push(ilike(leads.phoneE164, `%${digits}%`));
    const rows = await db
      .select({
        sid: leads.manychatSubId,
        name: leads.name,
        phone: leads.phoneE164,
      })
      .from(leads)
      .where(q ? or(...conds) : sql`true`)
      .orderBy(desc(leads.updatedAt))
      .limit(20);
    return NextResponse.json({ ok: true, leads: rows.filter((r) => r.name || r.phone) });
  } catch (err) {
    console.error("[sales/leads] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
