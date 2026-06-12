"use client";

/**
 * Widget variant — calls /api/widget/factory/* with widget_token.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Sparkles } from "lucide-react";
import type { FactoryQuoteRow } from "./types";
import type {
  FactoryPricingConfig,
  FactoryPricingResult,
  FactoryProductSpec,
  FactoryResponse,
  ShippingOption,
} from "@/lib/factory/types";
import { priceFactoryQuote, marginPctFromUnitPrice } from "@/lib/factory/pricing";
import { computeCombined, priceQuoteForCombine } from "@/lib/factory/combined";
import { DetailedBreakdown } from "@/components/calculator/DetailedBreakdown";
import { widgetUrl } from "./widget-url";

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

export function FinalizeModalWidget({
  apiToken,
  row,
  onClose,
  onFinalized,
}: {
  apiToken: string;
  row: FactoryQuoteRow;
  onClose: () => void;
  onFinalized: () => void;
}) {
  const [config, setConfig] = useState<FactoryPricingConfig | null>(null);
  const [margin, setMargin] = useState<number>(row.finalPricing?.profitMarginPct ?? 40);
  const [shippingOptionId, setShippingOptionId] = useState<string>(
    row.finalPricing?.shippingOptionId ?? row.productSpec.shippingOptionId ?? ""
  );
  const [moldsCost, setMoldsCost] = useState<string>(
    row.finalPricing?.moldsTotalCny && row.finalPricing.moldsTotalCny > 0
      ? String(row.finalPricing.moldsTotalCny)
      : ""
  );
  const moldsParsed = moldsCost !== "" ? parseFloat(moldsCost) : NaN;
  const moldsValid = Number.isFinite(moldsParsed) && moldsParsed > 0;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reverseMode, setReverseMode] = useState<"profit" | "total" | "unit">("profit");
  const [reverseInput, setReverseInput] = useState<string>("");

  // Editable product details that flow into the customer PDF. Pre-filled from
  // the stored spec (kept in sync with the Feishu table by the refresh), and
  // editable here before the PDF is generated.
  const s0 = row.productSpec;
  const [productName, setProductName] = useState<string>(s0.productName ?? "");
  const [picUrl, setPicUrl] = useState<string>(s0.picUrl ?? "");
  const [uploadingImg, setUploadingImg] = useState(false);
  const [pullingImg, setPullingImg] = useState(false);
  const [material, setMaterial] = useState<string>(s0.material ?? "");
  const [widthCm, setWidthCm] = useState<string>(s0.widthCm ? String(s0.widthCm) : "");
  const [heightCm, setHeightCm] = useState<string>(s0.heightCm ? String(s0.heightCm) : "");
  const [depthCm, setDepthCm] = useState<string>(s0.depthCm ? String(s0.depthCm) : "");
  const [qtyStr, setQtyStr] = useState<string>(s0.quantity ? String(s0.quantity) : "");
  const [printing, setPrinting] = useState<string>(s0.printing ?? "");
  const [finishing, setFinishing] = useState<string>(s0.finishing ?? "");
  const [customerNotes, setCustomerNotes] = useState<string>(s0.customerNotes ?? "");
  const qtyNum = Math.max(1, Math.floor(Number(qtyStr) || s0.quantity || 1));

  // "חישוב משולב" — other finalized quotes of this customer that ship together.
  const [otherQuotes, setOtherQuotes] = useState<
    {
      id: string;
      quotationNo: string | null;
      productSpec: FactoryProductSpec;
      factoryResponse: FactoryResponse | null;
      finalPricing: FactoryPricingResult | null;
    }[]
  >([]);
  const [combinedSel, setCombinedSel] = useState<Set<string>>(new Set());
  const toggleCombined = (id: string) =>
    setCombinedSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const MARGIN_MIN = 0;
  // margin-on-price is capped below 100% (profit can't be ≥ the price)
  const MARGIN_MAX = 99;

  useEffect(() => {
    fetch(widgetUrl("/api/widget/factory/config", apiToken))
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data?.config) {
          setConfig(data.config);
          if (!shippingOptionId) {
            const first = (data.config.shippingOptions as ShippingOption[]).find((s) => s.enabled);
            if (first) setShippingOptionId(first.id);
          }
          // Fresh finalize → snap-down to per-qty margin matrix.
          // Re-finalize → keep existing.
          if (!row.finalPricing) {
            const cfg = data.config as FactoryPricingConfig;
            const matrix = cfg.profitMarginByQuantity;
            if (matrix && Object.keys(matrix).length > 0) {
              const qty = row.productSpec.quantity;
              if (matrix[String(qty)] !== undefined) {
                setMargin(matrix[String(qty)]);
              } else {
                const keys = Object.keys(matrix).map(Number).sort((a, b) => a - b);
                let best = keys[0];
                for (const k of keys) if (k <= qty) best = k;
                setMargin(matrix[String(best)] ?? cfg.defaultProfitMargin);
              }
            } else if (cfg.defaultProfitMargin !== undefined) {
              setMargin(cfg.defaultProfitMargin);
            }
          } else if (margin < MARGIN_MIN || margin > MARGIN_MAX) {
            setMargin(Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, data.config.defaultProfitMargin)));
          }
        }
      })
      .catch((err) => setError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const livePricing = useMemo(() => {
    if (!config || !row.factoryResponse) return null;
    return priceFactoryQuote(
      {
        factoryUnitCostCny: row.factoryResponse.unitCostCny,
        quantity: qtyNum,
        shippingOptionId: shippingOptionId || null,
        cartonSpec: {
          qty: row.factoryResponse.cartonQty,
          weightKg: row.factoryResponse.weightKg,
          cbm: row.factoryResponse.cartonCbm,
          lengthCm: row.factoryResponse.cartonLengthCm,
          widthCm: row.factoryResponse.cartonWidthCm,
          heightCm: row.factoryResponse.cartonHeightCm,
        },
        profitMarginOverride: margin,
        moldsCostCny: moldsValid ? moldsParsed : 0,
      },
      config
    );
  }, [config, row, shippingOptionId, margin, moldsValid, moldsParsed, qtyNum]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingImg(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(widgetUrl("/api/factory/upload-image", apiToken), {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data?.ok && data.url) setPicUrl(data.url);
      else setError(data?.message ?? data?.error ?? "העלאת התמונה נכשלה");
    } catch (err) {
      setError(err instanceof Error ? err.message : "העלאת התמונה נכשלה");
    } finally {
      setUploadingImg(false);
    }
  };

  // Auto-pull the embedded product image from Feishu when the screen opens
  // (once, only if the quote has no image yet) — like the price is pulled.
  useEffect(() => {
    if (s0.picUrl) return;
    let alive = true;
    (async () => {
      setPullingImg(true);
      try {
        const res = await fetch(widgetUrl(`/api/factory/${row.id}/pull-image`, apiToken), {
          method: "POST",
        });
        const data = await res.json();
        if (alive && data?.ok && data.url) setPicUrl(data.url);
      } catch {
        /* silent — the manual button stays available */
      } finally {
        if (alive) setPullingImg(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          widgetUrl("/api/widget/factory/list", apiToken, {
            lead: row.manychatSubId,
          })
        );
        const data = await res.json();
        const list = (data?.requests ?? []) as typeof otherQuotes;
        setOtherQuotes(
          list.filter((q) => q.id !== row.id && (q.finalPricing || q.factoryResponse))
        );
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const combinedResult = useMemo(() => {
    if (!livePricing || !config) return null;
    const shipId = shippingOptionId || livePricing.shippingOptionId;
    const sel = otherQuotes
      .filter((q) => combinedSel.has(q.id))
      .map((q) => priceQuoteForCombine(q, config, shipId))
      .filter((p): p is FactoryPricingResult => !!p);
    if (sel.length === 0) return null;
    const opt = config.shippingOptions.find((s) => s.id === shipId) ?? null;
    return computeCombined([livePricing, ...sel], opt, config.usdToIls);
  }, [livePricing, config, otherQuotes, combinedSel, shippingOptionId]);

  const handlePullImage = async () => {
    setPullingImg(true);
    setError(null);
    try {
      const res = await fetch(widgetUrl(`/api/factory/${row.id}/pull-image`, apiToken), {
        method: "POST",
      });
      const data = await res.json();
      if (data?.ok && data.url) setPicUrl(data.url);
      else
        setError(
          data?.error === "no_image_in_sheet"
            ? "אין תמונה בשורה של ההצעה ב-Feishu"
            : data?.error === "download_failed"
              ? "הורדת התמונה מ-Feishu נכשלה (ייתכן שחסרה הרשאת Drive לאפליקציה)"
              : data?.error ?? "משיכת התמונה נכשלה"
        );
    } catch (err) {
      setError(err instanceof Error ? err.message : "משיכת התמונה נכשלה");
    } finally {
      setPullingImg(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(widgetUrl(`/api/widget/factory/${row.id}/finalize`, apiToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profitMarginOverride: margin,
          shippingOptionId: shippingOptionId || undefined,
          moldsCostCny: moldsValid ? moldsParsed : undefined,
          specOverride: {
            productName: productName.trim() || undefined,
            picUrl: picUrl.trim() || undefined,
            material: material.trim() || undefined,
            widthCm: widthCm !== "" ? Number(widthCm) : undefined,
            heightCm: heightCm !== "" ? Number(heightCm) : undefined,
            depthCm: depthCm !== "" ? Number(depthCm) : undefined,
            quantity: qtyNum,
            printing: printing.trim() || undefined,
            finishing: finishing.trim() || undefined,
            customerNotes: customerNotes.trim() || undefined,
          },
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        onFinalized();
      } else {
        setError(data?.error ?? data?.detail ?? "כשל בחישוב");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-auto rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-lg font-semibold shrink-0">חישוב הצעה סופית</h2>
            <span className="text-xs font-mono text-muted-foreground truncate">
              #{row.quotationNo ?? row.id.slice(-6)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!config ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> טוען הגדרות…
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card/40 p-3 space-y-2.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  פרטי המוצר ל‑PDF (ניתן לעריכה)
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-0.5">
                    תמונת מוצר (נכנסת ל‑PDF)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={picUrl}
                      onChange={(e) => setPicUrl(e.target.value)}
                      placeholder="הדבק קישור או העלה תמונה"
                      className="flex-1 min-w-0 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                    />
                    <label className="shrink-0 cursor-pointer rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary/70">
                      {uploadingImg ? "מעלה…" : "העלה תמונה"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageUpload}
                        disabled={uploadingImg}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handlePullImage}
                      disabled={pullingImg}
                      title="משוך את התמונה מהשורה ב-Feishu"
                      className="shrink-0 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary/70 disabled:opacity-60"
                    >
                      {pullingImg ? "מושך…" : "משוך מ-Feishu"}
                    </button>
                    {picUrl.trim() ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={picUrl}
                        alt="תמונת מוצר"
                        className="size-12 shrink-0 rounded-md border border-border object-contain bg-background"
                      />
                    ) : (
                      <div className="size-12 shrink-0 rounded-md border border-dashed border-border grid place-items-center text-[9px] text-muted-foreground">
                        אין
                      </div>
                    )}
                  </div>
                </div>
                <SpecField label="שם המוצר (כותרת)" value={productName} onChange={setProductName} placeholder="שקית אלבדי" />
                <div className="grid grid-cols-3 gap-2">
                  <SpecField label="רוחב (ס״מ)" value={widthCm} onChange={setWidthCm} type="number" />
                  <SpecField label="גובה (ס״מ)" value={heightCm} onChange={setHeightCm} type="number" />
                  <SpecField label="עומק (ס״מ)" value={depthCm} onChange={setDepthCm} type="number" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SpecField label="כמות" value={qtyStr} onChange={setQtyStr} type="number" />
                  <SpecField label="חומר" value={material} onChange={setMaterial} placeholder="80g non-woven" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SpecField label="הדפסה" value={printing} onChange={setPrinting} />
                  <SpecField label="גימור" value={finishing} onChange={setFinishing} />
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-0.5">הערות ללקוח (ב‑PDF)</label>
                  <textarea
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    rows={2}
                    placeholder="טקסט חופשי שיופיע בתחתית ההצעה"
                    className="w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </div>
                <div className="flex justify-between text-xs pt-1.5 border-t border-border/40">
                  <span className="text-muted-foreground">עלות מפעל ליחידה:</span>
                  <span className="tabular-nums">¥{row.factoryResponse?.unitCostCny}</span>
                </div>
                {row.factoryResponse?.supplier && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">ספק:</span>
                    <span>{row.factoryResponse.supplier}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  מולדים / תבניות (¥ CNY) — חד פעמי
                </label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  placeholder="למשל 2000"
                  value={moldsCost}
                  onChange={(e) => setMoldsCost(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {moldsValid
                    ? `מתחלק על ${row.productSpec.quantity.toLocaleString("he-IL")} יח׳ = ¥${(moldsParsed / row.productSpec.quantity).toFixed(3)} ליחידה — נכלל בעלות מפעל וברווח`
                    : "ריק → ללא עלות מולדים"}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">שיטת שילוח</label>
                <select
                  value={shippingOptionId}
                  onChange={(e) => setShippingOptionId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— ללא שילוח —</option>
                  {config.shippingOptions
                    .filter((s) => s.enabled)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.type === "sea" ? "ים" : "אוויר"})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">אחוז רווח</label>
                  <span className="text-sm font-semibold text-primary tabular-nums">{margin}%</span>
                </div>
                <input
                  type="range"
                  min={MARGIN_MIN}
                  max={MARGIN_MAX}
                  step={1}
                  value={margin}
                  onChange={(e) => setMargin(parseInt(e.target.value, 10))}
                  className="w-full accent-[var(--color-primary,#4A7C59)]"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>99%</span>
                </div>
              </div>

              {livePricing && (
                <ReverseTargetPanel
                  unitCost={livePricing.unitCost}
                  unitShipping={livePricing.unitShipping}
                  quantity={row.productSpec.quantity}
                  mode={reverseMode}
                  setMode={setReverseMode}
                  inputValue={reverseInput}
                  setInputValue={setReverseInput}
                  marginMin={MARGIN_MIN}
                  marginMax={MARGIN_MAX}
                  onApply={(pct) => setMargin(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, Math.round(pct))))}
                />
              )}

              {livePricing && (
                <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-1.5 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-success/80">תוצאת חישוב חיה</div>
                  <PriceRow label="מחיר ללקוח / יחידה" value={formatIls(livePricing.unitSellingPrice)} bold />
                  <PriceRow label="סה״כ הזמנה" value={formatIls(livePricing.totalSellingPrice)} bold />
                  <div className="border-t border-success/20 my-1" />
                  <PriceRow label="עלות יחידה (CNY→₪)" value={formatIls(livePricing.unitCost)} />
                  {livePricing.moldsTotalCny > 0 && (
                    <PriceRow
                      label={`מולדים (¥${livePricing.moldsTotalCny} ÷ ${livePricing.quantity} יח׳)`}
                      value={`¥${livePricing.moldsPerUnitCny.toFixed(3)}/יח׳`}
                    />
                  )}
                  <PriceRow label="שילוח / יחידה" value={formatIls(livePricing.unitShipping)} />
                  <PriceRow label="רווח / יחידה" value={formatIls(livePricing.unitProfit)} highlight />
                  <PriceRow label="סה״כ רווח" value={formatIls(livePricing.totalProfit)} highlight />
                  <div className="border-t border-success/20 my-1" />
                  <PriceRow
                    label="לוגיסטיקה"
                    value={`${livePricing.totalCartons} קרטונים · ${livePricing.totalWeightKg}kg · ${livePricing.totalCbm}m³`}
                  />
                </div>
              )}

              {livePricing && config && row.factoryResponse && (
                <DetailedBreakdown
                  unitCost={livePricing.unitCost}
                  unitShipping={livePricing.unitShipping}
                  unitProfit={livePricing.unitProfit}
                  unitSellingPrice={livePricing.unitSellingPrice}
                  totalCost={livePricing.totalCost}
                  totalShipping={livePricing.totalShipping}
                  totalProfit={livePricing.totalProfit}
                  totalSellingPrice={livePricing.totalSellingPrice}
                  quantity={livePricing.quantity}
                  profitMarginPct={livePricing.profitMarginPct}
                  totalCartons={livePricing.totalCartons}
                  totalWeightKg={livePricing.totalWeightKg}
                  totalCbm={livePricing.totalCbm}
                  shippingType={
                    config.shippingOptions.find((s) => s.id === livePricing.shippingOptionId)?.type ?? null
                  }
                  factoryUnitCostCny={row.factoryResponse.unitCostCny}
                  usdToIls={config.usdToIls}
                  usdToCny={config.usdToCny}
                  seaRate={
                    config.shippingOptions.find((s) => s.id === livePricing.shippingOptionId && s.type === "sea")?.seaRate
                  }
                  rawCbm={livePricing.totalCbm}
                  seaMinCbm={1}
                />
              )}

              {otherQuotes.length > 0 && livePricing && config && (
                <div className="rounded-lg border border-border bg-card/40 p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    חישוב משולב — מוצרים שנשלחים יחד
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    סמן הזמנות נוספות של הלקוח שנשלחות במשלוח אחד — השילוח מחושב מחדש (זול יותר):
                  </div>
                  {otherQuotes.map((q) => (
                    <label key={q.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={combinedSel.has(q.id)}
                        onChange={() => toggleCombined(q.id)}
                        className="accent-[var(--color-primary,#4A7C59)]"
                      />
                      <span className="font-mono text-muted-foreground shrink-0">
                        {q.quotationNo ?? q.id.slice(-6)}
                      </span>
                      <span className="truncate flex-1">
                        {q.productSpec?.productName || q.productSpec?.description || "מוצר"}
                      </span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {formatIls(
                          priceQuoteForCombine(
                            q,
                            config,
                            shippingOptionId || livePricing.shippingOptionId
                          )?.totalSellingPrice ?? 0
                        )}
                      </span>
                    </label>
                  ))}
                  {combinedResult && (
                    <div className="rounded-md border border-success/30 bg-success/5 p-2.5 space-y-1.5 mt-1">
                      <div className="text-[10px] uppercase tracking-wider text-success/80">
                        תוצאה משולבת ({combinedResult.count} מוצרים)
                      </div>
                      <PriceRow
                        label="סה״כ נפח / משקל"
                        value={`${combinedResult.combinedCbm} m³ · ${combinedResult.combinedWeightKg}kg`}
                      />
                      <PriceRow
                        label="שילוח מאוחד"
                        value={`${formatIls(combinedResult.combinedShipping)} (בנפרד: ${formatIls(combinedResult.separateShipping)})`}
                      />
                      <PriceRow
                        label="חיסכון בשילוח ללקוח"
                        value={formatIls(combinedResult.shippingSaving)}
                        highlight
                      />
                      <div className="border-t border-success/20 my-1" />
                      <PriceRow
                        label="סה״כ ללקוח (משולב)"
                        value={`${formatIls(combinedResult.grandTotal)} (בנפרד: ${formatIls(combinedResult.separateGrandTotal)})`}
                        bold
                      />
                      <PriceRow
                        label="סה״כ רווח"
                        value={formatIls(combinedResult.totalProfit)}
                        highlight
                      />
                      <PriceRow label="מרווח כולל" value={`${combinedResult.overallMarginPct}%`} />
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm hover:bg-secondary"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !livePricing}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            חשב + שמור + הפק PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function ReverseTargetPanel({
  unitCost,
  unitShipping,
  quantity,
  mode,
  setMode,
  inputValue,
  setInputValue,
  marginMin,
  marginMax,
  onApply,
}: {
  unitCost: number;
  unitShipping: number;
  quantity: number;
  mode: "profit" | "total" | "unit";
  setMode: (m: "profit" | "total" | "unit") => void;
  inputValue: string;
  setInputValue: (v: string) => void;
  marginMin: number;
  marginMax: number;
  onApply: (pct: number) => void;
}) {
  // margin-on-price: margin is profit ÷ product price (excluding pass-through shipping).
  const n = parseFloat(inputValue);
  const valid = Number.isFinite(n) && n > 0;
  const base = unitCost;
  const totalCostPerUnit = unitCost + unitShipping;
  let perUnit = 0;
  let marginPct = 0;
  let profitPerUnit = 0;
  let totalProfit = 0;
  let totalPrice = 0;
  if (valid && base > 0) {
    if (mode === "profit") perUnit = totalCostPerUnit + n / quantity;
    else if (mode === "total") perUnit = n / quantity;
    else perUnit = n;
    marginPct = marginPctFromUnitPrice(perUnit, unitCost, unitShipping);
    profitPerUnit = perUnit - totalCostPerUnit;
    totalProfit = profitPerUnit * quantity;
    totalPrice = perUnit * quantity;
  }
  const outOfRange = valid && (marginPct < marginMin || marginPct > marginMax);
  const fmt = (x: number) =>
    `₪${x.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium">תמחור לפי יעד</span>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-[11px]">
          <ModeBtn active={mode === "profit"} onClick={() => setMode("profit")}>רווח ₪</ModeBtn>
          <ModeBtn active={mode === "total"} onClick={() => setMode("total")}>סכום כולל</ModeBtn>
          <ModeBtn active={mode === "unit"} onClick={() => setMode("unit")}>ליחידה</ModeBtn>
        </div>
      </div>
      <div className="relative">
        <input
          type="number"
          min={0}
          step={mode === "unit" ? 0.01 : 100}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={mode === "profit" ? "למשל 500" : mode === "total" ? "למשל 12000" : "למשל 4.80"}
          className="w-full rounded-md border border-border bg-background/40 px-3 py-1.5 pl-7 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₪</span>
      </div>
      {valid && base > 0 && (
        <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-border/40">
          <Stat label="% מובלע" value={`${Math.round(marginPct * 10) / 10}%`} tone={outOfRange ? "neg" : undefined} />
          <Stat label="מחיר ליחידה" value={fmt(perUnit)} />
          <Stat label="רווח ליחידה" value={fmt(profitPerUnit)} tone={profitPerUnit < 0 ? "neg" : "pos"} />
          <Stat label="רווח כולל" value={fmt(totalProfit)} tone={totalProfit < 0 ? "neg" : "pos"} />
          <Stat label="סה״כ עסקה" value={fmt(totalPrice)} />
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        {outOfRange && (
          <span className="text-[11px] text-destructive">
            {marginPct < marginMin ? "מתחת ל-" : "מעל "}
            {marginPct < marginMin ? marginMin : marginMax}% — ייחתך
          </span>
        )}
        <button
          type="button"
          disabled={!valid || base <= 0}
          onClick={() => onApply(marginPct)}
          className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          החל על סליידר
        </button>
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-2 py-1 border-l border-border last:border-l-0",
        active ? "bg-primary text-primary-foreground" : "bg-background/30 text-muted-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function SpecField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-muted-foreground mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={[
          "tabular-nums font-semibold",
          tone === "pos" ? "text-success" : "",
          tone === "neg" ? "text-destructive" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function PriceRow({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={[
          "tabular-nums text-right",
          bold ? "font-semibold" : "",
          highlight ? "text-success font-medium" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
