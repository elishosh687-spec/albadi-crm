/**
 * "מה עבר למטא" — per-deal / per-lead proof that a conversion reached Meta.
 *
 * Sits under the ads table because the aggregate counters there can read
 * "all reported" while one specific deal is missing — naming every row is what
 * makes that falsifiable. Presentation only; the data comes from
 * [lib/meta/reporting-status.ts](../../lib/meta/reporting-status.ts).
 */
import type {
  ReportedLead,
  MetaReportingStatus,
} from "@/lib/meta/reporting-status";

const INK = "#e6e1e0";
const MUTED = "#8a7f74";
const LINE = "rgba(230,225,224,0.08)";

/** Visual language per state, defined once so the header chips and the row
 *  pills can never disagree about what a colour means. */
const REPORT_STATE: Record<
  ReportedLead["state"],
  { color: string; label: string }
> = {
  sent: { color: "#7dd3a0", label: "דווח" },
  pending: { color: "#e7cba6", label: "ממתין" },
  no_meta_id: { color: "#e08a8a", label: "חסר מזהה" },
  // Neutral grey on purpose: a customer who never came from an ad is not a
  // fault, and colouring it red made the panel cry wolf.
  not_from_meta: { color: MUTED, label: "לא ממודעה" },
  failed: { color: "#e08a8a", label: "נכשל" },
};

function chip(color: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "2px 9px",
    borderRadius: 999,
    color,
    border: `1px solid ${color}33`,
    background: `${color}14`,
    whiteSpace: "nowrap",
  };
}

/** At-a-glance tally across both lists. */
function countChips(reporting: MetaReportingStatus) {
  const all = [...reporting.purchases, ...reporting.qualified];
  const order: ReportedLead["state"][] = [
    "sent",
    "pending",
    "failed",
    "no_meta_id",
    "not_from_meta",
  ];
  return order
    .map((st) => ({
      n: all.filter((r) => r.state === st).length,
      ...REPORT_STATE[st],
    }))
    .filter((c) => c.n > 0);
}

/** One list — named rows, each with its state as a pill. */
function ReportList({ title, rows }: { title: string; rows: ReportedLead[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ padding: "10px 14px 12px" }}>
      <div
        style={{
          fontSize: 10.5,
          color: MUTED,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          marginBottom: 7,
        }}
      >
        {title}
      </div>
      {rows.map((r, i) => {
        const s = REPORT_STATE[r.state] ?? REPORT_STATE.pending;
        return (
          <div
            key={`${r.name}-${i}`}
            style={{
              padding: "7px 0",
              // separators only BETWEEN rows — a rule under every row, including
              // the last, is what made the first version read as a wall
              borderTop: i === 0 ? "none" : `1px solid ${LINE}`,
            }}
          >
            <div
              className="lux-wrap-sm"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span
                title={r.name}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  color: INK,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.name}
              </span>
              {typeof r.valueIls === "number" ? (
                <span
                  className="tabular-nums"
                  style={{ fontSize: 12.5, color: MUTED }}
                >
                  ₪{Math.round(r.valueIls).toLocaleString("he-IL")}
                </span>
              ) : null}
              <span style={chip(s.color)}>{s.label}</span>
            </div>
            {/* the reason belongs to ITS row — one shared note under the whole
                list left you guessing which name it referred to */}
            {r.note ? (
              <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                {r.note}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function MetaReportPanel({
  reporting,
}: {
  reporting: MetaReportingStatus;
}) {
  return (
    <section
      style={{
        marginTop: 20,
        border: `1px solid ${LINE}`,
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        overflow: "hidden",
      }}
    >
      <header
        className="lux-wrap-sm"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 14px",
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>
          מה עבר למטא
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginInlineStart: "auto",
            flexWrap: "wrap",
          }}
        >
          {countChips(reporting).map((c) => (
            <span key={c.label} style={chip(c.color)}>
              {c.n} {c.label}
            </span>
          ))}
        </div>
      </header>

      {reporting.unreportedRevenueIls > 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "#e08a8a",
            lineHeight: 1.65,
            padding: "9px 14px",
            background: "rgba(224,138,138,0.06)",
            borderBottom: `1px solid ${LINE}`,
          }}
        >
          ₪{reporting.unreportedRevenueIls.toLocaleString("he-IL")} מלקוחות
          שהגיעו ממטא לא דווחו — חסר להם מזהה, אז אי אפשר לשייך אותם למודעה.
        </div>
      ) : null}

      <ReportList title="עסקאות · Purchase" rows={reporting.purchases} />
      <ReportList title="לידים מתויגים · Qualified" rows={reporting.qualified} />
    </section>
  );
}
