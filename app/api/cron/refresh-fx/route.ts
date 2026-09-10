/**
 * GET /api/cron/refresh-fx — daily Vercel cron. Pulls the live USD→ILS / USD→CNY
 * market rate and writes it into the factory pricing config (unless the operator
 * turned `fxAutoUpdate` off). Auth: Bearer CRON_SECRET / BOT_SECRET.
 *
 * Also POST-able for a manual kick with the same auth.
 */

import { NextResponse } from "next/server";
import { applyLiveFxToConfig } from "@/lib/fx/live-rates";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: Request): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

const run = withRequestLog("fx", async (req, log) => {
  if (!authed(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await applyLiveFxToConfig();
  log.info("fx.refreshed", { ...result });
  return NextResponse.json({ ok: true, ...result });
}, { job: "refresh-fx" });

export const GET = run;
export const POST = run;
