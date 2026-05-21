/**
 * GET /api/widget/leads/recent?widget_token=...&q=<search>&limit=<n>
 *
 * Returns the N most-recently-updated leads (default 30). Optional `q` does
 * a case-insensitive LIKE on name, phone, and manychat_sub_id for typeahead.
 * Used by the factory-flow widget's contact picker.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { desc, or, ilike, sql } from "drizzle-orm";
import { widgetAuthed } from "@/lib/widget/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "30", 10) || 30)
  );

  const baseSelect = db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      updatedAt: leads.updatedAt,
    })
    .from(leads);

  const rows = q
    ? await baseSelect
        .where(
          or(
            ilike(leads.name, `%${q}%`),
            ilike(leads.phoneE164, `%${q}%`),
            sql`${leads.manychatSubId} ILIKE ${"%" + q + "%"}`
          )
        )
        .orderBy(desc(leads.updatedAt))
        .limit(limit)
    : await baseSelect.orderBy(desc(leads.updatedAt)).limit(limit);

  return NextResponse.json({ ok: true, leads: rows });
}
