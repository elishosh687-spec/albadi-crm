/**
 * GET /api/admin/analysis-aggregate
 *
 * The deterministic "why aren't leads closing" rollup over all persisted
 * per-lead verdicts. Every pattern carries a count + the supporting lead list
 * (no LLM, no cherry-picking). See lib/analysis/aggregate.ts.
 *
 * Auth: Bearer BOT_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { aggregateAnalyses } from "@/lib/analysis/aggregate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const aggregate = await aggregateAnalyses();
  return NextResponse.json({ ok: true, aggregate });
}
