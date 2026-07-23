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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Check, Save, Download, Upload, X, Paperclip, Circle, CheckCircle2 } from "lucide-react";
import { LuxShell, LuxTitle, LuxAccent, LuxStat } from "@/components/widget-ui/lux";
import { widgetUrl } from "./widget-url";
import type { DealMilestones, FactoryPricingResult, QuoteActualCosts, ZohoDocRef } from "@/lib/factory/types";
import type { AccuracyStats, GapStat } from "@/lib/factory/server/accuracy";
import type { ZohoMatchResult, ZohoSuggestion } from "@/lib/zoho/match";

interface ClosedQuote {
  id: string;
  leadSid: string;
  quotationNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  productSpec: Record<string, unknown> | null;
  finalPricing: FactoryPricingResult | null;
  actualCosts: QuoteActualCosts | null;
  dealMilestones: DealMilestones | null;
  sentToCustomerAt: string | null;
  updatedAt: string;
  products?: DealProduct[];
  isCombined?: boolean;
  fromEstimate?: boolean;
}

interface DealProduct {
  id: string;
  quotationNo: string | null;
  productSpec: Record<string, unknown> | null;
  finalPricing: FactoryPricingResult | null;
}

interface ZohoUnmatchedDoc {
  type: "invoice" | "bill" | "expense";
  id: string;
  number: string;
  date: string;
  party: string;
  total: number;
  currencyCode: string;
  totalIls: number | null;
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
  const plannedRevenue = fp.totalSellingPrice ?? 0;
  const revenue = ac?.actualRevenueIls ?? plannedRevenue;
  const actualFactory = ac?.factoryTotalIls ?? plannedFactory;
  const actualShipping = ac?.shippingTotalIls ?? plannedShipping;
  const otherTotal = (ac?.otherCosts ?? []).reduce((s, c) => s + (Number(c.amountIls) || 0), 0);
  const factoryDelta = actualFactory - plannedFactory;
  const shippingDelta = actualShipping - plannedShipping;
  const revenueDelta = revenue - plannedRevenue;
  // Planned profit, corrected by what really moved on BOTH sides.
  const actualProfit = plannedProfit + revenueDelta - factoryDelta - shippingDelta - otherTotal;
  const variance = actualProfit - plannedProfit;
  return {
    revenue, plannedRevenue, revenueDelta,
    plannedFactory, plannedShipping, plannedProfit,
    actualFactory, actualShipping, otherTotal, factoryDelta, shippingDelta,
    actualProfit, variance,
  };
}

