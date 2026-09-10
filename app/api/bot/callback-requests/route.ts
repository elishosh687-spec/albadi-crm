/**
 * POST /api/bot/callback-requests
 *
 * Detector for the "מתי נוח לכם לדבר?" callback-time flow. Finds silent leads
 * in the trigger states and — when the "לבקש מלקוחות שקטים זמן לשיחה" bot
 * setting is on — sends each a context-aware ask plus a prep list computed
 * from what that lead is actually missing, then flags them. When the customer
 * replies with a time, the greenapi webhook opens a task for the salesperson
 * (clamped into work hours) and confirms back.
 *
 * Off (the default) → this reports the candidate count and sends nothing, so
 * the every-30-min trigger is safe to leave running.
 *
 * Auth: Bearer BOT_SECRET / CRON_SECRET (same as the other bot crons).
 *
 * Query:
 *   ?dry=1  — compose + return everything that WOULD be sent, send nothing.
 *             Always safe; ignores the enable flag + quiet-hours gates.
 */

import { NextRequest, NextResponse } from "next/server";
import { isQuietNow } from "@/lib/clock/quiet-hours";
import { isNoSendDay } from "@/lib/clock/hebcal";
import { runCallbackRequests } from "@/lib/autoresponder/callback-request";
import { withJob } from "@/lib/observability/jobs";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = withJob("callback-requests", "followups", async (req: NextRequest, log) => {
  const auth = req.headers.get("authorization");
  const accepted = [process.env.BOT_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  if (accepted.length === 0 || !accepted.includes(auth ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dry = req.nextUrl.searchParams.get("dry") === "1";

  // Real sends respect quiet hours + no-send days. Dry-run bypasses (review only).
  if (!dry) {
    if (isQuietNow()) {
      log.debug("callback_requests.skipped", { reason: "quiet_hours" });
      return NextResponse.json({ ok: true, skipped: "quiet_hours" });
    }
    if (await isNoSendDay()) {
      log.debug("callback_requests.skipped", { reason: "no_send_day" });
      return NextResponse.json({ ok: true, skipped: "no_send_day" });
    }
  }

  try {
    const report = await runCallbackRequests({ dry });
    log.info("callback_requests.run", { dry, ...summarizeReport(report) });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    log.error("callback_requests.failed", e, { dry });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
});

/** Counts only — the report carries composed customer messages. */
function summarizeReport(report: unknown): Record<string, unknown> {
  if (!report || typeof report !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(report as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[`${k}_count`] = v.length;
  }
  return out;
}
