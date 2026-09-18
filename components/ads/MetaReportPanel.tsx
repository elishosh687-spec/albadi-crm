/**
 * "דיווח למטא" — did each closed deal / good lead reach Meta? (ui-ux-pro-max
 * redesign, 18/09: status first, problems first, one short row per customer,
 * the rest folded away — no filters.)
 *
 * The aggregate counters can read "all reported" while one specific deal is
 * missing, so every row is named — that is what makes it falsifiable.
 * Server-rendered, no JS: the folded groups are native <details>.
 * Data: lib/meta/reporting-status.ts. Grouping: groupReportRows (lib/ads/overview).
 */
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import type { ReportedLead, MetaReportingStatus } from "@/lib/meta/reporting-status";
import { groupReportRows } from "@/lib/ads/overview";

/** One visual language per state — colour AND words, never colour alone. */
const STATE: Record<ReportedLead["state"], { tone: "good" | "warn" | "stop" | "idle"; label: string }> = {
  sent: { tone: "good", label: "דווח" },
  pending: { tone: "warn", label: "ממתין" },
  failed: { tone: "stop", label: "נכשל" },
  no_meta_id: { tone: "stop", label: "חסר מזהה" },
  // Neutral on purpose: a customer who never came from an ad is not a fault.
  not_from_meta: { tone: "idle", label: "לא ממודעה" },
};

const ils = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;

function Row({ r }: { r: ReportedLead }) {
  const s = STATE[r.state] ?? STATE.pending;
  return (
    <li className="ux-rrow">
      <div className="who">
        <span className="name">{r.name}</span>
        {r.note && r.state !== "not_from_meta" ? <span className="note">{r.note}</span> : null}
      </div>
      <span className="val">{typeof r.valueIls === "number" ? ils(r.valueIls) : ""}</span>
      <span className="ux-pill" data-tone={s.tone}>{s.label}</span>
    </li>
  );
}

function Folded({ title, rows }: { title: string; rows: ReportedLead[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="ux-fold">
      <summary>
        <span>{title}</span>
        <ChevronDown className="size-4 chev" aria-hidden />
      </summary>
      <ul className="ux-rlist">{rows.map((r, i) => <Row key={`${r.name}-${i}`} r={r} />)}</ul>
    </details>
  );
}

/** One kind of event (Purchase / Qualified): problems open, the rest folded. */
function EventSection({ title, hint, rows }: { title: string; hint: string; rows: ReportedLead[] }) {
  const g = groupReportRows(rows);
  const sentValue = g.sent.reduce((a, r) => a + (r.valueIls ?? 0), 0);
  return (
    <section className="ux-panel" aria-label={title}>
      <h2>{title}</h2>
      <p className="d">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">עוד אין מה לדווח.</p>
      ) : (
        <>
          {g.attention.length > 0 && <ul className="ux-rlist">{g.attention.map((r, i) => <Row key={`${r.name}-${i}`} r={r} />)}</ul>}
          <Folded
            title={`דווחו למטא · ${g.sent.length}${sentValue > 0 ? ` · ${ils(sentValue)}` : ""}`}
            rows={g.sent}
          />
          <Folded title={`לא הגיעו ממודעה — אין מה לדווח · ${g.notFromMeta.length}`} rows={g.notFromMeta} />
        </>
      )}
    </section>
  );
}

export function MetaReportPanel({ reporting }: { reporting: MetaReportingStatus }) {
  const all = [...reporting.purchases, ...reporting.qualified];
  const count = (st: ReportedLead["state"]) => all.filter((r) => r.state === st).length;
  const problems = count("pending") + count("failed") + count("no_meta_id");
  const fromMeta = all.length - count("not_from_meta");

  return (
    <div className="grid gap-5">
      <div className="ux-kpis" style={{ marginBottom: 0 }}>
        <div className="ux-kpi"><div className="k">דווחו</div><div className="v">{count("sent")}</div><div className="e">מתוך <b>{fromMeta}</b> שהגיעו ממודעה</div></div>
        <div className="ux-kpi"><div className="k">ממתינים</div><div className="v">{count("pending")}</div><div className="e">יש מזהה, עוד לא נשלחו</div></div>
        <div className="ux-kpi"><div className="k">נכשלו או חסר מזהה</div><div className="v">{count("failed") + count("no_meta_id")}</div><div className="e">{count("failed") + count("no_meta_id") ? "דורש בדיקה" : "אין"}</div></div>
        <div className="ux-kpi"><div className="k">לא ממודעה</div><div className="v">{count("not_from_meta")}</div><div className="e">אין מה לדווח עליהם</div></div>
      </div>

      {problems === 0 && reporting.unreportedRevenueIls === 0 ? (
        <section className="ux-todo ok" aria-label="מצב הדיווח">
          <h2><CheckCircle2 className="size-4" aria-hidden /> כל מה שהגיע ממודעה דווח למטא.</h2>
        </section>
      ) : reporting.unreportedRevenueIls > 0 ? (
        <p className="ux-note" style={{ color: "#f0c0c0", marginTop: 0 }}>
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {ils(reporting.unreportedRevenueIls)} מלקוחות שהגיעו ממטא לא דווחו — חסר להם מזהה, אז אי אפשר לשייך אותם למודעה.
        </p>
      ) : null}

      <EventSection
        title="עסקאות שנסגרו · Purchase"
        hint="כל עסקה שנסגרה מליד ממודעה נשלחת למטא עם הסכום, כדי שמטא תלמד מי קונה."
        rows={reporting.purchases}
      />
      <EventSection
        title="לידים טובים · Qualified"
        hint="כל ליד שסימנת ״ליד טוב״ ב-GHL נשלח למטא, כדי שתביא עוד כמוהו."
        rows={reporting.qualified}
      />
    </div>
  );
}