export function ClosedQuotesView({ apiToken }: { apiToken: string }) {
  const [quotes, setQuotes] = useState<ClosedQuote[] | null>(null);
  const [stats, setStats] = useState<AccuracyStats | null>(null);
  const [unmatched, setUnmatched] = useState<ZohoUnmatchedDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(widgetUrl("/api/widget/factory/closed", apiToken), { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
      setQuotes(j.quotes as ClosedQuote[]);
      setStats((j.stats ?? null) as AccuracyStats | null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiToken]);

  useEffect(() => { load(); }, [load]);

  // Deep-link from the quotes tab: ?focus=<quote id or lead sid> scrolls to the card.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!quotes || focusedOnce.current) return;
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (!focus) return;
    focusedOnce.current = true;
    setTimeout(() => {
      const el =
        document.getElementById(`deal-${focus}`) ??
        document.querySelector(`[data-lead="${CSS.escape(focus)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
  }, [quotes]);

  // Zoho reminder panel — soft: unconfigured/down Zoho just hides it.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(widgetUrl("/api/widget/zoho/unmatched", apiToken), { cache: "no-store" });
        const j = await res.json();
        if (alive && j.ok && j.configured) setUnmatched(j.unmatched as ZohoUnmatchedDoc[]);
      } catch { /* hidden */ }
    })();
    return () => { alive = false; };
  }, [apiToken]);

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
          overline="— Deals"
          subtitle={
            quotes
              ? `ציר העסקה + הרווח האמיתי מכל לקוח · ${totals.reconciled}/${totals.count} עם עלויות שהוזנו`
              : "ציר העסקה + הרווח האמיתי מכל לקוח"
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
          תיקי <LuxAccent>עסקאות</LuxAccent>.
        </LuxTitle>

        {stats && <AccuracyStrip stats={stats} />}

        {unmatched && unmatched.length > 0 && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "10px 14px", marginBottom: 14, borderRadius: 8,
              background: "rgba(214,178,106,0.08)", border: "1px solid rgba(214,178,106,0.3)",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--lux-champagne, #d6b26a)" }}>
              {unmatched.length} מסמכי Zoho מ-90 הימים האחרונים עוד לא שויכו לעסקה
            </span>
            <span style={{ fontSize: 11.5, color: "var(--lux-muted)" }}>
              {unmatched.slice(0, 3).map((d) =>
                `${d.party || d.number}${d.totalIls != null ? ` ₪${Math.round(d.totalIls).toLocaleString("he-IL")}` : ""}`
              ).join(" · ")}
              {unmatched.length > 3 ? " · …" : ""}
            </span>
            <span style={{ fontSize: 11, color: "var(--lux-muted)", marginInlineStart: "auto" }}>
              שיוך: פתח עסקה למטה → «משוך מ-Zoho»
            </span>
          </div>
        )}

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
  const [milestones, setMilestones] = useState<DealMilestones>(quote.dealMilestones ?? {});

  // Local draft — default to the planned values so deltas start at 0.
  const [factory, setFactory] = useState(String(ac?.factoryTotalIls ?? Math.round(fp.totalCost ?? 0)));
  const [shipping, setShipping] = useState(String(ac?.shippingTotalIls ?? Math.round(fp.totalShipping ?? 0)));
  const [revenue, setRevenue] = useState(String(ac?.actualRevenueIls ?? Math.round(fp.totalSellingPrice ?? 0)));
  const [other, setOther] = useState<{ label: string; amount: string }[]>(
    (ac?.otherCosts ?? []).map((c) => ({ label: c.label, amount: String(c.amountIls) }))
  );
  const [zohoRefs, setZohoRefs] = useState<ZohoDocRef[]>(ac?.zohoRefs ?? []);
  const [note, setNote] = useState(ac?.note ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [zohoOpen, setZohoOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  /** "הסר מעסקאות" — reversible: clears closed stamp (+ unbinds a combined
   *  group). The quote stays in "הצעות מפעל" and can be re-closed. */
  async function handleRemove() {
    const n = quote.products?.length ?? 1;
    const what = quote.isCombined && n > 1 ? `עסקה משולבת (${n} מוצרים)` : "העסקה";
    if (!confirm(`להסיר את ${what} של ${quote.customerName || "הלקוח"} מלשונית עסקאות?\n\nההצעה נשארת ב«הצעות מפעל» וניתן לסגור אותה שוב.`)) return;
    setRemoving(true);
    try {
      const res = await fetch(widgetUrl(`/api/widget/factory/remove-deal/${quote.id}`, apiToken), {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { alert(`שגיאה: ${j?.error ?? res.status}`); return; }
      if (j.stillWon) {
        alert("הוסר מהסגירה, אבל העסקה עדיין מוצגת כי הליד מסומן «נסגר/WON» ב-GHL.\nכדי להעלים אותה לגמרי — העבר את הליד מ-WON לשלב אחר.");
      }
      onSaved();
    } finally {
      setRemoving(false);
    }
  }

  const draftActuals: QuoteActualCosts = useMemo(() => {
    const f = parseFloat(factory), s = parseFloat(shipping), rv = parseFloat(revenue);
    return {
      factoryTotalIls: Number.isFinite(f) ? f : undefined,
      shippingTotalIls: Number.isFinite(s) ? s : undefined,
      actualRevenueIls: Number.isFinite(rv) ? rv : undefined,
      otherCosts: other
        .map((c) => ({ label: c.label, amountIls: parseFloat(c.amount) }))
        .filter((c) => Number.isFinite(c.amountIls) && c.amountIls !== 0),
      zohoRefs: zohoRefs.length > 0 ? zohoRefs : undefined,
      note: note.trim() || undefined,
    };
  }, [factory, shipping, revenue, other, zohoRefs, note]);

  /** Zoho picker → fill the draft inputs (Eli still reviews + saves). */
  function applyZoho(sel: {
    revenueIls?: number; factoryIls?: number; shippingIls?: number;
    otherLines?: { label: string; amountIls: number }[];
    refs: ZohoDocRef[];
  }) {
    if (sel.revenueIls !== undefined) setRevenue(String(Math.round(sel.revenueIls)));
    if (sel.factoryIls !== undefined) setFactory(String(Math.round(sel.factoryIls)));
    if (sel.shippingIls !== undefined) setShipping(String(Math.round(sel.shippingIls)));
    if (sel.otherLines && sel.otherLines.length > 0) {
      setOther((prev) => {
        const existing = new Set(prev.map((c) => c.label));
        const added = sel.otherLines!
          .filter((l) => !existing.has(l.label))
          .map((l) => ({ label: l.label, amount: String(Math.round(l.amountIls)) }));
        return [...prev, ...added];
      });
    }
    setZohoRefs(sel.refs);
    setZohoOpen(false);
  }

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
    <section
      id={`deal-${quote.id}`}
      data-lead={quote.leadSid}
      style={{ background: "var(--lux-card)", borderRadius: 10, border: "1px solid var(--lux-line)", overflow: "hidden" }}
    >
      {/* Header: name + spec + stage chips (right) · ACTUAL PROFIT hero (left) */}
      <div
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "16px 20px", background: "var(--lux-inset)", borderBottom: "1px solid var(--lux-line)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="lux-sans" style={{ fontSize: 16, fontWeight: 400, color: "var(--lux-ink)", display: "flex", alignItems: "center", gap: 8 }}>
            {quote.customerName || "לקוח"}
            {quote.isCombined && (
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "rgba(214,178,106,0.12)", border: "1px solid rgba(214,178,106,0.35)", color: "var(--lux-champagne,#d6b26a)" }}>
                עסקה משולבת · {quote.products?.length ?? 1} מוצרים
              </span>
            )}
            {quote.fromEstimate && (
              <span
                title="נסגר לפי מחיר האומדן — עדיין לא אושר מול המפעל"
                style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "rgba(120,150,200,0.12)", border: "1px solid rgba(120,150,200,0.35)", color: "var(--lux-cool,#9db4d6)" }}
              >
                לפי אומדן
              </span>
            )}
          </div>
          {quote.isCombined && quote.products && quote.products.length > 1 ? (
            <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
              {quote.products.map((p, i) => {
                const ps = (p.productSpec ?? {}) as Record<string, unknown>;
                const label = (ps.productName as string) || (ps.description as string) ||
                  [ps.heightCm && `H${ps.heightCm}`, ps.depthCm && `D${ps.depthCm}`, ps.widthCm && `W${ps.widthCm}`].filter(Boolean).join("×") || "מוצר";
                return (
                  <span key={p.id}>
                    {i + 1}. {label}
                    {ps.quantity ? ` · ${Number(ps.quantity).toLocaleString("he-IL")} יח׳` : ""}
                    {p.finalPricing ? ` · ${ils(p.finalPricing.totalSellingPrice)}` : ""}
                  </span>
                );
              })}
              <span style={{ marginTop: 2 }}>נסגר {fmtDate(quote.sentToCustomerAt ?? quote.updatedAt)}</span>
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginTop: 3 }}>
              {[spec, quote.quotationNo ? `#${quote.quotationNo}` : null, `נסגר ${fmtDate(quote.sentToCustomerAt ?? quote.updatedAt)}`]
                .filter(Boolean).join(" · ")}
            </div>
          )}
          <StageChips quote={quote} m={milestones} />
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
          <button
            onClick={handleRemove}
            disabled={removing}
            title="הסר מלשונית עסקאות — הפיך; ההצעה נשארת ב«הצעות מפעל»"
            style={{
              marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: 11, color: "var(--lux-muted)", background: "transparent",
              border: "1px solid var(--lux-line)", borderRadius: 6, padding: "3px 9px",
              cursor: removing ? "default" : "pointer", opacity: removing ? 0.5 : 1,
            }}
          >
            {removing ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
            הסר מעסקאות
          </button>
        </div>
      </div>

      {/* Deal timeline — the post-WON journey with files per stage */}
      <DealTimeline
        quote={quote}
        milestones={milestones}
        onChange={setMilestones}
        apiToken={apiToken}
        onCreateInvoice={() => setInvoiceOpen(true)}
      />

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

          <CostRow label="הכנסה מהלקוח" planned={r.plannedRevenue} value={revenue} onChange={setRevenue} delta={r.revenueDelta} kind="revenue" />
          <CostRow label="עלות מפעל" planned={r.plannedFactory} value={factory} onChange={setFactory} delta={r.factoryDelta} />
          <CostRow label="שילוח (ממוצע ללקוח)" planned={r.plannedShipping} value={shipping} onChange={setShipping} delta={r.shippingDelta} />

          {/* Per-CBM view — "כמה חייבתי את הלקוח לקוב מול כמה שילמתי לקוב".
              Volume basis = the factory's CBM (ground truth per Eli). */}
          {typeof fp.totalCbm === "number" && fp.totalCbm > 0.001 && (
            <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--lux-muted)", marginTop: -4 }}>
              לפי נפח המפעל {fp.totalCbm.toFixed(2)} CBM — חויב ללקוח{" "}
              <span className="tabular-nums" style={{ color: "var(--lux-ink)" }}>
                ₪{Math.round(r.plannedShipping / fp.totalCbm).toLocaleString("he-IL")}/CBM
              </span>
              {" · "}שולם בפועל{" "}
              <span
                className="tabular-nums"
                style={{ color: r.actualShipping > r.plannedShipping ? "#e8b4b4" : "var(--lux-success,#a8c0a0)" }}
              >
                ₪{Math.round(r.actualShipping / fp.totalCbm).toLocaleString("he-IL")}/CBM
              </span>
            </div>
          )}

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

        {/* Zoho link-backs */}
        {zohoRefs.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
            {zohoRefs.map((z) => (
              <span
                key={`${z.type}:${z.id}`}
                style={{
                  fontSize: 10.5, padding: "3px 9px", borderRadius: 99,
                  background: "rgba(120,150,200,0.1)", border: "1px solid rgba(120,150,200,0.25)",
                  color: "var(--lux-cool, #9db4d6)",
                }}
                title={z.party ?? ""}
              >
                Zoho {z.type === "invoice" ? "חשבונית" : z.type === "bill" ? "ספק" : "הוצאה"} {z.number || z.id.slice(-6)}
                {z.amountIls != null ? ` · ${ils(z.amountIls)}` : ""}
              </span>
            ))}
          </div>
        )}

        {/* Save + Zoho pull */}
        <div style={{ display: "flex", justifyContent: "flex-start", gap: 10, marginTop: 14 }}>
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
          <button
            type="button"
            onClick={() => setZohoOpen(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px",
              borderRadius: 6, background: "transparent", border: "1px solid var(--lux-line)",
              color: "var(--lux-ink)", fontSize: 13,
            }}
          >
            <Download className="size-4" /> משוך מ-Zoho
          </button>
          <button
            type="button"
            onClick={() => setExpenseOpen(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px",
              borderRadius: 6, background: "transparent", border: "1px solid var(--lux-line)",
              color: "var(--lux-ink)", fontSize: 13,
            }}
          >
            <Upload className="size-4" /> רשום הוצאה ב-Zoho
          </button>
        </div>
      </div>

      {zohoOpen && (
        <ZohoMatchModal
          dealId={quote.id}
          apiToken={apiToken}
          onApply={applyZoho}
          onClose={() => setZohoOpen(false)}
        />
      )}
      {invoiceOpen && (
        <ZohoInvoiceModal
          quote={quote}
          apiToken={apiToken}
          onDone={() => { setInvoiceOpen(false); onSaved(); }}
          onClose={() => setInvoiceOpen(false)}
        />
      )}
      {expenseOpen && (
        <ZohoExpenseModal
          quote={quote}
          apiToken={apiToken}
          onDone={() => { setExpenseOpen(false); onSaved(); }}
          onClose={() => setExpenseOpen(false)}
        />
      )}
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

/** One planned↔actual row inside the card's grid (4 cells).
 *  kind="cost" (default): actual ABOVE planned is bad (red).
 *  kind="revenue": actual ABOVE planned is good (green). */
function CostRow({
  label, planned, value, onChange, delta, kind = "cost",
}: {
  label: string; planned: number; value: string; onChange: (v: string) => void; delta: number;
  kind?: "cost" | "revenue";
}) {
  const has = Math.abs(delta) > 0.5;
  const good = kind === "revenue" ? delta > 0 : delta < 0;
  const deltaColor = has ? (good ? "var(--lux-success,#a8c0a0)" : "#e8b4b4") : "var(--lux-muted)";
  const deltaText = !has
    ? "כמתוכנן"
    : kind === "revenue"
      ? (delta > 0 ? `יותר ב${ils(Math.abs(delta))}` : `פחות ב${ils(Math.abs(delta))}`)
      : (delta > 0 ? `יקר ב${ils(Math.abs(delta))}` : `זול ב${ils(Math.abs(delta))}`);
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
      <div style={{ fontSize: 11, color: deltaColor }}>{deltaText}</div>
    </>
  );
}

