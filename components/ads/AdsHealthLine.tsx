/**
 * "מצב החיבורים" — every connection the ads tab depends on. One line with the
 * overall status; the full list opens on tap, and opens by itself when
 * something is broken (ui-ux-pro-max: progressive disclosure). Server-rendered
 * from lib/ads/ads-health.ts; failed checks also surface in "לטיפול עכשיו".
 */
import { ChevronDown } from "lucide-react";
import type { AdsHealth } from "@/lib/ads/ads-health";

export function AdsHealthLine({ health }: { health: AdsHealth | null }) {
  if (!health) {
    return <p className="ux-note" style={{ color: "#f0c0c0" }}>לא הצלחתי לבדוק את מצב החיבורים — נסה לרענן.</p>;
  }
  const failed = health.checks.filter((c) => !c.ok);
  const ok = health.checks.filter((c) => c.ok);
  return (
    <details className="ux-panel ux-fold" style={{ marginTop: 0, borderTop: "1px solid var(--lux-line)" }} open={!health.ok}>
      <summary style={{ color: "var(--lux-ink)", fontSize: 16 }}>
        <span className="flex items-center gap-2">
          <span className="ux-dot" data-tone={health.ok ? undefined : "warn"} aria-hidden />
          מצב החיבורים ·{" "}
          {health.ok ? "הכל תקין" : health.problems === 1 ? "בעיה אחת" : `${health.problems} בעיות`}
        </span>
        <ChevronDown className="size-4 chev" aria-hidden />
      </summary>
      <ul className="ux-rlist">
        {[...failed, ...ok].map((c) => (
          <li key={c.key} className="ux-rrow" style={{ gridTemplateColumns: "minmax(0,1fr) 104px" }}>
            <div className="who">
              <span className="name">{c.label}</span>
              <span className="note">{c.detail}</span>
            </div>
            <span className="ux-pill" data-tone={c.ok ? "good" : "stop"} style={{ justifySelf: "end" }}>{c.ok ? "תקין" : "לא תקין"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
