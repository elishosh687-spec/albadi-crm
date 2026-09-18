/**
 * One line at the top of every מודעות sub-tab: "הכל תקין" or "N בעיות",
 * expanding to every connection the tab depends on. Server-rendered — the
 * status is computed on each page load (lib/ads/ads-health.ts).
 */
import type { AdsHealth } from "@/lib/ads/ads-health";

export function AdsHealthLine({ health }: { health: AdsHealth | null }) {
  if (!health) {
    return (
      <div className="mb-3 text-[11px] text-red-300">⚠ לא הצלחתי לבדוק את מצב החיבורים — נסה לרענן.</div>
    );
  }
  return (
    <details className="mb-3 rounded-lg border border-border/60" open={!health.ok}>
      <summary className={`flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs ${health.ok ? "text-emerald-300" : "text-amber-300"}`}>
        <span className={`size-2 rounded-full ${health.ok ? "bg-emerald-400" : "bg-amber-400"}`} />
        {health.ok ? "הכל תקין — מטא, ה-CRM והמשימות היומיות מסונכרנים" : health.problems === 1 ? "בעיה אחת בחיבורים" : `${health.problems} בעיות בחיבורים`}
        <span className="ms-auto text-[10px] text-muted-foreground">פרטים</span>
      </summary>
      <ul className="space-y-1 border-t border-border/50 px-3 py-2 text-[11px] leading-5">
        {health.checks.map((c) => (
          <li key={c.key} className="flex gap-2">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${c.ok ? "bg-emerald-400" : "bg-red-400"}`} />
            <span>
              <span className="text-foreground">{c.label}</span>
              <span className="text-muted-foreground"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
