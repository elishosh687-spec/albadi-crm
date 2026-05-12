import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, size, space } from "@/lib/ui/tokens";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/stages";
import { getSubscriber, getFieldValue } from "@/lib/manychat/client";
import { StageList, type StageLeadRow } from "./StageList";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

interface BaseRow {
  manychatSubId: string;
  name: string | null;
  flags: string[];
  summary: string | null;
  daysSince: number | null;
}

function daysSince(d: Date | string | null): number | null {
  if (!d) return null;
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  return Math.floor((Date.now() - t) / 86400000);
}

async function pullNotes(subIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const CONCURRENCY = 10;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, subIds.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= subIds.length) return;
        const sid = subIds[i];
        try {
          const sub = await getSubscriber(sid);
          const n = getFieldValue(sub.custom_fields, "notes");
          out.set(sid, n ? String(n) : null);
        } catch {
          out.set(sid, null);
        }
      }
    })
  );
  return out;
}

export default async function StageDetailPage({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage } = await params;
  const stageDecoded = decodeURIComponent(stage);

  const isUnclassified = stageDecoded === "UNCLASSIFIED";
  const isValid =
    isUnclassified ||
    (V2_PIPELINE_STAGES as readonly string[]).includes(stageDecoded);
  if (!isValid) notFound();

  let baseRows: BaseRow[] = [];
  if (isUnclassified) {
    const r = await db.execute(sql`
      SELECT l.manychat_sub_id AS sid, l.name AS name
      FROM leads l
      WHERE l.active = true
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_suggestions ps
          WHERE TRIM(ps.manychat_sub_id) = TRIM(l.manychat_sub_id)
            AND ps.approved_stage IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_suggestions ps
          WHERE TRIM(ps.manychat_sub_id) = TRIM(l.manychat_sub_id)
            AND ps.status = 'pending_review'
        )
      ORDER BY COALESCE(l.name, l.manychat_sub_id)
    `);
    baseRows = ((r.rows ?? r) as Array<{ sid: string; name: string | null }>).map((x) => ({
      manychatSubId: x.sid,
      name: x.name,
      flags: [],
      summary: null,
      daysSince: null,
    }));
  } else {
    // First take the LATEST approved suggestion per sub_id (globally), then
    // filter by stage. The old version filtered by stage first and then took
    // DISTINCT ON sub_id, which meant an older WAITING_CALL row could keep
    // beating a newer DROPPED row — so stage changes appeared not to update.
    const r = await db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (TRIM(ps.manychat_sub_id))
          TRIM(ps.manychat_sub_id) AS sid,
          ps.approved_stage,
          ps.approved_flags,
          ps.suggested_summary,
          ps.reviewed_at
        FROM pipeline_suggestions ps
        WHERE ps.approved_stage IS NOT NULL
        ORDER BY TRIM(ps.manychat_sub_id), ps.reviewed_at DESC NULLS LAST
      )
      SELECT
        latest.sid AS sid,
        l.name AS name,
        latest.approved_flags AS flags,
        latest.suggested_summary AS summary,
        latest.reviewed_at AS reviewed_at
      FROM latest
      LEFT JOIN leads l ON TRIM(l.manychat_sub_id) = latest.sid
      WHERE latest.approved_stage = ${stageDecoded}
        AND COALESCE(l.active, true) = true
    `);
    type DbRow = {
      sid: string;
      name: string | null;
      flags: string[] | null;
      summary: string | null;
      reviewed_at: string | Date | null;
    };
    baseRows = ((r.rows ?? r) as DbRow[]).map((x) => ({
      manychatSubId: x.sid,
      name: x.name,
      flags: (x.flags ?? []) as string[],
      summary: x.summary,
      daysSince: daysSince(x.reviewed_at),
    }));
    baseRows.sort((a, b) =>
      (a.name ?? a.manychatSubId).localeCompare(b.name ?? b.manychatSubId, "he")
    );
  }

  const cleanSids = baseRows.map((r) => r.manychatSubId.trim());
  const notesBySid = await pullNotes(cleanSids);

  const rows: StageLeadRow[] = baseRows.map((r) => ({
    manychatSubId: r.manychatSubId,
    name: r.name,
    flags: r.flags,
    summary: r.summary,
    daysSince: r.daysSince,
    notes: notesBySid.get(r.manychatSubId.trim()) ?? null,
    currentStage: isUnclassified ? null : stageDecoded,
  }));

  return (
    <div>
      <div style={{ marginBottom: space.md }}>
        <Link
          href="/dashboard/v2"
          style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.accent }}
        >
          ← חזרה ל-Inbox
        </Link>
      </div>
      <Page title={`Stage: ${stageDecoded}`} description={`${rows.length} לידים`} />

      <Card>
        <StageList rows={rows} isUnclassified={isUnclassified} />
      </Card>
    </div>
  );
}
