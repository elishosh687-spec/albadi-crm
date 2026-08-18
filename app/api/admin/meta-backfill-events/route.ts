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
 *   Qualified — delegated to pollGoodLeads: leads Eli TAGGED "ליד טוב" in GHL.
 *     It used to select by pipeline stage instead, which reported a much larger
 *     population than the live path and inflated the count in Events Manager.
 *   Purchase  — closed deals (listClosedQuotes) NOT already stamped
 *     meta_purchase_sent_at, value = grandTotalExVat.
 * "Less good" leads get no event — Meta infers them from the absence.
 *
 * ⚠️ Re-running is a no-op by default: both halves skip what is already
 * reported. Events Manager counts events RECEIVED, so re-sending visibly
 * inflates the dataset even though Meta dedups on event_id for attribution.
 * ?force=1 re-sends Purchases anyway.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { sendMetaCrmEvent, metaCapiConfigured } from "@/lib/meta/capi";
import { listClosedQuotes } from "@/lib/factory/server/closed";
import { pollGoodLeads } from "@/lib/meta/good-lead-poll";

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
/**
 * Clamp an epoch into the window Meta will actually accept.
 *
 * Meta rejects `event_time` in the future AND older than 7 days — and the
 * second half was missing here, so a backfill of anything older than a week
 * was rejected on arrival while the run still looked successful. We floor at
 * 6 days to keep a margin for clock skew and slow runs.
 *
 * The floor does misdate genuinely older conversions, which is the trade Meta
 * forces: a slightly-late timestamp inside the window, or no signal at all.
 */
const MAX_AGE_SEC = 6 * 24 * 60 * 60;
function clampTs(sec: number | null | undefined): number {
  const n = nowSec();
  const floor = n - MAX_AGE_SEC;
  if (!sec || !Number.isFinite(sec) || sec > n) return n;
  return Math.max(Math.floor(sec), floor);
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
  // Opt-in re-send of things we already reported. Off by default: Events
  // Manager counts events RECEIVED, so a casual re-run visibly inflates the
  // dataset even though Meta dedups on event_id for attribution.
  const force = url.searchParams.get("force") === "1";

  // ?names=a,b — send Qualified for leads matched by name (Eli hand-picking the
  // ones he knows were good). Uses the canonical event_id so it can't double
  // count against the automatic pass.
  const namesParam = url.searchParams.get("names");
  if (namesParam) {
    const patterns = namesParam.split(",").map((s) => `%${s.trim()}%`).filter((s) => s.length > 2);
    if (patterns.length === 0) {
      return NextResponse.json({ ok: false, error: "no usable names" }, { status: 400 });
    }
    // Build explicit OR clauses — passing a JS array to ILIKE ANY() leaves
    // Postgres unable to infer the element type (500s).
    const nameClauses = sql.join(
      patterns.map((p) => sql`name ILIKE ${p}`),
      sql` OR `,
    );
    const res = await db.execute<{ sid: string; name: string; ts: number | null }>(sql`
      SELECT manychat_sub_id AS sid, name,
             EXTRACT(EPOCH FROM COALESCE(last_response_at, updated_at, created_at)) AS ts
      FROM leads
      WHERE meta_leadgen_id IS NOT NULL AND (${nameClauses})`);
    if (dry) {
      return NextResponse.json({ ok: true, dry: true, matched: res.rows.map((r) => r.name) });
    }
    const out: { name: string; ok: boolean; err?: string }[] = [];
    for (const r of res.rows) {
      const s = await sendMetaCrmEvent(r.sid, "Qualified", {
        eventTime: clampTs(r.ts ? Number(r.ts) : null),
        testEventCode: testCode,
        eventId: `${r.sid.trim()}:Qualified`,
      });
      out.push({ name: r.name, ok: s.ok, err: s.error });
    }
    return NextResponse.json({ ok: true, mode: "names", sent: out.filter((o) => o.ok).length, results: out });
  }

  // 1. Qualified — delegated to the good-lead poller ON PURPOSE.
  //
  // This used to select `pipeline_stage IN (DISCAVERY, FACTORY_WAIT,
  // CONSIDERATION, WON)`, i.e. "got far in the funnel" — the exact definition
  // Eli rejected ("got a quote" is a pipeline step, not quality; the tag is
  // the judgement). It therefore reported a different, larger population than
  // the live path, inflating the Qualified count in Events Manager and
  // teaching the algorithm the wrong thing. pollGoodLeads is the single rule:
  // tagged in GHL, has an attribution key, not already reported.

  // 2. Purchase candidates (closed deals).
  const stampedRows = await db.execute<{ id: string }>(sql`
    SELECT id FROM factory_quote_requests WHERE meta_purchase_sent_at IS NOT NULL`);
  const stampedDealIds = new Set(stampedRows.rows.map((r) => r.id));
  const deals = await listClosedQuotes();
  const purchases = deals
    // Already reported? Skip it. Re-running used to re-send every deal, and
    // Events Manager counts what it RECEIVES — two runs showed as double the
    // conversions. ?force=1 re-sends anyway (Meta dedups on event_id, but the
    // received-count still moves, so it is opt-in).
    .filter((d) => force || !stampedDealIds.has(d.id))
    .filter((d) => d.leadSid && d.grandTotalExVat > 0)
    .map((d) => ({
      // carried so a successful send can be STAMPED on the deal — without it
      // the ads tab reports a reported deal as "ממתין לדיווח" forever
      id: d.id,
      sid: d.leadSid as string,
      value: d.grandTotalExVat,
      ts: clampTs(Math.floor(Date.parse(d.updatedAt) / 1000)),
    }));

  if (dry) {
    const preview = await pollGoodLeads({ dry: true });
    return NextResponse.json({
      ok: true,
      dry: true,
      wouldSend: { qualified: preview.matched, purchases: purchases.length },
      alreadyReported: { purchases: stampedDealIds.size },
      samplePurchases: purchases.slice(0, 5),
    });
  }

  let qSent = 0, qSkip = 0, pSent = 0, pSkip = 0;
  const errors: string[] = [];

  // NB: pollGoodLeads owns its own send, so ?testCode does not reach the
  // Qualified half. Use /api/admin/meta-send-test for a Test-Events dry run.
  const poll = await pollGoodLeads();
  qSent = poll.sent;
  qSkip = poll.failed + poll.unattributable;
  errors.push(...poll.errors.map((e) => `Q ${e}`));
  for (const p of purchases) {
    const r = await sendMetaCrmEvent(p.sid, "Purchase", {
      valueIls: p.value,
      eventTime: p.ts,
      testEventCode: testCode,
      eventId: `${p.sid.trim()}:Purchase`,
    });
    // Stamp the outcome, exactly as the live close path does. The backfill used
    // to send without recording it, so the ads tab kept showing reported deals
    // as pending — the panel contradicting reality is worse than no panel.
    await db
      .update(factoryQuoteRequests)
      .set(
        r.ok
          ? { metaPurchaseSentAt: new Date(), metaPurchaseValueIls: p.value, metaPurchaseError: null }
          : { metaPurchaseError: r.error ?? r.skipped ?? "unknown" },
      )
      .where(eq(factoryQuoteRequests.id, p.id));
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
