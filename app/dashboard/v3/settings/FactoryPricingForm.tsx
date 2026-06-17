"use client";

/**
 * Admin form for `app_config.factory_pricing` JSONB:
 *   - usdToIls, usdToCny, defaultProfitMargin
 *   - shippingOptions[] (sea/air, rates, enabled toggle)
 *
 * Loads initial state from server prop, PUTs full JSON to
 * /api/factory/config on save. Cache invalidates server-side.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Plus, Trash2, Ship, Plane } from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  FactoryPricingConfig,
  SeaCarrierProfile,
  ShippingOption,
} from "@/lib/factory/types";
import { SeaCarriersSection } from "@/components/settings/SeaCarriersSection";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || `opt-${Date.now().toString(36)}`
  );
}

export function FactoryPricingForm({ initial }: { initial: FactoryPricingConfig }) {
  const router = useRouter();
  const [state, setState] = useState<FactoryPricingConfig>(initial);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(initial) !== JSON.stringify(state),
    [initial, state]
  );

  const errors = useMemo(() => validate(state), [state]);
  const hasErrors = Object.keys(errors).length > 0;

  const save = () => {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/factory/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        });
        const data = await res.json();
        if (data?.ok) {
          setMsg({ ok: true, text: "נשמר ✓" });
          // Refresh the RSC page so `initial` prop reflects the saved value;
          // this resets the dirty check and confirms the round-trip.
          router.refresh();
        } else {
          setMsg({ ok: false, text: data?.detail ?? data?.error ?? "כשל" });
        }
      } catch (err) {
        setMsg({
          ok: false,
          text: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  const updateNumber = (
    key: "usdToIls" | "usdToCny" | "defaultProfitMargin" | "commissionPct",
    v: string
  ) => {
    const num = Number(v);
    setState((s) => ({ ...s, [key]: Number.isFinite(num) ? num : 0 }));
  };

  const QTY_TIERS = ["1000", "3000", "5000", "10000"] as const;
  const updateMarginTier = (qtyKey: string, v: string) => {
    const num = Number(v);
    setState((s) => ({
      ...s,
      profitMarginByQuantity: {
        ...(s.profitMarginByQuantity ?? {}),
        [qtyKey]: Number.isFinite(num) ? num : 0,
      },
    }));
  };

  const updateOption = (idx: number, patch: Partial<ShippingOption>) => {
    setState((s) => ({
      ...s,
      shippingOptions: s.shippingOptions.map((o, i) =>
        i === idx ? { ...o, ...patch } : o
      ),
    }));
  };

  const addOption = (type: "sea" | "air") => {
    const base: ShippingOption =
      type === "sea"
        ? {
            id: `sea-${Date.now().toString(36)}`,
            name: "אפשרות שילוח חדשה (ים)",
            type: "sea",
            enabled: true,
            seaRate: 200,
          }
        : {
            id: `air-${Date.now().toString(36)}`,
            name: "אפשרות שילוח חדשה (אוויר)",
            type: "air",
            enabled: true,
            airRates: {
              thresholdKg: 100,
              rateBelowThreshold: 8,
              rateAboveThreshold: 6,
            },
          };
    setState((s) => ({ ...s, shippingOptions: [...s.shippingOptions, base] }));
  };

  const removeOption = (idx: number) => {
    if (!confirm("למחוק את אפשרות השילוח?")) return;
    setState((s) => ({
      ...s,
      shippingOptions: s.shippingOptions.filter((_, i) => i !== idx),
    }));
  };

  const setCarriers = (next: SeaCarrierProfile[]) =>
    setState((s) => ({ ...s, seaCarriers: next }));
  const setActiveCarrier = (id: string) =>
    setState((s) => ({ ...s, activeSeaCarrierId: id }));
  const setAssumedCbm = (v: number) =>
    setState((s) => ({ ...s, assumedShipmentCbm: v > 0 ? v : 1 }));

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-medium mb-1">הגדרות תמחור מפעל</h2>
      <p className="text-xs text-muted-foreground mb-4">
        שערי המרה ועלויות שילוח בשימוש לכל הצעה סופית. שינויים נכנסים מיידית
        (cache מתאפס בשמירה).
      </p>
      <div className="border-b border-border mb-4" />

      {/* Conversion rates */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <NumField
          label="USD → ILS"
          hint="שער דולר אמריקאי לשקל"
          value={state.usdToIls}
          step={0.01}
          onChange={(v) => updateNumber("usdToIls", v)}
          error={errors.usdToIls as string | undefined}
        />
        <NumField
          label="USD → CNY"
          hint="כמה יואן בדולר (לחישוב עלות יחידה ¥ → ₪)"
          value={state.usdToCny}
          step={0.01}
          onChange={(v) => updateNumber("usdToCny", v)}
          error={errors.usdToCny as string | undefined}
        />
        <NumField
          label='מרז׳ין ברירת מחדל (% מהמחיר)'
          hint="אחוז רווח מתוך מחיר המוצר ללקוח (0–99). נופל-חזרה כשאין ערך בטבלת הכמויות"
          value={state.defaultProfitMargin}
          step={1}
          onChange={(v) => updateNumber("defaultProfitMargin", v)}
          error={errors.defaultProfitMargin as string | undefined}
        />
        <NumField
          label="עמלת מכירות (% מהעסקה)"
          hint="עמלת איש המכירות, אחוז מסכום העסקה הכולל. תצוגה לבוס בלבד — לא משפיע על מחיר הלקוח."
          value={state.commissionPct ?? 10}
          step={0.5}
          onChange={(v) => updateNumber("commissionPct", v)}
          error={errors.commissionPct as string | undefined}
        />
      </div>

      {/* Profit margin per quantity tier — used by the WhatsApp questionnaire */}
      <div className="mb-6">
        <h3 className="text-sm font-medium mb-1">מרז׳ין לפי כמות (% מהמחיר)</h3>
        <p className="text-[11px] text-muted-foreground mb-3">
          אחוז רווח מתוך מחיר המוצר ללקוח (0–99). למשל 60 = 60% מהמחיר נשאר לך.
          השאלון בווצאפ לוקח את האחוז לפי הכמות שהלקוח בחר; כמות שלא ברשימה →
          "מרז׳ין ברירת מחדל" שלמעלה.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {QTY_TIERS.map((q) => (
            <NumField
              key={q}
              label={`${Number(q).toLocaleString()} יח'`}
              value={
                state.profitMarginByQuantity?.[q] ?? state.defaultProfitMargin
              }
              step={1}
              onChange={(v) => updateMarginTier(q, v)}
              error={errors[`margin:${q}`] as string | undefined}
            />
          ))}
        </div>
      </div>

      {/* Sea carriers — the tiered forwarder pricing that drives sea cost */}
      <SeaCarriersSection
        carriers={state.seaCarriers ?? []}
        activeId={state.activeSeaCarrierId}
        assumedCbm={state.assumedShipmentCbm ?? 3}
        usdToIls={state.usdToIls}
        onCarriersChange={setCarriers}
        onActiveChange={setActiveCarrier}
        onAssumedChange={setAssumedCbm}
      />

      {/* Shipping options */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">אפשרויות שילוח</h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => addOption("sea")}
            className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-background/40 px-2 py-1 hover:bg-secondary"
          >
            <Plus className="size-3" />
            ים
          </button>
          <button
            type="button"
            onClick={() => addOption("air")}
            className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-background/40 px-2 py-1 hover:bg-secondary"
          >
            <Plus className="size-3" />
            אוויר
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {state.shippingOptions.map((opt, idx) => (
          <ShippingOptionCard
            key={opt.id + idx}
            opt={opt}
            errors={errors[`opt:${idx}`] as Record<string, string> | undefined}
            onChange={(patch) => updateOption(idx, patch)}
            onSlugifyId={() =>
              updateOption(idx, { id: slugify(opt.name) || opt.id })
            }
            onRemove={() => removeOption(idx)}
          />
        ))}
        {state.shippingOptions.length === 0 && (
          <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-md">
            אין אפשרויות שילוח. הוסף לפחות אחת כדי לאפשר finalize.
          </p>
        )}
      </div>

      {/* Save bar */}
      <div className="mt-6 flex items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={save}
          disabled={isPending || !dirty || hasErrors}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Save className="size-3.5" />
          {isPending ? "שומר…" : dirty ? "שמור הגדרות תמחור" : "נשמר"}
        </button>
        {hasErrors && (
          <span className="text-xs text-destructive">
            יש שדות לא תקינים — תקן לפני שמירה
          </span>
        )}
        {msg && (
          <span
            className={cn(
              "text-xs",
              msg.ok ? "text-success" : "text-destructive"
            )}
          >
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}

function NumField({
  label,
  hint,
  value,
  step,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  value: number;
  step: number;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium">{label}</label>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "bg-background/50 border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30",
          error ? "border-destructive" : "border-border"
        )}
      />
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

function ShippingOptionCard({
  opt,
  errors,
  onChange,
  onSlugifyId,
  onRemove,
}: {
  opt: ShippingOption;
  errors?: Record<string, string>;
  onChange: (patch: Partial<ShippingOption>) => void;
  onSlugifyId: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {opt.type === "sea" ? (
            <Ship className="size-4 text-primary shrink-0" />
          ) : (
            <Plane className="size-4 text-primary shrink-0" />
          )}
          <input
            type="text"
            value={opt.name}
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={onSlugifyId}
            placeholder="שם אפשרות"
            className="flex-1 min-w-0 bg-background/50 border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={opt.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="size-3.5"
            />
            פעיל
          </label>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive p-1"
            title="מחק"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground mb-2">
        id: <code className="bg-muted/40 px-1 rounded">{opt.id}</code>
      </div>

      {opt.type === "sea" ? (
        <NumField
          label="USD per CBM (גיבוי ישן)"
          hint="לא בשימוש כשיש ספק ים פעיל למעלה — נשאר רק כגיבוי לתאימות. תעריף שטוח לקובייה (m³)."
          value={opt.seaRate ?? 0}
          step={1}
          onChange={(v) => onChange({ seaRate: Number(v) || 0 })}
          error={errors?.seaRate}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumField
            label='סף משקל (ק"ג)'
            value={opt.airRates?.thresholdKg ?? 100}
            step={1}
            onChange={(v) =>
              onChange({
                airRates: {
                  ...(opt.airRates ?? {
                    thresholdKg: 0,
                    rateBelowThreshold: 0,
                    rateAboveThreshold: 0,
                  }),
                  thresholdKg: Number(v) || 0,
                },
              })
            }
            error={errors?.thresholdKg}
          />
          <NumField
            label='USD/kg מתחת לסף'
            value={opt.airRates?.rateBelowThreshold ?? 0}
            step={0.1}
            onChange={(v) =>
              onChange({
                airRates: {
                  ...(opt.airRates ?? {
                    thresholdKg: 0,
                    rateBelowThreshold: 0,
                    rateAboveThreshold: 0,
                  }),
                  rateBelowThreshold: Number(v) || 0,
                },
              })
            }
            error={errors?.rateBelowThreshold}
          />
          <NumField
            label='USD/kg מעל סף'
            value={opt.airRates?.rateAboveThreshold ?? 0}
            step={0.1}
            onChange={(v) =>
              onChange({
                airRates: {
                  ...(opt.airRates ?? {
                    thresholdKg: 0,
                    rateBelowThreshold: 0,
                    rateAboveThreshold: 0,
                  }),
                  rateAboveThreshold: Number(v) || 0,
                },
              })
            }
            error={errors?.rateAboveThreshold}
          />
        </div>
      )}
    </div>
  );
}

function validate(s: FactoryPricingConfig): Record<string, unknown> {
  const errors: Record<string, unknown> = {};
  if (!(s.usdToIls > 0)) errors.usdToIls = "חובה > 0";
  if (!(s.usdToCny > 0)) errors.usdToCny = "חובה > 0";
  // Margin is % of PRICE → must be 0..<100 (≥100 is mathematically impossible).
  if (!(s.defaultProfitMargin >= 0 && s.defaultProfitMargin < 100))
    errors.defaultProfitMargin = "חובה 0–99";
  // Commission is % of the gross sale → 0..100 is the sane range.
  if (s.commissionPct !== undefined && !(s.commissionPct >= 0 && s.commissionPct <= 100))
    errors.commissionPct = "חובה 0–100";
  if (s.profitMarginByQuantity) {
    for (const [qty, pct] of Object.entries(s.profitMarginByQuantity)) {
      if (!(pct >= 0 && pct < 100)) errors[`margin:${qty}`] = "חובה 0–99";
    }
  }
  if (s.assumedShipmentCbm !== undefined && !(s.assumedShipmentCbm > 0))
    errors.assumedShipmentCbm = "חובה > 0";
  s.shippingOptions.forEach((opt, i) => {
    const optErr: Record<string, string> = {};
    if (opt.type === "sea") {
      if (!(typeof opt.seaRate === "number" && opt.seaRate > 0))
        optErr.seaRate = "חובה > 0";
    } else {
      const r = opt.airRates;
      if (!r || !(r.thresholdKg > 0)) optErr.thresholdKg = "חובה > 0";
      if (!r || !(r.rateBelowThreshold > 0))
        optErr.rateBelowThreshold = "חובה > 0";
      if (!r || !(r.rateAboveThreshold > 0))
        optErr.rateAboveThreshold = "חובה > 0";
    }
    if (Object.keys(optErr).length > 0) errors[`opt:${i}`] = optErr;
  });
  return errors;
}
