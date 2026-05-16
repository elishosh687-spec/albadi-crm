"use client";

/**
 * Finalize modal — slider 30-50% with live ₪ profit preview.
 *
 * Pulls factory config (shipping options + FX rates) on mount, recomputes
 * pricing client-side as the slider/shipping changes, then submits to
 * /api/factory/finalize/[id] which renders the PDF server-side.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Sparkles } from "lucide-react";
import type {
  FactoryQuoteRow,
} from "./FactoryQuotePanel";
import type {
  FactoryPricingConfig,
  ShippingOption,
} from "@/lib/factory/types";
import { priceFactoryQuote } from "@/lib/factory/pricing";

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

export function FinalizeModal({
  row,
  onClose,
  onFinalized,
}: {
  row: FactoryQuoteRow;
  onClose: () => void;
  onFinalized: () => void;
}) {
  const [config, setConfig] = useState<FactoryPricingConfig | null>(null);
  const [margin, setMargin] = useState<number>(
    row.finalPricing?.profitMarginPct ?? 40
  );
  const [shippingOptionId, setShippingOptionId] = useState<string>(
    // Priority: previously-finalized choice (re-finalizing an existing row) →
    // customer's bot-questionnaire choice (carried via productSpec) → empty
    // (effect below falls back to the first enabled option).
    row.finalPricing?.shippingOptionId ??
      row.productSpec.shippingOptionId ??
      ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/factory/config")
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data?.config) {
          setConfig(data.config);
          if (!shippingOptionId) {
            const first = (data.config.shippingOptions as ShippingOption[]).find(
              (s) => s.enabled
            );
            if (first) setShippingOptionId(first.id);
          }
          if (margin < 30 || margin > 50) {
            setMargin(Math.min(50, Math.max(30, data.config.defaultProfitMargin)));
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
        quantity: row.productSpec.quantity,
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
      },
      config
    );
  }, [config, row, shippingOptionId, margin]);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/factory/finalize/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profitMarginOverride: margin,
          shippingOptionId: shippingOptionId || undefined,
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-auto rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">חישוב הצעה סופית</h2>
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
              <div className="rounded-lg border border-border bg-card/40 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">עלות מפעל ליחידה:</span>
                  <span className="tabular-nums">
                    ¥{row.factoryResponse?.unitCostCny}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">כמות:</span>
                  <span className="tabular-nums">
                    {row.productSpec.quantity.toLocaleString("he-IL")}
                  </span>
                </div>
                {row.factoryResponse?.supplier && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ספק:</span>
                    <span>{row.factoryResponse.supplier}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  שיטת שילוח
                </label>
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
                  <span className="text-sm font-semibold text-primary tabular-nums">
                    {margin}%
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={50}
                  step={1}
                  value={margin}
                  onChange={(e) => setMargin(parseInt(e.target.value, 10))}
                  className="w-full accent-[var(--color-primary,#4A7C59)]"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>30%</span>
                  <span>40%</span>
                  <span>50%</span>
                </div>
              </div>

              {livePricing && (
                <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-1.5 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-success/80">
                    תוצאת חישוב חיה
                  </div>
                  <PriceRow
                    label="מחיר ללקוח / יחידה"
                    value={formatIls(livePricing.unitSellingPrice)}
                    bold
                  />
                  <PriceRow
                    label="סה״כ הזמנה"
                    value={formatIls(livePricing.totalSellingPrice)}
                    bold
                  />
                  <div className="border-t border-success/20 my-1" />
                  <PriceRow
                    label="עלות יחידה (CNY→₪)"
                    value={formatIls(livePricing.unitCost)}
                  />
                  <PriceRow
                    label="שילוח / יחידה"
                    value={formatIls(livePricing.unitShipping)}
                  />
                  <PriceRow
                    label="רווח / יחידה"
                    value={formatIls(livePricing.unitProfit)}
                    highlight
                  />
                  <PriceRow
                    label="סה״כ רווח"
                    value={formatIls(livePricing.totalProfit)}
                    highlight
                  />
                  <div className="border-t border-success/20 my-1" />
                  <PriceRow
                    label="לוגיסטיקה"
                    value={`${livePricing.totalCartons} קרטונים · ${livePricing.totalWeightKg}kg · ${livePricing.totalCbm}m³`}
                  />
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
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            חשב + שמור + הפק PDF
          </button>
        </div>
      </div>
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
