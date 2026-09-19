"use client";

/**
 * Shipment consolidation planner (planning-only — does not change any customer
 * price). Lists real finalized SEA orders pulled from the system, lets the boss
 * tick which to merge into one shipment, and shows — live — the cost of
 * shipping them separately (each at its TRUE solo cost) vs merged, the saving,
 * and which band edge to aim for. Uses the active sea carrier profile.
 *
 * Silent-Luxury skin: editorial title, lead checklist on the left, sticky
 * live-comparison rail on the right (combined CBM + separate vs combined ₪
 * + green savings + recommendation hint).
 *
 * Client-safe: imports only the pure engine (sea-carriers.ts) + types.
 */

import { useMemo, useState } from "react";
import { ExternalLink, PackageCheck, Search, AlertTriangle } from "lucide-react";
import { stageLabel } from "@/lib/analytics/labels";
import type { SeaCarrierProfile } from "@/lib/factory/types";
import type { ConsolidationCandidate } from "@/lib/factory/consolidation";
import { consolidateShipment, seaShipmentCost } from "@/lib/factory/sea-carriers";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";

const PAGE = 40;

const isClosed = (c: ConsolidationCandidate) => !!c.closedDealAt || c.stage === "WON";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });

export function ConsolidationView({
  candidates,
  carrier,
  usdToIls,
  ghlContactBase,
}: {
  candidates: ConsolidationCandidate[];
  carrier: SeaCarrierProfile | null;
  usdToIls: number;
  /** GHL contact-card URL prefix; row links to <base><ghlContactId> */
  ghlContactBase?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  // Closed deals are what actually ships — start there when there are any.
  const [scope, setScope] = useState<"closed" | "all">(() => (candidates.some(isClosed) ? "closed" : "all"));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const ils = (usd: number) => Math.round(usd * usdToIls).toLocaleString();

  const result = useMemo(() => {
    if (!carrier || selected.size === 0) return null;
    const items = candidates
      .filter((c) => selected.has(c.id))
      .map((c) => ({ id: c.id, cbm: c.cbm }));
    return consolidateShipment(carrier, items);
  }, [carrier, candidates, selected]);

  // Per-row solo cost (true cost of shipping that order alone) for display.
  const soloUsdById = useMemo(() => {
    const m = new Map<string, number>();
    if (carrier) {
      for (const c of candidates) {
        m.set(c.id, seaShipmentCost(carrier, c.cbm).totalUsd);
      }
    }
    return m;
  }, [carrier, candidates]);

  if (!carrier) {
    return (
      <LuxShell className="ux ux-floor">
        <LuxTitle overline="— Consolidation planner">
          צירוף <LuxAccent>משלוחים.</LuxAccent>
        </LuxTitle>
        <p className="ux-note" style={{ color: "#f0c0c0" }}>
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          אין ספק שילוח ים פעיל. הגדר ספק פעיל בהגדרות (משלוח) לפני שימוש בכלי הצירוף.
        </p>
      </LuxShell>
    );
  }

  const q = query.trim().toLowerCase();
  const pool = scope === "closed" ? candidates.filter(isClosed) : candidates;
  const visible = q
    ? pool.filter((c) =>
        [c.customerName, c.productName, c.quotationNo, c.phone].some((v) => (v ?? "").toLowerCase().includes(q)),
      )
    : pool;
  const closedCount = candidates.filter(isClosed).length;

  return (
    <LuxShell className="ux ux-floor">
      <LuxTitle
        overline="— Consolidation planner"
        subtitle={`סמן הזמנות ים שיוצאות בערך באותו זמן, ותראה כמה חוסכים אם שולחים אותן יחד. כלי תכנון בלבד — לא משנה מחירים ללקוחות. ספק: ${carrier.name}.`}
      >
        צירוף <LuxAccent>משלוחים.</LuxAccent>
      </LuxTitle>

      {candidates.length === 0 ? (
        <div className="ux-panel" style={{ textAlign: "center", color: "var(--lux-muted)" }}>
          אין הזמנות ים סופיות לצירוף כרגע.
        </div>
      ) : (
        <div className="sh-grid">
          <section aria-labelledby="sh-list">
            <h2 id="sh-list" className="ux-sr">הזמנות ים לצירוף</h2>
            <label className="ux-search" style={{ marginBottom: 12 }}>
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="ux-sr">חיפוש הזמנה</span>
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(PAGE);
                }}
                placeholder="חיפוש לפי לקוח, מוצר או מספר הצעה"
              />
            </label>
            <div className="ux-chips" role="group" aria-label="אילו הזמנות להציג" style={{ marginBottom: 14 }}>
              <button type="button" className="ux-chip" aria-pressed={scope === "closed"} onClick={() => { setScope("closed"); setShown(PAGE); }}>
                עסקאות שנסגרו <span className="tnum">{closedCount}</span>
              </button>
              <button type="button" className="ux-chip" aria-pressed={scope === "all"} onClick={() => { setScope("all"); setShown(PAGE); }}>
                כל ההצעות הסופיות <span className="tnum">{candidates.length}</span>
              </button>
            </div>

            {visible.length === 0 ? (
              <div className="ux-panel" style={{ textAlign: "center", color: "var(--lux-muted)" }}>
                {q ? `לא נמצאה הזמנה עם ״${query}״.` : "אין עסקאות ים שנסגרו — עבור ל״כל ההצעות הסופיות״."}
              </div>
            ) : (
              <ul className="ux-list">
                {visible.slice(0, shown).map((c) => {
                  const isSel = selected.has(c.id);
                  const solo = soloUsdById.get(c.id) ?? 0;
                  const when = c.closedDealAt ?? c.createdAt;
                  return (
                    <li key={c.id} className="sh-row" data-on={isSel || undefined}>
                      <label className="sh-pick">
                        <input type="checkbox" checked={isSel} onChange={() => toggle(c.id)} />
                        <span className="main">
                          <span className="top">
                            <span className="nm">{c.customerName ?? "לקוח ללא שם"}</span>
                            {c.stage && (
                              <span className="ux-pill" data-tone={isClosed(c) ? "good" : "idle"}>{stageLabel(c.stage)}</span>
                            )}
                          </span>
                          <span className="sub">
                            {c.productName || "מוצר לא ידוע"}
                            {c.quantity ? ` · ${c.quantity.toLocaleString("he-IL")} יח׳` : ""}
                          </span>
                          <span className="sub tnum">
                            {c.closedDealAt ? "נסגרה" : "הצעה"} {fmtDate(when)}
                            {c.quotationNo ? ` · ${c.quotationNo}` : ""}
                          </span>
                        </span>
                        <span className="num tnum">
                          <span className="v">{c.cbm} קוב</span>
                          <span className="sub">לבד ₪{ils(solo)}</span>
                        </span>
                      </label>
                      {ghlContactBase && c.ghlContactId && (
                        <a
                          className="sh-ghl"
                          href={`${ghlContactBase}${c.ghlContactId}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`כרטיס הלקוח ${c.customerName ?? ""} ב-GHL`}
                          title="כרטיס לקוח ב-GHL"
                        >
                          <ExternalLink className="size-4" aria-hidden />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {visible.length > shown && (
              <button type="button" className="ux-btn" style={{ marginTop: 12, width: "100%" }} onClick={() => setShown((n) => n + PAGE)}>
                הצג עוד {Math.min(PAGE, visible.length - shown)} מתוך {visible.length - shown}
              </button>
            )}
          </section>

          {/* live comparison rail */}
          <SummaryRail
            count={selected.size}
            combinedCbm={result?.combinedCbm}
            soloIls={result ? ils(result.soloTotalUsd) : null}
            combinedIls={result ? ils(result.combinedUsd) : null}
            savingIls={result ? ils(result.savingUsd) : null}
            recommendation={result?.recommendation.text ?? null}
            onClear={() => setSelected(new Set())}
          />
        </div>
      )}
    </LuxShell>
  );
}

function SummaryRail({
  count,
  combinedCbm,
  soloIls,
  combinedIls,
  savingIls,
  recommendation,
  onClear,
}: {
  count: number;
  combinedCbm: number | undefined;
  soloIls: string | null;
  combinedIls: string | null;
  savingIls: string | null;
  recommendation: string | null;
  onClear: () => void;
}) {
  return (
    <aside className="ux-panel sh-rail" data-on={count > 0 || undefined} aria-live="polite" aria-label="השוואה">
      <div className="flex items-center justify-between gap-2">
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
          {count === 0 ? "השוואה" : count === 1 ? "נבחרה הזמנה אחת" : `נבחרו ${count} הזמנות`}
        </h2>
        {count > 0 && (
          <button type="button" className="ux-btn sm" onClick={onClear}>
            נקה
          </button>
        )}
      </div>

      {count === 0 ? (
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--lux-muted)", lineHeight: 1.6 }}>
          סמן שתי הזמנות או יותר כדי לראות כמה עולה לשלוח אותן יחד מול כל אחת לבד.
        </p>
      ) : (
        <div className="grid gap-4" style={{ marginTop: 16 }}>
          <div>
            <div className="k">נפח ביחד</div>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 300 }}>{combinedCbm} קוב</div>
          </div>
          <div className="flex justify-between gap-4 sh-more">
            <div>
              <div className="k">כל אחת לבד</div>
              <div className="tnum" style={{ fontSize: 18 }}>₪{soloIls}</div>
            </div>
            <div style={{ textAlign: "end" }}>
              <div className="k">ביחד</div>
              <div className="tnum" style={{ fontSize: 18 }}>₪{combinedIls}</div>
            </div>
          </div>
          <div className="sh-save">
            <div className="k">חיסכון</div>
            <div className="tnum" style={{ fontSize: 30, fontWeight: 300, lineHeight: 1.05 }}>₪{savingIls}</div>
          </div>
          {recommendation && (
            <p className="flex items-start gap-2 sh-more" style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--lux-ink)" }}>
              <PackageCheck className="size-4 shrink-0" style={{ marginTop: 3, color: "var(--lux-cool)" }} aria-hidden />
              {recommendation}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