/* ---------- deal timeline ("תיק עסקה") ---------- */

type StampKey =
  | "mockupSentAt" | "invoiceSentAt" | "layoutReceivedAt" | "layoutApprovedAt"
  | "productionStartedAt" | "shippedAt" | "deliveredAt";
type FileKey = "mockupFiles" | "invoiceFiles" | "layoutFiles";

const TIMELINE: {
  key: StampKey;
  label: string;
  chip: string;
  fileStage?: "mockup" | "invoice" | "layout";
  fileKey?: FileKey;
}[] = [
  { key: "mockupSentAt", label: "הדמיה נשלחה ללקוח", chip: "הדמיה", fileStage: "mockup", fileKey: "mockupFiles" },
  { key: "invoiceSentAt", label: "חשבונית הונפקה", chip: "חשבונית", fileStage: "invoice", fileKey: "invoiceFiles" },
  { key: "layoutReceivedAt", label: "פריסה התקבלה מהמפעל", chip: "פריסה", fileStage: "layout", fileKey: "layoutFiles" },
  { key: "layoutApprovedAt", label: "פריסה אושרה", chip: "אישור פריסה" },
  { key: "productionStartedAt", label: "ייצור התחיל", chip: "ייצור" },
  { key: "shippedAt", label: "יצא למשלוח", chip: "משלוח" },
  { key: "deliveredAt", label: "הגיע ללקוח", chip: "הגיע" },
];

