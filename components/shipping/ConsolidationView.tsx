"use client";

/**
 * Shipment consolidation planner (planning-only — does not change any customer
 * price). Lists real finalized SEA orders pulled from the system, lets the boss
 * tick which to merge into one shipment, and shows — live — the cost of
 * shipping them separately (each at its TRUE solo cost) vs merged, the saving,
 * and which band edge to aim for. Uses the active sea carrier profile.
 *
 * Client-safe: imports only the pure engine (sea-carriers.ts) + types.
 */

import { useMemo, useState } from "react";
import { Ship, ExternalLink, PackageCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SeaCarrierProfile } from "@/lib/factory/types";
import type { ConsolidationCandidate } from "@/lib/factory/consolidation";
import { consolidateShipment, seaShipmentCost } from "@/lib/factory/sea-carriers";

const STAGE_LABEL: Record<string, string> = {
  WON: "נסגר ✓",
  CONSIDERATION: "שוקל הצעה",
  DISCAVERY: "שיחת בירור",
  FACTORY_WAIT: "בדיקת מפעל",
  INTAKE: "שאלון",
};

export function ConsolidationView({
  candidates,
  carrier,
  usdToIls,
  ghlContactBase,
}: {
  candidates: ConsolidationCandidate[];
  carrier: SeaCarrierProfile | null;
  usdToIls: number;
  /** GHL contact-card URL prefix; row links to <base><ghlContactId> */
  ghlContactBase?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [region, setRegion] = useState<"center" | "north">("center");
  const [extraStops, setExtraStops] = useState(0);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const ils = (usd: number) => Math.round(usd * usdToIls).toLocaleString();

  const result = useMemo(() => {
    if (!carrier || selected.size === 0) return null;
    const items = candidates
      .filter((c) => selected.has(c.id))
      .map((c) => ({ id: c.id, cbm: c.cbm }));
    return consolidateShipment(carrier, items, { region, extraStops });
  }, [carrier, candidates, selected, region, extraStops]);

  // Per-row solo cost (true cost of shipping that order alone) for display.
  const soloUsdById = useMemo(() => {
    const m = new Map<string, number>();
    if (carrier) {
      for (const c of candidates) {
        m.set(c.id, seaShipmentCost(carrier, c.cbm, { region, extraStops }).totalUsd);
      }
    }
    return m;
  }, [carrier, candidates, region, extraStops]);

  if (!carrier) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" dir="rtl">
        ⚠️ אין ספק שילוח ים פעיל. הגדר ספק פעיל בטאב ההגדרות לפני שימוש בכלי הצירוף.
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4" dir="rtl">
      <header className="space-y-1">
        <h2 className="text-base font-medium flex items-center gap-2">
          <Ship className="size-4 text-primary" />
          צירוף משלוחים — תכנון
        </h2>
        <p className="text-xs text-muted-foreground">
          סמן הזמנות ים מאותו זמן כדי לראות כמה תחסוך אם תשלח אותן יחד במקום כל
          אחת בנפרד. כלי תכנון בלבד — לא משנה מחירים ללקוחות. ספק: {carrier.name}.
        </p>
      </header>

      {/* Region + extra stops */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">אזור מסירה</label>
          <div className="inline-flex rounded-md border border-border p-0.5 gap-0.5">
            {(["center", "north"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegion(r)}
                className={cn(
                  "px-3 py-1 text-xs rounded",
                  region === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                )}
              >
                {r === "center" ? "מרכז" : "צפון"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">עצירות נוספות</label>
          <input
            type="number"
            min={0}
            step={1}
            value={extraStops}
            onChange={(e) => setExtraStops(Math.max(0, Number(e.target.value) || 0))}
            className="bg-background/50 border border-border rounded-md px-2 py-1 text-sm tabular-nums w-20 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>

      {/* Candidate list */}
      {candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center border border-dashed border-border rounded-md">
          אין הזמנות ים סופיות לצירוף כרגע.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {candidates.map((c) => {
            const isSel = selected.has(c.id);
            const solo = soloUsdById.get(c.id) ?? 0;
            return (
              <label
                key={c.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors",
                  isSel ? "border-primary bg-primary/5" : "border-border bg-background/40 hover:bg-secondary/40"
                )}
              >
                <input type="checkbox" checked={isSel} onChange={() => toggle(c.id)} className="size-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{c.customerName ?? "לקוח ללא שם"}</span>
                    {c.stage && (
                      <span className="text-[10px] rounded bg-muted/50 px-1.5 py-0.5 text-muted-foreground shrink-0">
                        {STAGE_LABEL[c.stage] ?? c.stage}
                      </span>
                    )}
                    {ghlContactBase && c.ghlContactId && (
                      <a
                        href={`${ghlContactBase}${c.ghlContactId}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-primary shrink-0"
                        title="כרטיס לקוח ב-GHL"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {c.productName ?? "—"}
                    {c.quantity ? ` · ${c.quantity.toLocaleString()} יח'` : ""}
                  </div>
                </div>
                <div className="text-left shrink-0 tabular-nums">
                  <div className="text-sm font-medium">{c.cbm} קוב</div>
                  <div className="text-[11px] text-muted-foreground">לבד ₪{ils(solo)}</div>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <Stat label="נפח מאוחד" value={`${result.combinedCbm} קוב`} />
            <Stat label="בנפרד" value={`₪${ils(result.soloTotalUsd)}`} sub={`$${result.soloTotalUsd.toFixed(0)}`} />
            <Stat label="מאוחד" value={`₪${ils(result.combinedUsd)}`} sub={`$${result.combinedUsd.toFixed(0)} · $${result.combinedPerCbmUsd.toFixed(0)}/קוב`} />
            <Stat
              label="חיסכון"
              value={`₪${ils(result.savingUsd)}`}
              sub={`$${result.savingUsd.toFixed(0)}`}
              highlight
            />
          </div>
          <div className="flex items-start gap-2 text-xs rounded-md bg-background/50 border border-border p-2.5">
            <PackageCheck className="size-4 text-primary shrink-0 mt-0.5" />
            <span>{result.recommendation.text}</span>
          </div>
          {/* merged shipment breakdown */}
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer select-none">פירוט עלות המשלוח המאוחד</summary>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 tabular-nums">
              <Line label="הובלה בסין" usd={result.breakdown.chinaInlandUsd} ils={ils} />
              <Line label="ברוקר" usd={result.breakdown.brokerUsd} ils={ils} />
              <Line label="מכס" usd={result.breakdown.customsUsd} ils={ils} />
              <Line label="LCL" usd={result.breakdown.lclUsd} ils={ils} />
              <Line label="טרמינל" usd={result.breakdown.terminalUsd} ils={ils} />
              <Line label="רשומון" usd={result.breakdown.reshumonUsd} ils={ils} />
              <Line label="הובלה פנים" usd={result.breakdown.inlandUsd} ils={ils} />
              {result.breakdown.extraStopsUsd > 0 && (
                <Line label="עצירות" usd={result.breakdown.extraStopsUsd} ils={ils} />
              )}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", highlight && "text-success")}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground tabular-nums">{sub}</span>}
    </div>
  );
}

function Line({
  label,
  usd,
  ils,
}: {
  label: string;
  usd: number;
  ils: (usd: number) => string;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span>₪{ils(usd)}</span>
    </div>
  );
}
