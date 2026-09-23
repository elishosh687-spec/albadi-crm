"use client";

/**
 * "דיוק המחשבון" — shows whether the self-quote calculator's daily refit loop
 * is alive and what it learns (Eli 2026-09-22: "I want to see in settings that
 * the calculator-accuracy feature works"). Read-only; logic lives in
 * lib/factory/estimator-health.ts.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Gauge, Loader2 } from "lucide-react";
import type { EstimatorHealth, HealthStatus } from "@/lib/factory/estimator-health";

interface Resp {
  ok: boolean;
  error?: string;
  health?: EstimatorHealth;
  facts?: { factories: string[]; areaMin: number; areaMax: number; cartonAreaMax: number | null };
}

const TONE: Record<HealthStatus, { color: string; Icon: typeof CheckCircle2; word: string }> = {
  ok: { color: "var(--lux-success, #a8c0a0)", Icon: CheckCircle2, word: "תקין" },
  warn: { color: "#e0a96d", Icon: AlertTriangle, word: "דורש תשומת לב" },
  fail: { color: "#e8b4b4", Icon: XCircle, word: "לא עובד" },
};

export function EstimatorHealthSection({ apiToken }: { apiToken: string }) {
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    fetch(`/api/widget/settings/estimator-health?widget_token=${encodeURIComponent(apiToken)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setData({ ok: false, error: String(e) }));
  }, [apiToken]);

  const overall = data?.health ? TONE[data.health.status] : null;

  return (
    <div className="rounded-xl border border-border/70 bg-background/20 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Gauge className="size-4" aria-hidden />
          <h3 className="text-sm font-semibold m-0">דיוק המחשבון המשוער</h3>
        </div>
        {overall && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" style={{ color: overall.color, boxShadow: `inset 0 0 0 1px ${overall.color}` }}>
            <overall.Icon className="size-3.5" aria-hidden />
            {overall.word}
          </span>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground mt-1 mb-3">
        כל לילה ב‑04:00 המחשבון נבנה מחדש מהקטלוג ומהצעות המפעל (אלבד 80 גרם בלבד), ומתפרסם רק אם הוא עדיין מדויק. כאן רואים שזה באמת קורה.
      </p>

      {!data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />בודק…</div>
      ) : !data.ok || !data.health ? (
        <div role="alert" className="text-sm" style={{ color: TONE.fail.color }}>הבדיקה נכשלה: {data.error ?? "שגיאה"}</div>
      ) : (
        <>
          <ul className="flex flex-col gap-2 m-0 p-0 list-none">
            {data.health.checks.map((c) => {
              const t = TONE[c.status];
              return (
                <li key={c.id} className="flex gap-2.5 rounded-lg bg-background/30 p-3">
                  <t.Icon className="size-4 shrink-0 mt-0.5" style={{ color: t.color }} aria-label={t.word} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="text-[13px] text-muted-foreground leading-relaxed">{c.detail}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          {data.facts && (
            <p className="text-[13px] text-muted-foreground mt-3 mb-0 tabular-nums">
              מתמחר שקיות בשטח {data.facts.areaMin.toLocaleString("he-IL")}–{data.facts.areaMax.toLocaleString("he-IL")} ס״מ²
              {data.facts.cartonAreaMax ? ` (שילוח עד ${data.facts.cartonAreaMax.toLocaleString("he-IL")})` : ""} · מפעלים עם מודל: {data.facts.factories.join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
