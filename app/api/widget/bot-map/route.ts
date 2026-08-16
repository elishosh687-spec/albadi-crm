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

    return NextResponse.json({
      ok: true,
      cursors,
      pausedByReason: ((pausedRows as any).rows ?? pausedRows) as { reason: string; n: number }[],
      listening: ((((listeningRows as any).rows ?? listeningRows) as any[])[0]?.n) ?? 0,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
