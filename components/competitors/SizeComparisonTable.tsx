"use client";

/**
 * "Pick a size, see every competitor for it" — the view Eli asked for after the
 * card-per-comparison layout turned out to be unreadable ("זה לא ברור בכלל").
 *
 * One row per competitor quote, our own price beside it at the SAME quantity,
 * and the gap. The margin control at the top re-prices our whole column live,
 * so "what if I take 45% instead of 60%" is one drag rather than a recalculation
 * somewhere else.
 *
 * Our number is never invented: each one is labelled with where it came from,
 * and where the estimator refuses (flat shapes — shipping can't be estimated
 * reliably) the cell says so instead of showing a figure.
 *
 * ⚠️ Alignment rule for this table. The page is RTL and every price is a Latin
 * string ("₪1.77"). Putting `direction:"ltr"` on the CELL pushes its content to
 * the left edge while the header stays on the right — that is exactly how the
 * first version came out crooked. So the cell always keeps the page direction
 * and only the number itself is isolated (`<Num>`), which keeps "₪" in front
 * without moving the column.
 */

import { useEffect, useMemo, useRef, useState } from "react";

export interface CompRow {
  id: number;
  product: string;
  competitor: string;
  size: string | null;
  quantity: number | null;
  origin: string | null;
  gsm: number | null;
  shippingIncluded: boolean | null;
  leadTimeText: string | null;
  competitorLeadDays: number | null;
  competitorPrice: number | null;
  competitorPlateFee: number | null;
  competitorPlateFeeCurrency: string | null;
  handles: string | null;
  notes: string | null;
}

interface OurRow {
  id: number;
  unitIls: number | null;
  leadDays: number | null;
  source: "calculator" | "estimator" | null;
  refused?: string;
}

const SOURCE_SHORT: Record<string, string> = {
  calculator: "מדויק",
  estimator: "משוער",
};

const nis = (n: number) => "₪" + n.toFixed(2);

/**
 * Where the bag is made — and therefore how long the customer waits. Eli thinks
 * in exactly these two buckets: local is weeks, overseas is about three months.
 * Origin is the primary signal; the quoted lead time is the fallback for a row
 * logged without one.
 */
type OriginBucket = "IL" | "CN";

function bucketOf(row: CompRow): OriginBucket {
  const o = row.origin ?? "";
  if (o.includes("ישראל")) return "IL";
  if (o) return "CN"; // סין / any other overseas origin
  return (row.competitorLeadDays ?? 0) > 30 ? "CN" : "IL";
}

const ORIGIN_TABS: { id: "all" | OriginBucket; label: string; hint: string }[] = [
  { id: "all", label: "הכל", hint: "" },
  { id: "IL", label: "ייצור בארץ", hint: "עד חודש" },
  { id: "CN", label: "ייצור בחו״ל", hint: "כ-3 חודשים" },
];

/** A Latin/number string inside an RTL cell — isolated so "₪" stays in front. */
function Num({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <span
      style={{
        direction: "ltr",
        unicodeBidi: "isolate",
        display: "inline-block",
        fontVariantNumeric: "tabular-nums",
        fontWeight: bold ? 600 : undefined,
      }}
    >
      {children}
    </span>
  );
}

