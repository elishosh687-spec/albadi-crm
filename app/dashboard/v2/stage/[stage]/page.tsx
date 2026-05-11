import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/config";
import { getSubscriber, getFieldValue } from "@/lib/manychat/client";
import { NotesEditor } from "../../NotesEditor";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const FLAG_TONES: Record<string, "danger" | "warning" | "info" | "accent" | "neutral"> = {
  "דחוף": "danger",
  "עסקה_גדולה": "accent",
  "ביקש_שיחה": "warning",
  "אחרי_החג": "info",
  "מועדף": "accent",
};

interface LeadRow {
  manychatSubId: string;
  name: string | null;
  flags: string[];
  summary: string | null;
  reviewedAt: Date | null;
  daysSince: number | null;
  notes: string | null;
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

  const isValid =
    stageDecoded === "UNCLASSIFIED" ||
    (V2_PIPELINE_STAGES as readonly string[]).includes(stageDecoded);
  if (!isValid) notFound();

  let baseRows: Omit<LeadRow, "notes">[] = [];
  if (stageDecoded === "UNCLASSIFIED") {
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
      reviewedAt: null,
      daysSince: null,
    }));
  } else {
    const r = await db.execute(sql`
      SELECT DISTINCT ON (TRIM(ps.manychat_sub_id))
        ps.manychat_sub_id AS sid,
        l.name AS name,
        ps.approved_flags AS flags,
        ps.suggested_summary AS summary,
        ps.reviewed_at AS reviewed_at
      FROM pipeline_suggestions ps
      LEFT JOIN leads l ON TRIM(l.manychat_sub_id) = TRIM(ps.manychat_sub_id)
      WHERE ps.approved_stage = ${stageDecoded}
        AND COALESCE(l.active, true) = true
      ORDER BY TRIM(ps.manychat_sub_id), ps.reviewed_at DESC NULLS LAST
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
      reviewedAt: x.reviewed_at ? new Date(x.reviewed_at as any) : null,
      daysSince: daysSince(x.reviewed_at),
    }));
    baseRows.sort((a, b) =>
      (a.name ?? a.manychatSubId).localeCompare(b.name ?? b.manychatSubId, "he")
    );
  }

  const cleanSids = baseRows.map((r) => r.manychatSubId.trim());
  const notesBySid = await pullNotes(cleanSids);

  const rows: LeadRow[] = baseRows.map((r) => ({
    ...r,
    notes: notesBySid.get(r.manychatSubId.trim()) ?? null,
  }));

  return (
    <div>
      <div style={{ marginBottom: space.md }}>
        <Link
          href="/dashboard/v2"
          style={{
            fontFamily: fontStack.body,
            fontSize: size.sm,
            color: colors.accent,
          }}
        >
          ← חזרה ל-Inbox
        </Link>
      </div>
      <Page
        title={`Stage: ${stageDecoded}`}
        description={`${rows.length} לידים`}
      />

      {rows.length === 0 ? (
        <Card>
          <p
            style={{
              fontFamily: fontStack.body,
              fontSize: size.md,
              color: colors.inkMuted,
              margin: 0,
            }}
          >
            אין לידים ב-stage הזה.
          </p>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: space.md }}>
          {rows.map((r) => (
            <Card key={r.manychatSubId}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: space.md,
                  flexWrap: "wrap",
                  marginBottom: space.sm,
                }}
              >
                <div
                  style={{
                    fontFamily: fontStack.display,
                    fontSize: size.lg,
                    fontWeight: weight.medium,
                    color: colors.ink,
                  }}
                >
                  {r.name ?? r.manychatSubId}
                  <span
                    style={{
                      marginInlineStart: space.sm,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: size.xs,
                      color: colors.inkSubtle,
                      fontWeight: weight.regular,
                    }}
                  >
                    {r.manychatSubId.trim()}
                  </span>
                </div>
                <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap", alignItems: "baseline" }}>
                  {r.flags.map((f) => (
                    <Badge key={f} tone={FLAG_TONES[f] ?? "neutral"}>
                      {f}
                    </Badge>
                  ))}
                  {stageDecoded !== "UNCLASSIFIED" && r.daysSince !== null && (
                    <span style={{ fontFamily: fontStack.body, fontSize: size.xs, color: colors.inkMuted }}>
                      {r.daysSince}d
                    </span>
                  )}
                  <a
                    href={`https://app.manychat.com/fb4499581/chat/${encodeURIComponent(r.manychatSubId.trim())}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontFamily: fontStack.body,
                      fontSize: size.sm,
                      color: colors.accent,
                    }}
                  >
                    Live Chat ↗
                  </a>
                </div>
              </div>

              {r.summary && (
                <div
                  style={{
                    fontFamily: fontStack.body,
                    fontSize: size.sm,
                    color: colors.inkMuted,
                    marginBottom: space.xs,
                  }}
                >
                  {r.summary}
                </div>
              )}

              <NotesEditor manychatSubId={r.manychatSubId} initialNotes={r.notes} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
