"use client";

/**
 * Widget variant of FactoryPricingForm.
 *
 * Loads its own initial state on mount via /api/widget/factory/config, PUTs
 * the full config on save. No useRouter — replaces `router.refresh()` with a
 * GET-after-PUT round trip to confirm the value Vercel kept.
 *
 * Mirrors the dashboard FactoryPricingForm 1:1 for layout and validation.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Save, Plus, Trash2, Ship, Plane, Loader2, RefreshCw,
  ArrowLeftRight, Percent, Truck, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  FactoryPricingConfig,
  SeaCarrierProfile,
  ShippingOption,
} from "@/lib/factory/types";
import { SeaCarriersSection } from "@/components/settings/SeaCarriersSection";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";

function widgetUrl(path: string, token: string): string {
  const u = new URL(path, "http://placeholder.local");
  u.searchParams.set("widget_token", token);
  return u.pathname + u.search;
}

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

const QTY_TIERS = ["1000", "3000", "5000", "10000"] as const;

export function SettingsView({ apiToken }: { apiToken: string }) {
  const [initial, setInitial] = useState<FactoryPricingConfig | null>(null);
  const [state, setState] = useState<FactoryPricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshingFx, setRefreshingFx] = useState(false);
  const [fxMsg, setFxMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(widgetUrl("/api/widget/factory/config", apiToken));
      const data = await res.json();
      if (data?.ok && data?.config) {
        setInitial(data.config as FactoryPricingConfig);
        setState(data.config as FactoryPricingConfig);
      } else {
        setLoadError(data?.error ?? "כשל בטעינת הגדרות");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiToken]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => initial != null && state != null && JSON.stringify(initial) !== JSON.stringify(state),
    [initial, state]
  );

  const errors = useMemo(() => (state ? validate(state) : {}), [state]);
  const hasErrors = Object.keys(errors).length > 0;

  const save = async () => {
    if (!state) return;
    setMsg(null);
    setSaving(true);
    try {
      const res = await fetch(widgetUrl("/api/widget/factory/config", apiToken), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const data = await res.json();
      if (data?.ok) {
        setMsg({ ok: true, text: "נשמר ✓" });
        // Re-fetch to confirm what landed.
        await load();
      } else {
        setMsg({ ok: false, text: data?.detail ?? data?.error ?? "כשל" });
      }
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const updateNumber = (
    key: "usdToIls" | "usdToCny" | "ilsToCny" | "defaultProfitMargin" | "commissionPct",
    v: string
  ) => {
    const num = Number(v);
    setState((s) => (s ? { ...s, [key]: Number.isFinite(num) ? num : 0 } : s));
  };

  // Pull the live market rate and drop it into the form (operator still clicks
  // Save to apply). Does NOT write the config itself — keeps the save flow intact.
  const refreshFx = async () => {
    setFxMsg(null);
    setRefreshingFx(true);
    try {
      const res = await fetch(widgetUrl("/api/widget/factory/fx-live", apiToken) + "&fresh=1");
      const data = await res.json();
      if (data?.ok && data?.fx) {
        setState((s) => (s ? { ...s, usdToIls: data.fx.usdToIls, usdToCny: data.fx.usdToCny, fxUpdatedAt: data.fx.fetchedAt } : s));
        setFxMsg(
          data.fx.source === "config-fallback"
            ? "לא הצלחתי למשוך שער חי כרגע — נשאר הערך הנוכחי"
            : `שער חי נטען: 1$ = ₪${data.fx.usdToIls} · 1$ = ¥${data.fx.usdToCny}. לחץ שמור להחיל.`
        );
      } else {
        setFxMsg(data?.error ?? "כשל במשיכת שער");
      }
    } catch (err) {
      setFxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingFx(false);
    }
  };

  const updateMarginTier = (qtyKey: string, v: string) => {
    const num = Number(v);
    setState((s) =>
      s
        ? {
            ...s,
            profitMarginByQuantity: {
              ...(s.profitMarginByQuantity ?? {}),
              [qtyKey]: Number.isFinite(num) ? num : 0,
            },
          }
        : s
    );
  };

  const updateOption = (idx: number, patch: Partial<ShippingOption>) => {
    setState((s) =>
      s
        ? {
            ...s,
            shippingOptions: s.shippingOptions.map((o, i) =>
              i === idx ? { ...o, ...patch } : o
            ),
          }
        : s
    );
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
    setState((s) => (s ? { ...s, shippingOptions: [...s.shippingOptions, base] } : s));
  };

  const removeOption = (idx: number) => {
    if (!confirm("למחוק את אפשרות השילוח?")) return;
    setState((s) =>
      s
        ? { ...s, shippingOptions: s.shippingOptions.filter((_, i) => i !== idx) }
        : s
    );
  };

  const setCarriers = (next: SeaCarrierProfile[]) =>
    setState((s) => (s ? { ...s, seaCarriers: next } : s));
  const setActiveCarrier = (id: string) =>
    setState((s) => (s ? { ...s, activeSeaCarrierId: id } : s));
  const setAssumedCbm = (v: number) =>
    setState((s) => (s ? { ...s, assumedShipmentCbm: v > 0 ? v : 1 } : s));

  if (loading) {
    return (
      <LuxShell>
        <div
          style={{
            background: "var(--lux-card)",
            borderRadius: 10,
            padding: "48px 18px",
            textAlign: "center",
            color: "#8a7f74",
            fontSize: 14,
            boxShadow: "inset 0 0 0 1px var(--lux-line)",
          }}
        >
          <Loader2 className="size-5 mx-auto mb-2 animate-spin opacity-70" />
          טוען הגדרות…
        </div>
      </LuxShell>
    );
  }

  if (loadError) {
    return (
      <LuxShell>
        <div
          className="flex items-center justify-between gap-3"
          style={{
            background: "rgba(232,180,180,0.06)",
            borderRadius: 10,
            padding: "14px 18px",
            color: "#e8b4b4",
            fontSize: 14,
            boxShadow: "inset 0 0 0 1px rgba(232,180,180,0.2)",
          }}
        >
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5"
            style={{
              padding: "7px 13px",
              borderRadius: 9999,
              fontSize: 12,
              color: "#8a7f74",
              background: "transparent",
              border: 0,
              boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.22)",
              cursor: "pointer",
            }}
          >
            <RefreshCw className="size-3.5" />
            נסה שוב
          </button>
        </div>
      </LuxShell>
    );
  }

  if (!state) return null;

  return (
    <LuxShell>
      <LuxTitle
        overline="— Pricing settings"
        subtitle="שערי המרה, רווחיות ועלויות שילוח לכל הצעה סופית. שינויים נכנסים מיידית."
      >
        הגדרות תמחור <LuxAccent>מפעל.</LuxAccent>
      </LuxTitle>
      <section className="space-y-6" dir="rtl">

      <FormSection icon={ArrowLeftRight} title="שערי המרה" desc="המרות מטבע לחישוב עלות והצעה">
        {/* Live auto-update controls */}
        <div className="mb-4 rounded-lg border border-border/60 bg-background/30 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setState((s) => (s ? { ...s, fxAutoUpdate: s.fxAutoUpdate !== true } : s))}
              aria-pressed={state.fxAutoUpdate === true}
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors shrink-0",
                state.fxAutoUpdate === true ? "bg-emerald-500/70" : "bg-muted"
              )}
            >
              <span className={cn("absolute top-0.5 size-5 rounded-full bg-white transition-all", state.fxAutoUpdate === true ? "left-0.5" : "left-[22px]")} />
            </button>
            <div>
              <div className="text-sm font-medium">עדכון שער אוטומטי מהאינטרנט</div>
              <div className="text-[11px] text-muted-foreground">
                {state.fxAutoUpdate === true
                  ? "השער מתעדכן אוטומטית פעם ביום מהשוק."
                  : "השער קפוא — עדכון ידני בלבד (הפעל כדי לעדכן אוטומטית)."}
                {state.fxUpdatedAt && ` · עודכן לאחרונה ${new Date(state.fxUpdatedAt).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={refreshFx}
            disabled={refreshingFx}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/30 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", refreshingFx && "animate-spin")} /> רענן עכשיו
          </button>
        </div>
        {fxMsg && <div className="mb-3 text-[11px] text-muted-foreground">{fxMsg}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumField label="USD → ILS" suffix="₪" hint="שער דולר אמריקאי לשקל" value={state.usdToIls} step={0.01} onChange={(v) => updateNumber("usdToIls", v)} error={errors.usdToIls as string | undefined} />
          <NumField label="USD → CNY" suffix="¥" hint="כמה יואן בדולר (לעלות יחידה ¥ → ₪)" value={state.usdToCny} step={0.01} onChange={(v) => updateNumber("usdToCny", v)} error={errors.usdToCny as string | undefined} />
          <NumField label="ILS → CNY" suffix="¥" hint="להצגה בלבד ב-boss view של ההצעה" value={state.ilsToCny ?? 0} step={0.01} onChange={(v) => updateNumber("ilsToCny", v)} error={errors.ilsToCny as string | undefined} />
        </div>
      </FormSection>

      <FormSection icon={Percent} title="רווחיות ועמלות" desc="הרווח שלך והעמלה לאיש המכירות">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumField label="רווח ברירת מחדל" suffix="%" hint="נופל-חזרה כשאין ערך בטבלת הכמויות (לכמויות חופשיות)" value={state.defaultProfitMargin} step={1} onChange={(v) => updateNumber("defaultProfitMargin", v)} error={errors.defaultProfitMargin as string | undefined} />
          <NumField label="עמלת מכירות" suffix="%" badge="לבוס בלבד" accent hint="אחוז מסכום העסקה הכולל — לא משפיע על מחיר הלקוח." value={state.commissionPct ?? 10} step={0.5} onChange={(v) => updateNumber("commissionPct", v)} error={errors.commissionPct as string | undefined} />
        </div>
        <div className="mt-4 rounded-lg border border-border/60 bg-background/30 p-3">
          <h3 className="text-xs font-medium mb-0.5">אחוזי רווחיות לפי כמות</h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            השאלון בווצאפ לוקח את האחוז המתאים לפי הכמות שהלקוח בחר. כמות שלא ברשימה → "רווח ברירת מחדל".
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {QTY_TIERS.map((q) => (
              <NumField key={q} label={`${Number(q).toLocaleString()} יח'`} suffix="%" value={state.profitMarginByQuantity?.[q] ?? state.defaultProfitMargin} step={1} onChange={(v) => updateMarginTier(q, v)} error={errors[`margin:${q}`] as string | undefined} />
            ))}
          </div>
        </div>
      </FormSection>

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

      <FormSection
        icon={Truck}
        title="אפשרויות שילוח"
        desc="ים / אוויר — שמות, תעריפים והפעלה"
        action={
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
        }
      >
        <div className="flex flex-col gap-3">
          {state.shippingOptions.map((opt, idx) => (
            <ShippingOptionCard
              key={opt.id + idx}
              opt={opt}
              errors={errors[`opt:${idx}`] as Record<string, string> | undefined}
              onChange={(patch) => updateOption(idx, patch)}
              onSlugifyId={() => updateOption(idx, { id: slugify(opt.name) || opt.id })}
              onRemove={() => removeOption(idx)}
            />
          ))}
          {state.shippingOptions.length === 0 && (
            <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-md">
              אין אפשרויות שילוח. הוסף לפחות אחת כדי לאפשר finalize.
            </p>
          )}
        </div>
      </FormSection>

      <div className="mt-6 flex items-center gap-3 pt-4" style={{ borderTop: "1px solid var(--lux-line)" }}>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || hasErrors}
          className="lux-cta-champagne"
          style={{ minHeight: 44, padding: "0 20px", fontSize: 14 }}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "שומר…" : dirty ? "שמור הגדרות תמחור" : "נשמר"}
        </button>
        {hasErrors && (
          <span className="text-xs" style={{ color: "#e8b4b4" }}>
            יש שדות לא תקינים — תקן לפני שמירה
          </span>
        )}
        {msg && (
          <span className={cn("text-xs", msg.ok ? "text-success" : "text-destructive")}>
            {msg.text}
          </span>
        )}
      </div>
      </section>
    </LuxShell>
  );
}

