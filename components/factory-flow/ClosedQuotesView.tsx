"use client";

/**
 * "הצעות שנסגרו" — post-close reconciliation for WON deals.
 *
 * The customer price is locked at close, so any gap between what Eli PLANNED
 * (finalPricing) and what actually happened lands on his margin. Two things
 * drift: the factory sometimes raises the price after close, and real shipping
 * differs from the AVERAGED shipping charged to the customer. Here he enters the
 * real factory + shipping (+ free-form other) costs; each card shows
 * planned-vs-actual profit, and a header rolls it up so he can tell whether his
 * pricing/averaging is calibrated. Boss-only.
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
      <LuxTitle
        overline="— Closed deals"
        subtitle="עסקאות שנסגרו (WON) — הזן את העלויות בפועל וראה רווח מתוכנן מול בפועל"
        aside={
          quotes ? (
            <div style={{ display: "flex", gap: 10 }}>
              <LuxStat value={totals.count} label="עסקאות" />
              <LuxStat value={`${totals.reconciled}/${totals.count}`} label="הוזנו עלויות" />
              <LuxStat
                value={`${totals.variance >= 0 ? "+" : "−"}${ils(Math.abs(totals.variance))}`}
                label={totals.variance >= 0 ? "רווח מעבר לתכנון" : "נספג מהרווח"}
                tone={totals.variance >= 0 ? "success" : "alert"}
              />
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {quotes.map((q) =>
            q.finalPricing ? (
              <ClosedQuoteCard key={q.id} quote={q} apiToken={apiToken} onSaved={load} />
            ) : null
          )}
        </div>
      )}
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

  const title =
    (quote.productSpec?.["productName"] as string) ||
    (quote.productSpec?.["description"] as string) ||
    quote.quotationNo || quote.id.slice(-6);

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

  return (
    <section
      style={{
        background: "var(--lux-card)",
        borderRadius: 10,
        border: "1px solid var(--lux-line)",
        padding: "20px 22px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div className="lux-sans" style={{ fontSize: 17, fontWeight: 400, color: "var(--lux-ink)" }}>
            {quote.customerName || "לקוח"}
          </div>
          <div style={{ fontSize: 12, color: "var(--lux-muted)", marginTop: 3 }}>
            {title} · {quote.quotationNo ? `#${quote.quotationNo} · ` : ""}נסגר {fmtDate(quote.sentToCustomerAt ?? quote.updatedAt)}
          </div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 11, color: "var(--lux-muted)", letterSpacing: "0.1em" }}>מחיר ללקוח (נעול)</div>
          <div className="lux-serif tabular-nums" style={{ fontSize: 24, fontWeight: 300, color: "var(--lux-cool)" }}>
            {ils(r.revenue)}
          </div>
        </div>
      </div>

      {/* Two columns: planned vs actual entry */}
      <div className="cq-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <style>{`@media (max-width:640px){.cq-grid{grid-template-columns:1fr !important;}}`}</style>

        {/* Planned (read-only) */}
        <div>
          <div className="lux-label" style={{ color: "var(--lux-muted)", letterSpacing: "0.16em", marginBottom: 10 }}>מתוכנן (בהצעה)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <PlanRow label="עלות מפעל" value={ils(r.plannedFactory)} />
            <PlanRow label="שילוח (ממוצע ללקוח)" value={ils(r.plannedShipping)} />
            <PlanRow label="רווח מתוכנן" value={ils(r.plannedProfit)} strong cool />
          </div>
        </div>

        {/* Actual (editable) */}
        <div>
          <div className="lux-label" style={{ color: "var(--lux-champagne)", letterSpacing: "0.16em", marginBottom: 10 }}>בפועל (מה שקרה)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <MoneyInput label="עלות מפעל בפועל" value={factory} onChange={setFactory} planned={r.plannedFactory} delta={r.factoryDelta} />
            <MoneyInput label="שילוח בפועל" value={shipping} onChange={setShipping} planned={r.plannedShipping} delta={r.shippingDelta} />

            {other.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={c.label}
                  onChange={(e) => setOther((prev) => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                  placeholder="הוצאה (למשל מכס)"
                  style={inputStyle({ flex: 1 })}
                />
                <input
                  type="number"
                  value={c.amount}
                  onChange={(e) => setOther((prev) => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                  placeholder="₪"
                  style={inputStyle({ width: 90, textAlign: "right" })}
                />
                <button type="button" onClick={() => setOther((prev) => prev.filter((_, j) => j !== i))} style={{ color: "var(--lux-muted)", padding: 4 }} aria-label="הסר">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setOther((prev) => [...prev, { label: "", amount: "" }])}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--lux-cool)", alignSelf: "flex-start" }}
            >
              <Plus className="size-3.5" /> הוסף עלות אחרת
            </button>
          </div>
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

      {/* Reconciliation bar */}
      <div
        style={{
          marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--lux-line)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          <ReconStat label="רווח בפועל" value={ils(r.actualProfit)} tone={r.actualProfit >= r.plannedProfit ? "success" : "warn"} big />
          <ReconStat
            label={varPos ? "מעבר לתכנון" : "נספג מהרווח"}
            value={`${varPos ? "+" : "−"}${ils(Math.abs(r.variance))}`}
            tone={varPos ? "success" : "alert"}
          />
          {r.otherTotal > 0 && <ReconStat label="עלויות אחרות" value={ils(r.otherTotal)} tone="muted" />}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saveState === "saving"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px",
            borderRadius: 6, background: "var(--lux-navy-to, #2b3a55)", color: "#e8eefc",
            fontSize: 13, fontWeight: 500, opacity: saveState === "saving" ? 0.6 : 1,
          }}
        >
          {saveState === "saving" ? <Loader2 className="size-4 animate-spin" /> :
           saveState === "saved" ? <Check className="size-4" /> : <Save className="size-4" />}
          {saveState === "saved" ? "נשמר ✓" : saveState === "error" ? "שגיאה — נסה שוב" : "שמור עלויות בפועל"}
        </button>
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

function PlanRow({ label, value, strong, cool }: { label: string; value: string; strong?: boolean; cool?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "var(--lux-muted)" }}>{label}</span>
      <span className="tabular-nums" style={{ color: cool ? "var(--lux-cool)" : "var(--lux-ink)", fontWeight: strong ? 500 : 400 }}>{value}</span>
    </div>
  );
}

