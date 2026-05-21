"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Product, QuantityTier, ShippingOption, QuoteResult } from "@/lib/factory/calculator/types";
import { DetailedBreakdown } from "@/app/dashboard/v3/_components/factory/DetailedBreakdown";

interface Props {
  products: Product[];
  quantityTiers: QuantityTier[];
  shippingOptions: ShippingOption[];
  initialMargins: Record<string, number>;
  // Optional widget-mode token. When set, all fetches append
  // `&widget_token=<value>` so middleware lets the request through without
  // an albadi_auth cookie. Empty in normal dashboard mode.
  apiToken?: string;
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

export function CalculatorView({ products, quantityTiers, shippingOptions, initialMargins, apiToken }: Props) {
  const [productId, setProductId] = useState(products[0]?.id ?? "p1");
  const [qtyId, setQtyId]         = useState(quantityTiers[0]?.id ?? "q0");
  const [handles, setHandles]     = useState(true);
  const [lamination, setLamination] = useState(false);
  const [colors, setColors]       = useState(1);
  const [shippingId, setShippingId] = useState(shippingOptions.find((s) => s.type === "sea")?.id ?? shippingOptions[0]?.id ?? "s2");
  const [qtyOverride, setQtyOverride] = useState<string>("");
  const [marginOverride, setMarginOverride] = useState<string>("");
  const [minProfit, setMinProfit] = useState<string>("");
  const [reverseMode, setReverseMode] = useState<"total" | "unit" | "profit">("profit");
  const [reverseInput, setReverseInput] = useState<string>("");
  const [preview, setPreview]     = useState<PreviewResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const selectedTier = quantityTiers.find((t) => t.id === qtyId);
  const overrideParsed = qtyOverride ? parseInt(qtyOverride, 10) : NaN;
  const overrideValid = Number.isFinite(overrideParsed) && overrideParsed > 0;
  // For margin lookup we mirror engine's snap-down behaviour client-side so the
  // displayed margin matches the one used in the API call.
  const effectiveQty = overrideValid ? overrideParsed : (selectedTier?.quantity ?? 1000);
  const sortedTierQtys = quantityTiers.map((t) => t.quantity).sort((a, b) => a - b);
  const snappedTierQty = sortedTierQtys.reduce(
    (best, q) => (q <= effectiveQty ? q : best),
    sortedTierQtys[0] ?? 1000
  );
  const defaultMargin = initialMargins[String(snappedTierQty)] ?? 40;
  const marginOverrideParsed = marginOverride !== "" ? parseFloat(marginOverride) : NaN;
  const marginOverrideValid = Number.isFinite(marginOverrideParsed) && marginOverrideParsed >= 0 && marginOverrideParsed <= 300;
  const currentMargin = marginOverrideValid ? marginOverrideParsed : defaultMargin;
  const minProfitParsed = minProfit !== "" ? parseFloat(minProfit) : NaN;
  const minProfitValid = Number.isFinite(minProfitParsed) && minProfitParsed > 0;

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
      if (overrideValid) params.set("qtyOverride", String(overrideParsed));
      if (apiToken) params.set("widget_token", apiToken);
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
  }, [productId, qtyId, handles, lamination, colors, shippingId, currentMargin, overrideValid, overrideParsed]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const r = preview?.result;
  const c = preview?.computed;

