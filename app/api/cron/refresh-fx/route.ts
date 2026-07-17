/**
 * GET /api/cron/refresh-fx — daily Vercel cron. Pulls the live USD→ILS / USD→CNY
 * market rate and writes it into the factory pricing config (unless the operator
 * turned `fxAutoUpdate` off). Auth: Bearer CRON_SECRET / BOT_SECRET.
 *
 * Also POST-able for a manual kick with the same auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { applyLiveFxToConfig } from "@/lib/fx/live-rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET, process.env.CALL_TRIGGER_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  return accepted.includes(req.headers.get("authorization") ?? "");
}

async function run(req: NextRequest) {
  if (!authed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await applyLiveFxToConfig();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
