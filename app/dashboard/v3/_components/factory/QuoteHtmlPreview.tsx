"use client";

/**
 * HTML version of the customer-facing factory quote — mirrors the PDF layout
 * (`lib/factory/pdf.tsx`) but renders in-browser so the dashboard preview
 * modal works regardless of the browser's PDF plugin support. Uses the same
 * `finalPricing` / `productSpec` data already on the row, no extra fetch.
 */

import { useEffect, useState } from "react";
import type { FactoryQuoteRow } from "./FactoryQuotePanel";
import { humanizeMaterial, humanizePrinting, humanizeFinishing } from "@/lib/factory/qstate-decode";
import { DetailedBreakdown } from "./DetailedBreakdown";
import type { FactoryPricingConfig } from "@/lib/factory/types";

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

let cachedCfg: Promise<FactoryPricingConfig | null> | null = null;
function fetchCfg(): Promise<FactoryPricingConfig | null> {
  if (cachedCfg) return cachedCfg;
  cachedCfg = fetch("/api/factory/config")
    .then((r) => r.json())
    .then((d) => (d?.ok && d?.config ? (d.config as FactoryPricingConfig) : null))
    .catch(() => null);
  return cachedCfg;
}

export function QuoteHtmlPreview({ row }: { row: FactoryQuoteRow }) {
  const [mode, setMode] = useState<"customer" | "internal">("customer");
  const [cfg, setCfg] = useState<FactoryPricingConfig | null>(null);
  useEffect(() => {
    if (mode === "internal" && !cfg) fetchCfg().then(setCfg);
  }, [mode, cfg]);

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
    <div className="flex-1 w-full overflow-auto bg-white rounded-b-lg" dir="rtl">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200 px-4 py-2">
        <div className="max-w-2xl mx-auto flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => setMode("customer")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === "customer"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            👤 תצוגת לקוח
          </button>
          <button
            type="button"
            onClick={() => setMode("internal")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === "internal"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            🔒 תצוגה פנימית (בוס)
          </button>
        </div>
      </div>
      <div className="max-w-2xl mx-auto p-6 space-y-5 text-gray-900">
        {/* Header */}
        <div className="rounded-lg p-5 text-white" style={{ backgroundColor: "#4A7C59" }}>
          <div className="text-2xl font-bold">הצעת מחיר #{quotationNo}</div>
          {row.customerName && <div className="mt-1 text-base opacity-95">לכבוד {row.customerName}</div>}
          <div className="mt-1 text-sm opacity-85">{sentDate}</div>
        </div>

        {/* Hero price */}
        <div
          className="rounded-lg border p-4 text-center"
          style={{ borderColor: "#4A7C59", backgroundColor: "#F0F7F1" }}
        >
          <div className="text-3xl font-bold" style={{ color: "#4A7C59" }}>
            {fmtIls(p.totalSellingPrice)}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {fmtIls(p.unitSellingPrice)}/יח׳ · {p.quantity.toLocaleString("he-IL")} יח׳
          </div>
        </div>

        {/* Spec */}
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700">מפרט המוצר</div>
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

        {/* Price table */}
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700">פירוט מחיר</div>
          <table className="w-full text-sm">
            <tbody>
              <PriceRow label="מחיר ליחידה" value={fmtIls(p.unitSellingPrice)} />
              <PriceRow label="כמות" value={`${p.quantity.toLocaleString("he-IL")} יח׳`} />
              <PriceRow
                label="סה״כ הזמנה"
                value={fmtIls(p.totalSellingPrice)}
                bold
                primary
              />
            </tbody>
          </table>
        </div>

        {/* VAT + notes */}
        <div className="rounded-lg border p-3 text-center text-sm font-semibold" style={{ borderColor: "#4A6741", backgroundColor: "#EEF4EE", color: "#2D5016" }}>
          המחירים אינם כוללים מע״מ
        </div>

        <div className="rounded-lg border border-gray-200 p-4 text-sm space-y-1.5 text-gray-700">
          <div className="font-semibold text-gray-900">תנאי ההצעה</div>
          <div>• ההצעה בתוקף ל-14 יום מהיום.</div>
          <div>• זמן ייצור ומשלוח: לפי שיטת השילוח שנבחרה.</div>
          <div>• המחיר כפוף לאישור סופי של החברה שלנו.</div>
        </div>

        <div className="text-center text-xs text-gray-500 pt-2">
          אלבדי — אריזה ממותגת לעסקים · אריזה ממותגת לסביבה שלך
        </div>

        {mode === "internal" && (
          <div className="space-y-3 pt-4 mt-2 border-t-2 border-dashed border-gray-300">
            <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 font-semibold">
              🔒 פרטים פנימיים — לא מופיעים בהצעה ללקוח
            </div>

            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700">
                סיכום רווחיות
              </div>
              <table className="w-full text-sm">
                <tbody>
                  <PriceRow label="עלות מפעל ליחידה" value={fmtIls(p.unitCost)} />
                  <PriceRow label="עלות שילוח ליחידה" value={fmtIls(p.unitShipping)} />
                  <PriceRow label="סה״כ עלות" value={fmtIls(p.totalCost + p.totalShipping)} bold />
                  <PriceRow label={`רווח ${p.profitMarginPct}% (מעל עלות מפעל)`} value={fmtIls(p.totalProfit)} bold primary />
                  <PriceRow
                    label="רווח כ-% מהכנסה"
                    value={`${p.totalSellingPrice > 0 ? ((p.totalProfit / p.totalSellingPrice) * 100).toFixed(1) : "0"}%`}
                  />
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
              <div className="dark rounded-lg bg-gray-900 text-gray-100 p-2">
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-2 text-gray-500 w-1/3 text-right">{label}</td>
      <td className="px-4 py-2 text-right text-gray-900">{value}</td>
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
    <tr className="border-t border-gray-100">
      <td className={`px-4 py-2 text-right ${bold ? "font-semibold text-gray-900" : "text-gray-600"}`}>{label}</td>
      <td
        className={`px-4 py-2 tabular-nums text-left ${
          bold ? "font-bold text-lg" : ""
        }`}
        style={primary ? { color: "#4A7C59" } : undefined}
      >
        {value}
      </td>
    </tr>
  );
}
