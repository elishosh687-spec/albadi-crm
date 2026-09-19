"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, RefreshCw } from "lucide-react";
import type { LeadAnalysis } from "@/lib/analysis/analyze-lead";
import { getStagePlay, type BlockerKey, type StagePlay } from "@/lib/sales/stage-plays.he";

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
  const [plays, setPlays] = useState<Record<BlockerKey, StagePlay> | null>(null);

  useEffect(() => {
    fetch(`/api/widget/plays?widget_token=${encodeURIComponent(apiToken)}`)
      .then((r) => r.json())
      .then((j) => j.ok && setPlays(j.plays))
      .catch(() => {});
  }, [apiToken]);

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
      <div className="grid gap-3" aria-live="polite">
        <p style={{ margin: 0, fontSize: 14, color: "var(--lux-muted)" }}>מנתח את {name || "הליד"}… (כמה שניות)</p>
        <div className="ux-skel" style={{ height: 120 }} />
      </div>
    );
  }
  if (error) {
    return (
      <p className="ux-note" style={{ color: "#f0c0c0", alignItems: "center" }}>
        הניתוח נכשל: {error}
        <button type="button" className="ux-btn sm" onClick={() => run(true)}>
          <RefreshCw className="size-4" aria-hidden /> נסה שוב
        </button>
      </p>
    );
  }
  if (!verdict) return null;

  const v = verdict;
  return (
    <div className="la" dir="rtl">
      <div className="la-top">
        <span className="ux-pill" data-tone="go">חסם: {BLOCKER_HE[v.primary_blocker] ?? v.primary_blocker}</span>
        <span className="ux-pill" data-tone="idle">מחויבות {v.commitment_scorecard.score_1_5}/5</span>
        <span className="ux-pill" data-tone="idle">ביטחון {CONF_HE[v.confidence] ?? v.confidence}</span>
        {cached && <span style={{ fontSize: 13, color: "var(--lux-muted)" }}>מהשמירה</span>}
        <button type="button" className="ux-btn sm" style={{ marginInlineStart: "auto" }} onClick={() => run(true)}>
          <RefreshCw className="size-4" aria-hidden /> נתח מחדש
        </button>
      </div>

      {v.insufficient_data ? (
        <p className="ux-note" style={{ color: "#ecdcb3" }}>
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> {v.root_cause}
        </p>
      ) : (
        <>
          {(() => {
            const play = plays?.[v.primary_blocker as BlockerKey] ?? getStagePlay(v.primary_blocker);
            return (
              <section className="la-play" aria-label="מה לעשות">
                <div className="k">מה לעשות · {play.stage}</div>
                <h3>{play.title}</h3>
                <ul>
                  {play.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                <div className="k">שלב הבא: {play.nextStep}</div>
              </section>
            );
          })()}

          <dl className="la-dl">
            <dt>שורש התקיעה</dt>
            <dd>{v.root_cause}</dd>
            {v.objections.length > 0 && (
              <>
                <dt>התנגדויות</dt>
                <dd>
                  <ul>
                    {v.objections.map((o, i) => (
                      <li key={i}>
                        <span style={{ color: o.is_surface_or_root === "root" ? "#f0c0c0" : undefined }}>
                          {o.text}
                          {o.is_surface_or_root === "root" ? " (שורש)" : ""}
                        </span>
                        {o.quote && <div className="q">«{o.quote}»</div>}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {v.price_forensics && (
              <>
                <dt>פירוק מחיר</dt>
                <dd>
                  שלנו {v.price_forensics.our_unit ?? "?"} מול {v.price_forensics.their_alt_unit ?? "?"}
                  {v.price_forensics.gulpha_issue && " · בעיית גלופה"}
                  {v.price_forensics.branded_vs_unbranded && " · ממותג↔לא-ממותג"}
                </dd>
              </>
            )}
            {v.followup_verdict && (
              <>
                <dt>מעקב</dt>
                <dd>
                  {v.followup_verdict.promised ? "הבטחנו" : "לא הבטחנו"} · {v.followup_verdict.delivered ? "מסרנו" : "לא מסרנו"}
                  {v.followup_verdict.gap_days != null && ` · פער ${v.followup_verdict.gap_days} ימים`}
                </dd>
              </>
            )}
            {v.sample && (
              <>
                <dt>דוגמה</dt>
                <dd>
                  {v.sample.asked ? "ביקש" : "לא ביקש"} · {v.sample.fulfilled ? "נשלחה" : "לא נשלחה"}
                </dd>
              </>
            )}
          </dl>

          {v.recommended_next_action && (
            <p className="la-next">
              <b>הצעד הבא:</b> {v.recommended_next_action}
            </p>
          )}

          <section aria-label="תסריט תשובה">
            <div className="flex items-center justify-between gap-2" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 14, color: "var(--lux-muted)" }}>תסריט תשובה</span>
              <button type="button" className="ux-btn sm" onClick={() => navigator.clipboard?.writeText(v.recommended_reply_script)}>
                <Copy className="size-4" aria-hidden /> העתק
              </button>
            </div>
            <div className="la-script">{v.recommended_reply_script}</div>
          </section>

          {v.grounding.dropped_unverified > 0 && (
            <p style={{ fontSize: 13, color: "var(--lux-muted)", margin: 0 }}>
              נופו {v.grounding.dropped_unverified} ציטוטים שלא נמצאו בשיחה (בדיקת אמת).
            </p>
          )}
        </>
      )}
    </div>
  );
}
