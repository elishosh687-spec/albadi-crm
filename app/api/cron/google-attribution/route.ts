/**
 * GET /api/cron/google-attribution — daily Vercel cron (06:45 UTC).
 *
 * Ties each Google-click website lead to its campaign / ad group / keyword
 * (lib/google/attribution-run.ts). Read-only toward Google Ads. A Google
 * failure THROWS with the Hebrew reason so withJob records it and the
 * watchdog WhatsApps Eli.
 *
 * Auth: Bearer CRON_SECRET / BOT_SECRET / CALL_TRIGGER_SECRET. POST for a
 * manual kick.
 */
import { NextResponse } from "next/server";
import { withJob } from "@/lib/observability/jobs";
import { runGoogleAttribution } from "@/lib/google/attribution-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authed(req: Request): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const run = withJob("google-attribution", "google", async (req, log) => {
  if (!authed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await runGoogleAttribution();
  log.info("google_attribution.done", { ...result });
  return NextResponse.json({ ok: true, ...result });
});

export const GET = run;
export const POST = run;
