/**
 * "מצב החיבורים" — every connection the ads tab depends on, one line each.
 * Server-rendered; the status is computed on each page load
 * (lib/ads/ads-health.ts). Failed checks also surface in "לטיפול עכשיו".
 */
import type { AdsHealth } from "@/lib/ads/ads-health";

export function AdsHealthLine({ health }: { health: AdsHealth | null }) {
  if (!health) {
    return <p className="ux-note" style={{ color: "#f0c0c0" }}>לא הצלחתי לבדוק את מצב החיבורים — נסה לרענן.</p>;
  }
  return (
    <section className="ux-panel" aria-labelledby="ads-health-h">
      <h2 id="ads-health-h" className="flex items-center gap-2">
        <span className="ux-dot" data-tone={health.ok ? undefined : "warn"} aria-hidden />
        {health.ok ? "הכל תקין — מטא, ה-CRM והמשימות היומיות מסונכרנים" : health.problems === 1 ? "בעיה אחת בחיבורים" : `${health.problems} בעיות בחיבורים`}
      </h2>
      <p className="d">כל חיבור שהלשונית הזו תלויה בו, ומתי נבדק.</p>
      <ul className="grid gap-2 text-[14px] leading-6">
        {health.checks.map((c) => (
          <li key={c.key} className="flex gap-2">
            <span className="ux-dot mt-2" data-tone={c.ok ? undefined : "bad"} aria-hidden />
            <span>
              <span className="text-foreground">{c.label}</span>
              <span className="text-muted-foreground"> — {c.ok ? "" : "לא תקין: "}{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
