"use client";

/**
 * "מודעות → המלצות" — one card per exact Meta Ad ID: evidence, testing gate,
 * the live recommendation with its numbers in Hebrew, and Eli's approved status.
 *
 * Recommendation only. The only write here is the approved status / segment /
 * role, an internal CRM decision that never reaches Meta.
 * Engine + rules: lib/ads/*. Design: docs/plans/2026-09-18-meta-ad-recommendations-*.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { AdRecommendationRow, RecommendationsReport } from "@/lib/ads/assemble";
import type { RecommendationCode } from "@/lib/ads/recommendation-engine";
import {
  APPROVED_STATUSES,
  APPROVED_STATUS_LABELS,
  type ApprovedStatus,
} from "@/lib/ads/review-state";
import type { AdRole, AdSegment } from "@/lib/ads/structure-check";

export const SEGMENT_LABELS: Record<AdSegment, string> = { prospecting: "פרוספקטינג", remarketing: "רימרקטינג" };
export const ROLE_LABELS: Record<AdRole, string> = { control: "Control", challenger: "Challenger", remarketing: "משבצת רימרקטינג" };

type Tone = "good" | "go" | "warn" | "stop" | "idle" | "unknown";
export const CODE_TONE: Record<RecommendationCode, Tone> = {
  winner_candidate: "good",
  first_gate_pass: "go",
  stability_test: "go",
  continue_to_deal_proof: "go",
  quality_review: "warn",
  deal_economics_review: "warn",
  pause_and_mature: "warn",
  early_stop: "stop",
  stop_after_stability: "stop",
  loser_candidate: "stop",
  collecting: "idle",
  untested: "idle",
  insufficient_or_conflicting_data: "unknown",
};
export const TONE_CLASS: Record<Tone, string> = {
  good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  go: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  stop: "border-red-400/30 bg-red-400/10 text-red-200",
  idle: "border-border/60 bg-background/30 text-muted-foreground",
  unknown: "border-violet-400/30 bg-violet-400/10 text-violet-200",
};

const ils = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₪${Math.round(n).toLocaleString("he-IL")}`;
const ils2 = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₪${(Math.round(n * 100) / 100).toLocaleString("he-IL")}`;
const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—");
const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
const ltr = { unicodeBidi: "isolate" as const, direction: "ltr" as const };

export function AdRecommendationsView({ apiToken }: { apiToken: string }) {
  const [report, setReport] = useState<RecommendationsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showIdle, setShowIdle] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/widget/ads/recommendations?widget_token=${encodeURIComponent(apiToken)}${fresh ? "&fresh=1" : ""}`);
        const body = await r.json();
        if (!r.ok || !body.ok) throw new Error(body.error ?? "טעינת ההמלצות נכשלה");
        setReport(body);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [apiToken],
  );

  useEffect(() => {
    load();
  }, [load]);

  // An ad that never spent, brought no lead and carries no decision is noise
  // until asked for — one line at the bottom instead of dozens of rows.
  const isIdle = (r: AdRecommendationRow) =>
    r.recommendation.metrics.spendIls === 0 && r.crmLeads === 0 && r.approvedStatus === "untested";
  const rows = useMemo(() => (report ? report.rows.filter((r) => showIdle || !isIdle(r)) : []), [report, showIdle]);
  const idleCount = report ? report.rows.filter(isIdle).length : 0;

  const groups: { key: string; title: string; rows: AdRecommendationRow[] }[] = [
    { key: "prospecting", title: "פרוספקטינג", rows: rows.filter((r) => r.segment === "prospecting") },
    { key: "remarketing", title: "רימרקטינג", rows: rows.filter((r) => r.segment === "remarketing") },
    { key: "none", title: "לא סווג", rows: rows.filter((r) => r.segment === null) },
  ];

  const h = report?.health;
  const u = report?.structure.usage;

  return (
    <section dir="rtl" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 text-emerald-300/90">
          <ShieldCheck className="size-3.5" /> המלצות בלבד — לא משנה דבר במטא
        </span>
        {u && (
          <span>
            פעילות {u.active}/{u.max} · Controls {u.control.used}/{u.control.max} · Challenger {u.challenger.used}/{u.challenger.max} · רימרקטינג {u.remarketing.used}/{u.remarketing.max}
          </span>
        )}
        <button type="button" onClick={() => load(true)} disabled={loading}
          className="lux-tap ms-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-foreground/80 disabled:opacity-50" aria-label="רענן ממטא">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} רענן
        </button>
      </div>

      {error && <Banner tone="stop" text={error} />}
      {h && !h.meta.ok && <Banner tone="stop" text={`אין נתוני מטא — אין המלצה אמינה: ${h.meta.reason ?? ""}`} />}
      {report?.structure.warnings.map((w) => <Banner key={w} tone="warn" text={w} />)}

      {!report && !error && (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען…
        </div>
      )}

      {report &&
        groups.map((g) =>
          g.rows.length === 0 ? null : (
            <div key={g.key}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{g.title} · {g.rows.length}</h3>
              <div className="divide-y divide-border/50 rounded-lg border border-border/60">
                {g.rows.map((r) => <AdRow key={r.adId} row={r} apiToken={apiToken} onSaved={() => load(false)} />)}
              </div>
            </div>
          ),
        )}

      {idleCount > 0 && (
        <button type="button" onClick={() => setShowIdle((v) => !v)} className="lux-tap text-[11px] text-muted-foreground underline-offset-2 hover:underline">
          {showIdle ? "הסתר מודעות בלי הוצאה" : `הצג עוד ${idleCount} מודעות בלי הוצאה`}
        </button>
      )}
    </section>
  );
}

/** One collapsed line per Ad ID; the details open on tap. */
function AdRow({ row, apiToken, onSaved }: { row: AdRecommendationRow; apiToken: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const rec = row.recommendation;
  const m = rec.metrics;
  // Without Meta's spend history, spend is UNKNOWN, not ₪0 — every figure
  // derived from it (CPL, CAC, profit after ads) would be a confident lie.
  const noSpend = !row.evidence.dailyHistoryComplete;
  const s = <T,>(v: T) => (noSpend ? null : v);
  const summary = [
    noSpend ? null : ils(m.spendIls),
    count(noSpend ? row.crmLeads : m.metaLeads, "ליד אחד", "לידים"),
    row.deals ? count(row.deals, "עסקה אחת", "עסקאות") : null,
  ].filter(Boolean).join(" · ");

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]" style={ltr}>{row.adName || row.adId}</div>
          <div className="text-[11px] text-muted-foreground">{summary}</div>
        </div>
        {row.conflict && <span className="size-2 shrink-0 rounded-full bg-amber-400" title={row.conflict} />}
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${TONE_CLASS[CODE_TONE[rec.code]]}`}>{rec.label}</span>
      </summary>

      <div className="space-y-3 px-3 pb-3 text-xs">
        <ul className="space-y-0.5 leading-5 text-foreground/90">
          {rec.reasons.map((x, i) => <li key={i}>{x.text}</li>)}
        </ul>

        <div className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
          <Metric k="CPL" v={ils2(s(m.cplIls))} />
          <Metric k="CAC" v={ils(s(m.cacIls))} />
          <Metric k="רווח אחרי פרסום" v={ils(s(m.contributionAfterAdsIls))} />
          <Metric k="לידים מתאימים" v={row.suitableLeads === null ? "—" : String(row.suitableLeads)} />
          <Metric k="ימי מסירה" v={noSpend ? "—" : String(m.deliveryDays)} />
          <Metric k="הוצאה אחרונה" v={noSpend ? "—" : dmy(m.lastSpendDate)} />
        </div>

        <div className="text-[11px] leading-5 text-muted-foreground">
          <span style={ltr}>Ad ID {row.adId}</span>
          {row.adSetName && <> · <span style={ltr}>{row.adSetName}</span></>}
          {row.effectiveStatus && <> · מטא: {row.effectiveStatus}</>}
          {row.dealCustomers.length > 0 && <div className="text-emerald-300/90">💰 {row.dealCustomers.join(" · ")}</div>}
          {row.warnings.map((w) => <div key={w} className="text-amber-200/80">⚠ {w}</div>)}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
          <span className="text-muted-foreground">החלטה:</span>
          <strong>{APPROVED_STATUS_LABELS[row.approvedStatus]}</strong>
          {row.segment && <span className="text-muted-foreground">· {SEGMENT_LABELS[row.segment]}</span>}
          {row.role && <span className="text-muted-foreground">· {ROLE_LABELS[row.role]}</span>}
          {row.conflict && <span className="text-[11px] text-amber-300">— {row.conflict}</span>}
          <button type="button" onClick={() => setEditing((e) => !e)} className="lux-tap ms-auto rounded-md border border-border px-3 py-1">
            {editing ? "סגור" : "עדכן"}
          </button>
        </div>
        {editing && <ReviewEditor row={row} apiToken={apiToken} onDone={() => { setEditing(false); onSaved(); }} />}
      </div>
    </details>
  );
}

function ReviewEditor({ row, apiToken, onDone }: { row: AdRecommendationRow; apiToken: string; onDone: () => void }) {
  const [status, setStatus] = useState<ApprovedStatus>(row.approvedStatus);
  const [segment, setSegment] = useState<AdSegment | "">(row.segment ?? "");
  const [role, setRole] = useState<AdRole | "">(row.role ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const patch: Record<string, unknown> = {};
  if (status !== row.approvedStatus) patch.approvedStatus = status;
  if ((segment || null) !== row.segment) patch.segment = segment || null;
  if ((role || null) !== row.role) patch.role = role || null;
  if (row.adSetId) patch.adSetId = row.adSetId;
  const statusChanged = "approvedStatus" in patch;
  const changed = statusChanged || "segment" in patch || "role" in patch;

  async function save() {
    if (statusChanged && !reason.trim()) {
      setMsg("שינוי סטטוס מאושר מחייב סיבה");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/widget/ads/review-state/${row.adId}?widget_token=${encodeURIComponent(apiToken)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      const body = await r.json();
      if (!r.ok || !body.ok) throw new Error(body.error ?? "השמירה נכשלה");
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-background/30 p-3 text-xs">
      <p className="text-[11px] leading-5 text-muted-foreground">
        החלטה פנימית ב-CRM בלבד — לא נשלחת למטא. הסטטוס הקודם, החדש, הסיבה והזמן נשמרים בהיסטוריה. חישוב מחדש של ההמלצות לעולם לא משנה אותו.
      </p>
      <div className="lux-stack-sm grid grid-cols-3 gap-2">
        <LabeledSelect label="סטטוס מאושר" value={status} onChange={(v) => setStatus(v as ApprovedStatus)}
          options={APPROVED_STATUSES.map((s) => [s, APPROVED_STATUS_LABELS[s]])} />
        <LabeledSelect label="סגמנט" value={segment} onChange={(v) => setSegment(v as AdSegment | "")}
          options={[["", "לא סווג"], ...(Object.keys(SEGMENT_LABELS) as AdSegment[]).map((s) => [s, SEGMENT_LABELS[s]] as [string, string])]} />
        <LabeledSelect label="תפקיד בסבב" value={role} onChange={(v) => setRole(v as AdRole | "")}
          options={[["", "ללא"], ...(Object.keys(ROLE_LABELS) as AdRole[]).map((r) => [r, ROLE_LABELS[r]] as [string, string])]} />
      </div>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
        placeholder={statusChanged ? "סיבה (חובה לשינוי סטטוס) — למשל: 2 עסקאות CRM, CAC ₪400" : "סיבה (לא חובה)"}
        className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-xs" />
      {msg && <div className="text-red-300">{msg}</div>}
      <button type="button" onClick={save} disabled={busy || !changed} className="lux-cta-champagne disabled:opacity-50" style={{ minHeight: 34, padding: "0 14px", fontSize: 12 }}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
        {busy ? "שומר…" : "שמור החלטה"}
      </button>
    </div>
  );
}

export function Banner({ tone, text }: { tone: "warn" | "stop"; text: string }) {
  const cls = tone === "stop" ? "border-red-400/20 bg-red-400/5 text-red-100" : "border-amber-400/20 bg-amber-400/5 text-amber-100";
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-5 ${cls}`}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{k}</div>
      <div className="font-medium tabular-nums">{v}</div>
    </div>
  );
}

function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

