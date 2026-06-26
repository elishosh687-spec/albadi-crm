/**
 * GHL widget → deep lead analysis.
 *
 * Called by the "🔍 נתח" button in the widget inbox. Builds the lead's dossier,
 * runs the LLM judge + grounding self-check, persists the verdict, posts a GHL
 * note, and returns the structured verdict for the inline panel.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN> (or Bearer header).
 * Body: { sid?: string, contactId?: string, force?: boolean }  (sid preferred)
 *
 * Response: { ok: true, verdict, cached } | { ok: false, error }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { analyzeLead } from "@/lib/analysis/analyze-lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const token =
    req.nextUrl.searchParams.get("widget_token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;
  if (!verifyWidgetToken(token)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { sid?: string; contactId?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  let sid = body.sid?.trim() || "";
  if (!sid && body.contactId) {
    const [row] = await db
      .select({ sid: leads.manychatSubId })
      .from(leads)
      .where(eq(leads.ghlContactId, body.contactId))
      .limit(1);
    sid = row?.sid ?? "";
  }
  if (!sid) {
    return NextResponse.json(
      { ok: false, error: "missing sid/contactId" },
      { status: 400 }
    );
  }

  try {
    const result = await analyzeLead(sid, { force: !!body.force });
    if (!result) {
      return NextResponse.json(
        { ok: false, error: "lead not found: " + sid },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[widget/analyze-lead] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "analysis failed" },
      { status: 500 }
    );
  }
}
