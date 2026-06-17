"use client";

/**
 * Sea-freight carrier (forwarder) editor for the factory pricing settings.
 *
 * Replaces the old single "$ per CBM" field. The boss manages one profile per
 * forwarder (e.g. ידים לוגיסטיקה), picks which one is ACTIVE (drives all sea
 * pricing), and sets the "assumed shipment volume" (default 3 CBM) that is the
 * default per-order pricing basis. A live preview shows the resulting per-order
 * cost so the effect of any edit is visible immediately.
 *
 * Client-safe: only imports the pure engine (sea-carriers.ts) + types — no
 * server-only modules (per the client-bundle import rule in CLAUDE.md).
 */

import { useState } from "react";
import { Plus, Trash2, Ship, CheckCircle2, Circle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CbmTier, SeaCarrierProfile } from "@/lib/factory/types";
import { seaPerOrderUsd, seaShipmentCost } from "@/lib/factory/sea-carriers";

/** Read a band value by its inclusive upper bound; 0 when the band is absent. */
function bandVal(tiers: CbmTier[], maxCbm: number): number {
  return tiers.find((t) => t.maxCbm === maxCbm)?.value ?? 0;
}
/** Set a band value (creating the band if missing), kept sorted by maxCbm. */
function setBand(tiers: CbmTier[], maxCbm: number, value: number): CbmTier[] {
  const exists = tiers.some((t) => t.maxCbm === maxCbm);
  const next = exists
    ? tiers.map((t) => (t.maxCbm === maxCbm ? { ...t, value } : t))
    : [...tiers, { maxCbm, value }];
  return next.sort((a, b) => a.maxCbm - b.maxCbm);
}

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

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
  const effectiveActiveId =
    activeId && carriers.some((c) => c.id === activeId)
      ? activeId
      : carriers[0]?.id;

  const patchCarrier = (idx: number, patch: Partial<SeaCarrierProfile>) =>
    onCarriersChange(
      carriers.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    );

  const addCarrier = () => {
    const id = `carrier-${Date.now().toString(36)}`;
    onCarriersChange([
      ...carriers,
      {
        id,
        name: "ספק שילוח חדש",
        enabled: true,
        fxUsdToIls: 2.9,
        chinaInlandTiers: [
          { maxCbm: 1, value: 0 },
          { maxCbm: 3, value: 0 },
          { maxCbm: 7, value: 0 },
        ],
        brokerUsd: 0,
        customsUsd: 0,
        lclPerCbmUsd: 0,
        terminalTiers: [
          { maxCbm: 1, value: 0 },
          { maxCbm: 3, value: 0 },
          { maxCbm: 7, value: 0 },
        ],
        reshumonIls: 0,
        inlandCenterTiers: [
          { maxCbm: 3, value: 0 },
          { maxCbm: 7, value: 0 },
        ],
        inlandNorthTiers: [
          { maxCbm: 3, value: 0 },
          { maxCbm: 7, value: 0 },
        ],
        extraStopIls: 0,
      },
    ]);
  };

  const removeCarrier = (idx: number) => {
    if (!confirm("למחוק את פרופיל הספק?")) return;
    onCarriersChange(carriers.filter((_, i) => i !== idx));
  };

  const [open, setOpen] = useState(false);

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
            <span className="block text-sm font-medium">ספקי שילוח ים (מחירון מדורג)</span>
            <span className="block text-[11px] text-muted-foreground mt-0.5">
              כל ספק = מחירון מלא. הספק הפעיל קובע את חישוב השילוח לכל הצעה חדשה.
              במקום "תעריף לקוב" יחיד — המערכת מחברת את כל הרכיבים לפי הנפח.
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
            onChange={(patch) => patchCarrier(idx, patch)}
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
  onChange,
  onRemove,
}: {
  carrier: SeaCarrierProfile;
  isActive: boolean;
  assumedCbm: number;
  usdToIls: number;
  onSetActive: () => void;
  onChange: (patch: Partial<SeaCarrierProfile>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background/40 p-3",
        isActive ? "border-primary ring-1 ring-primary/30" : "border-border"
      )}
    >
      {/* Header: active radio + name + remove */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={onSetActive}
            title={isActive ? "ספק פעיל" : "הפוך לפעיל"}
            className={cn(
              "inline-flex items-center gap-1 text-xs shrink-0",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isActive ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Circle className="size-4" />
            )}
            {isActive ? "פעיל" : "הפעל"}
          </button>
          <Ship className="size-4 text-primary shrink-0" />
          <input
            type="text"
            value={carrier.name}
            onChange={(e) => onChange({ name: e.target.value })}
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

      {/* Fixed (per-shipment) + FX */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Field label="ברוקר סין ($)" value={carrier.brokerUsd}
          onChange={(v) => onChange({ brokerUsd: n(v) })} />
        <Field label="מכס ישראל ($)" value={carrier.customsUsd}
          onChange={(v) => onChange({ customsUsd: n(v) })} />
        <Field label="רשומון (₪)" value={carrier.reshumonIls}
          onChange={(v) => onChange({ reshumonIls: n(v) })} />
        <Field label="שער $→₪" step={0.01} value={carrier.fxUsdToIls}
          onChange={(v) => onChange({ fxUsdToIls: n(v) || 1 })} />
        <Field label="LCL לקוב ($)" value={carrier.lclPerCbmUsd}
          onChange={(v) => onChange({ lclPerCbmUsd: n(v) })} />
        <Field label="עצירה נוספת (₪)" value={carrier.extraStopIls}
          onChange={(v) => onChange({ extraStopIls: n(v) })} />
      </div>

      {/* Tiered components */}
      <TierRow
        label="הובלה בסין ($)"
        bands={[1, 3, 7]}
        tiers={carrier.chinaInlandTiers}
        onChange={(t) => onChange({ chinaInlandTiers: t })}
      />
      <TierRow
        label="טרמינל ($)"
        bands={[1, 3, 7]}
        tiers={carrier.terminalTiers}
        onChange={(t) => onChange({ terminalTiers: t })}
      />
      <TierRow
        label="הובלה פנים — מרכז (₪)"
        bands={[3, 7]}
        tiers={carrier.inlandCenterTiers}
        onChange={(t) => onChange({ inlandCenterTiers: t })}
      />
      <TierRow
        label="הובלה פנים — צפון (₪)"
        bands={[3, 7]}
        tiers={carrier.inlandNorthTiers}
        onChange={(t) => onChange({ inlandNorthTiers: t })}
      />

      {isActive && (
        <CarrierPreview carrier={carrier} assumedCbm={assumedCbm} usdToIls={usdToIls} />
      )}
    </div>
  );
}

