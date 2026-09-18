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
import { RECOMMENDATION_LABELS, type RecommendationCode } from "@/lib/ads/recommendation-engine";
import {
  APPROVED_STATUSES,
  APPROVED_STATUS_LABELS,
  type ApprovedStatus,
} from "@/lib/ads/review-state";
import type { AdRole, AdSegment } from "@/lib/ads/structure-check";

export const SEGMENT_LABELS: Record<AdSegment, string> = { prospecting: "פרוספקטינג", remarketing: "רימרקטינג" };
export const ROLE_LABELS: Record<AdRole, string> = { control: "Control", challenger: "Challenger", remarketing: "משבצת רימרקטינג" };
const GATE_LABELS = { none: "לפני השער הראשון", first: "סינון ראשוני", stability: "בדיקת יציבות", deal_proof: "הוכחת עסקה" } as const;

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
const ltr = { unicodeBidi: "isolate" as const, direction: "ltr" as const };

type Filters = {
  code: RecommendationCode | "";
  approved: ApprovedStatus | "";
  role: AdRole | "none" | "";
  conflictsOnly: boolean;
  showIdle: boolean;
};

export function AdRecommendationsView({ apiToken }: { apiToken: string }) {
  const [report, setReport] = useState<RecommendationsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({ code: "", approved: "", role: "", conflictsOnly: false, showIdle: false });

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

  const visible = useMemo(() => {
    if (!report) return [];
    return report.rows.filter((r) => {
      const idle = r.recommendation.metrics.spendIls === 0 && r.crmLeads === 0 && r.approvedStatus === "untested";
      if (!filters.showIdle && idle) return false;
      if (filters.code && r.recommendation.code !== filters.code) return false;
      if (filters.approved && r.approvedStatus !== filters.approved) return false;
      if (filters.role === "none" && r.role !== null) return false;
      if (filters.role && filters.role !== "none" && r.role !== filters.role) return false;
      if (filters.conflictsOnly && !r.conflict) return false;
      return true;
    });
  }, [report, filters]);

  const groups: { key: string; title: string; hint: string; rows: AdRecommendationRow[] }[] = [
    { key: "prospecting", title: "פרוספקטינג", hint: "קהל קר — Controls ו-Challenger נמדדים כאן", rows: visible.filter((r) => r.segment === "prospecting") },
    { key: "remarketing", title: "רימרקטינג", hint: "נבחן בנפרד — קהל חם תמיד ייראה זול יותר", rows: visible.filter((r) => r.segment === "remarketing") },
    { key: "none", title: "לא סווג", hint: "עדיין לא שויכו לפרוספקטינג או רימרקטינג — לא נספרים באף דירוג", rows: visible.filter((r) => r.segment === null) },
  ];

  const h = report?.health;
  const u = report?.structure.usage;

  return (
    <section dir="rtl" className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-5 text-emerald-100">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>
          המלצות בלבד. שום דבר כאן לא מפעיל, עוצר או משנה תקציב במטא. &quot;מנצחת&quot; ו&quot;מפסידה&quot; נשארות מועמדות עד
          שתשמור סטטוס מאושר.
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {report && (
          <span>
            מדיניות גרסה <strong className="text-foreground">{report.policyRevision}</strong>
            {report.policyRevision === 0 ? " (ברירת המחדל שאושרה 18/09)" : ""} · נכון ל-{dmy(report.today)}
          </span>
        )}
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="lux-tap ms-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          רענן ממטא
        </button>
      </div>

      {error && <Banner tone="stop" text={error} />}

      {h && !h.meta.ok && (
        <Banner
          tone="stop"
          text={`אין נתוני מטא, ולכן אין המלצה אמינה לאף מודעה: ${h.meta.reason ?? ""}. נתוני ה-CRM מוצגים כרגיל.`}
        />
      )}
      {h && h.meta.ok && (h.nameCollisions.length > 0 || h.unknownToMeta.length > 0 || h.unattributedLeads > 0) && (
        <div className="space-y-1 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-[11px] leading-5 text-amber-100">
          {h.nameCollisions.map((c) => (
            <div key={c.name}>
              לשם <span style={ltr}>{c.name}</span> יש {c.adIds.length} מודעות שונות במטא — כל עותק מוצג ונמדד בנפרד. לפני הפעלה בחר את ה-Ad ID המדויק.
            </div>
          ))}
          {h.unknownToMeta.length > 0 && <div>{h.unknownToMeta.length} מזהי מודעה ב-CRM לא קיימים במטא — מסומנים &quot;לא ניתן להכריע&quot;.</div>}
          {h.unattributedLeads > 0 && <div>{h.unattributedLeads} לידים עם שם מודעה אבל בלי Ad ID — לא משויכים לאף מודעה (לא מאחדים לפי שם).</div>}
        </div>
      )}

      {u && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Slot label="פעילות עכשיו במטא" used={u.active} max={u.max} />
          <Slot label="Controls" used={u.control.used} max={u.control.max} />
          <Slot label="Challenger" used={u.challenger.used} max={u.challenger.max} />
          <Slot label="רימרקטינג" used={u.remarketing.used} max={u.remarketing.max} />
        </div>
      )}
      {report?.structure.warnings.map((w) => <Banner key={w} tone="warn" text={w} />)}

      {report && (
        <div className="lux-wrap-sm flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-card/20 p-3 text-xs">
          <FilterSelect label="המלצה" value={filters.code} onChange={(v) => setFilters((f) => ({ ...f, code: v as Filters["code"] }))}
            options={(Object.keys(RECOMMENDATION_LABELS) as RecommendationCode[]).map((c) => [c, `${RECOMMENDATION_LABELS[c]}${report.counts[c] ? ` (${report.counts[c]})` : ""}`])} />
          <FilterSelect label="סטטוס מאושר" value={filters.approved} onChange={(v) => setFilters((f) => ({ ...f, approved: v as Filters["approved"] }))}
            options={APPROVED_STATUSES.map((s) => [s, APPROVED_STATUS_LABELS[s]])} />
          <FilterSelect label="תפקיד" value={filters.role} onChange={(v) => setFilters((f) => ({ ...f, role: v as Filters["role"] }))}
            options={[...(Object.keys(ROLE_LABELS) as AdRole[]).map((r) => [r, ROLE_LABELS[r]] as [string, string]), ["none", "ללא תפקיד"]]} />
          <Check label="רק סתירות" checked={filters.conflictsOnly} onChange={(v) => setFilters((f) => ({ ...f, conflictsOnly: v }))} />
          <Check label="הצג גם מודעות בלי הוצאה" checked={filters.showIdle} onChange={(v) => setFilters((f) => ({ ...f, showIdle: v }))} />
          <span className="ms-auto text-muted-foreground">{visible.length} מתוך {report.rows.length}</span>
        </div>
      )}

      {!report && !error && (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען נתונים ממטא ומה-CRM…
        </div>
      )}

      {report &&
        groups.map((g) =>
          g.rows.length === 0 ? null : (
            <div key={g.key} className="space-y-2">
              <div>
                <h3 className="text-sm font-medium">{g.title} <span className="text-muted-foreground">· {g.rows.length}</span></h3>
                <div className="text-[11px] text-muted-foreground">{g.hint}</div>
              </div>
              {g.rows.map((r) => (
                <AdCard key={r.adId} row={r} apiToken={apiToken} onSaved={() => load(false)} />
              ))}
            </div>
          ),
        )}
      {report && visible.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">אין מודעות שמתאימות לסינון.</p>}
    </section>
  );
}

