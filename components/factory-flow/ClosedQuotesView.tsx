"use client";

/**
 * "הצעות שנסגרו" — post-close reconciliation for WON deals.
 *
 * The customer price is locked at close, so any gap between what Eli PLANNED
 * (finalPricing) and what actually happened lands on his margin. Two things
 * drift: the factory sometimes raises the price after close, and real shipping
 * differs from the AVERAGED shipping charged to the customer. Here he enters the
 * real factory + shipping (+ free-form other) costs; the hero number per card is
 * the ACTUAL profit for that customer, and the header rolls it up. Boss-only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Check, Save } from "lucide-react";
import { LuxShell, LuxTitle, LuxAccent, LuxStat } from "@/components/widget-ui/lux";
import { widgetUrl } from "./widget-url";
import type { FactoryPricingResult, QuoteActualCosts } from "@/lib/factory/types";

interface ClosedQuote {
  id: string;
  leadSid: string;
  quotationNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  productSpec: Record<string, unknown> | null;
  finalPricing: FactoryPricingResult | null;
  actualCosts: QuoteActualCosts | null;
  sentToCustomerAt: string | null;
  updatedAt: string;
}

const MAX_W = 900;
const ils = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Reconciliation from planned finalPricing + entered actuals. */
function reconcile(fp: FactoryPricingResult, ac: QuoteActualCosts | null) {
  const plannedFactory = fp.totalCost ?? 0;
  const plannedShipping = fp.totalShipping ?? 0;
  const plannedProfit = fp.totalProfit ?? 0;
  const revenue = fp.totalSellingPrice ?? 0;
  const actualFactory = ac?.factoryTotalIls ?? plannedFactory;
  const actualShipping = ac?.shippingTotalIls ?? plannedShipping;
  const otherTotal = (ac?.otherCosts ?? []).reduce((s, c) => s + (Number(c.amountIls) || 0), 0);
  const factoryDelta = actualFactory - plannedFactory;
  const shippingDelta = actualShipping - plannedShipping;
  // Planned profit minus every overrun = what the deal really made.
  const actualProfit = plannedProfit - factoryDelta - shippingDelta - otherTotal;
  const variance = actualProfit - plannedProfit;
  return {
    revenue, plannedFactory, plannedShipping, plannedProfit,
    actualFactory, actualShipping, otherTotal, factoryDelta, shippingDelta,
    actualProfit, variance,
  };
}

export function ClosedQuotesView({ apiToken }: { apiToken: string }) {
  const [quotes, setQuotes] = useState<ClosedQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(widgetUrl("/api/widget/factory/closed", apiToken), { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
      setQuotes(j.quotes as ClosedQuote[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiToken]);

  useEffect(() => { load(); }, [load]);

  // Roll-up across all WON deals, using the SAVED actuals (not live drafts).
  const totals = useMemo(() => {
    const priced = (quotes ?? []).filter((q) => q.finalPricing);
    let plannedProfit = 0, actualProfit = 0, reconciled = 0;
    for (const q of priced) {
      const r = reconcile(q.finalPricing!, q.actualCosts);
      plannedProfit += r.plannedProfit;
      actualProfit += r.actualProfit;
      if (q.actualCosts) reconciled += 1;
    }
    return { count: priced.length, plannedProfit, actualProfit, variance: actualProfit - plannedProfit, reconciled };
  }, [quotes]);

  return (
    <LuxShell>
      <div style={{ maxWidth: MAX_W, margin: "0 auto" }}>
        <LuxTitle
          overline="— Closed deals"
          subtitle={
            quotes
              ? `הרווח האמיתי מכל לקוח — הזן עלויות בפועל · ${totals.reconciled}/${totals.count} עם עלויות שהוזנו`
              : "הרווח האמיתי מכל לקוח — הזן עלויות בפועל"
          }
          aside={
            quotes && totals.count > 0 ? (
              <div style={{ display: "flex", gap: 10 }}>
                <LuxStat value={totals.count} label="עסקאות" />
                <LuxStat value={ils(totals.actualProfit)} label="רווח בפועל סה״כ" tone="success" />
                {Math.abs(totals.variance) >= 1 && (
                  <LuxStat
                    value={`${totals.variance >= 0 ? "+" : "−"}${ils(Math.abs(totals.variance))}`}
                    label={totals.variance >= 0 ? "מעל התכנון" : "מתחת לתכנון"}
                    tone={totals.variance >= 0 ? "success" : "alert"}
                  />
                )}
              </div>
            ) : null
          }
        >
          הצעות <LuxAccent>שנסגרו</LuxAccent>.
        </LuxTitle>

        {error && (
          <div style={{ padding: 14, borderRadius: 8, background: "rgba(232,180,180,0.1)", color: "#e8b4b4", fontSize: 13 }}>
            שגיאה: {error}
          </div>
        )}

        {!quotes && !error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--lux-muted)", fontSize: 14 }}>
            <Loader2 className="size-4 animate-spin" /> טוען…
          </div>
        )}

        {quotes && quotes.length === 0 && (
          <div style={{ padding: 20, color: "var(--lux-muted)", fontSize: 14, textAlign: "center" }}>
            אין עדיין עסקאות שנסגרו (WON) עם הצעה סופית.
          </div>
        )}

        {quotes && quotes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {quotes.map((q) =>
              q.finalPricing ? (
                <ClosedQuoteCard key={q.id} quote={q} apiToken={apiToken} onSaved={load} />
              ) : null
            )}
          </div>
        )}
      </div>
    </LuxShell>
  );
}