function MoneyInput({
  label, value, onChange, planned, delta,
}: {
  label: string; value: string; onChange: (v: string) => void; planned: number; delta: number;
}) {
  const has = Math.abs(delta) > 0.5;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--lux-muted)", flex: 1 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", ...inputStyle({ width: 120, padding: "6px 10px" }) }}>
          <span style={{ fontSize: 12, color: "var(--lux-muted)" }}>₪</span>
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: "100%", background: "transparent", border: 0, textAlign: "right", color: "var(--lux-ink)", fontSize: 14, outline: "none" }}
          />
        </div>
      </div>
      <span style={{ fontSize: 10.5, color: has ? (delta > 0 ? "#e8b4b4" : "var(--lux-success,#a8c0a0)") : "var(--lux-muted)", textAlign: "left" }}>
        {has ? `${delta > 0 ? "יקר ב" : "זול ב"}${ils(Math.abs(delta))} מהתכנון (${ils(planned)})` : `כמתוכנן (${ils(planned)})`}
      </span>
    </div>
  );
}

function ReconStat({ label, value, tone = "muted", big }: { label: string; value: string; tone?: "success" | "alert" | "warn" | "muted"; big?: boolean }) {
  const color =
    tone === "success" ? "var(--lux-success,#a8c0a0)" :
    tone === "alert" ? "#e8b4b4" :
    tone === "warn" ? "var(--lux-champagne)" : "var(--lux-muted)";
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--lux-muted)", letterSpacing: "0.1em" }}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: big ? 22 : 16, fontWeight: 400, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}
