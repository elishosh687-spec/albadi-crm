"use client";

/**
 * Collapsible "פירוט מלא לבוס" panel — shows the full pricing pipeline
 * (¥ → $ → ₪, shipping floor, margin formula, plate fee amortization,
 * air/sea comparison). Default closed.
 *
 * Used by: FinalizeModal (live calc), FactoryQuotePanel (finalized state),
 * CalculatorView (per-quote preview). Each surface feeds a different set
 * of optional inputs (components, alt shipping, plate fee) — the panel
 * gracefully hides sections when data is absent.
 */

import { ChevronDown, AlertTriangle, Plane, Ship } from "lucide-react";
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

  return (
    <div className="rounded-lg border border-border bg-muted/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/20 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            className={cn("size-4 transition-transform", open ? "rotate-0" : "-rotate-90")}
          />
          פירוט מלא לבוס
        </span>
        {!open && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {v.totals.profitShareOfPriceLabel}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3 space-y-3 text-xs tabular-nums">
          {/* FX rates */}
          <Section title="שערי המרה (כפי שמופיעים בקונפיג כעת)">
            <div className="grid grid-cols-3 gap-2 text-center">
              <FxCell label="1$ = ₪" value={v.fx.usdToIls.toFixed(2)} />
              <FxCell label="1$ = ¥" value={v.fx.usdToCny.toFixed(2)} />
              <FxCell label="1¥ = ₪" value={v.fx.cnyToIls.toFixed(4)} />
            </div>
          </Section>

          {/* Factory cost */}
          <Section title="עלות מפעל (production — חל עליה רווח)">
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
                          <span className="text-warning"> · ⚠️ הופעלה רצפת 1 CBM</span>
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

          {/* Margin */}
          <Section title="רווח (חל רק על production, לא על שילוח)">
            <div className="space-y-1">
              <Row label="מרג'ין" value={<strong>{v.margin.pct}%</strong>} />
              <Row label="נוסחה" value={<span className="text-muted-foreground">{v.margin.formula}</span>} />
              <Row label="רווח ליחידה" value={<strong className="text-success">{fmtIls(v.margin.ilsPerUnitProfit)}</strong>} />
              <Row label="סה״כ רווח" value={<strong className="text-success">{fmtIls(v.margin.ilsTotalProfit)}</strong>} />
              <Row
                label="רווח כ‑% מהכנסה"
                value={
                  <span className="text-muted-foreground">
                    <strong className="text-foreground">{v.margin.pctOfRevenue.toFixed(1)}%</strong> (לעומת {v.margin.pct}% מהעלות)
                  </span>
                }
              />
            </div>
          </Section>

          {/* Summary */}
          <Section title="סיכום מחיר ללקוח">
            <div className="space-y-1">
              <Row label="מחיר/יחידה" value={<strong>{fmtIls(v.totals.unitSellingPrice)}</strong>} />
              <Row
                label="סה״כ חשבונית"
                value={<strong className="text-base">{fmtIls(v.totals.totalSellingPrice)}</strong>}
              />
              <Row
                label="מתוכו רווח"
                value={
                  <span className="text-success">
                    {fmtIls(v.margin.ilsTotalProfit)} ({v.margin.pctOfRevenue.toFixed(1)}%)
                  </span>
                }
              />
            </div>
          </Section>

          {/* Alt shipping comparison */}
          {v.alt && (
            <Section title="השוואת שיטות שילוח">
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
          <Section title="לוגיסטיקה">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{title}</div>
      {children}
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
