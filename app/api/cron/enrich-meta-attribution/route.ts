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
import { postFormAnswerNotes } from "@/lib/sheets/form-answers-note";
import { serializeError, withRequestLog } from "@/lib/observability/log";

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

const run = withRequestLog("meta", async (req: NextRequest, log) => {
  if (!authorized(req)) {
    log.warn("unauthorized");
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
      log.warn("good_lead_poll.failed", { ...serializeError(e) });
      goodLeads = { error: e instanceof Error ? e.message : String(e) };
    }
    // The form answers reach the DB above; this puts them in front of whoever
    // opens the contact. Non-fatal: a GHL wobble must not fail the enrichment.
    let formNotes: Awaited<ReturnType<typeof postFormAnswerNotes>> | { error: string };
    try {
      formNotes = await postFormAnswerNotes();
    } catch (e) {
      formNotes = { error: e instanceof Error ? e.message : String(e) };
    }
    // The per-tick summary — this is how a dead cron gets noticed.
    log.info("tick.summary", { ...result });
    return NextResponse.json({ ok: true, ...result, goodLeads, formNotes });
  } catch (e) {
    log.error("enrich.failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});

export const POST = run;
// Vercel Cron issues GET; accept it too.
export const GET = run;
