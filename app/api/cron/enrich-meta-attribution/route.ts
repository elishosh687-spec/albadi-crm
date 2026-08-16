/**
 * POST /api/cron/enrich-meta-attribution — fill leads.meta_* (leadgen id + ad +
 * campaign) from the Meta form Google Sheets, matched by phone. Feeds the
 * CAPI-for-CRM conversion loop (see memory meta-conversion-loop). Idempotent —
 * only touches leads whose meta_leadgen_id is still NULL, never overwrites.
 *
 * Auth: Bearer BOT_SECRET (or CALL_TRIGGER_SECRET / CRON_SECRET).
 * Trigger: vercel.json daily cron. Also safe to hit manually any time.
 */
import { NextRequest, NextResponse } from "next/server";
import { enrichMetaAttribution } from "@/lib/sheets/meta-attribution";
import { pollGoodLeads } from "@/lib/meta/good-lead-poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const accepted = [
    process.env.BOT_SECRET,
    process.env.CALL_TRIGGER_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return accepted.some((s) => header === `Bearer ${s}`);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // ?dry=1 — answer "did my tagging reach Meta?" WITHOUT sending anything.
  // Diagnosing the loop should never fire real conversion events at Meta, and
  // before this the only way to inspect it was to run it for real.
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  try {
    if (dry) {
      const goodLeads = await pollGoodLeads({ dry: true });
      return NextResponse.json({ ok: true, dry: true, goodLeads });
    }
    // 1. Fill leadgen ids from the Meta form sheets (past + new leads).
    const result = await enrichMetaAttribution();
    // 2. Report leads Eli tagged "ליד טוב" in GHL as Meta Qualified. Runs after
    //    enrichment so a lead tagged the same day it arrived already has its id.
    //    Non-fatal — enrichment must still report success if this trips.
    let goodLeads: unknown = null;
    try {
      goodLeads = await pollGoodLeads();
    } catch (e) {
      console.warn("[enrich-meta-attribution] good-lead poll failed", e);
      goodLeads = { error: e instanceof Error ? e.message : String(e) };
    }
    return NextResponse.json({ ok: true, ...result, goodLeads });
  } catch (e) {
    console.error("[enrich-meta-attribution] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// Vercel Cron issues GET; accept it too.
export async function GET(req: NextRequest) {
  return POST(req);
}
