/**
 * POST /api/bot/resume-sweep — expire temporary bot pauses.
 *
 * Auth: Bearer BOT_SECRET / CRON_SECRET / CALL_TRIGGER_SECRET.
 * Query:
 *   ?dry=1            preview only, changes nothing
 *   ?includeLegacy=1  ALSO release rows paused before the reason column
 *                     existed. Deliberate one-off — see resume-sweep.ts.
 *
 * Safe to run while the feature is off: with `autoResumeEnabled` false it
 * reports what it would have done and touches nothing.
 */
import { NextRequest, NextResponse } from "next/server";
import { runResumeSweep } from "@/lib/autoresponder/resume-sweep";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const accepted = [
    process.env.BOT_SECRET,
    process.env.CRON_SECRET,
    process.env.CALL_TRIGGER_SECRET,
  ]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.length > 0 && accepted.includes(auth);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runResumeSweep({
      dryRun: req.nextUrl.searchParams.get("dry") === "1",
      includeLegacy: req.nextUrl.searchParams.get("includeLegacy") === "1",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
