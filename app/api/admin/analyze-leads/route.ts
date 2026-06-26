/**
 * POST /api/admin/analyze-leads
 *
 * Filtered batch analysis (seed / bulk). Analyzes the next N matched leads
 * (cached/unchanged ones are free), newest first. Re-run to continue.
 *
 * Auth: Bearer BOT_SECRET.
 * Query / JSON body:
 *   stages=LOST,CONSIDERATION   (comma list; "__NULL__" for no-stage)
 *   dateFrom=2026-06-01  dateTo=2026-06-30   (on leads.created_at)
 *   withCalls=1   limit=20 (1..60)   force=1
 */
import { NextRequest, NextResponse } from "next/server";
import { analyzeBatch, type LeadFilter } from "@/lib/analysis/batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BOT_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* query-only ok */
  }

  const filter: LeadFilter = {
    stages: parseList(body.stages ?? sp.get("stages")),
    dateFrom: str(body.dateFrom ?? sp.get("dateFrom")),
    dateTo: str(body.dateTo ?? sp.get("dateTo")),
    withCalls: bool(body.withCalls ?? sp.get("withCalls")),
  };
  const rawLimit = Number(body.limit ?? sp.get("limit") ?? 15);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 15, 1), 60);
  const force = bool(body.force ?? sp.get("force"));

  const progress = await analyzeBatch(filter, limit, force);
  return NextResponse.json({ ok: true, ...progress });
}

function parseList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim())
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  return undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function bool(v: unknown): boolean {
  return v === true || v === "1" || v === "true";
}
