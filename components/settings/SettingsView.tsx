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

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Save, Plus, Trash2, Ship, Plane, Loader2, RefreshCw,
  ArrowLeftRight, Percent, Truck, ChevronDown,
  Coins, Users, PhoneCall, MessageSquareText, Megaphone, Gauge, Search,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  FactoryPricingConfig,
  SeaCarrierProfile,
  ShippingOption,
} from "@/lib/factory/types";
import { PAYMENT_PRESETS, DEFAULT_PAYMENT_PLAN_ID, VAT_PCT } from "@/lib/factory/payment-terms";
import { SeaCarriersSection } from "@/components/settings/SeaCarriersSection";
import { TemplatesManager } from "@/components/settings/TemplatesManager";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";
import { AssigneeSection } from "@/components/settings/AssigneeSection";
import { QuoteNotifySection } from "@/components/settings/QuoteNotifySection";
import { CallAnalysisSettingsSection } from "@/components/settings/CallAnalysisSettingsSection";
import { EstimatorHealthSection } from "@/components/settings/EstimatorHealthSection";
import { AdRecommendationSettingsView } from "@/components/ads/AdRecommendationSettingsView";
import { GoogleSettingsView } from "@/components/ads/GoogleSettingsView";
import { syncHubUrl } from "@/lib/widget/hub-link";

/**
 * Groups of the settings screen (ui-ux-pro-max redesign): a side nav instead of
 * one long page. The id is the URL `?section=` value, so a colleague can be sent
 * straight to e.g. `?tab=settings&section=ads`.
 */
export type SettingsSection = "price" | "calc" | "ship" | "team" | "calls" | "templates" | "ads" | "google-ads";
const SETTINGS_GROUPS: { id: SettingsSection; label: string; area: string; icon: typeof Truck }[] = [
  { id: "price", label: "תמחור", area: "מכירות", icon: Coins },
  { id: "calc", label: "דיוק המחשבון", area: "מכירות", icon: Gauge },
  { id: "ship", label: "שילוח", area: "מכירות", icon: Truck },
  { id: "team", label: "שיוך והתראות", area: "צוות", icon: Users },
  { id: "calls", label: "ניתוח שיחות", area: "צוות", icon: PhoneCall },
  { id: "templates", label: "תבניות הודעה", area: "צוות", icon: MessageSquareText },
  // Meta and Google are two separate worlds (Eli, 23/09): their own area each.
  // `ads` stays Meta's id so existing links keep working.
  { id: "ads", label: "כללי בדיקה — מטא", area: "שיווק · מטא", icon: Megaphone },
  { id: "google-ads", label: "כללי בדיקה — גוגל", area: "שיווק · גוגל", icon: Search },
];
export function parseSettingsSection(raw: string | undefined | null): SettingsSection {
  return SETTINGS_GROUPS.some((g) => g.id === raw) ? (raw as SettingsSection) : "price";
}

/** Which save-bar label each changed config key gets, and its group. */
const CONFIG_KEY_LABELS: Record<string, { label: string; group: "price" | "ship" }> = {
  usdToIls: { label: "דולר → שקל", group: "price" },
  usdToCny: { label: "דולר → יואן", group: "price" },
  ilsToCny: { label: "שקל → יואן", group: "price" },
  fxAutoUpdate: { label: "עדכון שער אוטומטי", group: "price" },
  fxUpdatedAt: { label: "שער מטבע", group: "price" },
  paymentTerms: { label: "תנאי תשלום", group: "price" },
  defaultProfitMargin: { label: "רווח ברירת מחדל", group: "price" },
  profitMarginByQuantity: { label: "רווח לפי כמות", group: "price" },
  commissionPct: { label: "עמלת מכירות", group: "price" },
  negotiationBufferAgorot: { label: "מרווח מיקוח", group: "price" },
  estimatorShippingBufferPct: { label: "מרווח ביטחון שילוח", group: "price" },
  estimatorShippingBufferLamPct: { label: "מרווח ביטחון שילוח — למינציה", group: "price" },
  laminationPlateFeePerColorCny: { label: "עמלת למינציה", group: "price" },
  seaCarriers: { label: "ספקי שילוח ים", group: "ship" },
  activeSeaCarrierId: { label: "ספק ים פעיל", group: "ship" },
  assumedShipmentCbm: { label: "נפח משלוח משוער", group: "ship" },
  shippingOptions: { label: "אפשרויות שילוח", group: "ship" },
}

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

