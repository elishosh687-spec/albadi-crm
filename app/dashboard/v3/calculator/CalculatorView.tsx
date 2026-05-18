"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Product, QuantityTier, ShippingOption, QuoteResult } from "@/lib/factory/calculator/types";

interface Props {
  products: Product[];
  quantityTiers: QuantityTier[];
  shippingOptions: ShippingOption[];
  initialMargins: Record<string, number>;
}

interface PreviewResult {
  result: QuoteResult;
  altResult: QuoteResult | null;
  computed: {
    productionPerUnitIls: number;
    shippingPerUnitIls: number;
    usdToIls: number;
    usdToCny: number;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ils = (n: number) =>
  n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CalculatorView({ products, quantityTiers, shippingOptions, initialMargins }: Props) {
  const [productId, setProductId] = useState(products[0]?.id ?? "p1");
  const [qtyId, setQtyId]         = useState(quantityTiers[0]?.id ?? "q0");
  const [handles, setHandles]     = useState(true);
  const [lamination, setLamination] = useState(false);
  const [colors, setColors]       = useState(1);
  const [shippingId, setShippingId] = useState(shippingOptions.find((s) => s.type === "sea")?.id ?? shippingOptions[0]?.id ?? "s2");
  const [margins, setMargins]     = useState<Record<string, number>>(initialMargins);
  const [preview, setPreview]     = useState<PreviewResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [saveMsg, setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedTier = quantityTiers.find((t) => t.id === qtyId);
  const qtyKey = String(selectedTier?.quantity ?? 1000);
  const currentMargin = margins[qtyKey] ?? 40;

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        product: productId,
        qty: qtyId,
        handles: String(handles),
        lamination: String(lamination),
        colors: String(colors),
        shipping: shippingId,
        margin: String(currentMargin),
      });
      const res = await fetch(`/api/factory/quote-preview?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setPreview(null);
        return;
      }
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [productId, qtyId, handles, lamination, colors, shippingId, currentMargin]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const saveMargins = () => {
    setSaveMsg(null);
    startTransition(async () => {
      try {
        const cfgRes = await fetch("/api/factory/config");
        const cfgData = await cfgRes.json();
        if (!cfgRes.ok) throw new Error(cfgData.error ?? "load config failed");
        const updated = { ...cfgData.config, profitMarginByQuantity: margins };
        const saveRes = await fetch("/api/factory/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
        const saveData = await saveRes.json();
        if (saveData?.ok) {
          setSaveMsg({ ok: true, text: "נשמר ✓" });
        } else {
          setSaveMsg({ ok: false, text: saveData?.error ?? "כשל" });
        }
      } catch (e) {
        setSaveMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  const r = preview?.result;
  const c = preview?.computed;

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      {/* Form */}
      <section className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
        {/* Product */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">מוצר</label>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.dimensions} — {p.description}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {/* Quantity */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">כמות</label>
            <select
              value={qtyId}
              onChange={(e) => setQtyId(e.target.value)}
              className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              {quantityTiers.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Shipping */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">שילוח</label>
            <select
              value={shippingId}
              onChange={(e) => setShippingId(e.target.value)}
              className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              {shippingOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Colors */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">צבעי לוגו</label>
            <select
              value={colors}
              onChange={(e) => setColors(Number(e.target.value))}
              className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value={1}>1 צבע</option>
              <option value={2}>2 צבעים</option>
              <option value={3}>3 צבעים</option>
            </select>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex gap-6">
          <Toggle label="ידיות" value={handles} onChange={setHandles} />
          <Toggle label="למינציה" value={lamination} onChange={setLamination} />
        </div>
      </section>

      {/* Margin editors */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium mb-3">אחוזי רווח לפי כמות</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {quantityTiers.map((t) => {
            const key = String(t.quantity);
            const active = t.id === qtyId;
            return (
              <div key={key} className="flex flex-col gap-1">
                <label className={cn("text-xs", active ? "text-primary font-medium" : "text-muted-foreground")}>
                  {t.label} {active ? "◀" : ""}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={200}
                    step={1}
                    value={margins[key] ?? 40}
                    onChange={(e) =>
                      setMargins((m) => ({ ...m, [key]: parseFloat(e.target.value) || 0 }))
                    }
                    className={cn(
                      "w-full bg-background/50 border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30",
                      active ? "border-primary/60" : "border-border"
                    )}
                  />
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={saveMargins}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            שמור לDB
          </button>
          {saveMsg && (
            <span className={cn("text-xs", saveMsg.ok ? "text-success" : "text-destructive")}>
              {saveMsg.text}
            </span>
          )}
          <span className="text-xs text-muted-foreground">שינויים מיידיים בתצוגה. שמירה מעדכנת את כל הבוטים.</span>
        </div>
      </section>

      {/* Result */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          מחשב…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}
      {r && c && !loading && (
        <BreakdownCard result={r} computed={c} />
      )}
    </div>
  );
}

function BreakdownCard({
  result: r,
  computed: c,
}: {
  result: QuoteResult;
  computed: { productionPerUnitIls: number; shippingPerUnitIls: number };
}) {
  const productionUnit = r2(c.productionPerUnitIls);
  const shippingUnit   = r2(c.shippingPerUnitIls);
  const totalCostUnit  = r2(r.totalCostPerUnitIls);
  const profitUnit     = r2(r.profitPerUnitIls);

  const productionTotal = r2(productionUnit * r.quantity);
  const shippingTotal   = r2(shippingUnit * r.quantity);
  const totalCostTotal  = r2(r.totalCostPerUnitIls * r.quantity);

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Hero */}
      <div className="text-center py-8 border-b border-border bg-background/30">
        <div className="text-4xl font-bold tabular-nums">₪{ils(r.sellingPricePerUnitIls)}</div>
        <div className="text-sm text-muted-foreground mt-1">מחיר ליחידה (כולל רווח)</div>
      </div>

      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-border">
        {/* Per unit */}
        <div className="p-5">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">ליחידה</h3>
          <BreakdownRows
            rows={[
              { label: "עלות מפעל", value: `₪${ils(productionUnit)}` },
              { label: "עלות שילוח", value: `₪${ils(shippingUnit)}` },
              { label: "סה״כ עלות", value: `₪${ils(totalCostUnit)}`, bold: true },
              { label: `רווח ${r.profitMargin}%`, value: `₪${ils(profitUnit)}`, bold: true },
            ]}
          />
        </div>

        {/* Total */}
        <div className="p-5">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            סה״כ עסקה ({r.quantity.toLocaleString("he-IL")} יח&apos;)
          </h3>
          <BreakdownRows
            rows={[
              { label: "עלות מפעל", value: `₪${ils(productionTotal)}` },
              { label: "עלות שילוח", value: `₪${ils(shippingTotal)}` },
              { label: "סה״כ עלות", value: `₪${ils(totalCostTotal)}`, bold: true },
              { label: `רווח ${r.profitMargin}%`, value: `₪${ils(r.totalProfitIls)}`, bold: true, green: true },
              { label: "מחיר ללקוח", value: `₪${ils(r.totalOrderPriceIls)}`, hero: true },
            ]}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground text-center flex flex-wrap justify-center gap-x-4 gap-y-1 tabular-nums">
        <span>משקל: {r.totalWeightKg.toLocaleString("he-IL")} ק״ג</span>
        <span>·</span>
        <span>CBM: {r.totalCbm.toFixed(3)}</span>
        <span>·</span>
        <span>{r.totalCartons} קרטונים</span>
        <span>·</span>
        <span>{r.quantity.toLocaleString("he-IL")} יחידות</span>
      </div>
    </section>
  );
}

function BreakdownRows({
  rows,
}: {
  rows: { label: string; value: string; bold?: boolean; green?: boolean; hero?: boolean }[];
}) {
  return (
    <dl className="flex flex-col divide-y divide-border/50">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3 py-2">
          <dt className={cn("text-sm", row.hero ? "font-semibold" : "text-muted-foreground")}>{row.label}</dt>
          <dd
            className={cn(
              "text-sm tabular-nums text-right",
              row.hero && "text-lg font-bold",
              row.green && "text-success font-semibold",
              row.bold && !row.hero && !row.green && "font-semibold"
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring/30",
          value ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform",
            value ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
      <span className="text-sm">{label}</span>
    </label>
  );
}