/** Compact done/current/pending pills under the customer name. */
function StageChips({ quote, m }: { quote: ClosedQuote; m: DealMilestones }) {
  const stages: { chip: string; done: boolean }[] = [
    { chip: "הצעה", done: !!quote.sentToCustomerAt },
    { chip: "זכייה", done: true },
    ...TIMELINE.filter((s) => s.key !== "layoutApprovedAt").map((s) => ({ chip: s.chip, done: !!m[s.key] })),
  ];
  const firstPending = stages.findIndex((s) => !s.done);
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
      {stages.map((s, i) => {
        const current = i === firstPending;
        return (
          <span
            key={s.chip}
            style={{
              fontSize: 10, padding: "2px 9px", borderRadius: 99, whiteSpace: "nowrap",
              background: s.done ? "rgba(168,192,160,0.12)" : current ? "rgba(214,178,106,0.12)" : "var(--lux-inset)",
              border: `1px solid ${s.done ? "rgba(168,192,160,0.35)" : current ? "rgba(214,178,106,0.4)" : "var(--lux-line)"}`,
              color: s.done ? "var(--lux-success,#a8c0a0)" : current ? "var(--lux-champagne,#d6b26a)" : "var(--lux-muted)",
            }}
          >
            {s.done ? "✓ " : ""}{s.chip}
          </span>
        );
      })}
    </div>
  );
}

