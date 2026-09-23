/**
 * GET /api/cron/google-ads-check — daily Vercel cron (07:00 UTC, after the
 * 06:45 google-attribution run).
 *
 * Runs every check of the Google side of the "מודעות" tab (lib/ads/google-health.ts)
 * and THROWS with the Hebrew reasons when any line is red, so withJob records
 * a failure and the job watchdog WhatsApps Eli once per incident (and once on
 * recovery). Its own heartbeat and the attribution job are left to the
 * watchdog directly. Read-only toward Google Ads.
 *
 * Auth: Bearer CRON_SECRET / BOT_SECRET / CALL_TRIGGER_SECRET. POST for a
 * manual kick.
 */
import { NextResponse } from "next/server";
import { withJob } from "@/lib/observability/jobs";
import { checkGoogleHealth } from "@/lib/ads/google-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NOT_ALERTED_HERE = new Set(["job:google-ads-check", "job:google-attribution", "job:google-conversions"]);

function authed(req: Request): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const run = withJob("google-ads-check", "google", async (req, log) => {
  if (!authed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const health = await checkGoogleHealth({ fresh: true });
  const broken = health.checks.filter((c) => !c.ok && !NOT_ALERTED_HERE.has(c.key));
  log.info("google_ads_check.done", { problems: broken.length, checks: health.checks.map((c) => `${c.key}:${c.ok ? "ok" : "red"}`) });
  if (broken.length) {
    throw new Error(`גוגל אדס — ${broken.map((c) => `${c.label}: ${c.detail}`).join(" · ")}`);
  }
  return NextResponse.json({ ok: true, checks: health.checks });
});

export const GET = run;
export const POST = run;
