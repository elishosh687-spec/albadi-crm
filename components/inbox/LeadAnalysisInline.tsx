"use client";

import { useEffect, useState } from "react";
import type { LeadAnalysis } from "@/lib/analysis/analyze-lead";

const BLOCKER_HE: Record<string, string> = {
  price: "מחיר",
  moq: "כמות מינימום",
  sample_trust: "דוגמה/אמון",
  payment_terms: "תנאי תשלום",
  product_mismatch: "מוצר לא מתאים",
  followup_drop: "נפילת מעקב",
  spec_open: "מפרט פתוח",
  wrong_lead: "ליד לא רלוונטי",
  other: "אחר",
};

const CONF_HE: Record<string, string> = { low: "נמוך", medium: "בינוני", high: "גבוה" };

/**
 * Inline deep-analysis panel shown under a conversation row when its 🔍 tile is
 * tapped. Calls POST /api/widget/analyze-lead (LLM judge + grounding guardrail),
 * shows the structured verdict + a ready Hebrew reply script. Result is cached
 * server-side by input hash, so re-opening is instant unless the lead changed.
 */
export default function LeadAnalysisInline({
  apiToken,
  sid,
  name,
}: {
  apiToken: string;
  sid: string;
  name: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<LeadAnalysis | null>(null);
  const [cached, setCached] = useState(false);

  async function run(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/widget/analyze-lead?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid, force }),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "analysis failed");
      setVerdict(json.verdict as LeadAnalysis);
      setCached(!!json.cached);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  if (loading) {
    return (
      <div dir="rtl" style={{ color: "#a1a1aa", fontSize: 13, padding: "8px 2px" }}>
        ⏳ מנתח את {name || "הליד"}… (כמה שניות)
      </div>
    );
  }
  if (error) {
    return (
      <div dir="rtl" style={{ color: "#fecaca", fontSize: 13 }}>
        שגיאה: {error}{" "}
        <button onClick={() => run(true)} style={linkBtn}>
          נסה שוב
        </button>
      </div>
    );
  }
  if (!verdict) return null;

  const v = verdict;
  return (
    <div dir="rtl" style={{ fontSize: 13, color: "#e4e4e7", lineHeight: 1.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Chip text={`חסם: ${BLOCKER_HE[v.primary_blocker] ?? v.primary_blocker}`} tone="accent" />
        <Chip text={`מחויבות ${v.commitment_scorecard.score_1_5}/5`} tone="neutral" />
        <Chip text={`ביטחון ${CONF_HE[v.confidence] ?? v.confidence}`} tone="neutral" />
        {cached && <span style={{ fontSize: 11, color: "#71717a" }}>שמור</span>}
        <button onClick={() => run(true)} style={{ ...linkBtn, marginInlineStart: "auto" }}>
          🔄 רענן
        </button>
      </div>

      {v.insufficient_data ? (
        <div style={{ color: "#fbbf24" }}>⚠️ {v.root_cause}</div>
      ) : (
        <>
          <Section title="שורש התקיעה">{v.root_cause}</Section>

          {v.objections.length > 0 && (
            <Section title="התנגדויות">
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {v.objections.map((o, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span style={{ color: o.is_surface_or_root === "root" ? "#fca5a5" : "#e4e4e7" }}>
                      {o.text}
                    </span>
                    {o.quote && (
                      <div style={{ color: "#a1a1aa", fontStyle: "italic" }}>«{o.quote}»</div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {v.price_forensics && (
            <Section title="פירוק מחיר">
              שלנו {v.price_forensics.our_unit ?? "?"} מול {v.price_forensics.their_alt_unit ?? "?"}
              {v.price_forensics.gulpha_issue && " · בעיית גלופה"}
              {v.price_forensics.branded_vs_unbranded && " · ממותג↔לא-ממותג"}
            </Section>
          )}

          {v.followup_verdict && (
            <Section title="מעקב">
              {v.followup_verdict.promised ? "הבטחנו" : "לא הבטחנו"} ·{" "}
              {v.followup_verdict.delivered ? "מסרנו" : "לא מסרנו"}
              {v.followup_verdict.gap_days != null && ` · פער ${v.followup_verdict.gap_days} ימים`}
            </Section>
          )}

          {v.sample && (
            <Section title="דוגמה">
              {v.sample.asked ? "ביקש" : "לא ביקש"} ·{" "}
              {v.sample.fulfilled ? "נשלחה" : "לא נשלחה"}
            </Section>
          )}

          {v.recommended_next_action && (
            <div
              style={{
                marginTop: 8,
                padding: "6px 10px",
                background: "#1a2638",
                border: "1px solid #2f4a6e",
                borderRadius: 8,
                color: "#dbeafe",
              }}
            >
              ▶ {v.recommended_next_action}
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: "#71717a", marginBottom: 2 }}>💬 תסריט תשובה</div>
            <div
              style={{
                padding: "8px 10px",
                background: "#0d0f14",
                border: "1px solid #2a2d34",
                borderRadius: 8,
                whiteSpace: "pre-wrap",
              }}
            >
              {v.recommended_reply_script}
            </div>
            <button
              onClick={() => navigator.clipboard?.writeText(v.recommended_reply_script)}
              style={{ ...linkBtn, marginTop: 4 }}
            >
              העתק
            </button>
          </div>

          {v.grounding.dropped_unverified > 0 && (
            <div style={{ fontSize: 11, color: "#71717a", marginTop: 6 }}>
              ⓘ נופו {v.grounding.dropped_unverified} ציטוטים לא-מבוססים (בדיקת אמת).
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6 }}>
      <span style={{ fontSize: 11, color: "#71717a" }}>{title}: </span>
      <span>{children}</span>
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone: "accent" | "neutral" }) {
  const c =
    tone === "accent"
      ? { bg: "#1a2638", br: "#2f4a6e", fg: "#dbeafe" }
      : { bg: "#17191f", br: "#2a2d34", fg: "#a1a1aa" };
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        background: c.bg,
        border: `1px solid ${c.br}`,
        borderRadius: 999,
        color: c.fg,
      }}
    >
      {text}
    </span>
  );
}

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#60a5fa",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  padding: 0,
};
