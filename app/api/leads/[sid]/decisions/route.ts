/**
 * GET /api/leads/[sid]/decisions
 *
 * Returns last 100 bot_decision_log rows for the lead, newest first.
 * Auth: Bearer BOT_SECRET (matches the rest of the bot API).
 *
 * Consumed by the v3 lead drawer "Bot Decisions" tab.
 */
import { NextRequest, NextResponse } from "next/server";
import { listDecisions } from "@/lib/supervisor/server/listDecisions";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sid } = await params;
  const cleanSid = sid?.trim();
  if (!cleanSid) {
    return NextResponse.json({ error: "missing sid" }, { status: 400 });
  }

  const rows = await listDecisions({ lead: cleanSid, limit: 100 });

  return NextResponse.json({
    ok: true,
    sid: cleanSid,
    count: rows.length,
    rows,
  });
}
