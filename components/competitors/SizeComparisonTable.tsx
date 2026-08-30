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
  competitorPrice: number | null;
  competitorPlateFee: number | null;
  competitorPlateFeeCurrency: string | null;
  handles: string | null;
  notes: string | null;
}

interface OurRow {
  id: number;
  unitIls: number | null;
  source: "calculator" | "estimator" | null;
  refused?: string;
}

const SOURCE_SHORT: Record<string, string> = {
  calculator: "מדויק",
  estimator: "משוער",
};

const nis = (n: number) => "₪" + n.toFixed(2);

export default function SizeComparisonTable({
  rows,
  token,
}: {
  rows: CompRow[];
  token: string;
}) {
  const sizes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const s = (r.size ?? "").trim();
      if (s) seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const [size, setSize] = useState<string>("");
  useEffect(() => {
    if (!size && sizes.length) setSize(sizes[0][0]);
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
      rows
        .filter((r) => (r.size ?? "").trim() === size)
        .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0)),
    [rows, size],
  );

  const cheapest = useMemo(() => {
    const prices = visible.map((r) => r.competitorPrice).filter((p): p is number => p != null);
    return prices.length ? Math.min(...prices) : null;
  }, [visible]);

  const spec = visible[0];
  const specLine = spec
    ? [
        spec.quantity != null && (spec.size?.split(/[×x*]/).length ?? 0) > 2 ? "תלת־ממדי" : "שטוח",
        spec.gsm ? `${spec.gsm} גרם` : null,
        spec.handles,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const th: React.CSSProperties = {
    padding: "9px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--lux-muted)",
    whiteSpace: "nowrap",
    textAlign: "start",
  };
  const td: React.CSSProperties = {
    padding: "10px",
    fontSize: 13,
    borderTop: "1px solid var(--lux-line)",
    verticalAlign: "top",
  };
  const numTd: React.CSSProperties = {
    ...td,
    fontVariantNumeric: "tabular-nums",
    direction: "ltr",
    textAlign: "start",
  };

  return (
    <div>
      {/* size picker */}
      <div className="lux-wrap-sm" style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {sizes.map(([s, n]) => {
          const on = s === size;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className="lux-tap"
              style={{
                padding: "6px 13px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
                direction: "ltr",
                color: on ? "#1d1b1a" : "var(--lux-ink)",
                background: on ? "var(--lux-champagne)" : "var(--lux-card)",
                boxShadow: on ? "none" : "inset 0 0 0 1px var(--lux-line)",
              }}
            >
              {s}
              <span style={{ opacity: 0.6, marginInlineStart: 6, fontSize: 11 }}>{n}</span>
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
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
            minWidth: 58,
            direction: "ltr",
            textAlign: "start",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {margin ?? "—"}%
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

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 600, direction: "ltr" }}>{size}</span>
        <span style={{ fontSize: 12, color: "var(--lux-muted)" }}>{specLine}</span>
      </div>

      {/* the table — a flat grid, so it scrolls sideways rather than stacking */}
      <div className="lux-scroll-x" style={{ overflowX: "auto", borderRadius: 7, boxShadow: "inset 0 0 0 1px var(--lux-line)" }}>
        <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--lux-card)" }}>
              <th style={th}>ספק</th>
              <th style={th}>כמות</th>
              <th style={th}>שלהם</th>
              <th style={{ ...th, color: "var(--lux-champagne)" }}>אנחנו</th>
              <th style={th}>פער</th>
              <th style={th}>ייצור</th>
              <th style={th}>גלופה</th>
              <th style={th}>משלוח</th>
              <th style={th}>אספקה</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const mine = ours.get(r.id);
              const theirs = r.competitorPrice;
              const gap =
                mine?.unitIls != null && theirs != null ? theirs - mine.unitIls : null;
              const isCheapest = theirs != null && cheapest != null && theirs === cheapest;
              return (
                <tr key={r.id}>
                  <td style={td}>
                    {r.competitor}
                    {isCheapest && (
                      <span style={{ fontSize: 10, color: "var(--lux-muted)", marginInlineStart: 6 }}>
                        הזול
                      </span>
                    )}
                  </td>
                  <td style={numTd}>{r.quantity?.toLocaleString("he-IL") ?? "—"}</td>
                  <td style={numTd}>{theirs != null ? nis(theirs) : "—"}</td>
                  <td style={{ ...numTd, background: "rgba(214,196,172,0.05)" }}>
                    {mine?.unitIls != null ? (
                      <>
                        <span style={{ fontWeight: 600 }}>{nis(mine.unitIls)}</span>
                        <span style={{ display: "block", fontSize: 10, color: "var(--lux-muted)" }}>
                          {SOURCE_SHORT[mine.source ?? ""] ?? ""}
                        </span>
                      </>
                    ) : (
                      <span
                        style={{ fontSize: 11, color: "var(--lux-muted)", direction: "rtl", display: "block", maxWidth: 150 }}
                        title={mine?.refused ?? ""}
                      >
                        {mine?.refused ? "צריך מחיר מהמפעל" : "—"}
                      </span>
                    )}
                  </td>
                  <td style={{ ...numTd, color: gap == null ? "var(--lux-muted)" : gap > 0 ? "#a8c0a0" : "#e8b4b4" }}>
                    {gap == null ? "—" : (gap > 0 ? "−" : "+") + nis(Math.abs(gap)).replace("₪", "₪")}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: "var(--lux-muted)" }}>{r.origin ?? "—"}</td>
                  <td style={{ ...numTd, fontSize: 12, color: "var(--lux-muted)" }}>
                    {r.competitorPlateFee == null
                      ? "—"
                      : (r.competitorPlateFeeCurrency === "USD" ? "$" : "₪") +
                        Math.round(r.competitorPlateFee)}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: "var(--lux-muted)" }}>
                    {r.shippingIncluded === true ? "כולל" : r.shippingIncluded === false ? "לא כולל" : "—"}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: "var(--lux-muted)" }}>{r.leadTimeText ?? "—"}</td>
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
      </p>
    </div>
  );
}