function AdCard({ row, apiToken, onSaved }: { row: AdRecommendationRow; apiToken: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const rec = row.recommendation;
  const m = rec.metrics;
  const tone = CODE_TONE[rec.code];
  // Without Meta's spend history, spend is UNKNOWN, not ₪0 — every figure
  // derived from it (CPL, CAC, profit after ads) would be a confident lie.
  const noSpend = !row.evidence.dailyHistoryComplete;
  const s = <T,>(v: T) => (noSpend ? null : v);

  return (
    <div className={`rounded-lg border p-3 ${row.conflict ? "border-amber-400/40" : "border-border/60"} bg-card/20`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium" style={ltr}>{row.adName || "(ללא שם)"}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            <span style={ltr}>Ad ID {row.adId}</span>
            {row.adSetName && (
              <>
                {" · "}
                <span style={ltr}>Ad Set {row.adSetName}{row.adSetId ? ` (${row.adSetId})` : ""}</span>
              </>
            )}
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] ${TONE_CLASS[tone]}`}>{rec.label}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <Chip text={row.effectiveStatus ? `מטא: ${row.effectiveStatus}` : "מטא: לא ידוע"} />
        <Chip text={row.segment ? SEGMENT_LABELS[row.segment] : "סגמנט לא סווג"} />
        <Chip text={row.role ? ROLE_LABELS[row.role] : "ללא תפקיד"} />
        {rec.code !== "insufficient_or_conflicting_data" && <Chip text={`שער: ${GATE_LABELS[rec.gate]}`} />}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4 lg:grid-cols-6">
        <Metric k="הוצאה" v={ils2(s(m.spendIls))} />
        <Metric k="ימי מסירה" v={noSpend ? "—" : String(m.deliveryDays)} />
        <Metric k="הוצאה ראשונה / אחרונה" v={`${dmy(m.firstSpendDate)} – ${dmy(m.lastSpendDate)}`} />
        <Metric k="לידי מטא" v={noSpend ? "—" : String(m.metaLeads)} />
        <Metric k="לידים ב-CRM" v={String(row.crmLeads)} />
        <Metric k="לידים מתאימים" v={row.suitableLeads === null ? "—" : String(row.suitableLeads)} />
        <Metric k="עסקאות CRM" v={String(row.deals)} />
        <Metric k="CPL" v={ils2(s(m.cplIls))} />
        <Metric k="CAC" v={ils(s(m.cacIls))} />
        <Metric k="רווח אחרי פרסום" v={ils(s(m.contributionAfterAdsIls))} />
        {m.leadsAtFirstGate !== null && <Metric k="לידים בשער הראשון" v={`${m.leadsAtFirstGate} ב-${ils(m.spendAtFirstGateIls)}`} />}
        {m.leadsAtStability !== null && <Metric k="לידים בשער היציבות" v={`${m.leadsAtStability} ב-${ils(m.spendAtStabilityIls)}`} />}
      </div>

      <ul className="mt-3 space-y-0.5 text-xs leading-5 text-foreground/90">
        {rec.reasons.map((x, i) => <li key={i}>{x.text}</li>)}
      </ul>
      {row.dealCustomers.length > 0 && <div className="mt-1 text-[11px] text-emerald-300">💰 {row.dealCustomers.join(" · ")}</div>}
      {row.warnings.map((w) => <div key={w} className="mt-1 text-[11px] text-amber-200/90">⚠ {w}</div>)}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2 text-xs">
        <span className="text-muted-foreground">סטטוס מאושר:</span>
        <strong>{APPROVED_STATUS_LABELS[row.approvedStatus]}</strong>
        {row.approvedAt && <span className="text-[11px] text-muted-foreground">({dmy(row.approvedAt.slice(0, 10))}{row.approvedReason ? ` — ${row.approvedReason}` : ""})</span>}
        {row.conflict && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">סתירה: {row.conflict}</span>}
        <button type="button" onClick={() => setEditing((e) => !e)} className="lux-tap ms-auto rounded-md border border-border px-3 py-1 text-xs">
          {editing ? "סגור" : "עדכן החלטה"}
        </button>
      </div>
      {editing && <ReviewEditor row={row} apiToken={apiToken} onDone={() => { setEditing(false); onSaved(); }} />}
    </div>
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

function Slot({ label, used, max }: { label: string; used: number; max: number }) {
  const over = used > max;
  return (
    <span className={`rounded-md border px-2.5 py-1 ${over ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-border/60 text-muted-foreground"}`}>
      {label} <strong className="text-foreground">{used}/{max}</strong>
    </span>
  );
}

function Chip({ text }: { text: string }) {
  return <span className="rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground">{text}</span>;
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{k}</div>
      <div className="font-medium tabular-nums">{v}</div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return <LabeledSelect label={label} value={value} onChange={onChange} options={[["", "הכל"], ...options]} />;
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

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="lux-tap inline-flex cursor-pointer items-center gap-1.5 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
