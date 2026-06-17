"use client";

/**
 * Sea-freight carrier editor — SIMPLIFIED. Each forwarder is just its cost per
 * CBM at 1..7 CBM (the "עלות לקוב" row of its sheet). The boss picks which
 * carrier is ACTIVE (drives all sea pricing) and sets the "assumed shipment
 * volume" (default 3 CBM) used as the default per-order pricing basis. A live
 * preview shows the resulting per-order cost. Switching/adding a forwarder =
 * type its 7 numbers. Collapsible behind a chevron.
 *
 * Client-safe: only the pure engine (sea-carriers.ts) + types.
 */

import { useState } from "react";
import { Plus, Trash2, Ship, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SeaCarrierProfile } from "@/lib/factory/types";
import { seaPerOrderUsd, seaShipmentCost, MAX_CBM_LEVEL } from "@/lib/factory/sea-carriers";

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const LEVELS = Array.from({ length: MAX_CBM_LEVEL }, (_, i) => i + 1); // [1..7]

function emptyPerCbm(): number[] {
  return Array.from({ length: MAX_CBM_LEVEL }, () => 0);
}

export function SeaCarriersSection({
  carriers,
  activeId,
  assumedCbm,
  usdToIls,
  onCarriersChange,
  onActiveChange,
  onAssumedChange,
}: {
  carriers: SeaCarrierProfile[];
  activeId: string | undefined;
  assumedCbm: number;
  usdToIls: number;
  onCarriersChange: (next: SeaCarrierProfile[]) => void;
  onActiveChange: (id: string) => void;
  onAssumedChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const effectiveActiveId =
    activeId && carriers.some((c) => c.id === activeId) ? activeId : carriers[0]?.id;

  const patchCarrier = (idx: number, patch: Partial<SeaCarrierProfile>) =>
    onCarriersChange(carriers.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const setLevel = (idx: number, level: number, value: number) => {
    const c = carriers[idx];
    const arr = [...(c.perCbmByLevel ?? emptyPerCbm())];
    while (arr.length < MAX_CBM_LEVEL) arr.push(0);
    arr[level - 1] = value;
    patchCarrier(idx, { perCbmByLevel: arr });
  };

  const addCarrier = () => {
    onCarriersChange([
      ...carriers,
      {
        id: `carrier-${Date.now().toString(36)}`,
        name: "ספק שילוח חדש",
        enabled: true,
        perCbmByLevel: emptyPerCbm(),
      },
    ]);
  };

  const removeCarrier = (idx: number) => {
    if (!confirm("למחוק את פרופיל הספק?")) return;
    onCarriersChange(carriers.filter((_, i) => i !== idx));
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-start gap-2 flex-1 min-w-0 text-right"
        >
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground shrink-0 mt-0.5 transition-transform",
              open ? "" : "-rotate-90"
            )}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">ספקי שילוח ים</span>
            <span className="block text-[11px] text-muted-foreground mt-0.5">
              מחיר לקוב ל-1 עד 7 קוב, לפי המחירון של הספק. הספק הפעיל קובע את חישוב
              השילוח לכל הצעה חדשה.
            </span>
          </span>
        </button>
        {open && (
          <button
            type="button"
            onClick={addCarrier}
            className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-background/40 px-2 py-1 hover:bg-secondary shrink-0"
          >
            <Plus className="size-3" />
            ספק
          </button>
        )}
      </div>

      {!open ? null : (
        <>
          {/* Assumed shipment volume — the default pricing basis */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 mb-3">
            <label className="text-sm font-medium">נפח משלוח משוער (קוב)</label>
            <p className="text-[11px] text-muted-foreground mb-2">
              בסיס התמחור לכל הזמנה קטנה: הזמנה מתחת לנפח הזה מחויבת לפי המחיר-לקוב
              בנקודה הזאת (ההימור שעוד הזמנות יצטברו וימלאו משלוח). הזמנה גדולה יותר
              משלמת את עלותה האמיתית. ברירת מחדל: 3.
            </p>
            <input
              type="number"
              step={0.5}
              min={0.5}
              value={assumedCbm}
              onChange={(e) => onAssumedChange(n(e.target.value))}
              className="bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums w-32 focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          <div className="flex flex-col gap-3">
            {carriers.map((c, idx) => (
              <CarrierCard
                key={c.id + idx}
                carrier={c}
                isActive={c.id === effectiveActiveId}
                assumedCbm={assumedCbm}
                usdToIls={usdToIls}
                onSetActive={() => onActiveChange(c.id)}
                onChangeName={(name) => patchCarrier(idx, { name })}
                onSetLevel={(level, value) => setLevel(idx, level, value)}
                onRemove={() => removeCarrier(idx)}
              />
            ))}
            {carriers.length === 0 && (
              <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-md">
                אין ספקי ים. הוסף ספק כדי לחשב שילוח ים.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CarrierCard({
  carrier,
  isActive,
  assumedCbm,
  usdToIls,
  onSetActive,
  onChangeName,
  onSetLevel,
  onRemove,
}: {
  carrier: SeaCarrierProfile;
  isActive: boolean;
  assumedCbm: number;
  usdToIls: number;
  onSetActive: () => void;
  onChangeName: (name: string) => void;
  onSetLevel: (level: number, value: number) => void;
  onRemove: () => void;
}) {
  const perCbm = carrier.perCbmByLevel ?? [];
  return (
    <div
      className={cn(
        "rounded-lg border bg-background/40 p-3",
        isActive ? "border-primary ring-1 ring-primary/30" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => { if (!isActive) onSetActive(); }}
            role="switch"
            aria-checked={isActive}
            title={isActive ? "ספק פעיל — לחץ על ספק אחר כדי להחליף" : "הפעל ספק זה (יכבה את האחר)"}
            className="inline-flex items-center gap-1.5 shrink-0"
          >
            <span
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                isActive ? "bg-success" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "inline-block size-4 rounded-full bg-white transition-transform",
                  isActive ? "translate-x-0.5" : "translate-x-[18px]"
                )}
              />
            </span>
            <span className={cn("text-xs", isActive ? "text-success font-medium" : "text-muted-foreground")}>
              {isActive ? "פעיל" : "כבוי"}
            </span>
          </button>
          <Ship className="size-4 text-primary shrink-0" />
          <input
            type="text"
            value={carrier.name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="שם הספק"
            className="flex-1 min-w-0 bg-background/50 border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive p-1 shrink-0"
          title="מחק"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <label className="text-[11px] font-medium text-muted-foreground">
        מחיר לקוב ($) לפי נפח המשלוח
      </label>
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mt-1">
        {LEVELS.map((lvl) => (
          <div key={lvl} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground text-center">{lvl} קוב</span>
            <input
              type="number"
              step={1}
              value={perCbm[lvl - 1] ?? 0}
              onChange={(e) => onSetLevel(lvl, n(e.target.value))}
              className="bg-background/50 border border-border rounded-md px-2 py-1 text-sm tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
        ))}
      </div>

      {isActive && (
        <CarrierPreview carrier={carrier} assumedCbm={assumedCbm} usdToIls={usdToIls} />
      )}
    </div>
  );
}

/** Live preview: per-order billed cost at the assumed basis vs true cost. */
function CarrierPreview({
  carrier,
  assumedCbm,
  usdToIls,
}: {
  carrier: SeaCarrierProfile;
  assumedCbm: number;
  usdToIls: number;
}) {
  const rows = [1, 2, 3, 4, 5, 7].map((cbm) => {
    const order = seaPerOrderUsd(carrier, cbm, { assumedCbm });
    const trueCost = seaShipmentCost(carrier, cbm).totalUsd;
    return { cbm, order, trueCost };
  });
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/20 p-2">
      <p className="text-[11px] font-medium mb-1">
        תצוגה חיה — עלות שילוח להזמנה (בסיס {assumedCbm} קוב)
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-muted-foreground">
            <tr className="text-right">
              <th className="font-normal py-0.5 pl-2">קוב</th>
              <th className="font-normal py-0.5 pl-2">מחויב $</th>
              <th className="font-normal py-0.5 pl-2">מחויב ₪</th>
              <th className="font-normal py-0.5 pl-2">$/קוב</th>
              <th className="font-normal py-0.5">בסיס</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cbm, order }) => (
              <tr key={cbm} className="border-t border-border/50">
                <td className="py-0.5 pl-2">{cbm}</td>
                <td className="py-0.5 pl-2">${order.shipmentUsd.toFixed(0)}</td>
                <td className="py-0.5 pl-2">
                  ₪{Math.round(order.shipmentUsd * usdToIls).toLocaleString()}
                </td>
                <td className="py-0.5 pl-2">${order.perCbmUsd.toFixed(0)}</td>
                <td className="py-0.5">
                  {order.assumedBasisUsed ? (
                    <span className="text-primary">הימור {assumedCbm} קוב</span>
                  ) : (
                    <span className="text-muted-foreground">עלות אמיתית</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
