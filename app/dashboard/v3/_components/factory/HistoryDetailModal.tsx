"use client";

import { useEffect } from "react";
import { X, ShoppingBag, Package, Hash, Palette, Truck } from "lucide-react";
import {
  humanizeFinishing,
  humanizeMaterial,
  humanizePrinting,
} from "@/lib/factory/qstate-decode";
import type { FactoryQuoteRow } from "./FactoryQuotePanel";

function hebrewSize(spec: {
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
}): string {
  const parts: string[] = [];
  if (spec.widthCm) parts.push(`רוחב ${spec.widthCm}`);
  if (spec.heightCm) parts.push(`גובה ${spec.heightCm}`);
  if (spec.depthCm) parts.push(`עומק ${spec.depthCm}`);
  if (parts.length === 0) return "";
  return `${parts.join(" × ")} ס״מ`;
}

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

export function HistoryDetailModal({
  row,
  onClose,
}: {
  row: FactoryQuoteRow;
  onClose: () => void;
}) {
  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const spec = row.productSpec;
  const resp = row.factoryResponse;
  const p = row.finalPricing;

  const sizeHe = hebrewSize(spec);
  const materialHe = spec.material ? humanizeMaterial(spec.material) : "";
  const printingHe = spec.printing ? humanizePrinting(spec.printing) : "";
  const finishingHe = spec.finishing ? humanizeFinishing(spec.finishing) : "";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border sticky top-0 bg-card">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              הצעה {row.quotationNo ?? row.id.slice(-6)}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {new Date(row.createdAt).toLocaleString("he-IL")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
            title="סגור"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="p-4 space-y-3">
          <section className="rounded-lg border border-border bg-background/40 p-3">
            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              מפרט מוצר
            </h3>
            <dl className="text-xs">
              <DetailRow icon={<ShoppingBag className="size-3" />} label="מוצר" value={spec.description || "—"} />
              {sizeHe && (
                <DetailRow icon={<Package className="size-3" />} label="מידות" value={sizeHe} />
              )}
              {materialHe && (
                <DetailRow icon={<Package className="size-3" />} label="חומר" value={materialHe} />
              )}
              <DetailRow icon={<Hash className="size-3" />} label="כמות" value={`${spec.quantity.toLocaleString("he-IL")} יח׳`} />
              {printingHe && (
                <DetailRow icon={<Palette className="size-3" />} label="הדפסה" value={printingHe} />
              )}
              {finishingHe && (
                <DetailRow icon={<Package className="size-3" />} label="גימור" value={finishingHe} />
              )}
              {spec.notes && (
                <DetailRow icon={<Package className="size-3" />} label="הערות" value={spec.notes} />
              )}
            </dl>
          </section>

          {resp && (
            <section className="rounded-lg border border-border bg-background/40 p-3">
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                תשובת המפעל
              </h3>
              <dl className="text-xs">
                <DetailRow label="עלות יחידה" value={`¥${resp.unitCostCny}`} />
                {resp.cartonQty !== undefined && (
                  <DetailRow label="יח׳/קרטון" value={String(resp.cartonQty)} />
                )}
                {resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm && (
                  <DetailRow
                    label="מידות קרטון"
                    value={`${resp.cartonLengthCm}×${resp.cartonWidthCm}×${resp.cartonHeightCm} ס״מ`}
                  />
                )}
                {resp.cartonCbm !== undefined && (
                  <DetailRow label="CBM" value={resp.cartonCbm.toFixed(3)} />
                )}
                {resp.weightKg !== undefined && (
                  <DetailRow label="משקל" value={`${resp.weightKg} ק״ג`} />
                )}
                {resp.supplier && <DetailRow label="ספק" value={resp.supplier} />}
                {resp.notes && <DetailRow label="הערות מפעל" value={resp.notes} />}
              </dl>
            </section>
          )}

          {p && (
            <section className="rounded-lg border border-success/30 bg-success/5 p-3">
              <h3 className="text-[10px] uppercase tracking-wider text-success/80 mb-2">
                תמחור סופי
              </h3>
              <dl className="text-xs">
                <DetailRow label="מחיר ללקוח" value={formatIls(p.totalSellingPrice)} />
                <DetailRow label="מחיר ליחידה" value={formatIls(p.unitSellingPrice)} />
                <DetailRow label="רווח" value={`${formatIls(p.totalProfit)} (${p.profitMarginPct}%)`} />
                {p.shippingOptionName && (
                  <DetailRow
                    icon={<Truck className="size-3" />}
                    label="שילוח"
                    value={p.shippingOptionName}
                  />
                )}
                {row.sentToCustomerAt && (
                  <DetailRow
                    label="נשלח ללקוח"
                    value={new Date(row.sentToCustomerAt).toLocaleString("he-IL")}
                  />
                )}
              </dl>
            </section>
          )}

          {row.feishuRowIndex && (
            <div className="text-[10px] text-muted-foreground text-center">
              שורה ב-Feishu: <span className="font-mono">{row.feishuRowIndex}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <dt className="text-muted-foreground inline-flex items-center gap-1 shrink-0">
        {icon}
        {label}
      </dt>
      <dd className="text-right text-foreground break-words min-w-0">{value}</dd>
    </div>
  );
}
