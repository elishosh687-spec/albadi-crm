/**
 * GET /api/widget/bot-map?widget_token=…
 *
 * The live numbers behind the bot map: how many leads the bot is listening to,
 * why it is silent on the rest, and when each background job last ran. Read on
 * every load so the map cannot drift from what the system is actually doing —
 * a written map answers the question once and then rots.
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const cursorRows = await db.execute(sql`
      SELECT key, updated_at FROM app_config
      WHERE key IN ('call_recordings.last_polled_at','elevenlabs.last_polled_unix','followups.lock')`);
    const cursors: Record<string, string> = {};
    for (const r of (((cursorRows as any).rows ?? cursorRows) as any[])) {
      cursors[r.key] = new Date(r.updated_at).toISOString();
    }

    const pausedRows = await db.execute(sql`
      SELECT coalesce(bot_pause_reason,'unknown') AS reason, count(*)::int AS n
      FROM leads WHERE bot_paused = true AND active IS NOT FALSE
      GROUP BY 1 ORDER BY 2 DESC`);

    const listeningRows = await db.execute(sql`
      SELECT count(*)::int AS n FROM leads
      WHERE active IS NOT FALSE AND bot_paused = false
        AND coalesce(pipeline_stage,'') NOT IN ('WON','LOST')`);

    // Per-stage roll-up. The parked "להתקשר בעתיד" bucket was the largest
    // non-terminal population in the system and no screen said so — which is
    // exactly how 45 leads sat untouched for months.
    const stageRows = await db.execute(sql`
      SELECT coalesce(pipeline_stage,'(שאלון)') AS stage,
             count(*)::int AS n,
             count(*) FILTER (WHERE bot_paused)::int AS paused,
             count(*) FILTER (WHERE quote_total IS NOT NULL)::int AS quoted,
             count(*) FILTER (WHERE follow_up_date IS NOT NULL
                              AND trim(follow_up_date) <> '')::int AS dated
      FROM leads WHERE active IS NOT FALSE
      GROUP BY 1 ORDER BY 2 DESC`);

    // Why the bot can't reach the parked leads. This is where "23 muted by an
    // old pause" becomes a decision prompt instead of a footnote.
    const parkedPausedRows = await db.execute(sql`
      SELECT coalesce(bot_pause_reason,'unknown') AS reason, count(*)::int AS n
      FROM leads
      WHERE active IS NOT FALSE AND bot_paused = true
        AND pipeline_stage = 'FUTURE_FOLLOW_UP'
      GROUP BY 1 ORDER BY 2 DESC`);

    const { readFutureQuota } = await import("@/lib/autoresponder/future-followup");

    return NextResponse.json({
      ok: true,
      cursors,
      pausedByReason: ((pausedRows as any).rows ?? pausedRows) as { reason: string; n: number }[],
      listening: ((((listeningRows as any).rows ?? listeningRows) as any[])[0]?.n) ?? 0,
      byStage: ((stageRows as any).rows ?? stageRows) as {
        stage: string; n: number; paused: number; quoted: number; dated: number;
      }[],
      parkedPausedByReason: ((parkedPausedRows as any).rows ?? parkedPausedRows) as {
        reason: string; n: number;
      }[],
      futureQuota: await readFutureQuota(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