function FormSection({
  icon: Icon,
  title,
  desc,
  action,
  children,
  defaultOpen = false,
}: {
  icon: typeof Truck;
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** open on first render; default collapsed so the page is compact. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border/70 bg-background/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-right"
        >
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground shrink-0 transition-transform",
              open ? "" : "-rotate-90"
            )}
          />
          <span
            className="grid place-items-center size-7 rounded-lg shrink-0"
            style={{
              background: "rgba(190,198,224,0.12)",
              color: "#bec6e0",
              boxShadow: "inset 0 0 0 1px rgba(190,198,224,0.22)",
            }}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">{title}</h3>
            {desc && <p className="text-[11px] text-muted-foreground leading-tight">{desc}</p>}
          </div>
        </button>
        {open && action}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function NumField({
  label,
  hint,
  value,
  step,
  onChange,
  error,
  suffix,
  badge,
  accent,
}: {
  label: string;
  hint?: string;
  value: number;
  step: number;
  onChange: (v: string) => void;
  error?: string;
  suffix?: string;
  badge?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <label className="text-sm font-medium">{label}</label>
        {badge && (
          <span className="rounded-full bg-warning/15 text-warning text-[9px] font-medium px-1.5 py-0.5">
            {badge}
          </span>
        )}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground leading-tight">{hint}</p>}
      <div className="relative">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full bg-background/50 border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30",
            suffix && "pl-8",
            error ? "border-destructive" : accent ? "border-warning/50 ring-1 ring-warning/20" : "border-border"
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
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
        <p className="text-[11px] text-muted-foreground">
          התעריפים נקבעים לפי הספק הפעיל ב"ספקי שילוח ים" למעלה. כאן רק שם
          האפשרות וההפעלה.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumField
            label='סף משקל (ק"ג)'
            value={opt.airRates?.thresholdKg ?? 100}
            step={1}
            onChange={(v) =>
              onChange({
                airRates: {
                  ...(opt.airRates ?? { thresholdKg: 0, rateBelowThreshold: 0, rateAboveThreshold: 0 }),
                  thresholdKg: Number(v) || 0,
                },
              })
            }
            error={errors?.thresholdKg}
          />
          <NumField
            label="USD/kg מתחת לסף"
            value={opt.airRates?.rateBelowThreshold ?? 0}
            step={0.1}
            onChange={(v) =>
              onChange({
                airRates: {
                  ...(opt.airRates ?? { thresholdKg: 0, rateBelowThreshold: 0, rateAboveThreshold: 0 }),
                  rateBelowThreshold: Number(v) || 0,
                },
              })
            }
            error={errors?.rateBelowThreshold}
          />
          <NumField
            label="USD/kg מעל סף"
            value={opt.airRates?.rateAboveThreshold ?? 0}
            step={0.1}
            onChange={(v) =>
              onChange({
                airRates: {
                  ...(opt.airRates ?? { thresholdKg: 0, rateBelowThreshold: 0, rateAboveThreshold: 0 }),
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
  if (s.ilsToCny !== undefined && !(s.ilsToCny > 0)) errors.ilsToCny = "חובה > 0";
  if (!(s.defaultProfitMargin >= 0)) errors.defaultProfitMargin = "חובה ≥ 0";
  if (s.commissionPct !== undefined && !(s.commissionPct >= 0 && s.commissionPct <= 100))
    errors.commissionPct = "חובה 0–100";
  if (s.profitMarginByQuantity) {
    for (const [qty, pct] of Object.entries(s.profitMarginByQuantity)) {
      if (!(pct >= 0)) errors[`margin:${qty}`] = "חובה ≥ 0";
    }
  }
  if (s.assumedShipmentCbm !== undefined && !(s.assumedShipmentCbm > 0))
    errors.assumedShipmentCbm = "חובה > 0";
  s.shippingOptions.forEach((opt, i) => {
    const optErr: Record<string, string> = {};
    if (opt.type === "sea") {
      // Sea rate comes from the active carrier profile, not this option.
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
