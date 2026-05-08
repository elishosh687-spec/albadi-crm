import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Dot } from "@/components/ui/Badge";
import { colors, fontStack, leading, radius, size, space, weight } from "@/lib/ui/tokens";

export const dynamic = "force-dynamic";

const TAGS_ORDER = [
  "ליד_חדש",
  "מעוניין",
  "הצעה_בוט",
  "הצעה_טלפון",
  "בתהליך",
  "לקוח",
  "לא_ענה",
  "לא_רלוונטי",
] as const;

type Tag = (typeof TAGS_ORDER)[number];

const TAG_TONE: Record<Tag, "info" | "accent" | "warning" | "success" | "neutral" | "danger"> = {
  ליד_חדש: "info",
  מעוניין: "accent",
  הצעה_בוט: "warning",
  הצעה_טלפון: "warning",
  בתהליך: "success",
  לקוח: "success",
  לא_ענה: "neutral",
  לא_רלוונטי: "neutral",
};

const TONE_BG: Record<string, string> = {
  info: colors.infoBg,
  accent: colors.accentSoft,
  warning: colors.warningBg,
  success: colors.successBg,
  neutral: colors.surfaceMuted,
  danger: colors.dangerBg,
};

export default async function PipelinePage() {
  const latest = await db.execute(sql`
    SELECT DISTINCT ON (manychat_sub_id)
      manychat_sub_id, lead_name, classified_tag, created_at
    FROM decisions
    ORDER BY manychat_sub_id, created_at DESC
  `);

  const rows = (latest.rows ?? latest) as Array<{
    manychat_sub_id: string;
    lead_name: string | null;
    classified_tag: string | null;
    created_at: string;
  }>;

  const grouped: Record<string, typeof rows> = {};
  for (const tag of TAGS_ORDER) grouped[tag] = [];
  for (const row of rows) {
    const tag = row.classified_tag ?? "ליד_חדש";
    if (grouped[tag]) grouped[tag].push(row);
  }

  return (
    <div>
      <Page
        title="Pipeline"
        description="תצוגת kanban — לידים מקובצים לפי הסיווג האחרון של הבוט. נגלל אופקית."
      />

      {rows.length === 0 ? (
        <p style={emptyStyle}>אין עדיין החלטות מהבוט. ה-pipeline יתמלא אחרי שהבוט ירוץ.</p>
      ) : (
        <div
          style={{
            display: "flex",
            gap: space.md,
            overflowX: "auto",
            paddingBottom: space.lg,
          }}
        >
          {TAGS_ORDER.map((tag) => {
            const tone = TAG_TONE[tag];
            return (
              <div
                key={tag}
                style={{
                  minWidth: 220,
                  maxWidth: 240,
                  background: TONE_BG[tone],
                  borderRadius: radius.lg,
                  padding: space.md,
                  display: "flex",
                  flexDirection: "column",
                  gap: space.sm,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingBottom: space.sm,
                    borderBottom: `1px solid ${colors.rule}`,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: space.xs }}>
                    <Dot tone={tone} />
                    <span
                      style={{
                        fontFamily: fontStack.body,
                        fontSize: size.sm,
                        fontWeight: weight.semibold,
                        color: colors.ink,
                      }}
                    >
                      {tag.replace(/_/g, " ")}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: fontStack.display,
                      fontSize: size.md,
                      color: colors.inkMuted,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {grouped[tag].length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
                  {grouped[tag].length === 0 ? (
                    <span
                      style={{
                        fontFamily: fontStack.body,
                        fontSize: size.xs,
                        color: colors.inkSubtle,
                        padding: `${space.xs}px ${space.sm}px`,
                      }}
                    >
                      ריק
                    </span>
                  ) : (
                    grouped[tag].map((r) => (
                      <div
                        key={r.manychat_sub_id}
                        style={{
                          background: colors.surface,
                          padding: `${space.sm}px ${space.md}px`,
                          borderRadius: radius.sm,
                          fontFamily: fontStack.body,
                          fontSize: size.sm,
                          color: colors.ink,
                          lineHeight: leading.normal,
                        }}
                      >
                        {r.lead_name ?? r.manychat_sub_id}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  fontFamily: fontStack.body,
  fontSize: size.md,
  color: colors.inkMuted,
  margin: 0,
  padding: `${space["2xl"]}px 0`,
};
