/**
 * /api/cron/job-watchdog — every 30 min from .github/workflows/job-watchdog.yml.
 * Checks every scheduled job's last success (lib/observability/jobs.ts) and
 * WhatsApps Eli when one is late or failed, once per incident + on recovery.
 * `?dry=1` reports what it WOULD alert on and sends/stores nothing.
 * Auth: Bearer BOT_SECRET / CRON_SECRET / CALL_TRIGGER_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/observability/log";
import { runWatchdog } from "@/lib/observability/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authed(req: NextRequest): boolean {
  const accepted = [process.env.BOT_SECRET, process.env.CRON_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const run = withRequestLog(
  "cron",
  async (req: NextRequest, log) => {
    if (!authed(req)) {
      log.warn("unauthorized");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const dry = req.nextUrl.searchParams.get("dry") === "1";
    const result = await runWatchdog({ dry });
    log.info("watchdog.run", { job: "job-watchdog", dry, unhealthy: result.unhealthy.length, alerted: result.alerted.length, recovered: result.recovered.length });
    return NextResponse.json(result);
  },
  { job: "job-watchdog" },
);
export const GET = run;
export const POST = run;
