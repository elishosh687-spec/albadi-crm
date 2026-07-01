"use client";

/**
 * Widget variant of QuoteHtmlPreview — fetches config via /api/widget/factory/config.
 */

import { useEffect, useState } from "react";
import type { FactoryQuoteRow } from "./types";
import { humanizeMaterial, humanizePrinting, humanizeFinishing } from "@/lib/factory/qstate-decode";
import { DetailedBreakdown } from "@/components/calculator/DetailedBreakdown";
import type { FactoryPricingConfig } from "@/lib/factory/types";
import { computeCommission } from "@/lib/factory/commission";
import { widgetUrl } from "./widget-url";

const PRODUCT_LABEL = "שקית אלבדי";
const stripCjk = (s: string | null | undefined): string =>
  s && /[　-鿿＀-￯]/.test(s) ? "" : (s ?? "");

function fmtIls(n: number, digits = 2): string {
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function dimensionsHe(spec: FactoryQuoteRow["productSpec"]): string {
  const parts: string[] = [];
  if (spec.widthCm) parts.push(`רוחב ${spec.widthCm}`);
  if (spec.depthCm) parts.push(`עומק ${spec.depthCm}`);
  if (spec.heightCm) parts.push(`גובה ${spec.heightCm}`);
  return parts.length ? `${parts.join(" × ")} ס"מ` : "";
}

export function QuoteHtmlPreviewWidget({ apiToken, row }: { apiToken: string; row: FactoryQuoteRow }) {
  const [mode, setMode] = useState<"customer" | "internal">("customer");
  const [cfg, setCfg] = useState<FactoryPricingConfig | null>(null);
  useEffect(() => {
    if (mode === "internal" && !cfg) {
      fetch(widgetUrl("/api/widget/factory/config", apiToken))
        .then((r) => r.json())
        .then((d) => setCfg(d?.ok && d?.config ? (d.config as FactoryPricingConfig) : null))
        .catch(() => setCfg(null));
    }
  }, [mode, cfg, apiToken]);

  const p = row.finalPricing;
  if (!p) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        אין הצעה סופית עדיין.
      </div>
    );
  }
  const spec = row.productSpec;
  const dims = dimensionsHe(spec);
  const quotationNo = row.quotationNo ?? row.id.slice(-8).toUpperCase();
  const sentDate = row.sentToCustomerAt
    ? new Date(row.sentToCustomerAt).toLocaleDateString("he-IL")
    : new Date(row.updatedAt).toLocaleDateString("he-IL");

  return (
    <div className="flex-1 w-full overflow-auto bg-gray-950 text-gray-100 rounded-b-lg" dir="rtl">
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-2">
        <div className="max-w-2xl mx-auto flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => setMode("customer")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === "customer" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            }`}
          >
            👤 תצוגת לקוח
          </button>
          <button
            type="button"
            onClick={() => setMode("internal")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === "internal" ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            }`}
          >
            🔒 תצוגה פנימית (בוס)
          </button>
        </div>
      </div>
      <div className="max-w-2xl mx-auto p-6 space-y-5">
        <div className="rounded-lg p-5 text-white" style={{ backgroundColor: "#4A7C59" }}>
          <div className="text-2xl font-bold">הצעת מחיר #{quotationNo}</div>
          {row.customerName && <div className="mt-1 text-base opacity-95">לכבוד {row.customerName}</div>}
          <div className="mt-1 text-sm opacity-85">{sentDate}</div>
        </div>

        <div
          className="rounded-lg border p-4 text-center"
          style={{ borderColor: "#4A7C59", backgroundColor: "rgba(74, 124, 89, 0.12)" }}
        >
          <div className="text-3xl font-bold" style={{ color: "#7CB890" }}>
            {fmtIls(p.totalSellingPrice)}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {fmtIls(p.unitSellingPrice)}/יח׳ · {p.quantity.toLocaleString("he-IL")} יח׳
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 overflow-hidden">
          <div className="bg-gray-900 px-4 py-2 text-xs font-semibold text-gray-300">מפרט המוצר</div>
          <table className="w-full text-sm">
            <tbody>
              <SpecRow label="תיאור" value={PRODUCT_LABEL} />
              {dims && <SpecRow label="מידות" value={dims} />}
              {stripCjk(spec.material && humanizeMaterial(spec.material)) && (
                <SpecRow label="חומר" value={stripCjk(humanizeMaterial(spec.material))} />
              )}
              {stripCjk(spec.printing && humanizePrinting(spec.printing)) && (
                <SpecRow label="הדפסה" value={stripCjk(humanizePrinting(spec.printing))} />
              )}
              {stripCjk(spec.finishing && humanizeFinishing(spec.finishing)) && (
                <SpecRow label="גימור" value={stripCjk(humanizeFinishing(spec.finishing))} />
              )}
              <SpecRow label="כמות" value={`${spec.quantity.toLocaleString("he-IL")} יח׳`} />
              {p.shippingOptionName && <SpecRow label="שיטת שילוח" value={p.shippingOptionName} />}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-gray-800 overflow-hidden">
          <div className="bg-gray-900 px-4 py-2 text-xs font-semibold text-gray-300">פירוט מחיר</div>
          <table className="w-full text-sm">
            <tbody>
              <PriceRow label="מחיר ליחידה (לשקית)" value={fmtIls(p.unitSellingPrice)} />
              <PriceRow label="כמות" value={`${p.quantity.toLocaleString("he-IL")} יח׳`} />
              <PriceRow label="סה״כ שקיות" value={fmtIls(p.unitSellingPrice * p.quantity)} />
              {p.moldsTotalSellingPriceIls !== undefined && p.moldsTotalSellingPriceIls > 0 && (
                <PriceRow
                  label="תבניות / מולדים (תשלום חד-פעמי)"
                  value={fmtIls(p.moldsTotalSellingPriceIls)}
                />
              )}
              <PriceRow label="סה״כ הזמנה" value={fmtIls(p.totalSellingPrice)} bold primary />
            </tbody>
          </table>
        </div>

        <div
          className="rounded-lg border p-3 text-center text-sm font-semibold"
          style={{
            borderColor: "rgba(124, 184, 144, 0.4)",
            backgroundColor: "rgba(74, 124, 89, 0.15)",
            color: "#A8D5BA",
          }}
        >
          המחירים אינם כוללים מע״מ
        </div>

        <div className="rounded-lg border border-gray-800 p-4 text-sm space-y-1.5 text-gray-300">
          <div className="font-semibold text-gray-100">תנאי ההצעה</div>
          <div>• ההצעה בתוקף ל-14 יום מהיום.</div>
          <div>• זמן ייצור ומשלוח: לפי שיטת השילוח שנבחרה.</div>
          <div>• המחיר כפוף לאישור סופי של החברה שלנו.</div>
        </div>

        <div className="text-center text-xs text-gray-500 pt-2">
          אלבדי — אריזה ממותגת לעסקים · אריזה ממותגת לסביבה שלך
        </div>

        {mode === "internal" && (
          <div className="space-y-3 pt-4 mt-2 border-t-2 border-dashed border-gray-700">
            <div className="rounded-md bg-amber-500/10 border border-amber-500/40 px-3 py-2 text-xs text-amber-300 font-semibold">
              🔒 פרטים פנימיים — לא מופיעים בהצעה ללקוח
            </div>
            <div className="rounded-lg border border-gray-800 overflow-hidden">
              <div className="bg-gray-900 px-4 py-2 text-xs font-semibold text-gray-300">סיכום רווחיות</div>
              <table className="w-full text-sm">
                <tbody>
                  <PriceRow label="עלות מפעל ליחידה (שקית)" value={fmtIls(p.unitCost)} />
                  <PriceRow label="עלות שילוח ליחידה" value={fmtIls(p.unitShipping)} />
                  {p.plateFeeTotalCostIls !== undefined && p.plateFeeTotalCostIls > 0 && (
                    <>
                      <PriceRow
                        label={`🔗 גלופה מהמפעל (${p.plateFeeLogoColors ?? "?"} צבעים × ¥${p.platePerColorCny ?? "?"}) — pass-through`}
                        value={fmtIls(p.plateFeeTotalCostIls)}
                      />
                      <PriceRow
                        label="מזה ¥/יח׳ (מתחלק על כל הכמות)"
                        value={`¥${(p.platePerUnitCny ?? 0).toFixed(3)}/יח׳ · ${fmtIls(p.platePerUnitIls ?? 0)}/יח׳`}
                      />
                    </>
                  )}
                  {p.moldsTotalCostIls !== undefined && p.moldsTotalCostIls > 0 && (
                    <PriceRow
                      label={`עלות מולד ידני (חד-פעמי, ¥${p.moldsTotalCny ?? "?"})`}
                      value={fmtIls(p.moldsTotalCostIls)}
                    />
                  )}
                  <PriceRow
                    label={
                      p.plateFeeTotalCostIls && p.plateFeeTotalCostIls > 0
                        ? "סה״כ עלות (שקיות + שילוח + גלופה + מולד)"
                        : "סה״כ עלות (שקיות + שילוח + מולד)"
                    }
                    value={fmtIls((p.totalCost ?? 0) + (p.totalShipping ?? 0))}
                    bold
                  />
                  {p.moldsTotalSellingPriceIls !== undefined && p.moldsTotalSellingPriceIls > 0 && (
                    <PriceRow
                      label="מחיר מולד ללקוח (חד-פעמי)"
                      value={fmtIls(p.moldsTotalSellingPriceIls)}
                    />
                  )}
                  <PriceRow
                    label={`רווח ${p.profitMarginPct}% (מהמחיר, ללא שילוח)`}
                    value={fmtIls(p.totalProfit)}
                    bold
                    primary
                  />
                  {p.moldsTotalProfitIls !== undefined && p.moldsTotalProfitIls > 0 && (
                    <PriceRow
                      label="מתוכו: רווח מהמולד (חד-פעמי)"
                      value={fmtIls(p.moldsTotalProfitIls)}
                    />
                  )}
                  {(() => {
                    const c = computeCommission(p.totalSellingPrice, p.totalProfit, p.commissionPct, p.totalShipping);
                    return (
                      <>
                        <PriceRow
                          label={`עמלת מכירות (${c.pct}% מהעסקה ללא שילוח · ${Math.round(c.ofProfitPct)}% מהרווח)`}
                          value={`−${fmtIls(c.commission)}`}
                        />
                        <PriceRow label="רווח נטו (אחרי עמלה)" value={fmtIls(c.netProfit)} bold primary />
                      </>
                    );
                  })()}
                  <PriceRow
                    label="לוגיסטיקה"
                    value={`${p.totalCartons} קרטונים · ${p.totalWeightKg} ק״ג · ${p.totalCbm} m³`}
                  />
                  {row.factoryResponse?.unitCostCny != null && (
                    <PriceRow
                      label="עלות מפעל מקור (¥)"
                      value={`¥${row.factoryResponse.unitCostCny}/יח׳`}
                    />
                  )}
                  {row.factoryResponse?.supplier && (
                    <PriceRow label="ספק" value={row.factoryResponse.supplier} />
                  )}
                </tbody>
              </table>
            </div>

            {cfg && (
              <DetailedBreakdown
                defaultOpen
                unitCost={p.unitCost}
                unitShipping={p.unitShipping}
                unitProfit={p.unitProfit}
                unitSellingPrice={p.unitSellingPrice}
                totalCost={p.totalCost}
                totalShipping={p.totalShipping}
                totalProfit={p.totalProfit}
                totalSellingPrice={p.totalSellingPrice}
                quantity={p.quantity}
                profitMarginPct={p.profitMarginPct}
                commissionPct={p.commissionPct}
                totalCartons={p.totalCartons}
                totalWeightKg={p.totalWeightKg}
                totalCbm={p.totalCbm}
                shippingType={
                  cfg.shippingOptions.find((s) => s.id === p.shippingOptionId)?.type ?? null
                }
                factoryUnitCostCny={row.factoryResponse?.unitCostCny}
                usdToIls={cfg.usdToIls}
                usdToCny={cfg.usdToCny}
                seaRate={
                  cfg.shippingOptions.find((s) => s.id === p.shippingOptionId && s.type === "sea")?.seaRate
                }
                rawCbm={p.totalCbm}
                seaMinCbm={1}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-gray-800">
      <td className="px-4 py-2 text-gray-400 w-1/3 text-right">{label}</td>
      <td className="px-4 py-2 text-right text-gray-100">{value}</td>
    </tr>
  );
}

function PriceRow({
  label,
  value,
  bold,
  primary,
}: {
  label: string;
  value: string;
  bold?: boolean;
  primary?: boolean;
}) {
  return (
    <tr className="border-t border-gray-800">
      <td className={`px-4 py-2 text-right ${bold ? "font-semibold text-gray-100" : "text-gray-400"}`}>{label}</td>
      <td
        className={`px-4 py-2 tabular-nums text-left ${bold ? "font-bold text-lg text-gray-100" : "text-gray-200"}`}
        style={primary ? { color: "#7CB890" } : undefined}
      >
        {value}
      </td>
    </tr>
  );
}
