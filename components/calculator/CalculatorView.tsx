"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2, Send, Copy, Check, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Product, QuantityTier, ShippingOption, QuoteResult } from "@/lib/factory/calculator/types";
import { computeCommission } from "@/lib/factory/commission";
import { isOverCbmConsolidationThreshold, cbmConsolidationAlert } from "@/lib/factory/sea-carriers";
import { customerBreakdownIls } from "@/lib/factory/calculator/customer-breakdown";
import { DetailedBreakdown } from "./DetailedBreakdown";

interface Props {
  products: Product[];
  quantityTiers: QuantityTier[];
  shippingOptions: ShippingOption[];
  initialMargins: Record<string, number>;
  // Optional widget-mode token. When set, all fetches append
  // `&widget_token=<value>` so middleware lets the request through without
  // an albadi_auth cookie. Empty in normal dashboard mode.
  apiToken?: string;
  // Optional lead sid (waJid for bridge-origin leads). When present, a
  // "send quote text to lead via WhatsApp" action becomes available so
  // Eli can fire off a quick manual quote from the calculator without
  // touching the factory pipeline.
  sid?: string;
  // Lead display name for the WA greeting. Optional.
  leadName?: string | null;
}

interface PreviewResult {
  result: QuoteResult;
  altResult: QuoteResult | null;
  computed: {
    productionPerUnitIls: number;
    shippingPerUnitIls: number;
    usdToIls: number;
    usdToCny: number;
    commissionPct?: number;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ils = (n: number) =>
  n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CalculatorView({ products, quantityTiers, shippingOptions, initialMargins, apiToken, sid, leadName }: Props) {
  const [productId, setProductId] = useState(products[0]?.id ?? "p1");
  const [qtyId, setQtyId]         = useState(quantityTiers[0]?.id ?? "q0");
  const [handles, setHandles]     = useState(true);
  const [lamination, setLamination] = useState(false);
  const [colors, setColors]       = useState(1);
  const [shippingId, setShippingId] = useState(shippingOptions.find((s) => s.type === "sea")?.id ?? shippingOptions[0]?.id ?? "s2");
  const [qtyOverride, setQtyOverride] = useState<string>("");
  const [marginOverride, setMarginOverride] = useState<string>("");
  const [minProfit, setMinProfit] = useState<string>("");
  // One-time mold/tooling fee from the factory (¥ CNY). Empty = none.
  const [moldsCost, setMoldsCost] = useState<string>("");
  const [reverseMode, setReverseMode] = useState<"total" | "unit" | "profit">("profit");
  const [reverseInput, setReverseInput] = useState<string>("");
  const [preview, setPreview]     = useState<PreviewResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  // Top-level tab: the regular operator calculator vs the "estimated" calculator
  // (price an arbitrary 80g size from the per-factory model, no factory round-trip).
  const [tab, setTab] = useState<"operator" | "estimate">("operator");

  // Manual product mode — user enters dims + CNY + carton, no catalog match.
  const [manualMode, setManualMode] = useState(false);
  const [manualDesc, setManualDesc] = useState<string>("");
  const [manualW, setManualW] = useState<string>("");
  const [manualH, setManualH] = useState<string>("");
  const [manualD, setManualD] = useState<string>("");
  const [manualCny, setManualCny] = useState<string>("");
  const [manualCartonQty, setManualCartonQty] = useState<string>("250");
  const [manualCartonWeight, setManualCartonWeight] = useState<string>("");
  const [manualCartonL, setManualCartonL] = useState<string>("");
  const [manualCartonW, setManualCartonW] = useState<string>("");
  const [manualCartonH, setManualCartonH] = useState<string>("");

  const manualCnyNum = parseFloat(manualCny);
  const manualValid = manualMode && Number.isFinite(manualCnyNum) && manualCnyNum > 0;

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
  const marginOverrideValid = Number.isFinite(marginOverrideParsed) && marginOverrideParsed >= 0 && marginOverrideParsed < 100;
  const currentMargin = marginOverrideValid ? marginOverrideParsed : defaultMargin;
  const minProfitParsed = minProfit !== "" ? parseFloat(minProfit) : NaN;
  const minProfitValid = Number.isFinite(minProfitParsed) && minProfitParsed > 0;
  const moldsParsed = moldsCost !== "" ? parseFloat(moldsCost) : NaN;
  const moldsValid = Number.isFinite(moldsParsed) && moldsParsed > 0;

  const fetchPreview = useCallback(async () => {
    if (manualMode && !manualValid) {
      setPreview(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        product: manualMode ? "custom" : productId,
        qty: qtyId,
        handles: String(manualMode ? false : handles),
        lamination: String(manualMode ? false : lamination),
        colors: String(manualMode ? 1 : colors),
        shipping: shippingId,
        margin: String(currentMargin),
      });
      if (overrideValid) params.set("qtyOverride", String(overrideParsed));
      if (moldsValid) params.set("moldsCostCny", String(moldsParsed));
      if (manualMode) {
        params.set("customUnitCostCny", String(manualCnyNum));
        if (manualDesc.trim()) params.set("customDescription", manualDesc.trim());
        if (manualW) params.set("customWidthCm", manualW);
        if (manualH) params.set("customHeightCm", manualH);
        if (manualD) params.set("customDepthCm", manualD);
        if (manualCartonQty) params.set("customCartonQty", manualCartonQty);
        if (manualCartonWeight) params.set("customCartonWeight", manualCartonWeight);
        if (manualCartonL) params.set("customCartonLength", manualCartonL);
        if (manualCartonW) params.set("customCartonWidth", manualCartonW);
        if (manualCartonH) params.set("customCartonHeight", manualCartonH);
      }
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
  }, [
    manualMode, manualValid, manualCnyNum, manualDesc,
    manualW, manualH, manualD,
    manualCartonQty, manualCartonWeight, manualCartonL, manualCartonW, manualCartonH,
    productId, qtyId, handles, lamination, colors, shippingId, currentMargin, overrideValid, overrideParsed,
    moldsValid, moldsParsed,
  ]);

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
    // MARGIN-on-price: profit ÷ product price (excl shipping).
    const productPrice = perUnit - c.shippingPerUnitIls;
    const marginPct = productPrice > 0 ? ((productPrice - base) / productPrice) * 100 : 0;
    const profitPerUnit = perUnit - r.totalCostPerUnitIls;
    const totalProfit = profitPerUnit * r.quantity;
    const totalPrice = perUnit * r.quantity;
    return { marginPct, profitPerUnit, totalProfit, perUnit, totalPrice };
  }, [r, c, reverseInput, reverseMode]);

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      {/* Top-level tab: regular vs estimated calculator */}
      <div className="inline-flex self-start rounded-lg border border-border bg-background/40 p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setTab("operator")}
          className={cn("px-4 py-1.5 rounded-md", tab === "operator" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
        >
          מחשבון
        </button>
        <button
          type="button"
          onClick={() => setTab("estimate")}
          className={cn("px-4 py-1.5 rounded-md", tab === "estimate" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
        >
          מחשבון משוער ✨
        </button>
      </div>

      {tab === "estimate" && (
        <EstimateTab apiToken={apiToken} shippingOptions={shippingOptions} sid={sid} leadName={leadName} />
      )}

      {tab === "operator" && (<>
      {/* Form */}
      <section className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
        {/* Mode toggle */}
        <div className="inline-flex self-start rounded-md border border-border bg-background/40 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setManualMode(false)}
            className={cn(
              "px-3 py-1 rounded",
              !manualMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
          >
            מוצר מקטלוג
          </button>
          <button
            type="button"
            onClick={() => setManualMode(true)}
            className={cn(
              "px-3 py-1 rounded",
              manualMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
          >
            מוצר ידני
          </button>
        </div>

        {!manualMode ? (
          /* Product */
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
        ) : (
          /* Manual product spec */
          <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="text-[11px] text-muted-foreground">
              מוצר מותאם אישית — הזן עלות סינית, מידות, ופרטי קרטון. הרווח/שילוח מחושב לפי הגדרות המערכת.
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">תיאור המוצר</label>
              <input
                type="text"
                placeholder="למשל: שקית פוליאסטר עם רוכסן"
                value={manualDesc}
                onChange={(e) => setManualDesc(e.target.value)}
                className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <NumField label="גובה (ס״מ)" value={manualH} onChange={setManualH} placeholder="30" />
              <NumField label="עומק (ס״מ)" value={manualD} onChange={setManualD} placeholder="10" />
              <NumField label="רוחב (ס״מ)" value={manualW} onChange={setManualW} placeholder="40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">עלות סינית ליחידה (¥ CNY)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="למשל 1.20"
                value={manualCny}
                onChange={(e) => setManualCny(e.target.value)}
                className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              {!manualValid && (
                <span className="text-[11px] text-warning">חובה להזין עלות סינית גדולה מ-0</span>
              )}
            </div>
            <div className="pt-2 border-t border-primary/20 flex flex-col gap-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">קרטון מאסטר</div>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="יחידות לקרטון" value={manualCartonQty} onChange={setManualCartonQty} placeholder="250" />
                <NumField label="משקל קרטון (ק״ג)" value={manualCartonWeight} onChange={setManualCartonWeight} placeholder="5" step={0.1} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <NumField label="אורך (ס״מ)" value={manualCartonL} onChange={setManualCartonL} placeholder="40" />
                <NumField label="רוחב (ס״מ)" value={manualCartonW} onChange={setManualCartonW} placeholder="30" />
                <NumField label="גובה (ס״מ)" value={manualCartonH} onChange={setManualCartonH} placeholder="40" />
              </div>
            </div>
          </div>
        )}

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

          {/* Colors — catalog only */}
          {!manualMode && (
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
          )}
        </div>

        {/* Toggles — catalog only */}
        {!manualMode && (
          <div className="flex gap-6">
            <Toggle label="ידיות" value={handles} onChange={setHandles} />
            <Toggle label="למינציה" value={lamination} onChange={setLamination} />
          </div>
        )}

        {/* One-time mold/tooling fee (¥ CNY) — amortized across the order */}
        <div className="pt-2 border-t border-border/50 flex flex-col gap-1">
          <label className="text-sm font-medium">מולדים / תבניות (¥ CNY) — חד פעמי</label>
          <input
            type="number"
            min={0}
            step={50}
            placeholder="למשל 2000"
            value={moldsCost}
            onChange={(e) => setMoldsCost(e.target.value)}
            className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <span className="text-[11px] text-muted-foreground">
            {moldsValid
              ? `מתחלק על ${effectiveQty.toLocaleString("he-IL")} יח׳ = ¥${(moldsParsed / effectiveQty).toFixed(3)} ליחידה (נכלל בעלות מפעל וברווח)`
              : "ריק → ללא עלות מולדים"}
          </span>
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
            // MARGIN-on-price: profit ÷ (cost + profit) at the target.
            const requiredMarginPct =
              minProfitParsed > 0 ? ((minProfitParsed / (totalCost + minProfitParsed)) * 100) : 0;
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
          commissionPct={c.commissionPct}
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
            moldsPerUnitCny: r.moldsPerUnitCny,
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

      {/* Quote → WhatsApp / Copy. Only when widget is loaded with a lead
          context (sid present) and the calculator has a fresh result. */}
      {r && c && !loading && (
        <QuoteShareCard
          apiToken={apiToken}
          sid={sid}
          leadName={leadName}
          quoteText={buildQuoteText({
            leadName: leadName ?? null,
            product: manualMode
              ? null
              : products.find((p) => p.id === productId) ?? null,
            manualDescription: manualMode
              ? (() => {
                  const dimsParts: string[] = [];
                  if (manualH) dimsParts.push(`H${manualH}`);
                  if (manualD) dimsParts.push(`D${manualD}`);
                  if (manualW) dimsParts.push(`W${manualW}`);
                  const dims = dimsParts.join("*");
                  const desc = manualDesc.trim() || "מוצר מותאם";
                  return dims ? `${dims} — ${desc}` : desc;
                })()
              : null,
            quantity: r.quantity,
            shippingName: r.shippingOption?.name ?? null,
            shippingType:
              r.shippingOption?.type === "sea" || r.shippingOption?.type === "air"
                ? r.shippingOption.type
                : null,
            unitSellingPriceIls: r.sellingPricePerUnitIls,
            totalSellingPriceIls: r.totalOrderPriceIls,
            shippingPerUnitIls: c.shippingPerUnitIls,
            totalShippingIls: c.shippingPerUnitIls * r.quantity,
            result: r,
          })}
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
      </>)}
    </div>
  );
}

interface EstimateApiResponse {
  ok: boolean;
  estimate: {
    ok: boolean;
    refused?: string;
    factoryName?: string;
    factoryUnitCostCny?: number;
    plateFeeOneTimeCny?: number;
    confidence?: "high" | "medium" | "low";
    reasoning?: string[];
    areaCm2?: number;
    carton?: { qty: number; weightKg: number; lengthCm: number; widthCm: number; heightCm: number; cbmPerUnit: number; confidence: "high" | "low"; weightApprox: boolean };
    candidates?: { factory: string; unitCny: number; inRange: boolean }[];
  };
  result?: QuoteResult;
  altResult?: QuoteResult | null;
  computed?: { productionPerUnitIls: number; shippingPerUnitIls: number; usdToIls: number; usdToCny: number; commissionPct?: number };
}

const SELECT_CLS = "bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30";

function ConfidenceBadge({ confidence }: { confidence?: string }) {
  const map: Record<string, [string, string]> = {
    high: ["bg-success/15 text-success", "ביטחון גבוה"],
    medium: ["bg-amber-500/15 text-amber-600", "ביטחון בינוני"],
    low: ["bg-destructive/15 text-destructive", "ביטחון נמוך"],
  };
  const [cls, label] = map[confidence ?? "medium"] ?? map.medium;
  return <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cls)}>{label}</span>;
}

function EstimateTab({ apiToken, shippingOptions, sid, leadName }: { apiToken?: string; shippingOptions: ShippingOption[]; sid?: string; leadName?: string | null }) {
  const [h, setH] = useState(""); const [d, setD] = useState(""); const [w, setW] = useState("");
  const [qty, setQty] = useState("5000");
  const [colors, setColors] = useState(1);
  const [handles, setHandles] = useState(true);
  const [lam, setLam] = useState(false);
  const [shippingId, setShippingId] = useState(shippingOptions.find((s) => s.type === "sea")?.id ?? shippingOptions[0]?.id ?? "s2");
  const [data, setData] = useState<EstimateApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hN = parseFloat(h), wN = parseFloat(w);
  const valid = Number.isFinite(hN) && hN > 0 && Number.isFinite(wN) && wN > 0;

  const run = useCallback(async () => {
    if (!valid) { setData(null); return; }
    setLoading(true); setErr(null);
    try {
      const p = new URLSearchParams({ heightCm: h, depthCm: d || "0", widthCm: w, qty, colors: String(colors), handles: String(handles), lamination: String(lam), shipping: shippingId });
      if (apiToken) p.set("widget_token", apiToken);
      const res = await fetch(`/api/factory/estimate?${p}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) { setErr(j.error ?? `HTTP ${res.status}`); setData(null); return; }
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setData(null); } finally { setLoading(false); }
  }, [valid, h, d, w, qty, colors, handles, lam, shippingId, apiToken]);

  useEffect(() => { run(); }, [run]);

  const est = data?.estimate;
  const r = data?.result; const c = data?.computed;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4">
        <div className="text-[11px] text-muted-foreground">
          הזן מידות וכמות → המערכת תחזה את המחיר לפי המחירונים האמיתיים של המפעלים (80g, עד 10,000 יח׳), תבחר את המפעל הזול שמייצר, ותראה את ההיגיון. מחוץ לטווח → &quot;שלח למפעל&quot;.
        </div>
        <div className="grid grid-cols-3 gap-3">
          <NumField label="גובה H (ס״מ)" value={h} onChange={setH} placeholder="30" />
          <NumField label="עומק D (ס״מ)" value={d} onChange={setD} placeholder="10" />
          <NumField label="רוחב W (ס״מ)" value={w} onChange={setW} placeholder="40" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">כמות</label>
            <select value={qty} onChange={(e) => setQty(e.target.value)} className={SELECT_CLS}>
              <option value="3000">3,000</option><option value="5000">5,000</option><option value="10000">10,000</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">צבעי לוגו</label>
            <select value={colors} onChange={(e) => setColors(Number(e.target.value))} className={SELECT_CLS}>
              <option value={1}>1 צבע</option><option value={2}>2 צבעים</option><option value={3}>3 צבעים</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">שילוח</label>
            <select value={shippingId} onChange={(e) => setShippingId(e.target.value)} className={SELECT_CLS}>
              {shippingOptions.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
        </div>
        <div className="flex gap-6">
          <Toggle label="ידיות" value={handles} onChange={setHandles} />
          <Toggle label="למינציה" value={lam} onChange={setLam} />
        </div>
      </section>

      {loading && (<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />מחשב…</div>)}
      {err && (<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{err}</div>)}

      {!loading && est && !est.ok && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-5 text-sm">
          <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">⚠️ לא ניתן לאמוד — שלח למפעל</div>
          <div className="text-muted-foreground">{est.refused}</div>
          {est.candidates && est.candidates.length > 0 && (
            <div className="text-[11px] text-muted-foreground mt-2">מחירים שנבדקו: {est.candidates.map((x) => `${x.factory} ¥${x.unitCny}${x.inRange ? "" : " (מחוץ לטווח)"}`).join(" · ")}</div>
          )}
        </div>
      )}

      {!loading && est && est.ok && r && c && (
        <>
          <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">מפעל מומלץ:</span>
            <span className="rounded-full bg-primary/10 text-primary px-3 py-1 text-sm font-bold">{est.factoryName}</span>
            <ConfidenceBadge confidence={est.confidence} />
            <span className="text-xs text-muted-foreground tabular-nums">שטח {Math.round(est.areaCm2 ?? 0)} ס״מ² · עלות מפעל ¥{est.factoryUnitCostCny}{est.plateFeeOneTimeCny ? ` · 版费 ¥${est.plateFeeOneTimeCny} חד‑פעמי` : ""}</span>
          </div>

          {est.reasoning && (
            <section className="rounded-xl border border-border bg-background/40 p-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">ההיגיון מאחורי המחיר</h3>
              <ul className="flex flex-col gap-1 text-xs tabular-nums">
                {est.reasoning.map((step, i) => (<li key={i} className="text-foreground/90">• {step}</li>))}
              </ul>
            </section>
          )}

          {est.carton && (
            <section className={cn("rounded-xl border p-4", est.carton.confidence === "low" ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-background/40")}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">מידות אריזה (אומדן)</h3>
                {est.carton.confidence === "low"
                  ? <span className="rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-400 px-2.5 py-0.5 text-[11px] font-semibold">לאמת מול מפעל</span>
                  : <span className="rounded-full bg-success/15 text-success px-2.5 py-0.5 text-[11px] font-semibold">±10%</span>}
              </div>
              {est.carton.confidence === "low" && (
                <div className="text-[11px] text-amber-700 dark:text-amber-400 mb-2">צורה שטוחה/חריגה — אומדן הנפח לא אמין. הקרטון להלן בערך בלבד; מומלץ לאמת מול המפעל.</div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
                <Stat label="קרטון (ס״מ)" value={`${est.carton.lengthCm}×${est.carton.widthCm}×${est.carton.heightCm} ≈`} />
                <Stat label="יח׳ לקרטון" value={`${est.carton.qty}`} />
                <Stat label="CBM ליחידה" value={est.carton.cbmPerUnit.toFixed(5)} />
                <Stat label={`סה״כ CBM (${r.quantity.toLocaleString("he-IL")} יח׳)`} value={r.totalCbm.toFixed(3)} />
                <Stat label="קרטונים" value={`${r.totalCartons}`} />
                <Stat label="משקל (ק״ג)" value={`${r.totalWeightKg.toLocaleString("he-IL")} ≈`} />
              </div>
              <div className="text-[10px] text-muted-foreground mt-2">
                ה‑CBM הוא המספר הקובע לשילוח ימי (≈90% מההזמנות). המשקל אומדן-בד גס — רלוונטי לאוויר בלבד, לא נתון מפעל.
              </div>
            </section>
          )}

          <BreakdownCard result={r} computed={c} />
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
            commissionPct={c.commissionPct}
            totalCartons={r.totalCartons}
            totalWeightKg={r.totalWeightKg}
            totalCbm={r.totalCbm}
            shippingType={r.shippingOption?.type === "sea" || r.shippingOption?.type === "air" ? r.shippingOption.type : null}
            factoryUnitCostCny={r.unitProductionCny}
            usdToIls={c.usdToIls}
            usdToCny={c.usdToCny}
            seaRate={r.shippingOption?.type === "sea" ? shippingOptions.find((s) => s.id === r.shippingOption?.id)?.seaRate : undefined}
            rawCbm={r.totalCbm}
            seaMinCbm={1}
            plateFeeCnyPerUnit={r.plateFeeCny}
            components={{ baseBagCny: r.baseBagCny, handlesAddonCny: r.handlesAddonCny, laminationAddonCny: r.laminationAddonCny, plateFeeCny: r.plateFeeCny, logoAddonCny: r.logoAddonCny, moldsPerUnitCny: r.moldsPerUnitCny }}
            alt={data?.altResult ? { shippingType: data.altResult.shippingOption?.type === "air" ? "air" : "sea", unitSellingPrice: data.altResult.sellingPricePerUnitIls, totalSellingPrice: data.altResult.totalOrderPriceIls, shippingName: data.altResult.shippingOption?.name ?? null } : null}
          />
          <QuoteShareCard
            apiToken={apiToken}
            sid={sid}
            leadName={leadName}
            quoteText={buildQuoteText({
              leadName: leadName ?? null,
              product: null,
              manualDescription: `${`H${h}${d ? `*D${d}` : ""}*W${w}`} — אומדן ${est.factoryName}`,
              quantity: r.quantity,
              shippingName: r.shippingOption?.name ?? null,
              shippingType: r.shippingOption?.type === "sea" || r.shippingOption?.type === "air" ? r.shippingOption.type : null,
              unitSellingPriceIls: r.sellingPricePerUnitIls,
              totalSellingPriceIls: r.totalOrderPriceIls,
              shippingPerUnitIls: c.shippingPerUnitIls,
              totalShippingIls: c.shippingPerUnitIls * r.quantity,
              result: r,
            })}
          />
        </>
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
  computed: { productionPerUnitIls: number; shippingPerUnitIls: number; commissionPct?: number };
}) {
  const productionUnit = r2(c.productionPerUnitIls);
  const shippingUnit   = r2(c.shippingPerUnitIls);
  const totalCostUnit  = r2(r.totalCostPerUnitIls);
  const profitUnit     = r2(r.profitPerUnitIls);

  const productionTotal = r2(productionUnit * r.quantity);
  const shippingTotal   = r2(shippingUnit * r.quantity);
  const totalCostTotal  = r2(r.totalCostPerUnitIls * r.quantity);

  // Salesperson commission — boss-only, display-only (does not change the
  // customer price). On the total order, out of profit.
  const comm = computeCommission(r.totalOrderPriceIls, r.totalProfitIls, c.commissionPct);

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
              { label: `עמלת מכירות (${comm.pct}% · ${Math.round(comm.ofProfitPct)}% מהרווח)`, value: `−₪${ils(comm.commission)}` },
              { label: "רווח נטו (אחרי עמלה)", value: `₪${ils(comm.netProfit)}`, bold: true, green: true },
              { label: "מחיר ללקוח", value: `₪${ils(r.totalOrderPriceIls)}`, hero: true },
            ]}
          />
        </div>
      </div>

      {/* >7 CBM consolidation signal — INTERNAL only. Above 7 CBM sea cost
          drops sharply (container/consolidation) so Eli can revise the offer. */}
      {isOverCbmConsolidationThreshold(r.totalCbm) && (
        <div className="border-t border-amber-500/50 bg-amber-500/15 px-5 py-3 text-center text-sm font-bold text-amber-700 dark:text-amber-400">
          🚢 {cbmConsolidationAlert(r.totalCbm)}
        </div>
      )}

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

      {/* Air weight breakdown — physical vs volumetric vs chargeable.
          Air is billed on the chargeable kg = max(physical, cbm × 167), so the
          bulky-but-light case is where volume wins. Sea ignores weight, so we
          only show this block for air. */}
      {r.shippingOption?.type === "air" && (
        <div className="border-t border-border px-5 py-3 text-xs tabular-nums">
          <div className="text-muted-foreground mb-2 text-center">פירוט משקל לחיוב אווירי</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-muted-foreground">משקל פיזי</div>
              <div className="font-medium">{r.totalWeightKg.toLocaleString("he-IL")} ק״ג</div>
            </div>
            <div>
              <div className="text-muted-foreground">משקל נפחי</div>
              <div className="font-medium">{r.volumetricWeightKg.toLocaleString("he-IL")} ק״ג</div>
            </div>
            <div>
              <div className="text-muted-foreground">משקל לחיוב</div>
              <div
                className={
                  r.chargeableWeightKg > r.totalWeightKg
                    ? "font-bold text-amber-500"
                    : "font-bold"
                }
              >
                {r.chargeableWeightKg.toLocaleString("he-IL")} ק״ג
              </div>
            </div>
          </div>
          <div className="text-muted-foreground text-center mt-2 text-[11px]">
            {r.chargeableWeightKg > r.totalWeightKg
              ? `הנפח גובר — מחויב לפי ${r.volumetricWeightKg.toLocaleString("he-IL")} ק״ג (CBM × 167)`
              : "המשקל הפיזי גובר — מחויב לפי המשקל בפועל"}
          </div>
        </div>
      )}
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

// -----------------------------------------------------------------------------
// Quote → text + WhatsApp share. Used when /widget/calculator is loaded with a
// lead context (sid). Builds the same Hebrew layout the bot uses for quote
// messages so the customer sees a familiar format whether the quote was
// generated automatically or manually by Eli on a phone call.
// -----------------------------------------------------------------------------

function buildQuoteText(opts: {
  leadName: string | null;
  product: Product | null;
  manualDescription?: string | null;
  quantity: number;
  shippingName: string | null;
  shippingType: "sea" | "air" | null | undefined;
  unitSellingPriceIls: number;
  totalSellingPriceIls: number;
  shippingPerUnitIls: number;
  totalShippingIls: number;
  /** Full quote result — drives the customer-safe itemised breakdown. */
  result: QuoteResult;
}): string {
  const ilsFmt = (n: number) =>
    `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
  const qty = opts.quantity.toLocaleString("he-IL");
  const greeting = opts.leadName ? `היי ${opts.leadName} 👋` : "היי 👋";
  const productDesc = opts.product
    ? `${opts.product.dimensions} — ${opts.product.description}`
    : opts.manualDescription ?? null;
  const shippingMethod = opts.shippingName
    ? `${opts.shippingName}${opts.shippingType === "air" ? " (אווירי)" : opts.shippingType === "sea" ? " (ימי)" : ""}`
    : null;

  // Customer-safe per-unit breakdown (shipping folded into the base line; no
  // costs/margin). Each chosen option is shown as its own up-charge so the
  // customer sees exactly what lamination / handles / colours add.
  const b = customerBreakdownIls(opts.result);
  const hasLamination = opts.result.selectedFeatures.some((f) => f.id === "f1");
  const logoColors = opts.result.logoColors;

  const lines: (string | null)[] = [
    greeting,
    "",
    "*הצעת מחיר*",
    "",
    "📦 *פרטי המוצר*",
    productDesc ? `מוצר: ${productDesc}` : null,
    `כמות: ${qty} יח׳`,
    "",
    "💰 *תמחור — מחיר ליחידה* _(כולל שילוח)_",
    `▪️ שקית${shippingMethod ? " + שילוח" : ""}: ${ilsFmt(b.productIls)}`,
    opts.result.hasHandles && b.handlesIls > 0
      ? `▪️ ידיות: +${ilsFmt(b.handlesIls)}`
      : null,
    hasLamination && b.laminationIls > 0
      ? `▪️ למינציה: +${ilsFmt(b.laminationIls)}`
      : null,
    !hasLamination && b.logoColorsIls > 0
      ? `▪️ צבעי לוגו (${logoColors}): +${ilsFmt(b.logoColorsIls)}`
      : null,
    "",
    `📦 ${qty} יחידות × ${ilsFmt(opts.unitSellingPriceIls)}`,
  ];
  if (shippingMethod) {
    lines.push(`🚚 שיטת שילוח: ${shippingMethod}`);
  }
  lines.push(
    `*💵 סה״כ: ${ilsFmt(opts.totalSellingPriceIls)}*`,
    "_(לא כולל מע״מ)_",
    "",
    "━━━━━━━━━━━━━━",
    "ההצעה בתוקף ל-14 יום",
    "נשמח לקבל את אישורך 🙂",
  );
  return lines.filter((l) => l !== null).join("\n");
}

interface LeadPickerOption {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  updatedAt: string;
}

function QuoteShareCard({
  apiToken,
  sid,
  leadName,
  quoteText,
}: {
  apiToken: string | undefined;
  sid: string | undefined;
  leadName: string | null | undefined;
  quoteText: string;
}) {
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lead picker — defaults to the URL-provided sid/leadName when the widget
  // was opened from a contact card, but Eli can always switch to any other
  // lead from inside the calculator (e.g. when bouncing between calls).
  const [pickedSid, setPickedSid] = useState<string | null>(sid ?? null);
  const [pickedName, setPickedName] = useState<string | null>(leadName ?? null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<LeadPickerOption[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep picker in sync if the URL-provided sid changes (e.g. parent
  // reloads with a different contactId).
  useEffect(() => {
    if (sid && sid !== pickedSid) {
      setPickedSid(sid);
      setPickedName(leadName ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, leadName]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!apiToken) return;
      setLoadingResults(true);
      try {
        const res = await fetch(
          `/api/widget/leads/recent?widget_token=${encodeURIComponent(apiToken)}&q=${encodeURIComponent(q)}`
        );
        const data = await res.json();
        if (data?.ok) setResults(data.leads || []);
      } catch {
        // ignore — picker just stays empty
      } finally {
        setLoadingResults(false);
      }
    },
    [apiToken]
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runSearch]);

  // Close picker on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const pickLead = (lead: LeadPickerOption) => {
    setPickedSid(lead.sid);
    setPickedName(lead.name);
    setOpen(false);
    setQuery("");
    setStatus(null);
    setError(null);
  };

  const clearLead = () => {
    setPickedSid(null);
    setPickedName(null);
    setStatus(null);
    setError(null);
    setOpen(true);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(quoteText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    if (!pickedSid || !apiToken) return;
    if (!confirm(`לשלוח את ההצעה ל-${pickedName ?? "לקוח"} ב-WhatsApp?`)) return;
    setSending(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/widget/calculator/send-text?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid: pickedSid, text: quoteText }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        setError(j?.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus(`נשלח ל-${pickedName ?? "לקוח"} בהצלחה ✓`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-medium">📨 שליחת ההצעה ללקוח</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs hover:bg-secondary"
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            {copied ? "הועתק" : "העתק טקסט"}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!pickedSid || !apiToken || sending}
            title={!pickedSid ? "בחר ליד כדי לאפשר שליחה" : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {sending ? "שולח…" : "שלח בווצאפ"}
          </button>
        </div>
      </div>

      {/* Lead picker */}
      <div ref={containerRef} className="relative">
        {pickedSid && !open ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">
                {pickedName ?? "(ללא שם)"}
              </div>
              <div className="text-[11px] text-muted-foreground truncate tabular-nums">
                sid {pickedSid}
              </div>
            </div>
            <button
              type="button"
              onClick={clearLead}
              title="בחר ליד אחר"
              className="size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                setOpen(true);
                if (results.length === 0) runSearch(query.trim());
              }}
              placeholder="חפש ליד לפי שם / טלפון / sid"
              className="w-full rounded-md border border-border bg-background pr-8 pl-3 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
        )}
        {open && (
          <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-xl max-h-72 overflow-auto">
            {loadingResults ? (
              <div className="px-3 py-4 text-[11px] text-muted-foreground flex items-center gap-2 justify-center">
                <Loader2 className="size-3 animate-spin" />
                טוען…
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">
                לא נמצאו לידים.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {results.map((r) => (
                  <li key={r.sid}>
                    <button
                      type="button"
                      onClick={() => pickLead(r)}
                      className="w-full px-3 py-2 text-right hover:bg-accent flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{r.name || "(ללא שם)"}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums truncate">
                          {r.phone || r.sid}
                          {r.stage ? ` · ${r.stage}` : ""}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <textarea
        readOnly
        value={quoteText}
        className="w-full min-h-[220px] bg-background/30 border border-border rounded-md px-3 py-2 text-xs leading-relaxed font-mono whitespace-pre-wrap focus:outline-none"
      />
      {status && <p className="text-[11px] text-success">{status}</p>}
      {error && <p className="text-[11px] text-destructive">⚠️ {error}</p>}
    </section>
  );
}

function NumField({
  label,
  value,
  onChange,
  placeholder,
  step = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium">{label}</label>
      <input
        type="number"
        min={0}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
    </div>
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