export default function SizeComparisonTable({
  rows,
  token,
}: {
  rows: CompRow[];
  token: string;
}) {
  const [origin, setOrigin] = useState<"all" | OriginBucket>("all");

  const originCounts = useMemo(() => {
    const c = { all: rows.length, IL: 0, CN: 0 };
    for (const r of rows) c[bucketOf(r)]++;
    return c;
  }, [rows]);

  const inOrigin = useMemo(
    () => (origin === "all" ? rows : rows.filter((r) => bucketOf(r) === origin)),
    [rows, origin],
  );

  const sizes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of inOrigin) {
      const s = (r.size ?? "").trim();
      if (s) seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [inOrigin]);

  const [size, setSize] = useState<string>("");
  // Filtering can remove the selected size entirely — fall back to the biggest
  // group that survived rather than rendering an empty table.
  useEffect(() => {
    if (!sizes.length) return;
    if (!sizes.some(([s]) => s === size)) setSize(sizes[0][0]);
  }, [sizes, size]);

  const [margin, setMargin] = useState<number | null>(null);
  const [defaultMargin, setDefaultMargin] = useState<number | null>(null);
  const [ours, setOurs] = useState<Map<number, OurRow>>(new Map());
  const [pricing, setPricing] = useState(true);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-price our column. Debounced — the margin control is a slider.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setPricing(true);
      setPriceErr(null);
      try {
        const qs = new URLSearchParams({ widget_token: token });
        if (margin != null) qs.set("margin", String(margin));
        const res = await fetch(`/api/widget/competitor-prices/our-side?${qs}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "pricing failed");
        setOurs(new Map<number, OurRow>(data.rows.map((r: OurRow) => [r.id, r])));
        if (defaultMargin == null) setDefaultMargin(data.defaultMargin);
        if (margin == null) setMargin(data.margin);
      } catch (e) {
        setPriceErr(e instanceof Error ? e.message : "pricing failed");
      } finally {
        setPricing(false);
      }
    }, margin == null ? 0 : 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // defaultMargin intentionally excluded — it is set once from the response.
  }, [margin, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(
    () =>
      inOrigin
        .filter((r) => (r.size ?? "").trim() === size)
        .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0)),
    [inOrigin, size],
  );

  const cheapest = useMemo(() => {
    const prices = visible.map((r) => r.competitorPrice).filter((p): p is number => p != null);
    return prices.length ? Math.min(...prices) : null;
  }, [visible]);

  const spec = visible[0];
  const specLine = spec
    ? [
        (spec.size?.split(/[×x*]/).length ?? 0) > 2 ? "תלת־ממדי" : "שטוח",
        spec.gsm ? `${spec.gsm} גרם` : null,
        spec.handles,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  // One style per column, shared by the header and its cells, so a header can
  // never drift away from the numbers beneath it.
  const th: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--lux-muted)",
    whiteSpace: "nowrap",
    textAlign: "start",
    letterSpacing: "0.02em",
  };
  const td: React.CSSProperties = {
    padding: "11px 12px",
    fontSize: 13,
    textAlign: "start",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  };
  const soft: React.CSSProperties = { ...td, fontSize: 12, color: "var(--lux-muted)" };
  // The "אנחנו" column is the point of the table — framed rather than tinted,
  // so it reads as one continuous column top to bottom.
  const mineEdge = "1px solid rgba(214,196,172,0.22)";
  const mineCell: React.CSSProperties = {
    ...td,
    background: "rgba(214,196,172,0.06)",
    borderInlineStart: mineEdge,
    borderInlineEnd: mineEdge,
  };

  const pill = (on: boolean): React.CSSProperties => ({
    padding: "6px 13px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "inherit",
    color: on ? "#1d1b1a" : "var(--lux-ink)",
    background: on ? "var(--lux-champagne)" : "var(--lux-card)",
    boxShadow: on ? "none" : "inset 0 0 0 1px var(--lux-line)",
  });

  return (
    <div>
      {/* where it's made — the filter Eli asked for: local weeks vs overseas months */}
      <div
        className="lux-wrap-sm"
        style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}
      >
        <span style={{ fontSize: 12, color: "var(--lux-muted)", marginInlineEnd: 2 }}>ייצור</span>
        {ORIGIN_TABS.map((t) => {
          const n = originCounts[t.id];
          if (t.id !== "all" && n === 0) return null;
          const on = t.id === origin;
          return (
            <button key={t.id} type="button" onClick={() => setOrigin(t.id)} className="lux-tap" style={pill(on)}>
              {t.label}
              {t.hint && (
                <span style={{ opacity: on ? 0.65 : 0.5, fontSize: 11, marginInlineStart: 6 }}>{t.hint}</span>
              )}
              <span style={{ opacity: 0.6, marginInlineStart: 6, fontSize: 11 }}>
                <Num>{n}</Num>
              </span>
            </button>
          );
        })}
      </div>

      {/* size picker */}
      <div className="lux-wrap-sm" style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: "var(--lux-muted)", marginInlineEnd: 2 }}>מידה</span>
        {sizes.map(([s, n]) => {
          const on = s === size;
          return (
            <button key={s} type="button" onClick={() => setSize(s)} className="lux-tap" style={pill(on)}>
              <Num>{s}</Num>
              <span style={{ opacity: 0.6, marginInlineStart: 6, fontSize: 11 }}>
                <Num>{n}</Num>
              </span>
            </button>
          );
        })}
      </div>

      {/* margin control */}
      <div
        className="lux-wrap-sm"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "11px 13px",
          borderRadius: 7,
          background: "var(--lux-card)",
          boxShadow: "inset 0 0 0 1px var(--lux-line)",
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--lux-muted)" }}>אחוז רווחיות שלנו</span>
        <input
          type="range"
          min={0}
          max={85}
          step={1}
          value={margin ?? 60}
          onChange={(e) => setMargin(Number(e.target.value))}
          style={{ flex: "1 1 160px", minWidth: 120, accentColor: "var(--lux-champagne)" }}
          aria-label="אחוז רווחיות"
        />
        <span style={{ fontSize: 18, minWidth: 58 }}>
          <Num bold>{margin ?? "—"}%</Num>
        </span>
        {defaultMargin != null && margin !== defaultMargin && (
          <button
            type="button"
            onClick={() => setMargin(defaultMargin)}
            className="lux-tap"
            style={{
              fontSize: 11,
              padding: "4px 9px",
              borderRadius: 5,
              border: "none",
              cursor: "pointer",
              background: "transparent",
              color: "var(--lux-champagne)",
              boxShadow: "inset 0 0 0 1px var(--lux-line)",
              fontFamily: "inherit",
            }}
          >
            חזרה ל-{defaultMargin}%
          </button>
        )}
        {pricing && <span style={{ fontSize: 11, color: "var(--lux-muted)" }}>מחשב…</span>}
      </div>

      {priceErr && (
        <div style={{ fontSize: 12, color: "#e8b4b4", marginBottom: 10 }}>
          לא הצלחתי לחשב את הצד שלנו: {priceErr}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>
          <Num>{size}</Num>
        </span>
        <span style={{ fontSize: 12, color: "var(--lux-muted)" }}>{specLine}</span>
      </div>

      {/* the table — a flat grid, so it scrolls sideways rather than stacking */}
      <div
        className="lux-scroll-x"
        style={{ overflowX: "auto", borderRadius: 8, boxShadow: "inset 0 0 0 1px var(--lux-line)" }}
      >
        <table style={{ width: "100%", minWidth: origin === "all" ? 640 : 560, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              <th style={th}>ספק</th>
              {/* redundant once a bucket is picked — and dropping it pulls the
                  "אנחנו" column into view on a phone without side-scrolling */}
              {origin === "all" && <th style={th}>ייצור</th>}
              <th style={th}>כמות</th>
              <th style={th}>שלהם</th>
              <th style={{ ...th, color: "var(--lux-champagne)", background: "rgba(214,196,172,0.06)", borderInlineStart: mineEdge, borderInlineEnd: mineEdge }}>
                אנחנו
              </th>
              <th style={th}>פער</th>
              <th style={th}>גלופה</th>
              <th style={th}>משלוח</th>
              <th style={th}>אספקה</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const mine = ours.get(r.id);
              const theirs = r.competitorPrice;
              const gap = mine?.unitIls != null && theirs != null ? theirs - mine.unitIls : null;
              const isCheapest = theirs != null && cheapest != null && theirs === cheapest;
              const zebra = i % 2 ? "rgba(255,255,255,0.015)" : "transparent";
              const line = { borderTop: "1px solid var(--lux-line)" };
              return (
                <tr key={r.id} style={{ background: zebra }}>
                  <td style={{ ...td, ...line }}>
                    {r.competitor}
                    {isCheapest && (
                      <span style={{ fontSize: 10, color: "var(--lux-muted)", marginInlineStart: 6 }}>הזול</span>
                    )}
                  </td>
                  {origin === "all" && (
                    <td style={{ ...soft, ...line }}>
                      {r.origin ?? (bucketOf(r) === "IL" ? "ישראל" : "חו״ל")}
                    </td>
                  )}
                  <td style={{ ...td, ...line }}>
                    <Num>{r.quantity?.toLocaleString("he-IL") ?? "—"}</Num>
                  </td>
                  <td style={{ ...td, ...line }}>
                    <Num>{theirs != null ? nis(theirs) : "—"}</Num>
                  </td>
                  <td style={{ ...mineCell, ...line, borderTopColor: "rgba(214,196,172,0.18)" }}>
                    {mine?.unitIls != null ? (
                      <>
                        <Num bold>{nis(mine.unitIls)}</Num>
                        <span style={{ display: "block", fontSize: 10, color: "var(--lux-muted)" }}>
                          {SOURCE_SHORT[mine.source ?? ""] ?? ""}
                          {mine.leadDays != null && ` · כ-${mine.leadDays} ימים`}
                        </span>
                      </>
                    ) : (
                      <span
                        style={{ fontSize: 11, color: "var(--lux-muted)", whiteSpace: "normal", display: "block", maxWidth: 130 }}
                        title={mine?.refused ?? ""}
                      >
                        {mine?.refused ? "צריך מחיר מהמפעל" : "—"}
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      ...td,
                      ...line,
                      color: gap == null ? "var(--lux-muted)" : gap > 0 ? "#a8c0a0" : "#e8b4b4",
                    }}
                  >
                    <Num>{gap == null ? "—" : (gap > 0 ? "−" : "+") + nis(Math.abs(gap))}</Num>
                  </td>
                  <td style={{ ...soft, ...line }}>
                    <Num>
                      {r.competitorPlateFee == null
                        ? "—"
                        : (r.competitorPlateFeeCurrency === "USD" ? "$" : "₪") +
                          Math.round(r.competitorPlateFee)}
                    </Num>
                  </td>
                  <td style={{ ...soft, ...line }}>
                    {r.shippingIncluded === true ? "כולל" : r.shippingIncluded === false ? "לא כולל" : "—"}
                  </td>
                  <td style={{ ...soft, ...line }}>{r.leadTimeText ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 10, fontSize: 11.5, color: "var(--lux-muted)", lineHeight: 1.7, maxWidth: "72ch" }}>
        הצד שלנו מחושב חי במחשבון, במשלוח ימי, לאותה כמות בדיוק. «מדויק» = המידה בקטלוג.
        «משוער» = מודל האומדן. «צריך מחיר מהמפעל» = האומדן סירב, ולא נמציא מספר במקומו.
        פער שלילי (ירוק) = אנחנו זולים מהם.
        {origin === "IL" && (
          <>
            {" "}
            <b style={{ color: "var(--lux-ink)" }}>שים לב:</b> מול ייצור בארץ ההשוואה היא מחיר מול זמן —
            הם מספקים בשבועיים, אנחנו מייצרים בסין וזה כ-3 חודשים.
          </>
        )}
      </p>
    </div>
  );
}
