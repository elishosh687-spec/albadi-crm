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
import { ExternalLink, PackageCheck, Check } from "lucide-react";
import type { SeaCarrierProfile } from "@/lib/factory/types";
import type { ConsolidationCandidate } from "@/lib/factory/consolidation";
import { consolidateShipment, seaShipmentCost } from "@/lib/factory/sea-carriers";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";

const STAGE_LABEL: Record<string, string> = {
  WON: "נסגר ✓",
  CONSIDERATION: "שוקל / משא ומתן",
  DISCAVERY: "אפיון",
  FACTORY_WAIT: "מחכה למפעל",
  INTAKE: "קליטה",
};

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
      <LuxShell>
        <LuxTitle overline="— Consolidation planner">
          צירוף <LuxAccent>משלוחים.</LuxAccent>
        </LuxTitle>
        <div
          style={{
            background: "rgba(232,180,180,0.06)",
            borderRadius: 10,
            padding: "14px 18px",
            color: "#e8b4b4",
            fontSize: 14,
            boxShadow: "inset 0 0 0 1px rgba(232,180,180,0.2)",
          }}
        >
          ⚠️ אין ספק שילוח ים פעיל. הגדר ספק פעיל בטאב ההגדרות לפני שימוש בכלי הצירוף.
        </div>
      </LuxShell>
    );
  }

  return (
    <LuxShell>
      <LuxTitle
        overline="— Consolidation planner"
        subtitle={`סמן הזמנות ים מאותו זמן כדי לראות כמה תחסוך אם תשלח אותן יחד במקום כל אחת בנפרד. כלי תכנון בלבד — לא משנה מחירים ללקוחות. ספק: ${carrier.name}.`}
      >
        צירוף משלוחים — <LuxAccent>תכנון.</LuxAccent>
      </LuxTitle>

      {candidates.length === 0 ? (
        <div
          style={{
            background: "var(--lux-card)",
            borderRadius: 10,
            padding: "32px 18px",
            textAlign: "center",
            color: "#8a7f74",
            fontSize: 14,
            boxShadow: "inset 0 0 0 1px var(--lux-line)",
          }}
        >
          אין הזמנות ים סופיות לצירוף כרגע.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            gap: 18,
            alignItems: "start",
          }}
        >
          {/* candidate list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div className="lux-label" style={{ marginBottom: 2 }}>
              הזמנות ים סופיות · בחר לצירוף
            </div>
            {candidates.map((c) => {
              const isSel = selected.has(c.id);
              const solo = soloUsdById.get(c.id) ?? 0;
              return (
                <label
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    background: isSel ? "#1d1b1a" : "#161514",
                    borderRadius: 8,
                    padding: "14px 18px",
                    cursor: "pointer",
                    boxShadow: isSel
                      ? "inset 0 0 0 1px rgba(190,198,224,0.3)"
                      : "inset 0 0 0 1px rgba(69,70,77,0.16)",
                    transition: "box-shadow .12s ease, background .12s ease",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(c.id)}
                    style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                    aria-hidden
                  />
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      background: isSel ? "rgba(190,198,224,0.2)" : "#211f1e",
                      boxShadow: isSel
                        ? "inset 0 0 0 1px rgba(190,198,224,0.5)"
                        : "inset 0 0 0 1px rgba(69,70,77,0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {isSel ? <Check size={13} strokeWidth={2.5} color="#bec6e0" /> : null}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{ fontSize: 15, color: "#e6e1e0", fontWeight: 500 }}
                        className="truncate"
                      >
                        {c.customerName ?? "לקוח ללא שם"}
                      </span>
                      {c.stage && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "#8a7f74",
                            background: "#211f1e",
                            padding: "2px 8px",
                            borderRadius: 4,
                            flexShrink: 0,
                          }}
                        >
                          {STAGE_LABEL[c.stage] ?? c.stage}
                        </span>
                      )}
                      {ghlContactBase && c.ghlContactId && (
                        <a
                          href={`${ghlContactBase}${c.ghlContactId}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="כרטיס לקוח ב-GHL"
                          style={{ color: "#8a7f74", flexShrink: 0, display: "inline-flex" }}
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                    <div
                      style={{ fontSize: 11, color: "#8a7f74", marginTop: 2 }}
                      className="truncate"
                    >
                      {c.productName ?? "—"}
                      {c.quantity ? ` · ${c.quantity.toLocaleString()} יח'` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "left", flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        color: "#e6e1e0",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {c.cbm} קוב
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#8a7f74",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      לבד ₪{ils(solo)}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* live comparison rail */}
          <SummaryRail
            count={selected.size}
            combinedCbm={result?.combinedCbm}
            soloIls={result ? ils(result.soloTotalUsd) : null}
            combinedIls={result ? ils(result.combinedUsd) : null}
            savingIls={result ? ils(result.savingUsd) : null}
            recommendation={result?.recommendation.text ?? null}
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
}: {
  count: number;
  combinedCbm: number | undefined;
  soloIls: string | null;
  combinedIls: string | null;
  savingIls: string | null;
  recommendation: string | null;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 12,
        background: "#1d1b1a",
        borderRadius: 8,
        padding: "22px 22px",
        boxShadow: `inset 0 0 0 1px ${
          count > 0 ? "rgba(190,198,224,0.22)" : "rgba(69,70,77,0.16)"
        }`,
      }}
    >
      <div
        className="lux-label"
        style={{ color: count > 0 ? "#bec6e0" : "#8a7f74", marginBottom: 18 }}
      >
        {count === 0 ? "בחר כדי להתחיל" : `${count} נבחרו · השוואה חיה`}
      </div>

      {count === 0 ? (
        <div style={{ fontSize: 12.5, color: "#8a7f74", lineHeight: 1.55 }}>
          סמן הזמנות מהרשימה כדי לראות חיסכון במשלוח מאוחד.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "#8a7f74", marginBottom: 3 }}>נפח מאוחד</div>
            <div
              style={{
                fontFamily: "var(--font-body), Heebo, system-ui",
                fontWeight: 300,
                fontSize: 22,
                color: "#e6e1e0",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {combinedCbm} קוב
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: "#8a7f74", marginBottom: 3 }}>בנפרד</div>
              <div
                style={{
                  fontSize: 18,
                  color: "#c6c6cd",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                ₪{soloIls}
              </div>
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 12, color: "#8a7f74", marginBottom: 3 }}>מאוחד</div>
              <div
                style={{
                  fontSize: 18,
                  color: "#c6c6cd",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                ₪{combinedIls}
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "14px 16px",
              borderRadius: 8,
              background: "rgba(127,211,168,0.08)",
              boxShadow: "inset 0 0 0 1px rgba(127,211,168,0.25)",
            }}
          >
            <div style={{ fontSize: 12, color: "#8a7f74", marginBottom: 3 }}>חיסכון</div>
            <div
              style={{
                fontFamily: "var(--font-body), Heebo, system-ui",
                fontWeight: 300,
                fontSize: 30,
                color: "#7fd3a8",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.05,
              }}
            >
              ₪{savingIls}
            </div>
          </div>

          {recommendation && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                padding: "13px 14px",
                borderRadius: 8,
                background: "#161514",
                boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.16)",
              }}
            >
              <PackageCheck size={17} color="#bec6e0" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "#c6c6cd" }}>
                {recommendation}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