  const reverseResult = useMemo(() => {
    if (!r || !c) return null;
    const n = parseFloat(reverseInput);
    if (!Number.isFinite(n) || n <= 0) return null;
    const base = r.totalCostPerUnitIls - c.shippingPerUnitIls;
    if (base <= 0) return null;
    let perUnit: number;
    if (reverseMode === "profit") {
      perUnit = r.totalCostPerUnitIls + n / r.quantity;
    } else if (reverseMode === "total") {
      perUnit = n / r.quantity;
    } else {
      perUnit = n;
    }
    const marginPct = ((perUnit - c.shippingPerUnitIls) / base - 1) * 100;
    const profitPerUnit = perUnit - r.totalCostPerUnitIls;
    const totalProfit = profitPerUnit * r.quantity;
    const totalPrice = perUnit * r.quantity;
    return { marginPct, profitPerUnit, totalProfit, perUnit, totalPrice };
  }, [r, c, reverseInput, reverseMode]);

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
              disabled={overrideValid}
              className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
            >
              {quantityTiers.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Custom quantity override */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">כמות מותאמת (אופציונלי)</label>
            <input
              type="number"
              min={1}
              step={100}
              placeholder="למשל 2500"
              value={qtyOverride}
              onChange={(e) => setQtyOverride(e.target.value)}
              className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <span className="text-[11px] text-muted-foreground">
              {overrideValid
                ? `מתומחר לפי טיר ${snappedTierQty.toLocaleString("he-IL")}`
                : "ריק → משתמש בבחירה למעלה"}
            </span>
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

        {/* Margin override + min profit (Wave 6: #4, #19) */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/50">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">% רווח יעד (override)</label>
            <input
              type="number"
              min={0}
              max={300}
              step={1}
              placeholder={`ברירת מחדל: ${defaultMargin}%`}
              value={marginOverride}
              onChange={(e) => setMarginOverride(e.target.value)}
              className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <span className="text-[11px] text-muted-foreground">
              {marginOverrideValid
                ? `דורס את הגלובלי לחישוב הזה (${marginOverrideParsed}%)`
                : "ריק → לפי הגדרות מערכת"}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">רווח מינימלי ₪ (אזהרה)</label>
            <input
              type="number"
              min={0}
              step={100}
              placeholder="למשל 1000"
              value={minProfit}
              onChange={(e) => setMinProfit(e.target.value)}
              className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <span className="text-[11px] text-muted-foreground">
              {minProfitValid
                ? `מציג אזהרה אם רווח כולל < ₪${ils(minProfitParsed)}`
                : "ריק → ללא בדיקה"}
            </span>
          </div>
        </div>
      </section>

      {/* Min-profit warning (Wave 6: #19) */}
      {r && minProfitValid && r.totalProfitIls < minProfitParsed && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning flex items-center gap-2">
          ⚠️ הרווח הכולל ₪{ils(r.totalProfitIls)} נמוך מהמינימום שהוגדר ₪{ils(minProfitParsed)}.
          {(() => {
            const totalCost = r.totalCostPerUnitIls * r.quantity;
            const requiredMarginPct = totalCost > 0 ? ((minProfitParsed / totalCost) * 100) : 0;
            return ` רווח נדרש כדי להגיע ליעד: ${r2(requiredMarginPct)}%.`;
          })()}
        </div>
      )}

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

      {r && c && !loading && (
        <DetailedBreakdown
          unitCost={c.productionPerUnitIls}
          unitShipping={c.shippingPerUnitIls}
          unitProfit={r.profitPerUnitIls}
          unitSellingPrice={r.sellingPricePerUnitIls}
          totalCost={c.productionPerUnitIls * r.quantity}
          totalShipping={c.shippingPerUnitIls * r.quantity}
          totalProfit={r.totalProfitIls}
          totalSellingPrice={r.totalOrderPriceIls}
          quantity={r.quantity}
          profitMarginPct={r.profitMargin}
          totalCartons={r.totalCartons}
          totalWeightKg={r.totalWeightKg}
          totalCbm={r.totalCbm}
          shippingType={
            r.shippingOption?.type === "sea" || r.shippingOption?.type === "air"
              ? r.shippingOption.type
              : null
          }
          factoryUnitCostCny={r.unitProductionCny}
          usdToIls={c.usdToIls}
          usdToCny={c.usdToCny}
          seaRate={
            r.shippingOption?.type === "sea"
              ? shippingOptions.find((s) => s.id === r.shippingOption?.id)?.seaRate
              : undefined
          }
          rawCbm={r.totalCbm}
          seaMinCbm={1}
          plateFeeCnyPerUnit={r.plateFeeCny}
          components={{
            baseBagCny: r.baseBagCny,
            handlesAddonCny: r.handlesAddonCny,
            laminationAddonCny: r.laminationAddonCny,
            plateFeeCny: r.plateFeeCny,
            logoAddonCny: r.logoAddonCny,
          }}
          alt={
            preview?.altResult
              ? {
                  shippingType:
                    preview.altResult.shippingOption?.type === "air" ? "air" : "sea",
                  unitSellingPrice: preview.altResult.sellingPricePerUnitIls,
                  totalSellingPrice: preview.altResult.totalOrderPriceIls,
                  shippingName: preview.altResult.shippingOption?.name ?? null,
                }
              : null
          }
        />
      )}

      {/* Reverse margin: given a price, what % is the implied profit? */}
      {r && c && (
        <section className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-medium">תמחור לפי יעד</h2>
            <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setReverseMode("profit")}
                className={cn(
                  "px-3 py-1",
                  reverseMode === "profit" ? "bg-primary text-primary-foreground" : "bg-background/30 text-muted-foreground"
                )}
              >
                רווח קבוע (₪)
              </button>
              <button
                type="button"
                onClick={() => setReverseMode("total")}
                className={cn(
                  "px-3 py-1 border-r border-border",
                  reverseMode === "total" ? "bg-primary text-primary-foreground" : "bg-background/30 text-muted-foreground"
                )}
              >
                סכום כולל
              </button>
              <button
                type="button"
                onClick={() => setReverseMode("unit")}
                className={cn(
                  "px-3 py-1 border-r border-border",
                  reverseMode === "unit" ? "bg-primary text-primary-foreground" : "bg-background/30 text-muted-foreground"
                )}
              >
                מחיר ליחידה
              </button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-muted-foreground">
                {reverseMode === "profit"
                  ? `הכנס רווח רצוי לעסקה (${r.quantity.toLocaleString("he-IL")} יח')`
                  : reverseMode === "total"
                    ? `הכנס סכום עסקה כולל (${r.quantity.toLocaleString("he-IL")} יח')`
                    : "הכנס מחיר ליחידה"}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={reverseMode === "unit" ? 0.01 : 100}
                  value={reverseInput}
                  onChange={(e) => setReverseInput(e.target.value)}
                  placeholder={
                    reverseMode === "profit"
                      ? "למשל 500"
                      : reverseMode === "total"
                        ? "למשל 12000"
                        : "למשל 4.80"
                  }
                  className="w-full bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₪</span>
              </div>
            </div>
            {reverseResult && (
              <div className="flex flex-col items-end justify-end min-w-[12rem]">
                <div className={cn(
                  "text-2xl font-bold tabular-nums",
                  reverseResult.marginPct >= (currentMargin) ? "text-success" : reverseResult.marginPct < 0 ? "text-destructive" : "text-foreground"
                )}>
                  {r2(reverseResult.marginPct).toLocaleString("he-IL")}%
                </div>
                <div className="text-xs text-muted-foreground">אחוז רווח מובלע</div>
              </div>
            )}
          </div>
          {reverseResult && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/50 text-xs">
              <Stat label="מחיר ליחידה" value={`₪${ils(reverseResult.perUnit)}`} />
              <Stat label="סה״כ עסקה" value={`₪${ils(reverseResult.totalPrice)}`} />
              <Stat label="רווח ליחידה" value={`₪${ils(reverseResult.profitPerUnit)}`} tone={reverseResult.profitPerUnit < 0 ? "neg" : "pos"} />
              <Stat label="רווח כולל" value={`₪${ils(reverseResult.totalProfit)}`} tone={reverseResult.totalProfit < 0 ? "neg" : "pos"} />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            השוואה למרג'ין הנוכחי בהגדרות: {currentMargin}%. צבע ירוק = ≥ ההגדרה.
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        "tabular-nums font-semibold",
        tone === "pos" && "text-success",
        tone === "neg" && "text-destructive"
      )}>
        {value}
      </span>
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
