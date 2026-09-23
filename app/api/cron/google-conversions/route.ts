/**
 * GET /api/cron/google-conversions — daily Vercel cron (07:15 UTC).
 *
 * Reports CRM progress of Google-click leads to Google Ads as offline
 * conversions (lib/google/conversions-run.ts; plan phase 5, Eli 23/09).
 * GOOGLE_CONVERSIONS_MODE: off | validate (default — Google checks, nothing
 * counts) | live. Throws with the Hebrew reason when Google refuses, so the
 * watchdog WhatsApps Eli; a missing Data Manager token is a known,
 * not-yet-authorised state and is reported, not alerted.
 *
 * Auth: Bearer CRON_SECRET / BOT_SECRET / CALL_TRIGGER_SECRET. POST for a
 * manual kick.
 */
import { NextResponse } from "next/server";
import { withJob } from "@/lib/observability/jobs";
import { runGoogleConversions } from "@/lib/google/conversions-run";
import { dataManagerConfig } from "@/lib/google/conversions-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authed(req: Request): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const run = withJob("google-conversions", "google", async (req, log) => {
  if (!authed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const r = await runGoogleConversions();
  log.info("google_conversions.done", { ...r, pending: JSON.stringify(r.pending) });
  const authorised = Boolean(dataManagerConfig().refreshToken);
  if (r.failed > 0 && authorised) throw new Error(`דיווח המרות לגוגל: ${r.reason ?? "נכשל"}`);
  return NextResponse.json({ ok: true, authorised, ...r });
});

export const GET = run;
export const POST = run;