const BAND_LABEL: Record<number, string> = { 1: "≤1 קוב", 3: "1–3 קוב", 7: "3–7 קוב" };
const BAND_LABEL_2: Record<number, string> = { 3: "≤3 קוב", 7: "3–7 קוב" };

function TierRow({
  label,
  bands,
  tiers,
  onChange,
}: {
  label: string;
  bands: number[];
  tiers: CbmTier[];
  onChange: (t: CbmTier[]) => void;
}) {
  const labels = bands.length === 2 ? BAND_LABEL_2 : BAND_LABEL;
  return (
    <div className="mb-3">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      <div className="grid grid-cols-3 gap-2 mt-1">
        {bands.map((b) => (
          <div key={b} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">{labels[b]}</span>
            <input
              type="number"
              step={1}
              value={bandVal(tiers, b)}
              onChange={(e) => onChange(setBand(tiers, b, n(e.target.value)))}
              className="bg-background/50 border border-border rounded-md px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background/50 border border-border rounded-md px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
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
              <th className="font-normal py-0.5 pl-2">בסיס</th>
              <th className="font-normal py-0.5">עלות אמיתית $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cbm, order, trueCost }) => (
              <tr key={cbm} className="border-t border-border/50">
                <td className="py-0.5 pl-2">{cbm}</td>
                <td className="py-0.5 pl-2">${order.shipmentUsd.toFixed(0)}</td>
                <td className="py-0.5 pl-2">
                  ₪{Math.round(order.shipmentUsd * usdToIls).toLocaleString()}
                </td>
                <td className="py-0.5 pl-2">${order.perCbmUsd.toFixed(0)}</td>
                <td className="py-0.5 pl-2">
                  {order.assumedBasisUsed ? (
                    <span className="text-primary">הימור {assumedCbm} קוב</span>
                  ) : (
                    <span className="text-muted-foreground">עלות אמיתית</span>
                  )}
                </td>
                <td className="py-0.5 text-muted-foreground">${trueCost.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
