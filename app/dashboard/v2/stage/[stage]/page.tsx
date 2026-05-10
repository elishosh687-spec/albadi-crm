import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pipelineSuggestions, leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
}

function daysSince(d: Date | string | null): number | null {
  if (!d) return null;
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  return Math.floor((Date.now() - t) / 86400000);
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

  let rows: LeadRow[] = [];
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
      ORDER BY COALESCE(l.name, l.manychat_sub_id)
    `);
    rows = ((r.rows ?? r) as Array<{ sid: string; name: string | null }>).map((x) => ({
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
    rows = ((r.rows ?? r) as DbRow[]).map((x) => ({
      manychatSubId: x.sid,
      name: x.name,
      flags: (x.flags ?? []) as string[],
      summary: x.summary,
      reviewedAt: x.reviewed_at ? new Date(x.reviewed_at as any) : null,
      daysSince: daysSince(x.reviewed_at),
    }));
    rows.sort((a, b) =>
      (a.name ?? a.manychatSubId).localeCompare(b.name ?? b.manychatSubId, "he")
    );
  }

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

      <Card>
        {rows.length === 0 ? (
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
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: fontStack.body,
              fontSize: size.sm,
            }}
          >
            <thead>
              <tr style={{ textAlign: "right", color: colors.inkMuted }}>
                <th style={th}>שם</th>
                <th style={th}>sub_id</th>
                <th style={th}>flags</th>
                {stageDecoded !== "UNCLASSIFIED" && <th style={th}>ימים מאז עדכון</th>}
                <th style={th}>סיכום</th>
                <th style={th}>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.manychatSubId}
                  style={{ borderTop: `1px solid ${colors.ruleSoft}`, verticalAlign: "top" }}
                >
                  <td style={{ ...td, color: colors.ink, fontWeight: weight.medium }}>
                    {r.name ?? r.manychatSubId}
                  </td>
                  <td style={{ ...td, color: colors.inkSubtle, fontFamily: "ui-monospace, monospace", fontSize: size.xs }}>
                    {r.manychatSubId}
                  </td>
                  <td style={td}>
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: space.xs }}>
                      {r.flags.map((f) => (
                        <Badge key={f} tone={FLAG_TONES[f] ?? "neutral"}>
                          {f}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  {stageDecoded !== "UNCLASSIFIED" && (
                    <td style={{ ...td, color: colors.inkMuted }}>
                      {r.daysSince !== null ? `${r.daysSince}d` : "—"}
                    </td>
                  )}
                  <td style={{ ...td, color: colors.inkMuted, maxWidth: 380 }}>
                    {r.summary ?? "—"}
                  </td>
                  <td style={td}>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: `${space.sm}px ${space.sm}px`,
  fontWeight: weight.medium,
};
const td: React.CSSProperties = {
  padding: `${space.sm}px ${space.sm}px`,
};
