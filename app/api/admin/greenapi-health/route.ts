/**
 * GET /api/admin/greenapi-health
 *
 * Is WhatsApp inbound actually alive? See lib/greenapi/health.ts for the rule
 * and for why this exists (07/09/2026: inbound died at 22:31 and nothing
 * noticed for a full working day).
 *
 * Auth: Bearer BOT_SECRET or CALL_TRIGGER_SECRET (shared with the other crons).
 *
 *   ?alert=1  also DM Eli when unhealthy — BEST EFFORT ONLY. The DM goes over
 *             the very channel that is broken, so it must never be the thing
 *             the alert depends on; the caller failing loudly is. See the
 *             workflow.
 *
 * Always HTTP 200 with `ok` in the body — the GitHub workflow reads the field
 * and decides. A non-200 would make "endpoint down" and "WhatsApp down"
 * indistinguishable.
 */
import { NextRequest, NextResponse } from "next/server";
import { assessGreenHealth, formatGreenHealth } from "@/lib/greenapi/health";
import { sendEliDM } from "@/lib/notify/eli";
import { withRequestLog } from "@/lib/observability/log";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const hdr = req.headers.get("authorization") ?? "";
  for (const name of ["BOT_SECRET", "CALL_TRIGGER_SECRET"]) {
    const secret = (process.env[name] ?? "").trim();
    if (secret && hdr === `Bearer ${secret}`) return true;
  }
  return false;
}

export const GET = withRequestLog("admin", async (req: NextRequest, log) => {
  if (!authorized(req)) {
    log.warn("unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const health = await assessGreenHealth();
  let alerted: string | null = null;
  if (!health.ok) log.warn("green.unhealthy", { summary: formatGreenHealth(health) });

  if (req.nextUrl.searchParams.get("alert") === "1" && !health.ok) {
    try {
      alerted = await sendEliDM(formatGreenHealth(health));
    } catch (e) {
      // Expected when the instance is the thing that is broken. Not a failure
      // of the check.
      alerted = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json({ ...health, summary: formatGreenHealth(health), alerted });
}, { job: "greenapi-health" });