export function SettingsView({ apiToken, initialSection }: { apiToken: string; initialSection?: string }) {
  const [section, setSection] = useState<SettingsSection>(() => parseSettingsSection(initialSection));
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

  const changedLabels = useMemo(() => {
    if (!initial || !state) return [];
    const keys = new Set([...Object.keys(initial), ...Object.keys(state)]) as Set<keyof FactoryPricingConfig>;
    const out: { label: string; group: "price" | "ship" }[] = [];
    for (const k of keys) {
      if (JSON.stringify(initial[k]) === JSON.stringify(state[k])) continue;
      const known = CONFIG_KEY_LABELS[k as string];
      if (known && !out.some((o) => o.label === known.label)) out.push(known);
      else if (!known) out.push({ label: String(k), group: "price" });
    }
    return out;
  }, [initial, state]);

  // A full navigation (another tab, a reload) would drop the draft.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const selectSection = (next: SettingsSection) => {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
    syncHubUrl({ section: next });
    window.scrollTo({ top: 0 });
  };

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
        setMsg({ ok: true, text: "נשמר. הצעות חדשות יחושבו לפי הערכים החדשים." });
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
    key: "usdToIls" | "usdToCny" | "ilsToCny" | "defaultProfitMargin" | "commissionPct" | "negotiationBufferAgorot" | "laminationPlateFeePerColorCny" | "estimatorShippingBufferPct" | "estimatorShippingBufferLamPct",
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

  const pricingDirty = changedLabels.some((c) => c.group === "price");
  const shippingDirty = changedLabels.some((c) => c.group === "ship");

  const configBody = (group: "price" | "ship") => {
    if (loading) {
      return (
        <div className="ux-panel" role="status" style={{ textAlign: "center", color: "var(--lux-muted)", padding: "48px 18px" }}>
          <Loader2 className="size-5 mx-auto mb-2 animate-spin opacity-70" aria-hidden />
          טוען הגדרות…
        </div>
      );
    }
    if (loadError || !state) {
      return (
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
                color: "var(--lux-muted)",
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
      );
    }
    return group === "price" ? pricingGroup(state) : shippingGroup(state);
  };

  const pricingGroup = (state: FactoryPricingConfig) => (
    <div className="space-y-5">
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
              <div className="text-[13px] text-muted-foreground">
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
        {fxMsg && <div className="mb-3 text-[13px] text-muted-foreground">{fxMsg}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <NumField label="USD → ILS" suffix="₪" hint="שער דולר אמריקאי לשקל" value={state.usdToIls} step={0.01} onChange={(v) => updateNumber("usdToIls", v)} error={errors.usdToIls as string | undefined} />
          <NumField label="USD → CNY" suffix="¥" hint="כמה יואן בדולר (לעלות יחידה ¥ → ₪)" value={state.usdToCny} step={0.01} onChange={(v) => updateNumber("usdToCny", v)} error={errors.usdToCny as string | undefined} />
          <NumField label="ILS → CNY" suffix="¥" hint="להצגה בלבד ב-boss view של ההצעה" value={state.ilsToCny ?? 0} step={0.01} onChange={(v) => updateNumber("ilsToCny", v)} error={errors.ilsToCny as string | undefined} />
        </div>
      </FormSection>

      <FormSection icon={Percent} title="תנאי תשלום" desc="מה הלקוח רואה בסוף ההצעה בוואטסאפ — מע״מ, סה״כ לתשלום ופריסה">
        <div className="space-y-3">
          {/* Master toggle: attach payment terms to a quote by default. Eli
              2026-08-03 default OFF — the salesperson confirms terms per-call and
              turns them on per-send. Does NOT affect the bot (never sends terms). */}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/30 p-3 cursor-pointer">
            <div>
              <div className="text-xs font-medium">צרף תנאי תשלום להצעות כברירת מחדל</div>
              <div className="text-[13px] text-muted-foreground">
                כבוי (מומלץ) → הצעה נשלחת בלי פרטי בנק/פריסה, ואיש המכירות מוסיף אותם ידנית בשליחה. לא משפיע על הבוט.
              </div>
            </div>
            <input
              type="checkbox"
              checked={state.paymentTerms?.includeByDefault ?? false}
              onChange={(e) =>
                setState((prev) =>
                  prev
                    ? {
                        ...prev,
                        paymentTerms: {
                          defaultPlanId: prev.paymentTerms?.defaultPlanId ?? DEFAULT_PAYMENT_PLAN_ID,
                          vatPct: prev.paymentTerms?.vatPct ?? VAT_PCT,
                          includeByDefault: e.target.checked,
                        },
                      }
                    : prev
                )
              }
              className="size-4 accent-primary"
            />
          </label>
          <div>
            <div className="text-xs font-medium mb-2">פריסת תשלומים — ברירת מחדל</div>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_PRESETS.map((p) => {
                const active = (state.paymentTerms?.defaultPlanId ?? DEFAULT_PAYMENT_PLAN_ID) === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setState((prev) =>
                        prev
                          ? {
                              ...prev,
                              paymentTerms: {
                                defaultPlanId: p.id,
                                vatPct: prev.paymentTerms?.vatPct ?? VAT_PCT,
                                includeByDefault: prev.paymentTerms?.includeByDefault ?? false,
                              },
                            }
                          : prev
                      )
                    }
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border bg-card/40 text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[13px] text-muted-foreground mt-2">
              אפשר לשנות לכל שליחה בנפרד (כולל אחוז חופשי) במסך שליחת ההצעה.
            </p>
          </div>
          <NumField
            label="מע״מ"
            suffix="%"
            hint="נכון להיום 18%. משנים רק אם שיעור המע״מ בישראל משתנה."
            value={state.paymentTerms?.vatPct ?? VAT_PCT}
            step={1}
            onChange={(v) =>
              setState((prev) =>
                prev
                  ? {
                      ...prev,
                      paymentTerms: {
                        defaultPlanId: prev.paymentTerms?.defaultPlanId ?? DEFAULT_PAYMENT_PLAN_ID,
                        vatPct: Number(v) || VAT_PCT,
                        includeByDefault: prev.paymentTerms?.includeByDefault ?? false,
                      },
                    }
                  : prev
              )
            }
          />
        </div>
      </FormSection>

      <FormSection icon={Percent} title="רווחיות ועמלות" desc="הרווח שלך והעמלה לאיש המכירות">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumField label="רווח ברירת מחדל" suffix="%" hint="נופל-חזרה כשאין ערך בטבלת הכמויות (לכמויות חופשיות)" value={state.defaultProfitMargin} step={1} onChange={(v) => updateNumber("defaultProfitMargin", v)} error={errors.defaultProfitMargin as string | undefined} />
          <NumField label="עמלת מכירות" suffix="%" badge="לבוס בלבד" accent hint="אחוז מסכום העסקה הכולל — לא משפיע על מחיר הלקוח." value={state.commissionPct ?? 10} step={0.5} onChange={(v) => updateNumber("commissionPct", v)} error={errors.commissionPct as string | undefined} />
          <NumField label="מרווח מיקוח" suffix="אג׳/שקית" hint="מתווסף למחיר כל שקית (בוט + ידני) כמקום לרדת בהתמקחות. 0 = כבוי." value={state.negotiationBufferAgorot ?? 0} step={1} onChange={(v) => updateNumber("negotiationBufferAgorot", v)} error={errors.negotiationBufferAgorot as string | undefined} />
          <NumField label="מרווח ביטחון שילוח — משוער" suffix="%" hint="המחשבון המשוער מנפח את נפח האריזה (CBM) באחוז הזה לפני חישוב השילוח, כדי לא לתמחר נמוך. נמדד 9.9.26: המודל הפיזי נמוך ב-5–9% מהמציאות, 15% מרכז אותו. 0 = בלי מרווח." value={state.estimatorShippingBufferPct ?? 15} step={1} onChange={(v) => updateNumber("estimatorShippingBufferPct", v)} error={errors.estimatorShippingBufferPct as string | undefined} />
          <NumField label="מרווח ביטחון שילוח — משוער, למינציה" suffix="%" hint="אותו דבר לשקיות למינציה. היה 30% (נקבע על 2 הצעות) והוציא 10 מ-15 הצעות ב-10–45% מעל האמת; 10% מרכז אותן ב-+4%." value={state.estimatorShippingBufferLamPct ?? 10} step={1} onChange={(v) => updateNumber("estimatorShippingBufferLamPct", v)} error={errors.estimatorShippingBufferLamPct as string | undefined} />
          <NumField label="עמלת למינציה (פלייט)" suffix="¥/צבע" hint="עלות המפעל לפלייט למינציה, פר צבע (חד-פעמי, רק על שקיות עם למינציה). ברירת מחדל ¥500." value={state.laminationPlateFeePerColorCny ?? 500} step={50} onChange={(v) => updateNumber("laminationPlateFeePerColorCny", v)} error={errors.laminationPlateFeePerColorCny as string | undefined} />
        </div>
        <div className="mt-4 rounded-lg border border-border/60 bg-background/30 p-3">
          <h3 className="text-xs font-medium mb-0.5">אחוזי רווחיות לפי כמות</h3>
          <p className="text-[13px] text-muted-foreground mb-3">
            השאלון בווצאפ לוקח את האחוז המתאים לפי הכמות שהלקוח בחר. כמות שלא ברשימה → "רווח ברירת מחדל".
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {QTY_TIERS.map((q) => (
              <NumField key={q} label={`${Number(q).toLocaleString()} יח'`} suffix="%" value={state.profitMarginByQuantity?.[q] ?? state.defaultProfitMargin} step={1} onChange={(v) => updateMarginTier(q, v)} error={errors[`margin:${q}`] as string | undefined} />
            ))}
          </div>
        </div>
      </FormSection>

    </div>
  );

  const shippingGroup = (state: FactoryPricingConfig) => (
    <div className="space-y-5">
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

    </div>
  );

  const dirtyGroups: Record<SettingsSection, boolean> = {
    price: pricingDirty,
    ship: shippingDirty,
    calc: false,
    team: false,
    calls: false,
    templates: false,
    ads: false,
    "google-ads": false,
  };

  return (
    <LuxShell className="ux">
      <LuxTitle
        overline="— Settings"
        subtitle="כל ההגדרות במקום אחד. שינוי נכנס לתוקף מיד אחרי שמירה ומשפיע על הצעות חדשות בלבד."
      >
        הגדרות <LuxAccent>המערכת.</LuxAccent>
      </LuxTitle>

      <div className="ux-set">
        <nav className="ux-side" aria-label="קבוצות הגדרות">
          {SETTINGS_GROUPS.map((g, i) => (
            <Fragment key={g.id}>
              {(i === 0 || SETTINGS_GROUPS[i - 1].area !== g.area) && <div className="g">{g.area}</div>}
              <button type="button" aria-current={section === g.id ? "true" : "false"} onClick={() => selectSection(g.id)}>
                <g.icon className="size-4" aria-hidden />
                {g.label}
                {dirtyGroups[g.id] && <span className="dirty" aria-label="יש שינויים שלא נשמרו" />}
              </button>
            </Fragment>
          ))}
        </nav>

        <div dir="rtl">
          {/* Every group stays mounted (hidden, not unmounted) so a half-edited
              group keeps its draft while you look at another one. */}
          <section hidden={section !== "price"} aria-label="תמחור">{configBody("price")}</section>
          <section hidden={section !== "calc"} aria-label="דיוק המחשבון">
            <EstimatorHealthSection apiToken={apiToken} />
          </section>
          <section hidden={section !== "ship"} aria-label="שילוח">{configBody("ship")}</section>
          <section hidden={section !== "team"} aria-label="שיוך והתראות" className="space-y-5">
            <AssigneeSection apiToken={apiToken} />
            <QuoteNotifySection apiToken={apiToken} />
          </section>
          <section hidden={section !== "calls"} aria-label="ניתוח שיחות">
            <CallAnalysisSettingsSection apiToken={apiToken} />
          </section>
          <section hidden={section !== "templates"} aria-label="תבניות הודעה">
            <TemplatesManager />
          </section>
          <section hidden={section !== "ads"} aria-label="כללי בדיקה — מטא">
            <AdRecommendationSettingsView apiToken={apiToken} />
          </section>
          <section hidden={section !== "google-ads"} aria-label="כללי בדיקה — גוגל">
            <GoogleSettingsView apiToken={apiToken} />
          </section>

          {(dirty || saving || msg) && (
            <div className="ux-savebar" role="region" aria-label="שמירת תמחור ושילוח">
              <div className="t">
                {saving ? (
                  "שומר…"
                ) : dirty ? (
                  <>
                    {changedLabels.length === 1 ? "שינוי אחד לא נשמר" : `${changedLabels.length} שינויים לא נשמרו`}
                    <span> · {changedLabels.map((c) => c.label).join(", ")}</span>
                  </>
                ) : msg ? (
                  <span style={{ color: msg.ok ? "var(--lux-success, #a8c0a0)" : "#f0c0c0" }}>{msg.text}</span>
                ) : null}
                {hasErrors && dirty && (
                  <span role="alert" style={{ display: "block", color: "#f0c0c0" }}>יש שדה לא תקין — הוא מסומן באדום. תקן אותו לפני שמירה.</span>
                )}
              </div>
              <p className="ux-sr" aria-live="polite">{saving ? "שומר" : msg?.text ?? ""}</p>
              {dirty && (
                <button type="button" className="ux-btn" onClick={() => { setState(initial); setMsg(null); }} disabled={saving}>
                  בטל שינויים
                </button>
              )}
              {dirty && (
                <button type="button" onClick={save} disabled={saving || hasErrors} aria-busy={saving} className="lux-cta-champagne" style={{ minHeight: 48, padding: "0 22px", fontSize: 15 }}>
                  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                  {saving ? "שומר…" : "שמור"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </LuxShell>
  );
}

function FormSection({
  icon: Icon,
  title,
  desc,
  action,
  children,
  defaultOpen = true,
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
            {desc && <p className="text-[13px] text-muted-foreground leading-tight">{desc}</p>}
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
          <span className="rounded-full bg-warning/15 text-warning text-xs font-medium px-1.5 py-0.5">
            {badge}
          </span>
        )}
      </div>
      {hint && <p className="text-[13px] text-muted-foreground leading-tight">{hint}</p>}
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
      {error && <span className="text-[13px] text-destructive">{error}</span>}
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

      <div className="text-[13px] text-muted-foreground mb-2">
        id: <code className="bg-muted/40 px-1 rounded">{opt.id}</code>
      </div>

      {opt.type === "sea" ? (
        <p className="text-[13px] text-muted-foreground">
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
  if (s.negotiationBufferAgorot !== undefined && !(s.negotiationBufferAgorot >= 0 && s.negotiationBufferAgorot <= 1000))
    errors.negotiationBufferAgorot = "חובה 0–1000";
  for (const k of ["estimatorShippingBufferPct", "estimatorShippingBufferLamPct"] as const) {
    const v = s[k];
    if (v !== undefined && !(v >= 0 && v <= 100)) errors[k] = "חובה 0–100";
  }
  if (s.laminationPlateFeePerColorCny !== undefined && !(s.laminationPlateFeePerColorCny >= 0))
    errors.laminationPlateFeePerColorCny = "חובה ≥ 0";
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