function ClosedQuoteCard({
  quote,
  apiToken,
  onSaved,
}: {
  quote: ClosedQuote;
  apiToken: string;
  onSaved: () => void;
}) {
  const fp = quote.finalPricing!;
  const ac = quote.actualCosts;

  // Local draft — default to the planned values so deltas start at 0.
  const [factory, setFactory] = useState(String(ac?.factoryTotalIls ?? Math.round(fp.totalCost ?? 0)));
  const [shipping, setShipping] = useState(String(ac?.shippingTotalIls ?? Math.round(fp.totalShipping ?? 0)));
  const [other, setOther] = useState<{ label: string; amount: string }[]>(
    (ac?.otherCosts ?? []).map((c) => ({ label: c.label, amount: String(c.amountIls) }))
  );
  const [note, setNote] = useState(ac?.note ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const draftActuals: QuoteActualCosts = useMemo(() => {
    const f = parseFloat(factory), s = parseFloat(shipping);
    return {
      factoryTotalIls: Number.isFinite(f) ? f : undefined,
      shippingTotalIls: Number.isFinite(s) ? s : undefined,
      otherCosts: other
        .map((c) => ({ label: c.label, amountIls: parseFloat(c.amount) }))
        .filter((c) => Number.isFinite(c.amountIls) && c.amountIls !== 0),
      note: note.trim() || undefined,
    };
  }, [factory, shipping, other, note]);

  const r = useMemo(() => reconcile(fp, draftActuals), [fp, draftActuals]);

  const spec =
    (quote.productSpec?.["productName"] as string) ||
    (quote.productSpec?.["description"] as string) ||
    "";

  async function save() {
    setSaveState("saving");
    try {
      const res = await fetch(widgetUrl(`/api/widget/factory/actuals/${quote.id}`, apiToken), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftActuals),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "save failed");
      setSaveState("saved");
      onSaved();
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  const varPos = r.variance >= 0;
  const varColor = Math.abs(r.variance) < 1 ? "var(--lux-muted)" : varPos ? "var(--lux-success,#a8c0a0)" : "#e8b4b4";

  return (
    <section style={{ background: "var(--lux-card)", borderRadius: 10, border: "1px solid var(--lux-line)", overflow: "hidden" }}>
      {/* Header: name + spec (right) · ACTUAL PROFIT hero (left) */}
      <div
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "16px 20px", background: "var(--lux-inset)", borderBottom: "1px solid var(--lux-line)",
        }}
      >
        <div>
          <div className="lux-sans" style={{ fontSize: 16, fontWeight: 400, color: "var(--lux-ink)" }}>
            {quote.customerName || "לקוח"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginTop: 3 }}>
            {[spec, quote.quotationNo ? `#${quote.quotationNo}` : null, `נסגר ${fmtDate(quote.sentToCustomerAt ?? quote.updatedAt)}`]
              .filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 10.5, color: "var(--lux-muted)", letterSpacing: "0.12em" }}>רווח בפועל מהלקוח</div>
          <div className="lux-serif tabular-nums" style={{ fontSize: 30, fontWeight: 300, color: varColor, lineHeight: 1.1 }}>
            {ils(r.actualProfit)}
          </div>
          <div style={{ fontSize: 11, color: "var(--lux-muted)", marginTop: 1 }}>
            מחיר ללקוח {ils(r.revenue)} · מתוכנן היה {ils(r.plannedProfit)}
            {Math.abs(r.variance) >= 1 && (
              <span style={{ color: varColor }}> · {varPos ? "+" : "−"}{ils(Math.abs(r.variance))}</span>
            )}
          </div>
        </div>
      </div>

      {/* Body: tidy planned↔actual table */}
      <div style={{ padding: "16px 20px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(90px,1fr) 96px 150px minmax(120px,1fr)",
            columnGap: 14, rowGap: 12, alignItems: "center",
          }}
        >
          {/* column headers */}
          <div />
          <div className="lux-label" style={{ color: "var(--lux-muted)", letterSpacing: "0.12em", textAlign: "right" }}>מתוכנן</div>
          <div className="lux-label" style={{ color: "var(--lux-champagne)", letterSpacing: "0.12em" }}>בפועל</div>
          <div />

          <CostRow label="עלות מפעל" planned={r.plannedFactory} value={factory} onChange={setFactory} delta={r.factoryDelta} />
          <CostRow label="שילוח (ממוצע ללקוח)" planned={r.plannedShipping} value={shipping} onChange={setShipping} delta={r.shippingDelta} />

          {/* other cost lines span the row */}
          {other.map((c, i) => (
            <div key={i} style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={c.label}
                onChange={(e) => setOther((prev) => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                placeholder="שם ההוצאה (מכס / שיווק / תיקון…)"
                style={inputStyle({ flex: 1 })}
              />
              <div style={{ display: "flex", alignItems: "center", ...inputStyle({ width: 120, padding: "7px 10px" }) }}>
                <span style={{ fontSize: 12, color: "var(--lux-muted)" }}>₪</span>
                <input
                  type="number" value={c.amount}
                  onChange={(e) => setOther((prev) => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                  style={{ width: "100%", background: "transparent", border: 0, textAlign: "right", color: "var(--lux-ink)", fontSize: 14, outline: "none" }}
                />
              </div>
              <button type="button" onClick={() => setOther((prev) => prev.filter((_, j) => j !== i))} style={{ color: "var(--lux-muted)", padding: 4 }} aria-label="הסר">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}

          <div style={{ gridColumn: "1 / -1" }}>
            <button
              type="button"
              onClick={() => setOther((prev) => [...prev, { label: "", amount: "" }])}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--lux-cool)" }}
            >
              <Plus className="size-3.5" /> הוסף עלות אחרת
            </button>
          </div>
        </div>

        {/* Note */}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="הערה — למשל: המפעל העלה מחיר, אוחד עם הזמנה אחרת…"
          rows={2}
          style={{ ...inputStyle({ width: "100%" }), marginTop: 14, resize: "vertical" }}
        />

        {/* Save */}
        <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 14 }}>
          <button
            type="button"
            onClick={save}
            disabled={saveState === "saving"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px",
              borderRadius: 6, background: "var(--lux-navy-to, #2b3a55)", color: "#e8eefc",
              fontSize: 13, fontWeight: 500, opacity: saveState === "saving" ? 0.6 : 1,
            }}
          >
            {saveState === "saving" ? <Loader2 className="size-4 animate-spin" /> :
             saveState === "saved" ? <Check className="size-4" /> : <Save className="size-4" />}
            {saveState === "saved" ? "נשמר ✓" : saveState === "error" ? "שגיאה — נסה שוב" : "שמור עלויות בפועל"}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------- small presentational bits ---------- */

function inputStyle(extra: React.CSSProperties): React.CSSProperties {
  return {
    background: "var(--lux-inset)",
    border: "1px solid var(--lux-line)",
    borderRadius: 4,
    padding: "8px 11px",
    fontSize: 14,
    color: "var(--lux-ink)",
    outline: "none",
    ...extra,
  };
}

/** One planned↔actual row inside the card's grid (4 cells). */
function CostRow({
  label, planned, value, onChange, delta,
}: {
  label: string; planned: number; value: string; onChange: (v: string) => void; delta: number;
}) {
  const has = Math.abs(delta) > 0.5;
  const deltaColor = has ? (delta > 0 ? "#e8b4b4" : "var(--lux-success,#a8c0a0)") : "var(--lux-muted)";
  return (
    <>
      <div style={{ fontSize: 13, color: "var(--lux-muted)" }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 13.5, color: "var(--lux-ink)", textAlign: "right" }}>{ils(planned)}</div>
      <div style={{ display: "flex", alignItems: "center", ...inputStyle({ padding: "7px 10px" }) }}>
        <span style={{ fontSize: 12, color: "var(--lux-muted)" }}>₪</span>
        <input
          type="number" value={value} onChange={(e) => onChange(e.target.value)}
          style={{ width: "100%", background: "transparent", border: 0, textAlign: "right", color: "var(--lux-ink)", fontSize: 14, outline: "none" }}
        />
      </div>
      <div style={{ fontSize: 11, color: deltaColor }}>
        {has ? (delta > 0 ? `יקר ב${ils(Math.abs(delta))}` : `זול ב${ils(Math.abs(delta))}`) : "כמתוכנן"}
      </div>
    </>
  );
}