function DealTimeline({
  quote, milestones, onChange, apiToken, onCreateInvoice,
}: {
  quote: ClosedQuote;
  milestones: DealMilestones;
  onChange: (m: DealMilestones) => void;
  apiToken: string;
  onCreateInvoice: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const doneCount = TIMELINE.filter((s) => !!milestones[s.key]).length;

  async function putPatch(patch: Partial<DealMilestones>, busy: string) {
    setBusyKey(busy);
    setErr(null);
    try {
      const res = await fetch(widgetUrl(`/api/widget/factory/milestones/${quote.id}`, apiToken), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "save failed");
      onChange(j.milestones as DealMilestones);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadFile(stage: "mockup" | "invoice" | "layout", file: File) {
    setBusyKey(`up-${stage}`);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        widgetUrl(`/api/widget/factory/deal-upload/${quote.id}`, apiToken) + `&stage=${stage}`,
        { method: "POST", body: fd }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.message ?? j.error ?? "upload failed");
      onChange(j.milestones as DealMilestones);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div style={{ borderBottom: "1px solid var(--lux-line)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "10px 20px", fontSize: 12.5, color: "var(--lux-muted)", textAlign: "right",
        }}
      >
        <span style={{ color: "var(--lux-champagne,#d6b26a)" }}>{open ? "▾" : "◂"}</span>
        ציר העסקה — {doneCount}/{TIMELINE.length} שלבים הושלמו
        <span style={{ marginInlineStart: "auto", fontSize: 11 }}>{open ? "סגור" : "פתח"}</span>
      </button>

      {open && (
        <div style={{ padding: "4px 20px 14px" }}>
          {/* auto stage — quote sent */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--lux-line)" }}>
            {quote.sentToCustomerAt
              ? <CheckCircle2 className="size-4" style={{ color: "var(--lux-success,#a8c0a0)" }} />
              : <Circle className="size-4" style={{ color: "var(--lux-muted)" }} />}
            <span style={{ fontSize: 13, color: "var(--lux-ink)" }}>הצעה נשלחה ללקוח</span>
            <span style={{ fontSize: 11.5, color: "var(--lux-muted)" }}>{fmtDate(quote.sentToCustomerAt)}</span>
            <span style={{ marginInlineStart: "auto", fontSize: 11, color: "var(--lux-muted)" }}>אוטומטי</span>
          </div>

          {TIMELINE.map((s) => {
            const stamped = milestones[s.key];
            const files = s.fileKey ? milestones[s.fileKey] ?? [] : [];
            return (
              <div key={s.key} style={{ padding: "7px 0", borderBottom: "1px solid var(--lux-line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {stamped
                    ? <CheckCircle2 className="size-4 shrink-0" style={{ color: "var(--lux-success,#a8c0a0)" }} />
                    : <Circle className="size-4 shrink-0" style={{ color: "var(--lux-muted)" }} />}
                  <span style={{ fontSize: 13, color: stamped ? "var(--lux-ink)" : "var(--lux-muted)" }}>{s.label}</span>
                  {stamped && <span style={{ fontSize: 11.5, color: "var(--lux-muted)" }}>{fmtDate(stamped)}</span>}
                  <span style={{ marginInlineStart: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    {s.key === "invoiceSentAt" && milestones.invoiceZohoId && (
                      <span style={{ fontSize: 10.5, color: "var(--lux-cool,#9db4d6)" }}>
                        Zoho {milestones.invoiceZohoId}
                      </span>
                    )}
                    {s.key === "invoiceSentAt" && !milestones.invoiceZohoId && (
                      <button
                        type="button"
                        onClick={onCreateInvoice}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--lux-champagne,#d6b26a)", padding: "3px 10px", borderRadius: 5, border: "1px solid rgba(214,178,106,0.4)" }}
                      >
                        🧾 צור חשבונית ב-Zoho
                      </button>
                    )}
                    {s.fileStage && (
                      <>
                        <input
                          ref={(el) => { fileInputs.current[s.fileStage!] = el; }}
                          type="file"
                          accept="image/*,video/*,application/pdf"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadFile(s.fileStage!, f);
                            e.target.value = "";
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => fileInputs.current[s.fileStage!]?.click()}
                          disabled={busyKey === `up-${s.fileStage}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--lux-cool,#9db4d6)", padding: "3px 8px", borderRadius: 5, border: "1px solid var(--lux-line)" }}
                        >
                          {busyKey === `up-${s.fileStage}` ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
                          צרף קובץ
                        </button>
                      </>
                    )}
                    {stamped ? (
                      <button
                        type="button"
                        onClick={() => putPatch({ [s.key]: null }, s.key)}
                        disabled={busyKey === s.key}
                        style={{ fontSize: 10.5, color: "var(--lux-muted)", padding: "3px 8px" }}
                      >
                        בטל
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => putPatch({ [s.key]: new Date().toISOString() }, s.key)}
                        disabled={busyKey === s.key}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--lux-champagne,#d6b26a)", padding: "3px 10px", borderRadius: 5, border: "1px solid rgba(214,178,106,0.4)" }}
                      >
                        {busyKey === s.key ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        סמן ✓
                      </button>
                    )}
                  </span>
                </div>
                {files.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5, marginInlineStart: 24 }}>
                    {files.map((f, i) => (
                      <a
                        key={i}
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 10.5, padding: "3px 9px", borderRadius: 99,
                          background: "rgba(120,150,200,0.08)", border: "1px solid rgba(120,150,200,0.25)",
                          color: "var(--lux-cool,#9db4d6)", textDecoration: "none", maxWidth: 220,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                        title={f.name}
                      >
                        📎 {f.name || "קובץ"}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {err && <div style={{ fontSize: 11.5, color: "#e8b4b4", marginTop: 8 }}>שגיאה: {err}</div>}
          <div style={{ fontSize: 10.5, color: "var(--lux-muted)", marginTop: 8 }}>
            כל סימון וכל קובץ משתקפים אוטומטית ככרטיסיית הערה על איש הקשר ב-GHL — איתי רואה.
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- accuracy strip ("כמה המחשבון שלי מדויק") ---------- */

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.abs(v).toFixed(1)}%`;
}

function AccuracyCard({
  title, stat, signedHint,
}: {
  title: string;
  stat: GapStat | null;
  /** Render the SIGNED bias line ("המפעל בד״כ יקר/זול מהאומדן"). */
  signedHint?: (meanSigned: number) => string;
}) {
  const trend =
    stat?.recentMeanAbsPct != null && stat.n >= 4
      ? stat.recentMeanAbsPct - stat.meanAbsPct
      : null;
  return (
    <div style={{ background: "var(--lux-card)", border: "1px solid var(--lux-line)", borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ fontSize: 10.5, color: "var(--lux-muted)", letterSpacing: "0.1em", marginBottom: 4 }}>{title}</div>
      {!stat ? (
        <div style={{ fontSize: 13, color: "var(--lux-muted)", padding: "6px 0" }}>אין עדיין מספיק נתונים</div>
      ) : (
        <>
          <div className="lux-serif tabular-nums" style={{ fontSize: 26, fontWeight: 300, color: "var(--lux-ink)", lineHeight: 1.15 }}>
            {pct(stat.medianAbsPct)}
            <span style={{ fontSize: 11.5, color: "var(--lux-muted)", fontFamily: "inherit", marginInlineStart: 6 }}>פער חציוני</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--lux-muted)", marginTop: 3 }}>
            ממוצע {pct(stat.meanAbsPct)} · {stat.n} עסקאות
            {signedHint && Math.abs(stat.meanSignedPct) >= 1 && (
              <> · {signedHint(stat.meanSignedPct)}</>
            )}
          </div>
          {trend !== null && Math.abs(trend) >= 0.5 && (
            <div style={{ fontSize: 11, marginTop: 2, color: trend < 0 ? "var(--lux-success,#a8c0a0)" : "#e8b4b4" }}>
              {trend < 0 ? "▼" : "▲"} {pct(trend)} ב-10 האחרונות {trend < 0 ? "— משתפר" : "— נחלש"}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AccuracyStrip({ stats }: { stats: AccuracyStats }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "var(--lux-muted)", letterSpacing: "0.14em", marginBottom: 8 }}>
        כמה המחשבון שלי מדויק — מצטבר על כל העסקאות
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <AccuracyCard
          title="טיוטה ↔ מפעל · עלות מפעל ליחידה"
          stat={stats.draftVsFactory.unitPrice}
          signedHint={(s) => (s > 0 ? "המפעל בד״כ יקר מהאומדן" : "המפעל בד״כ זול מהאומדן")}
        />
        <AccuracyCard
          title="טיוטה ↔ מפעל · נפח משלוח (CBM)"
          stat={stats.draftVsFactory.cbm}
          signedHint={(s) => (s > 0 ? "הנפח בפועל גדול מהאומדן" : "הנפח בפועל קטן מהאומדן")}
        />
        <AccuracyCard
          title="מתוכנן ↔ בפועל · רווח"
          stat={stats.plannedVsActual.profit}
          signedHint={(s) => (s > 0 ? "הרווח בפועל גבוה מהתכנון" : "הרווח בפועל נמוך מהתכנון")}
        />
      </div>
    </div>
  );
}

/* ---------- Zoho match modal ---------- */

function zohoAmount(d: ZohoSuggestion): string {
  const orig = `${d.total.toLocaleString("he-IL")} ${d.currencyCode}`;
  if (d.currencyCode === "ILS") return ils(d.total);
  return d.totalIls != null ? `${ils(d.totalIls)} (${orig})` : orig;
}

function ZohoMatchModal({
  dealId, apiToken, onApply, onClose,
}: {
  dealId: string;
  apiToken: string;
  onApply: (sel: {
    revenueIls?: number; factoryIls?: number; shippingIls?: number;
    otherLines?: { label: string; amountIls: number }[];
    refs: ZohoDocRef[];
  }) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<ZohoMatchResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unconfigured" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(widgetUrl(`/api/widget/zoho/match?dealId=${encodeURIComponent(dealId)}`, apiToken), { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok || !j.ok) { setErrMsg(j.error ?? `HTTP ${res.status}`); setState("error"); return; }
        if (!j.configured) { setState("unconfigured"); return; }
        const sug = j.suggestions as ZohoMatchResult;
        setData(sug);
        // Pre-tick the clear winners only (score high enough to trust).
        const pre = new Set<string>();
        const best = (list: ZohoSuggestion[]) => list[0] && list[0].score >= 0.6 ? pre.add(`${list[0].type}:${list[0].id}`) : null;
        best(sug.invoices); best(sug.factoryBills); best(sug.shippingDocs);
        // Factory is often split 30%/70% → pre-tick EVERY strong factory match.
        for (const d of sug.factoryBills.slice(1)) {
          if (d.score >= 0.6) pre.add(`${d.type}:${d.id}`);
        }
        // Commission expenses are customer-linked → trust a strong name match.
        for (const d of sug.otherDocs ?? []) {
          if (d.score >= 0.7) pre.add(`${d.type}:${d.id}`);
        }
        setSelected(pre);
        setState("ready");
      } catch (e) {
        if (alive) { setErrMsg(e instanceof Error ? e.message : String(e)); setState("error"); }
      }
    })();
    return () => { alive = false; };
  }, [dealId, apiToken]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function apply() {
    if (!data) return;
    const pick = (list: ZohoSuggestion[]) => list.filter((d) => selected.has(`${d.type}:${d.id}`));
    const inv = pick(data.invoices);
    const fac = pick(data.factoryBills);
    const shp = pick(data.shippingDocs);
    const oth = pick(data.otherDocs ?? []);
    const sum = (list: ZohoSuggestion[], field: "totalIls" | "exVatIls" = "totalIls") => {
      const vals = list.map((d) => d[field] ?? d.totalIls).filter((v): v is number => v != null);
      return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) : undefined;
    };
    const refs: ZohoDocRef[] = [...inv, ...fac, ...shp, ...oth].map((d) => ({
      type: d.type, id: d.id, number: d.number || undefined,
      amountIls: d.totalIls ?? undefined, date: d.date || undefined, party: d.party || undefined,
    }));
    const otherLines = oth
      .filter((d) => d.totalIls != null)
      .map((d) => ({
        label: (d.description || d.number || "הוצאה מ-Zoho").slice(0, 60),
        amountIls: d.totalIls!,
      }));
    onApply({
      // Revenue lands EX-VAT so it compares 1:1 with the quote totals.
      revenueIls: sum(inv, "exVatIls"),
      factoryIls: sum(fac),
      shippingIls: sum(shp),
      otherLines: otherLines.length > 0 ? otherLines : undefined,
      refs,
    });
  }

  function Section({ title, list }: { title: string; list: ZohoSuggestion[] }) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "var(--lux-muted)", letterSpacing: "0.1em", marginBottom: 6 }}>{title}</div>
        {list.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--lux-muted)" }}>לא נמצאו מסמכים מתאימים</div>
        ) : (
          list.map((d) => {
            const key = `${d.type}:${d.id}`;
            const on = selected.has(key);
            return (
              <label
                key={key}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 6,
                  border: `1px solid ${on ? "var(--lux-champagne, #d6b26a)" : "var(--lux-line)"}`,
                  background: on ? "rgba(214,178,106,0.07)" : "transparent",
                  marginBottom: 5, cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(key)} style={{ accentColor: "#d6b26a" }} />
                <span style={{ fontSize: 12.5, color: "var(--lux-ink)", flex: 1 }}>
                  {(d.type === "expense" && d.description ? d.description.slice(0, 42) : d.number) || d.id.slice(-6)}
                  {d.party ? ` · ${d.party}` : ""}
                </span>
                <span className="tabular-nums" style={{ fontSize: 12.5, color: "var(--lux-ink)" }}>{zohoAmount(d)}</span>
                <span style={{ fontSize: 11, color: "var(--lux-muted)", minWidth: 58, textAlign: "left" }}>{fmtDate(d.date)}</span>
                {d.score >= 0.6 && (
                  <span style={{ fontSize: 10, color: "var(--lux-champagne, #d6b26a)" }}>מומלץ</span>
                )}
              </label>
            );
          })
        )}
      </div>
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        dir="rtl"
        style={{
          width: "100%", maxWidth: 620, maxHeight: "85vh", overflowY: "auto",
          background: "#1b1917", border: "1px solid var(--lux-line)", borderRadius: 12, padding: "18px 20px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 15, color: "var(--lux-ink)" }}>משוך עלויות בפועל מ-Zoho Books</div>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ color: "var(--lux-muted)", padding: 4 }}>
            <X className="size-4" />
          </button>
        </div>

        {state === "loading" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--lux-muted)", fontSize: 13, padding: "18px 0" }}>
            <Loader2 className="size-4 animate-spin" /> מחפש מסמכים מתאימים ב-Zoho…
          </div>
        )}
        {state === "unconfigured" && (
          <div style={{ fontSize: 13, color: "var(--lux-muted)", padding: "12px 0", lineHeight: 1.7 }}>
            Zoho Books עוד לא מחובר. צריך להגדיר פעם אחת Self Client בקונסולת ה-API של Zoho
            ולהזין את המפתחות ב-Vercel — תבקש מקלוד את ההוראות.
          </div>
        )}
        {state === "error" && (
          <div style={{ fontSize: 13, color: "#e8b4b4", padding: "12px 0" }}>שגיאה מול Zoho: {errMsg}</div>
        )}

        {state === "ready" && data && (
          <>
            <Section title="הכנסה — חשבונית ללקוח (ימולא ללא מע״מ)" list={data.invoices} />
            <Section title="עלות מפעל — תשלומים למפעל" list={data.factoryBills} />
            <Section title="שילוח / מכס" list={data.shippingDocs} />
            <Section title="עמלות ועלויות נוספות (יתווספו כשורות)" list={data.otherDocs ?? []} />
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={apply}
                disabled={selected.size === 0}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px",
                  borderRadius: 6, background: "var(--lux-navy-to, #2b3a55)", color: "#e8eefc",
                  fontSize: 13, fontWeight: 500, opacity: selected.size === 0 ? 0.5 : 1,
                }}
              >
                <Check className="size-4" /> מלא לפי הבחירה ({selected.size})
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: "9px 16px", borderRadius: 6, border: "1px solid var(--lux-line)", color: "var(--lux-muted)", fontSize: 13 }}
              >
                ביטול
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--lux-muted)", marginTop: 10 }}>
              הסכומים ימולאו בשדות — שום דבר לא נשמר עד שתלחץ «שמור עלויות בפועל».
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Zoho push modals ("דחוף ל-Zoho") ---------- */

const modalShell: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.8)",
  backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
// SOLID opaque panel — --lux-card is rgba(...,0.03) (near-transparent) so the
// card behind bleeds through; a modal must be fully opaque.
const modalBox: React.CSSProperties = {
  width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto",
  background: "#1b1917", border: "1px solid var(--lux-line)",
  borderRadius: 12, padding: "18px 20px",
  boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
};

/** Create the customer invoice in Zoho from finalPricing (Eli's house rules). */
function ZohoInvoiceModal({
  quote, apiToken, onDone, onClose,
}: {
  quote: ClosedQuote;
  apiToken: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const fp = quote.finalPricing!;
  const spec = (quote.productSpec ?? {}) as Record<string, unknown>;
  const sizeLabel = [
    spec.heightCm ? `H${spec.heightCm}` : null,
    spec.depthCm ? `D${spec.depthCm}` : null,
    spec.widthCm ? `W${spec.widthCm}` : null,
  ].filter(Boolean).join("*");

  const [productName, setProductName] = useState(`שקית אלבד ממותגת — ${sizeLabel}`.trim());
  const [advance, setAdvance] = useState("50");
  const [asDraft, setAsDraft] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [result, setResult] = useState<{ invoiceNumber: string; total: number; advance: number; pdfUrl: string | null; tagApplied: boolean } | null>(null);

  const subtotal = fp.totalSellingPrice ?? 0;
  const vat = Math.round(subtotal * 0.18 * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  const advPct = Math.min(100, Math.max(0, parseFloat(advance) || 50));

  async function create() {
    setState("working");
    setErrMsg("");
    try {
      const res = await fetch(widgetUrl("/api/widget/zoho/create-invoice", apiToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: quote.id,
          advancePercent: advPct,
          draft: asDraft,
          productName,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setResult({ invoiceNumber: j.invoiceNumber, total: j.total, advance: j.advance, pdfUrl: j.pdfUrl, tagApplied: j.tagApplied });
      setState("done");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  return (
    <div style={modalShell} onClick={state === "working" ? undefined : onClose}>
      <div dir="rtl" style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 15, color: "var(--lux-ink)" }}>🧾 צור חשבונית ב-Zoho Books</div>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ color: "var(--lux-muted)", padding: 4 }}>
            <X className="size-4" />
          </button>
        </div>

        {state !== "done" && (
          <>
            <div style={{ fontSize: 12.5, color: "var(--lux-muted)", marginBottom: 10 }}>
              לקוח: <span style={{ color: "var(--lux-ink)" }}>{quote.customerName}</span>
            </div>
            <label style={{ display: "block", fontSize: 11.5, color: "var(--lux-muted)", marginBottom: 4 }}>שם המוצר בחשבונית</label>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} style={inputStyle({ width: "100%", marginBottom: 12 })} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 6, fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: "var(--lux-muted)" }}>כמות</span>
              <span className="tabular-nums" style={{ color: "var(--lux-ink)" }}>{(fp.quantity ?? 0).toLocaleString("he-IL")}</span>
              <span style={{ color: "var(--lux-muted)" }}>סך ההזמנה (לפני מע״מ)</span>
              <span className="tabular-nums" style={{ color: "var(--lux-ink)" }}>{ils(subtotal)}</span>
              <span style={{ color: "var(--lux-muted)" }}>מע״מ 18%</span>
              <span className="tabular-nums" style={{ color: "var(--lux-ink)" }}>{ils(vat)}</span>
              <span style={{ color: "var(--lux-muted)" }}>סה״כ כולל מע״מ</span>
              <span className="tabular-nums" style={{ color: "var(--lux-champagne,#d6b26a)", fontSize: 15 }}>{ils(total)}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: "var(--lux-muted)" }}>מקדמה %</label>
              <input type="number" value={advance} onChange={(e) => setAdvance(e.target.value)} style={inputStyle({ width: 70, padding: "6px 8px" })} />
              <span style={{ fontSize: 12, color: "var(--lux-muted)" }}>
                = {ils(Math.round(total * advPct) / 100)} עכשיו · יתרה {ils(Math.round(total * (100 - advPct)) / 100)}
              </span>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--lux-muted)", marginBottom: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} style={{ accentColor: "#d6b26a" }} />
              השאר כטיוטה ב-Zoho (בלי לסמן "נשלחה")
            </label>

            <div style={{ fontSize: 11, color: "#e8b4b4", marginBottom: 12 }}>
              ⚠️ יוצר חשבונית אמיתית בספרים — מספר עוקב, פרטי בנק, מע״מ 18%. בדיוק כמו הסקיל המקומי שלך.
            </div>

            {state === "error" && <div style={{ fontSize: 12, color: "#e8b4b4", marginBottom: 10 }}>שגיאה: {errMsg}</div>}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={create}
                disabled={state === "working"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px",
                  borderRadius: 6, background: "var(--lux-navy-to, #2b3a55)", color: "#e8eefc",
                  fontSize: 13, fontWeight: 500, opacity: state === "working" ? 0.6 : 1,
                }}
              >
                {state === "working" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {state === "working" ? "יוצר…" : "צור חשבונית"}
              </button>
              <button type="button" onClick={onClose} style={{ padding: "9px 16px", borderRadius: 6, border: "1px solid var(--lux-line)", color: "var(--lux-muted)", fontSize: 13 }}>
                ביטול
              </button>
            </div>
          </>
        )}

        {state === "done" && result && (
          <div>
            <div style={{ fontSize: 14, color: "var(--lux-success,#a8c0a0)", marginBottom: 8 }}>
              ✓ חשבונית {result.invoiceNumber} נוצרה{asDraft ? " (טיוטה)" : " וסומנה נשלחה"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--lux-muted)", lineHeight: 1.8 }}>
              סה״כ כולל מע״מ: {ils(result.total)} · מקדמה: {ils(result.advance)}
              <br />
              {result.pdfUrl ? <>ה-PDF צורף לתיק העסקה ושוקף ל-GHL.</> : <>ה-PDF לא נמשך — פתח ב-Zoho.</>}
              <br />החשבונית מקושרת ללקוח — כל ההוצאות וההכנסות מרוכזות תחת {quote.customerName}.
            </div>
            <button
              type="button"
              onClick={onDone}
              style={{ marginTop: 14, padding: "9px 18px", borderRadius: 6, background: "var(--lux-navy-to, #2b3a55)", color: "#e8eefc", fontSize: 13 }}
            >
              סגור ורענן
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Record an order expense in Zoho (factory / commission / shipping / other). */
function ZohoExpenseModal({
  quote, apiToken, onDone, onClose,
}: {
  quote: ClosedQuote;
  apiToken: string;
  onDone: () => void;
  onClose: () => void;
}) {
  type Bucket = "factory" | "commission" | "shipping" | "other";
  const name = quote.customerName ?? "";
  const DESC: Record<Bucket, string> = {
    factory: `מפעל — הזמנת ${name}`,
    commission: `עמלת מכירה — הזמנת ${name}`,
    shipping: `שילוח — הזמנת ${name}`,
    other: `הוצאה — הזמנת ${name}`,
  };
  const [bucket, setBucket] = useState<Bucket>("factory");
  const [partner, setPartner] = useState("אלי");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [description, setDescription] = useState(DESC.factory);
  const [descTouched, setDescTouched] = useState(false);
  const [applyToCard, setApplyToCard] = useState(true);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [accountId, setAccountId] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [result, setResult] = useState<{ bcyTotalIls: number; exchangeRate: number | null; tagApplied: boolean; customerLinked: boolean } | null>(null);

  useEffect(() => {
    if (!descTouched) setDescription(DESC[bucket]);
    if (bucket === "factory") setCurrency("CNY");
    if (bucket === "commission") setCurrency("ILS");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket]);

  const needsAccount = bucket === "shipping" || bucket === "other";
  useEffect(() => {
    if (!needsAccount || accounts.length > 0) return;
    (async () => {
      try {
        const res = await fetch(widgetUrl("/api/widget/zoho/create-expense", apiToken), { cache: "no-store" });
        const j = await res.json();
        if (j.ok) setAccounts(j.accounts ?? []);
      } catch { /* dropdown stays empty */ }
    })();
  }, [needsAccount, accounts.length, apiToken]);

  async function create() {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErrMsg("סכום לא תקין"); setState("error"); return; }
    if (needsAccount && !accountId) { setErrMsg("בחר חשבון הוצאה"); setState("error"); return; }
    setState("working");
    setErrMsg("");
    try {
      const res = await fetch(widgetUrl("/api/widget/zoho/create-expense", apiToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: quote.id,
          category: bucket === "factory" ? "cogs" : bucket === "commission" ? "commission" : "custom",
          accountId: needsAccount ? accountId : undefined,
          partner,
          amount: amt,
          currency,
          description,
          applyTo: applyToCard
            ? (bucket === "factory" ? "factory" : bucket === "shipping" ? "shipping" : "other")
            : null,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setResult({ bcyTotalIls: j.bcyTotalIls, exchangeRate: j.exchangeRate, tagApplied: j.tagApplied, customerLinked: j.customerLinked });
      setState("done");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  const radio = (checked: boolean): React.CSSProperties => ({
    fontSize: 12, padding: "5px 12px", borderRadius: 99, cursor: "pointer",
    border: `1px solid ${checked ? "var(--lux-champagne,#d6b26a)" : "var(--lux-line)"}`,
    background: checked ? "rgba(214,178,106,0.1)" : "transparent",
    color: checked ? "var(--lux-champagne,#d6b26a)" : "var(--lux-muted)",
  });

  return (
    <div style={modalShell} onClick={state === "working" ? undefined : onClose}>
      <div dir="rtl" style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 15, color: "var(--lux-ink)" }}>רשום הוצאה ב-Zoho Books</div>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ color: "var(--lux-muted)", padding: 4 }}>
            <X className="size-4" />
          </button>
        </div>

        {state !== "done" && (
          <>
            <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginBottom: 5 }}>סוג ההוצאה</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {([["factory", "מפעל (COGS)"], ["commission", "עמלת מכירות"], ["shipping", "שילוח"], ["other", "אחר"]] as [Bucket, string][]).map(([b, l]) => (
                <button key={b} type="button" style={radio(bucket === b)} onClick={() => setBucket(b)}>{l}</button>
              ))}
            </div>

            {needsAccount && (
              <>
                <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginBottom: 5 }}>חשבון הוצאה ב-Zoho</div>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ ...inputStyle({ width: "100%", marginBottom: 12 }), appearance: "auto" } as React.CSSProperties}>
                  <option value="">בחר חשבון…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </>
            )}

            <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginBottom: 5 }}>מי שילם</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {["אלי", "שמעון", "העסק (Pepper)"].map((p) => (
                <button key={p} type="button" style={radio(partner === p)} onClick={() => setPartner(p)}>{p}</button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginBottom: 5 }}>סכום</div>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={inputStyle({ width: "100%" })} />
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginBottom: 5 }}>מטבע</div>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ ...inputStyle({ width: 90 }), appearance: "auto" } as React.CSSProperties}>
                  <option>ILS</option><option>CNY</option><option>USD</option>
                </select>
              </div>
            </div>
            {currency !== "ILS" && (
              <div style={{ fontSize: 11, color: "var(--lux-muted)", marginTop: -8, marginBottom: 12 }}>
                יומר ל-₪ בשער חי (התוכנית שלך ב-Zoho לא מאפשרת הוצאה במטבע זר) —
                הסכום המקורי נשמר בתיאור.
              </div>
            )}

            <div style={{ fontSize: 11.5, color: "var(--lux-muted)", marginBottom: 5 }}>תיאור</div>
            <input value={description} onChange={(e) => { setDescription(e.target.value); setDescTouched(true); }} style={inputStyle({ width: "100%", marginBottom: 12 })} />

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--lux-muted)", marginBottom: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={applyToCard} onChange={(e) => setApplyToCard(e.target.checked)} style={{ accentColor: "#d6b26a" }} />
              עדכן גם את "עלויות בפועל" בכרטיס הזה (בש״ח לפי השער)
            </label>

            <div style={{ fontSize: 11, color: "#e8b4b4", marginBottom: 12 }}>
              ⚠️ רושם הוצאה אמיתית בספרים — ללא מע״מ (ייבוא), מקושרת ללקוח {name}.
            </div>

            {state === "error" && <div style={{ fontSize: 12, color: "#e8b4b4", marginBottom: 10 }}>שגיאה: {errMsg}</div>}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={create}
                disabled={state === "working"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px",
                  borderRadius: 6, background: "var(--lux-navy-to, #2b3a55)", color: "#e8eefc",
                  fontSize: 13, fontWeight: 500, opacity: state === "working" ? 0.6 : 1,
                }}
              >
                {state === "working" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {state === "working" ? "רושם…" : "צור הוצאה"}
              </button>
              <button type="button" onClick={onClose} style={{ padding: "9px 16px", borderRadius: 6, border: "1px solid var(--lux-line)", color: "var(--lux-muted)", fontSize: 13 }}>
                ביטול
              </button>
            </div>
          </>
        )}

        {state === "done" && result && (
          <div>
            <div style={{ fontSize: 14, color: "var(--lux-success,#a8c0a0)", marginBottom: 8 }}>✓ ההוצאה נרשמה ב-Zoho</div>
            <div style={{ fontSize: 12.5, color: "var(--lux-muted)", lineHeight: 1.8 }}>
              {ils(result.bcyTotalIls)}
              {result.exchangeRate ? ` (שער ${result.exchangeRate.toFixed(3)})` : ""}
              {result.customerLinked ? " · ✓ מקושרת ללקוח (מרוכז פר-לקוח)" : " · ⚠️ הלקוח לא נמצא ב-Zoho — ההוצאה בלי קישור לקוח"}
            </div>
            <button
              type="button"
              onClick={onDone}
              style={{ marginTop: 14, padding: "9px 18px", borderRadius: 6, background: "var(--lux-navy-to, #2b3a55)", color: "#e8eefc", fontSize: 13 }}
            >
              סגור ורענן
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
