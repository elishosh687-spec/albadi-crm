/**
 * POST /api/admin/meta-backfill-events — one-time (idempotent) backfill of
 * historical conversion events to Meta CAPI, so the dataset reflects which past
 * leads became good (Qualified) and which closed (Purchase). Meta's conversion-
 * leads optimization uses a 28-day window (lead→stage), so recent leads help
 * the algorithm; older ones are for reporting. event_id = <sid>:<eventName>
 * matches the live sender → re-runs and future live events dedup, no double count.
 *
 * Auth: Bearer BOT_SECRET / CALL_TRIGGER_SECRET / CRON_SECRET.
 * Query: ?dry=1 → count only, send nothing. ?testCode=XXX → route to Test Events.
 *
 * Events:
 *   Qualified — every lead with a meta_leadgen_id whose stage reached an engaged
 *     state (DISCAVERY / FACTORY_WAIT / CONSIDERATION / WON). event_time from
 *     last_response_at ?? updated_at ?? created_at.
 *   Purchase  — every closed deal (listClosedQuotes), value = grandTotalExVat,
 *     event_time from the deal's newest updatedAt.
 * "Less good" leads get no event — Meta infers them from the absence.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { sendMetaCrmEvent, metaCapiConfigured } from "@/lib/meta/capi";
import { listClosedQuotes } from "@/lib/factory/server/closed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const accepted = [
    process.env.BOT_SECRET,
    process.env.CALL_TRIGGER_SECRET,
    process.env.CRON_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (accepted.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return accepted.some((s) => header === `Bearer ${s}`);
}

const nowSec = () => Math.floor(Date.now() / 1000);
// Clamp an epoch to [not future, not absurdly old]. Meta rejects future times.
function clampTs(sec: number | null | undefined): number {
  const n = nowSec();
  if (!sec || !Number.isFinite(sec) || sec > n) return n;
  return Math.floor(sec);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!metaCapiConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const testCode = url.searchParams.get("testCode") || null;

  // 1. Qualified candidates.
  const qRes = await db.execute<{ sid: string; ts: number | null }>(sql`
    SELECT manychat_sub_id AS sid,
           EXTRACT(EPOCH FROM COALESCE(last_response_at, updated_at, created_at)) AS ts
    FROM leads
    WHERE meta_leadgen_id IS NOT NULL
      AND pipeline_stage IN ('DISCAVERY','FACTORY_WAIT','CONSIDERATION','WON')`);
  const qualified = qRes.rows.map((r) => ({
    sid: r.sid,
    ts: clampTs(r.ts ? Number(r.ts) : null),
  }));

  // 2. Purchase candidates (closed deals).
  const deals = await listClosedQuotes();
  const purchases = deals
    .filter((d) => d.leadSid && d.grandTotalExVat > 0)
    .map((d) => ({
      sid: d.leadSid as string,
      value: d.grandTotalExVat,
      ts: clampTs(Math.floor(Date.parse(d.updatedAt) / 1000)),
    }));

  if (dry) {
    return NextResponse.json({
      ok: true,
      dry: true,
      wouldSend: { qualified: qualified.length, purchases: purchases.length },
      samplePurchases: purchases.slice(0, 5),
    });
  }

  let qSent = 0, qSkip = 0, pSent = 0, pSkip = 0;
  const errors: string[] = [];

  for (const q of qualified) {
    const r = await sendMetaCrmEvent(q.sid, "Qualified", {
      eventTime: q.ts,
      testEventCode: testCode,
      eventId: `${q.sid.trim()}:Qualified`,
    });
    if (r.ok) qSent++;
    else {
      qSkip++;
      if (r.error) errors.push(`Q ${q.sid}: ${r.error}`);
    }
  }
  for (const p of purchases) {
    const r = await sendMetaCrmEvent(p.sid, "Purchase", {
      valueIls: p.value,
      eventTime: p.ts,
      testEventCode: testCode,
      eventId: `${p.sid.trim()}:Purchase`,
    });
    if (r.ok) pSent++;
    else {
      pSkip++;
      if (r.error) errors.push(`P ${p.sid}: ${r.error}`);
    }
  }

  return NextResponse.json({
    ok: true,
    qualified: { sent: qSent, skipped: qSkip },
    purchases: { sent: pSent, skipped: pSkip },
    errors: errors.slice(0, 10),
  });
}
