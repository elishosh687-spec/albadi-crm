"use client";

/**
 * Salesperson calculator — customer price ONLY. Built lean and dedicated (not a
 * trimmed boss calculator) so it is secure by construction: it has no code paths
 * that fetch or render cost/profit/margin/commission. It talks only to the
 * /api/sales/* endpoints, which strip everything but the customer view.
 *
 * Phase A: catalog products. Estimate + history come next.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, Check, Send, Package, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { PAYMENT_PRESETS, NO_PAYMENT_PLAN_ID } from "@/lib/factory/payment-terms";

const PRODUCTS = DEFAULT_CONFIG.products
  .slice()
  .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  .map((p) => ({ id: p.id, dimensions: p.dimensions, description: p.description }));
const TIERS = DEFAULT_CONFIG.quantityTiers
  .slice()
  .sort((a, b) => a.quantity - b.quantity)
  .map((t) => ({ id: t.id, quantity: t.quantity, label: t.label }));
const SHIPPING = DEFAULT_CONFIG.shippingOptions
  .filter((s) => s.enabled)
  .map((s) => ({ id: s.id, name: s.name, description: s.description }));

interface Lead { sid: string; name: string | null; phone: string | null; }
interface CustomerQuote {
  unitSellingPriceIls: number;
  totalOrderIls: number;
  quantity: number;
  shippingName: string;
  shippingDays: number | null;
  moldsTotalIls: number;
  dimensions: string;
}

const ils = (n: number) => `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

export function SalesCalculator({ token }: { token: string }) {
  // customer
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Lead[] | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);

  // spec
  const [productId, setProductId] = useState(PRODUCTS[0]?.id ?? "p1");
  const [tierId, setTierId] = useState<string>(TIERS[1]?.id ?? TIERS[0]?.id ?? "q1");
  const [customQty, setCustomQty] = useState<string>("");
  const [handles, setHandles] = useState(true);
  const [colors, setColors] = useState(1);
  const [lamination, setLamination] = useState(false);
  const [shippingId, setShippingId] = useState(SHIPPING.find((s) => s.id === "s2")?.id ?? SHIPPING[0]?.id ?? "s2");
  const [payPlan, setPayPlan] = useState<string>(NO_PAYMENT_PLAN_ID);

  // pricing
  const [quote, setQuote] = useState<CustomerQuote | null>(null);
  const [pricing, setPricing] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const specBody = useCallback(() => {
    const custom = customQty.trim() ? Math.max(1, parseInt(customQty, 10) || 0) : 0;
    return {
      productId,
      quantityTierId: custom ? null : tierId,
      quantityOverride: custom || null,
      hasHandles: handles,
      logoColors: colors,
      hasLamination: lamination,
      shippingOptionId: shippingId,
    };
  }, [productId, tierId, customQty, handles, colors, lamination, shippingId]);

  // live customer price (debounced)
  useEffect(() => {
    let alive = true;
    setPricing(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sales/quote?token=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(specBody()),
        });
        const j = await res.json();
        if (alive) setQuote(j?.ok ? j.quote : null);
      } catch {
        if (alive) setQuote(null);
      } finally {
        if (alive) setPricing(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [specBody, token]);

  // customer search (debounced)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearch(v: string) {
    setQ(v);
    setLead(null);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(async () => {
      const res = await fetch(`/api/sales/leads?token=${encodeURIComponent(token)}&q=${encodeURIComponent(v)}`);
      const j = await res.json();
      setResults(j?.ok ? j.leads : []);
    }, 250);
  }

  async function send() {
    if (!lead) { setMsg("בחר לקוח קודם"); return; }
    setSendState("sending");
    setMsg(null);
    try {
      const res = await fetch(`/api/sales/send?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...specBody(), sid: lead.sid, customerName: lead.name, paymentPlanId: payPlan }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.detail || j?.error || "send failed");
      setSendState("sent");
      setMsg(`נשלח ל${lead.name ?? "לקוח"} · הצעה #${j.quotationNo}`);
      setTimeout(() => setSendState("idle"), 4000);
    } catch (e) {
      setSendState("error");
      setMsg(String(e));
    }
  }

  const Toggle = ({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) => (
    <button
      type="button"
      onClick={() => set(!on)}
      className={cn(
        "px-3 py-2 rounded-lg border text-sm transition-colors",
        on ? "border-primary bg-primary/15 text-foreground" : "border-border bg-card/40 text-muted-foreground"
      )}
    >
      {label}: {on ? "כן" : "לא"}
    </button>
  );

  return (
    <div dir="rtl" className="mx-auto max-w-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Package className="size-5 text-primary" />
        <h1 className="text-lg font-medium">מחשבון מכירות</h1>
      </div>

      {/* Customer */}
      <div className="rounded-xl border border-border bg-card/40 p-3">
        <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5"><User className="size-3.5" /> לקוח</div>
        {lead ? (
          <div className="flex items-center justify-between">
            <span className="text-sm">{lead.name ?? lead.phone}</span>
            <button type="button" onClick={() => { setLead(null); setQ(""); setResults(null); }} className="text-xs text-muted-foreground underline">שנה</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 h-9 rounded-lg border border-border px-2.5">
              <Search className="size-4 text-muted-foreground" />
              <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="חפש לפי שם או טלפון" className="flex-1 bg-transparent text-sm outline-none" />
            </div>
            {results && results.length > 0 && (
              <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-border divide-y divide-border/60">
                {results.map((r) => (
                  <button key={r.sid} type="button" onClick={() => { setLead(r); setResults(null); }} className="w-full text-right px-3 py-2 text-sm hover:bg-secondary">
                    {r.name ?? "—"} <span className="text-xs text-muted-foreground">{r.phone ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
            {results && results.length === 0 && <div className="mt-2 text-xs text-muted-foreground">אין תוצאות</div>}
          </>
        )}
      </div>

      {/* Product */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">מוצר</label>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full h-10 rounded-lg border border-border bg-card/40 px-3 text-sm">
          {PRODUCTS.map((p) => (<option key={p.id} value={p.id}>{p.dimensions} — {p.description}</option>))}
        </select>
      </div>

      {/* Quantity */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">כמות</label>
        <div className="flex flex-wrap gap-2">
          {TIERS.map((t) => (
            <button key={t.id} type="button" onClick={() => { setTierId(t.id); setCustomQty(""); }} className={cn("px-3 py-2 rounded-lg border text-sm", !customQty && tierId === t.id ? "border-primary bg-primary/15" : "border-border bg-card/40 text-muted-foreground")}>{t.quantity.toLocaleString()}</button>
          ))}
          <input type="number" min={1} value={customQty} onChange={(e) => setCustomQty(e.target.value)} placeholder="אחר" className="w-24 h-10 rounded-lg border border-border bg-card/40 px-3 text-sm text-center" />
        </div>
      </div>

      {/* Spec toggles */}
      <div className="flex flex-wrap gap-2">
        <Toggle on={handles} set={setHandles} label="ידיות" />
        <Toggle on={lamination} set={setLamination} label="למינציה" />
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card/40">
          <span className="text-sm text-muted-foreground">צבעים</span>
          <select value={colors} onChange={(e) => setColors(Number(e.target.value))} className="bg-transparent text-sm outline-none">
            {[1, 2, 3, 4, 5, 6].map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
        </div>
      </div>

      {/* Shipping */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">שילוח</label>
        <div className="flex gap-2">
          {SHIPPING.map((s) => (
            <button key={s.id} type="button" onClick={() => setShippingId(s.id)} className={cn("flex-1 px-3 py-2 rounded-lg border text-sm", shippingId === s.id ? "border-primary bg-primary/15" : "border-border bg-card/40 text-muted-foreground")}>
              {s.name} <span className="text-xs opacity-70">{s.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Payment terms */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">תנאי תשלום</label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPayPlan(NO_PAYMENT_PLAN_ID)} className={cn("px-3 py-1.5 rounded-lg border text-xs", payPlan === NO_PAYMENT_PLAN_ID ? "border-primary bg-primary/15" : "border-border bg-card/40 text-muted-foreground")}>⛔ ללא</button>
          {PAYMENT_PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPayPlan(p.id)} className={cn("px-3 py-1.5 rounded-lg border text-xs", payPlan === p.id ? "border-primary bg-primary/15" : "border-border bg-card/40 text-muted-foreground")}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Price */}
      <div className="rounded-xl border border-primary/40 bg-primary/10 p-4">
        <div className="text-xs text-primary mb-1 flex items-center gap-2">מחיר ללקוח · ליחידה {pricing && <Loader2 className="size-3 animate-spin" />}</div>
        {quote ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-medium">{ils(quote.unitSellingPriceIls)}</span>
              <span className="text-xs text-muted-foreground">כולל שילוח</span>
            </div>
            <div className="mt-2 pt-2 border-t border-primary/30 flex justify-between text-sm">
              <span>סה״כ הזמנה ({quote.quantity.toLocaleString()} יח׳)</span>
              <span className="font-medium">{ils(quote.totalOrderIls)}</span>
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">{pricing ? "מחשב…" : "בחר מפרט לתמחור"}</div>
        )}
      </div>

      {/* Send */}
      <button type="button" onClick={send} disabled={!lead || !quote || sendState === "sending"} className={cn("w-full h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors", !lead || !quote ? "bg-card/40 text-muted-foreground/60 border border-border" : "bg-primary text-primary-foreground hover:bg-primary/90")}>
        {sendState === "sending" ? <Loader2 className="size-4 animate-spin" /> : sendState === "sent" ? <Check className="size-4" /> : <Send className="size-4" />}
        {sendState === "sent" ? "נשלח" : "שלח הצעה ללקוח"}
      </button>
      {msg && <div className={cn("text-xs", sendState === "error" ? "text-red-400" : "text-emerald-400")}>{msg}</div>}
    </div>
  );
}
