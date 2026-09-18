"use client";

/**
 * Shared pieces of the "מודעות" tab: recommendation tone/labels and the editor
 * for Eli's approved status per Ad ID.
 *
 * The only write here is the approved status / segment / role — an internal
 * CRM decision that never reaches Meta. Engine + rules: lib/ads/*.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { AdRecommendationRow } from "@/lib/ads/assemble";
import type { RecommendationCode } from "@/lib/ads/recommendation-engine";
import {
  APPROVED_STATUSES,
  APPROVED_STATUS_LABELS,
  type ApprovedStatus,
} from "@/lib/ads/review-state";
import type { AdRole, AdSegment } from "@/lib/ads/structure-check";

export const SEGMENT_LABELS: Record<AdSegment, string> = { prospecting: "פרוספקטינג", remarketing: "רימרקטינג" };
export const ROLE_LABELS: Record<AdRole, string> = { control: "Control", challenger: "Challenger", remarketing: "משבצת רימרקטינג" };

export type Tone = "good" | "go" | "warn" | "stop" | "idle" | "unknown";
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
/** Tailwind variant, used by the settings preview. The tab itself uses `.ux-pill[data-tone]`. */
export const TONE_CLASS: Record<Tone, string> = {
  good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  go: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  stop: "border-red-400/30 bg-red-400/10 text-red-200",
  idle: "border-border/60 bg-background/30 text-muted-foreground",
  unknown: "border-violet-400/30 bg-violet-400/10 text-violet-200",
};

export function ReviewEditor({ row, apiToken, onDone }: { row: AdRecommendationRow; apiToken: string; onDone: () => void }) {
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
  const reasonId = `reason-${row.adId}`;

  async function save() {
    if (statusChanged && !reason.trim()) {
      setMsg("שינוי החלטה מחייב סיבה — כתוב במשפט אחד למה.");
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
      setMsg(`${e instanceof Error ? e.message : String(e)} — נסה שוב.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border/60 p-3" style={{ background: "var(--lux-inset)" }}>
      <p className="text-[13px] leading-6 text-muted-foreground">
        החלטה פנימית ב-CRM בלבד — לא נשלחת למטא. הסטטוס הקודם, החדש, הסיבה והזמן נשמרים בהיסטוריה.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <LabeledSelect label="החלטה" value={status} onChange={(v) => setStatus(v as ApprovedStatus)}
          options={APPROVED_STATUSES.map((s) => [s, APPROVED_STATUS_LABELS[s]])} />
        <LabeledSelect label="סגמנט" value={segment} onChange={(v) => setSegment(v as AdSegment | "")}
          options={[["", "לא סווג"], ...(Object.keys(SEGMENT_LABELS) as AdSegment[]).map((s) => [s, SEGMENT_LABELS[s]] as [string, string])]} />
        <LabeledSelect label="תפקיד בסבב" value={role} onChange={(v) => setRole(v as AdRole | "")}
          options={[["", "ללא"], ...(Object.keys(ROLE_LABELS) as AdRole[]).map((r) => [r, ROLE_LABELS[r]] as [string, string])]} />
      </div>
      <label htmlFor={reasonId} className="block text-[13px] text-muted-foreground">
        סיבה {statusChanged ? "(חובה כשמשנים החלטה)" : "(לא חובה)"}
      </label>
      <textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
        aria-invalid={Boolean(msg && statusChanged && !reason.trim())}
        className="w-full rounded-md border border-border px-3 py-2 text-sm" style={{ background: "var(--lux-inset-deep)", minHeight: 64 }} />
      {msg && <div role="alert" className="text-[13px] text-red-300">{msg}</div>}
      <button type="button" onClick={save} disabled={busy || !changed} aria-busy={busy} className="lux-cta-champagne disabled:opacity-50" style={{ minHeight: 44, padding: "0 18px", fontSize: 14 }}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        {busy ? "שומר…" : "שמור החלטה"}
      </button>
    </div>
  );
}

export function Banner({ tone, text }: { tone: "warn" | "stop"; text: string }) {
  const cls = tone === "stop" ? "border-red-400/20 bg-red-400/5 text-red-100" : "border-amber-400/20 bg-amber-400/5 text-amber-100";
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-[13px] leading-6 ${cls}`}>
      <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-border px-2 text-sm" style={{ background: "var(--lux-inset-deep)", minHeight: 44 }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
