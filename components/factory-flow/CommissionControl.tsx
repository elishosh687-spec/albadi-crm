"use client";

/**
 * Inline salesperson-commission editor. Boss-only, display-only — the commission
 * NEVER changes the customer price; it only reshapes the profit / net-profit
 * numbers the boss sees (see lib/factory/commission.ts).
 *
 * Two behaviours, both wired here (per Eli 2026-07-16 — "גם וגם"):
 *   1. Edit the % → recompute THIS calculation only (an ephemeral per-quote
 *      override the parent threads into computeCommission / DetailedBreakdown).
 *   2. "שמור כברירת מחדל" → persist to the global `factory_pricing` config so
 *      every price surface (calculator, factory quotes, PDF) uses it from now on.
 *
 * The parent owns the override TEXT (keeps decimals intact while typing) and
 * derives the effective pct; this component is the input + save affordance. Used
 * by the estimator tab (CalculatorView) and the factory-quote screens
 * (FinalizeModal, CombinedCalcModal). Neutral Tailwind styling resolves in both
 * the lux calculator and the plain factory-flow widgets.
 */

import { useState } from "react";
import { RotateCcw, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FactoryPricingConfig } from "@/lib/factory/types";
import { widgetUrl } from "./widget-url";

export function CommissionControl({
  text,
  onTextChange,
  valid,
  effectivePct,
  defaultPct,
  apiToken,
  className,
}: {
  /** Raw input text the parent owns (empty = fall back to the global default). */
  text: string;
  onTextChange: (v: string) => void;
  /** Whether `text` parses to a sane 0..100 percentage. */
  valid: boolean;
  /** The pct actually used for this calculation (parsed override or default). */
  effectivePct: number;
  /** The global stored default (config.commissionPct) — shown as placeholder/reset. */
  defaultPct: number;
  /** Widget token; when present the save-default PUT goes to the widget endpoint. */
  apiToken?: string;
  className?: string;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const overriding = valid && Math.abs(effectivePct - defaultPct) > 1e-9;

  async function saveDefault() {
    setSaveState("saving");
    try {
      const url = apiToken
        ? widgetUrl("/api/widget/factory/config", apiToken)
        : "/api/factory/config";
      // Read-modify-write: the PUT overwrites the whole row, so pull the current
      // config and change only commissionPct (don't clobber FX / margins / carriers).
      const g = await fetch(url, { cache: "no-store" });
      const gj = await g.json();
      if (!gj?.ok || !gj?.config) throw new Error("load failed");
      const next: FactoryPricingConfig = { ...gj.config, commissionPct: effectivePct };
      const p = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const pj = await p.json();
      if (!pj?.ok) throw new Error("save failed");
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  return (
    <div className={cn("rounded-xl border border-border bg-card/40 p-3 flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">עמלת מכירות</label>
        <span className="text-[11px] text-muted-foreground">תצוגה לבוס בלבד — לא משנה את מחיר הלקוח</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-md border border-border bg-background/50 px-3 py-1.5 tabular-nums">
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={String(defaultPct)}
            className="w-16 bg-transparent border-0 text-right tabular-nums focus:outline-none text-base"
            aria-label="אחוז עמלת מכירות"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>

        {overriding && (
          <button
            type="button"
            onClick={() => onTextChange("")}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" /> חזרה ל-{defaultPct}%
          </button>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={saveDefault}
          disabled={!valid || saveState === "saving"}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveState === "saving" && <Loader2 className="size-3.5 animate-spin" />}
          {saveState === "saved" && <Check className="size-3.5 text-success" />}
          {saveState === "saved" ? "נשמר ✓" : saveState === "error" ? "שגיאה — נסה שוב" : "שמור כברירת מחדל"}
        </button>
      </div>

      <span className="text-[11px] text-muted-foreground">
        {overriding
          ? `חישוב זה: ${effectivePct}% (דורס את ${defaultPct}% הגלובלי). "שמור כברירת מחדל" יחיל על כל המסכים.`
          : `ברירת המחדל הגלובלית: ${defaultPct}%. שנה כדי לדרוס לחישוב הזה בלבד.`}
      </span>
    </div>
  );
}
