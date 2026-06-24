/**
 * /api/factory/refit-estimator
 *   GET  — Vercel cron (daily). Bearer CRON_SECRET / BOT_SECRET.
 *   POST — manual trigger (dashboard cookie via middleware).
 *
 * Re-fits the per-factory self-quote estimator from the live Feishu tables +
 * new factory_quote_requests, and publishes only if accuracy holds. DMs Eli.
 */
import { NextRequest, NextResponse } from "next/server";
import { refitEstimator } from "@/lib/factory/server/refit-estimator";

export const runtime = "nodejs";
export const maxDuration = 300;

function authed(req: NextRequest): boolean {
  const accepted = [process.env.CRON_SECRET, process.env.BOT_SECRET].filter(Boolean).map((s) => `Bearer ${s}`);
  if (accepted.length === 0) return true; // no secret configured → allow (dev)
  return accepted.includes(req.headers.get("authorization") ?? "");
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await refitEstimator());
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Cookie-auth (middleware) manual trigger from the dashboard.
export async function POST() {
  try {
    return NextResponse.json(await refitEstimator());
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
