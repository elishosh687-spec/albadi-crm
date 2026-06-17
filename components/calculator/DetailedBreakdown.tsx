"use client";

/**
 * Collapsible "פירוט מלא לבוס" panel — shows the full pricing pipeline
 * (¥ → $ → ₪, shipping floor, margin formula, plate fee amortization,
 * salesperson commission, air/sea comparison). Default closed.
 *
 * Used by: FinalizeModal (live calc), FactoryQuotePanel (finalized state),
 * CalculatorView (per-quote preview), and the widget variants embedded in
 * GHL. Each surface feeds a different set of optional inputs (components, alt
 * shipping, plate fee) — the panel gracefully hides sections when data is
 * absent. Boss-only: never rendered in the customer copy.
 */

import {
  ChevronDown, AlertTriangle, Plane, Ship, ArrowLeftRight, Factory,
  TrendingUp, Receipt, Boxes, GitCompareArrows, type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { buildBreakdownView, type BreakdownInput } from "@/lib/factory/breakdown";

function fmtIls(n: number, digits = 2): string {
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function fmtUsd(n: number, digits = 3): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function fmtCny(n: number, digits = 3): string {
  return `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function DetailedBreakdown(props: BreakdownInput & { defaultOpen?: boolean }) {
  const { defaultOpen = false, ...input } = props;
  const [open, setOpen] = useState(defaultOpen);
  const v = buildBreakdownView(input);
  const ShipIcon = v.shipping.type === "air" ? Plane : Ship;

  return (
    <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium hover:bg-muted/20 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            className={cn("size-4 text-muted-foreground transition-transform", open ? "rotate-0" : "-rotate-90")}
          />
          פירוט מלא לבוס
        </span>
        {!open && (
          <span className="flex items-center gap-2 text-xs tabular-nums">
            <span className="text-muted-foreground">רווח נטו</span>
            <span className="font-semibold text-success">{fmtIls(v.commission.netProfitIls)}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3 space-y-2.5 text-xs tabular-nums">
          {/* Bottom-line hero — the three numbers the boss cares about, up front */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="סה״כ הזמנה" value={fmtIls(v.totals.totalSellingPrice)} tone="primary" />
            <Stat label="רווח" value={fmtIls(v.margin.ilsTotalProfit)} tone="success" />
            <Stat
              label="רווח נטו"
              value={fmtIls(v.commission.netProfitIls)}
              tone="success"
              sub={`עמלה −${fmtIls(v.commission.ils)}`}
            />
          </div>

          {/* FX rates */}
          <Section icon={ArrowLeftRight} title="שערי המרה (כפי שמופיעים בקונפיג כעת)">
            <div className="grid grid-cols-3 gap-2 text-center">
              <FxCell label="1$ = ₪" value={v.fx.usdToIls.toFixed(2)} />
              <FxCell label="1$ = ¥" value={v.fx.usdToCny.toFixed(2)} />
              <FxCell label="1¥ = ₪" value={v.fx.cnyToIls.toFixed(4)} />
            </div>
          </Section>

          {/* Factory cost */}
          <Section icon={Factory} title="עלות מפעל (production — חל עליה רווח)">
            {v.factory.cnyPerUnit !== null && v.factory.usdPerUnit !== null ? (
              <div className="space-y-1">
                <Row
                  label="¥ → $ → ₪ ליחידה"
                  value={
                    <>
                      {fmtCny(v.factory.cnyPerUnit)}
                      <span className="text-muted-foreground"> → </span>
                      {fmtUsd(v.factory.usdPerUnit, 4)}
                      <span className="text-muted-foreground"> → </span>
                      <strong>{fmtIls(v.factory.ilsPerUnit)}</strong>
                    </>
                  }
                />
                <Row label="סה״כ עלות מפעל" value={<strong>{fmtIls(v.factory.ilsTotal)}</strong>} />
              </div>
            ) : (
              <div className="space-y-1">
                <Row label="עלות יחידה (ILS)" value={<strong>{fmtIls(v.factory.ilsPerUnit)}</strong>} />
                <Row label="סה״כ עלות מפעל" value={fmtIls(v.factory.ilsTotal)} />
              </div>
            )}

            {v.components && (
              <div className="mt-2 pt-2 border-t border-border/50 space-y-0.5 text-[11px]">
                <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                  פירוק רכיבי הייצור (¥)
                </div>
                <ComponentRow label="בסיס שקית" cny={v.components.baseBagCny} cnyToIls={v.fx.cnyToIls} />
                {v.components.handlesAddonCny > 0 && (
                  <ComponentRow label="תוספת ידיות" cny={v.components.handlesAddonCny} cnyToIls={v.fx.cnyToIls} />
                )}
                {v.components.laminationAddonCny > 0 && (
                  <ComponentRow label="תוספת למינציה" cny={v.components.laminationAddonCny} cnyToIls={v.fx.cnyToIls} />
                )}
                {v.components.plateFeeCny > 0 && (
                  <ComponentRow label="plate fee (אמורטיזציה)" cny={v.components.plateFeeCny} cnyToIls={v.fx.cnyToIls} />
                )}
                {v.components.logoAddonCny > 0 && (
                  <ComponentRow label="צבעי הדפסה" cny={v.components.logoAddonCny} cnyToIls={v.fx.cnyToIls} />
                )}
                {v.components.moldsPerUnitCny !== undefined && v.components.moldsPerUnitCny > 0 && (
                  <ComponentRow
                    label={`מולדים — חד-פעמי (≈ ${v.components.moldsPerUnitCny.toFixed(3)}¥/יח׳ אם היו מתחלקים על ${input.quantity.toLocaleString("he-IL")})`}
                    cny={v.components.moldsPerUnitCny}
                    cnyToIls={v.fx.cnyToIls}
                  />
                )}
              </div>
            )}

            {v.plateFee && (
              <div className="mt-2 pt-2 border-t border-border/50 text-[11px]">
                <Row
                  label={`plate fee מתחלק על ${v.plateFee.quantity.toLocaleString("he-IL")} יח׳`}
                  value={
                    <>
                      {fmtCny(v.plateFee.cnyPerUnit)} = <strong>{fmtIls(v.plateFee.ilsPerUnit, 3)}</strong>/יח׳
                      <span className="text-muted-foreground"> · סה״כ {fmtIls(v.plateFee.ilsTotal)}</span>
                    </>
                  }
                />
              </div>
            )}
          </Section>

          {/* Shipping */}
          <Section
            icon={ShipIcon}
            title={
              v.shipping.type === "sea"
                ? "שילוח ים (pass-through — ללא רווח)"
                : v.shipping.type === "air"
                  ? "שילוח אווירי (pass-through — ללא רווח)"
                  : "שילוח"
            }
          >
            <div className="space-y-1">
              {v.shipping.type === "sea" && v.shipping.rate !== null && v.shipping.rawCbm !== null && v.shipping.effectiveCbm !== null ? (
                <>
                  <Row label="CBM גולמי (לפי קרטונים)" value={v.shipping.rawCbm.toFixed(3)} />
                  <Row
                    label="CBM בחיוב"
                    value={
                      <>
                        {v.shipping.effectiveCbm.toFixed(3)}
                        {v.shipping.floorApplied && (
                          <span className="text-warning"> · הופעלה רצפת 1 CBM</span>
                        )}
                      </>
                    }
                  />
                  <Row label="תעריף" value={`${fmtUsd(v.shipping.rate, 0)} / CBM`} />
                  <Row
                    label="חישוב"
                    value={
                      <span className="text-muted-foreground">
                        {v.shipping.effectiveCbm.toFixed(3)} × {fmtUsd(v.shipping.rate, 0)} ÷ {input.quantity.toLocaleString("he-IL")} יח׳ × {v.fx.usdToIls} = <strong className="text-foreground">{fmtIls(v.shipping.ilsPerUnit, 3)}/יח׳</strong>
                      </span>
                    }
                  />
                </>
              ) : (
                <Row label="עלות יחידה" value={fmtIls(v.shipping.ilsPerUnit, 3)} />
              )}
              <Row label="סה״כ שילוח" value={<strong>{fmtIls(v.shipping.ilsTotal)}</strong>} />

              {v.shipping.utilizationLow && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-warning">
                  <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                  <div>
                    ניצול CBM נמוך ({v.shipping.utilizationPct?.toFixed(0)}%) — הזמנה זו לבד תשלם {fmtUsd(v.shipping.floorImpactUsd, 0)} (={fmtIls(v.shipping.floorImpactIls)}) על אוויר ריק. שווה לשקול אקספרס אווירי.
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* Margin + commission */}
          <Section icon={TrendingUp} title="רווח ועמלה" tone="success">
            <div className="space-y-1">
              <Row label="מרג'ין" value={<strong>{v.margin.pct}%</strong>} />
              <Row label="נוסחה" value={<span className="text-muted-foreground">{v.margin.formula}</span>} />
              <Row label="רווח ליחידה" value={<strong className="text-success">{fmtIls(v.margin.ilsPerUnitProfit)}</strong>} />
              <Row label="סה״כ רווח" value={<strong className="text-success">{fmtIls(v.margin.ilsTotalProfit)}</strong>} />
              <div className="my-1 border-t border-border/40" />
              <Row
                label={`עמלת מכירות (${v.commission.pct}% מהעסקה · ${Math.round(v.commission.ofProfitPct)}% מהרווח)`}
                value={<span className="text-warning">−{fmtIls(v.commission.ils)}</span>}
              />
              <Row
                label="רווח נטו (אחרי עמלה)"
                value={<strong className="text-success">{fmtIls(v.commission.netProfitIls)}</strong>}
              />
            </div>
          </Section>

          {/* Summary */}
          <Section icon={Receipt} title="סיכום מחיר ללקוח" tone="primary">
            <div className="space-y-1">
              <Row label="מחיר/יחידה" value={<strong>{fmtIls(v.totals.unitSellingPrice)}</strong>} />
              <Row
                label="סה״כ חשבונית"
                value={<strong className="text-sm">{fmtIls(v.totals.totalSellingPrice)}</strong>}
              />
              <Row
                label="מתוכו רווח"
                value={<span className="text-success">{fmtIls(v.margin.ilsTotalProfit)}</span>}
              />
            </div>
          </Section>

          {/* Alt shipping comparison */}
          {v.alt && (
            <Section icon={GitCompareArrows} title="השוואת שיטות שילוח">
              <div className="grid grid-cols-2 gap-2 text-center">
                <AltCell
                  type={v.shipping.type ?? "sea"}
                  label="הצעה נוכחית"
                  unit={v.totals.unitSellingPrice}
                  total={v.totals.totalSellingPrice}
                  isActive
                />
                <AltCell
                  type={v.alt.shippingType}
                  label={v.alt.shippingName ?? (v.alt.shippingType === "air" ? "אקספרס" : "ים")}
                  unit={v.alt.unitSellingPrice}
                  total={v.alt.totalSellingPrice}
                />
              </div>
              {(() => {
                const diff = v.alt.totalSellingPrice - v.totals.totalSellingPrice;
                if (Math.abs(diff) < 1) return null;
                return (
                  <div className="mt-1.5 text-center text-[11px] text-muted-foreground">
                    {diff > 0
                      ? `החלופה יקרה ב‑${fmtIls(diff)}`
                      : `החלופה זולה ב‑${fmtIls(-diff)}`}
                  </div>
                );
              })()}
            </Section>
          )}

          {/* Logistics */}
          <Section icon={Boxes} title="לוגיסטיקה">
            <Row
              label="פירוט"
              value={
                <>
                  {v.logistics.cartons} קרטונים · {v.logistics.weightKg} ק״ג · {v.logistics.cbm} CBM
                </>
              }
            />
          </Section>
        </div>
      )}
    </div>
  );
}

type Tone = "muted" | "success" | "warning" | "primary";
const TONE_TEXT: Record<Tone, string> = {
  muted: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  primary: "text-primary",
};

function Stat({
  label,
  value,
  sub,
  tone = "muted",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold tabular-nums mt-0.5", TONE_TEXT[tone])}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  tone = "muted",
  children,
}: {
  icon?: LucideIcon;
  title: string;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/40 bg-muted/15">
        {Icon && <Icon className={cn("size-3.5 shrink-0", TONE_TEXT[tone])} />}
        <span className="text-[11px] font-medium text-foreground/90">{title}</span>
      </div>
      <div className="p-2.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 items-baseline">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function FxCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 p-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function ComponentRow({
  label,
  cny,
  cnyToIls,
}: {
  label: string;
  cny: number;
  cnyToIls: number;
}) {
  const ils = cny * cnyToIls;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>
        {fmtCny(cny)} <span className="text-muted-foreground">({fmtIls(ils, 3)})</span>
      </span>
    </div>
  );
}

function AltCell({
  type,
  label,
  unit,
  total,
  isActive,
}: {
  type: "sea" | "air";
  label: string;
  unit: number;
  total: number;
  isActive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md p-2",
        isActive ? "bg-primary/10 border border-primary/30" : "bg-muted/20 border border-border/40",
      )}
    >
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {type === "air" ? <Plane className="size-3" /> : <Ship className="size-3" />}
        {label}
      </div>
      <div className="text-sm font-semibold mt-0.5">{fmtIls(total)}</div>
      <div className="text-[10px] text-muted-foreground">{fmtIls(unit, 2)}/יח׳</div>
    </div>
  );
}
