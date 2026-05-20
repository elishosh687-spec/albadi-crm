"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, MessageSquare, X, ExternalLink, Trash2, Loader2 } from "lucide-react";
import { STAGE_LABEL, STAGE_TONE } from "@/app/dashboard/v3/_components/stage-meta";
import type { SheetGapRow } from "@/lib/sheets/lead-gaps";
import { setLeadStage, deleteLeadAction } from "@/app/actions/v2";
import { V2_PIPELINE_STAGES, type V2PipelineStage } from "@/lib/manychat/stages";

const ALL_STAGES = ["ALL", "NEW", "AWAITING_ESTIMATE", "AWAITING_LOGO", "WAITING_FACTORY", "AWAITING_FINAL", "CALLBACK_LATER", "WON", "DROPPED", "GAPS"] as const;
const STAGE_FILTER_LABEL: Record<string, string> = {
  ALL: "הכל",
  NEW: "חדשים",
  AWAITING_ESTIMATE: "ממתינים להצעה",
  AWAITING_LOGO: "ממתינים ללוגו",
  WAITING_FACTORY: "אצל המפעל",
  AWAITING_FINAL: "אישור סופי",
  CALLBACK_LATER: "לחזור בעתיד הרחוק",
  WON: "נסגרו",
  DROPPED: "ננטשו",
  GAPS: "פערי טופס",
};

const GAP_CATEGORY_LABEL: Record<SheetGapRow["category"], string> = {
  pending: "ממתין",
  bad_phone: "טלפון פגום",
  send_failed: "שליחה נכשלה",
  other_error: "שגיאה",
};
const GAP_CATEGORY_COLOR: Record<SheetGapRow["category"], string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  bad_phone: "bg-red-500/20 text-red-400 border-red-500/30",
  send_failed: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  other_error: "bg-red-500/20 text-red-400 border-red-500/30",
};

function lastNoteBody(notes: string | null, maxLen = 90): string | null {
  if (!notes) return null;
  const entries = notes.split(/\n\n(?=\[)/g).filter(Boolean);
  const last = entries.at(-1);
  if (!last) return null;
  const body = last.replace(/^(\[[^\]]+\]\s*)/, "").trim();
  return body ? (body.length > maxLen ? body.slice(0, maxLen) + "…" : body) : null;
}

function sheetRowDeepLink(spreadsheetId: string | null, rowIndex: number): string | null {
  if (!spreadsheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0&range=A${rowIndex}`;
}

function GapsTable({ rows, spreadsheetId }: { rows: SheetGapRow[]; spreadsheetId: string | null }) {
  if (rows.length === 0) {
    return (
      <div className="py-20 text-center text-muted-foreground">אין פערים — כל הלידים מהטופס הגיעו בהצלחה</div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">שם</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">טלפון</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">סטטוס</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">פרטים</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Sheet</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const link = sheetRowDeepLink(spreadsheetId, row.rowIndex);
            return (
              <tr key={row.rowIndex} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">{row.name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs" dir="ltr">{row.rawPhone ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${GAP_CATEGORY_COLOR[row.category]}`}>
                    {GAP_CATEGORY_LABEL[row.category]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">{row.lastStatus ?? "—"}</td>
                <td className="px-4 py-3">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      פתח <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface LeadRow {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  quoteTotal: string | null;
  botSummary: string | null;
  notes: string | null;
  pipelineFlag: string | null;
  botPaused: boolean | null;
  followUpCount: number | null;
  updatedAt: Date | null;
}

function LeadCard({
  lead,
  onPreview,
  activeStage,
}: {
  lead: LeadRow;
  onPreview: (l: LeadRow) => void;
  activeStage: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const pill = STAGE_TONE[lead.stage ?? ""]?.pill ?? "bg-muted text-muted-foreground";
  const stageLabel = STAGE_LABEL[lead.stage ?? ""] ?? lead.stage ?? "—";
  const updatedAt = lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString("he-IL") : "—";

  const handleStageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as V2PipelineStage;
    if (next === lead.stage) return;
    startTransition(async () => {
      const r = await setLeadStage({ manychatSubId: lead.sid, stage: next, flags: [] });
      if (r.ok) router.refresh();
      else alert(`שגיאה: ${r.error}`);
    });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`למחוק את ${lead.name ?? lead.sid}? פעולה לא הפיכה.`)) return;
    setDeleting(true);
    startTransition(async () => {
      const r = await deleteLeadAction(lead.sid);
      if (r.ok) router.refresh();
      else {
        alert(`שגיאה: ${r.error}`);
        setDeleting(false);
      }
    });
  };
  // Carry the active stage filter into the lead card URL so the card's
  // prev/next arrows can paginate over the same filtered list the user sees.
  const fullCardHref =
    activeStage && activeStage !== "ALL"
      ? `/dashboard/v3/leads?stage=${encodeURIComponent(activeStage)}&lead=${encodeURIComponent(lead.sid)}`
      : `/dashboard/v3/leads?lead=${encodeURIComponent(lead.sid)}`;

  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-md transition-all duration-150">
      {/* Whole-card click opens the FULL lead card (ExpandedLead with 4 tabs incl. החלטות בוט). */}
      <a
        href={fullCardHref}
        aria-label={`פתח כרטיס מלא של ${lead.name ?? "ליד"}`}
        className="absolute inset-0 z-0"
      />

      {/* Top row */}
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pill}`}>
          {stageLabel}
        </span>
        <div className="flex items-center gap-1 text-xs">
          {lead.botPaused && <span className="text-yellow-400" title="בוט מושהה">⏸</span>}
          {lead.pipelineFlag === "NEEDS_ELI" && <span className="text-red-400" title="דרוש טיפול">🔴</span>}
          <span className="text-muted-foreground">{updatedAt}</span>
        </div>
      </div>

      {/* Name */}
      <div className="relative z-10 font-semibold text-base leading-tight pointer-events-none">{lead.name ?? "ללא שם"}</div>

      {/* Phone */}
      {lead.phone && (
        <div className="relative z-10 text-sm text-muted-foreground pointer-events-none" dir="ltr">{lead.phone}</div>
      )}

      {/* Quote */}
      {lead.quoteTotal && (
        <div className="relative z-10 text-sm font-medium text-emerald-400 pointer-events-none">
          ₪{Number(lead.quoteTotal).toLocaleString("he-IL")}
        </div>
      )}

      {/* Summary */}
      {lead.botSummary && (
        <p className="relative z-10 text-xs text-muted-foreground line-clamp-2 leading-relaxed pointer-events-none">
          {lead.botSummary}
        </p>
      )}

      {/* Last note */}
      {(() => {
        const note = lastNoteBody(lead.notes);
        if (!note) return null;
        return (
          <p className="relative z-10 text-xs text-muted-foreground/70 line-clamp-1 leading-relaxed pointer-events-none italic border-r-2 border-primary/30 pr-2">
            {note}
          </p>
        );
      })()}

      {/* Inline stage dropdown */}
      <div className="relative z-10 flex items-center gap-2">
        <select
          value={lead.stage ?? "NEW"}
          onChange={handleStageChange}
          disabled={isPending}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-xs rounded-md border border-border bg-muted/40 px-2 py-1 disabled:opacity-50"
        >
          {V2_PIPELINE_STAGES.map((s) => (
            <option key={s} value={s}>{STAGE_LABEL[s] ?? s}</option>
          ))}
        </select>
        {isPending && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Actions — always visible (mobile has no hover, desktop also benefits from clarity). */}
      <div className="relative z-10 flex gap-2 pt-1">
        <a
          href={fullCardHref}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted transition-colors"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          פתח כרטיס
        </a>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPreview(lead);
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition-colors"
        >
          תצוגה מקדימה
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          title="מחק ליד"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-60"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function PreviewDrawer({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const pill = STAGE_TONE[lead.stage ?? ""]?.pill ?? "bg-muted text-muted-foreground";
  const stageLabel = STAGE_LABEL[lead.stage ?? ""] ?? lead.stage ?? "—";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed inset-y-0 left-0 z-50 flex w-full max-w-sm flex-col bg-card border-r border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-semibold">פרטי ליד</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">שם</div>
            <div className="font-semibold text-lg">{lead.name ?? "ללא שם"}</div>
          </div>
          {lead.phone && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">טלפון</div>
              <div dir="ltr">{lead.phone}</div>
            </div>
          )}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">שלב</div>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${pill}`}>
              {stageLabel}
            </span>
          </div>
          {lead.quoteTotal && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">הצעת מחיר</div>
              <div className="text-emerald-400 font-medium">₪{Number(lead.quoteTotal).toLocaleString("he-IL")}</div>
            </div>
          )}
          {lead.followUpCount != null && lead.followUpCount > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">פולואפים שנשלחו</div>
              <div>{lead.followUpCount}</div>
            </div>
          )}
          {lead.botPaused && (
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-yellow-400 text-xs">⏸ בוט מושהה</div>
          )}
          {lead.pipelineFlag === "NEEDS_ELI" && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-red-400 text-xs">🔴 דרוש טיפול ידני</div>
          )}
          {lead.botSummary && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">סיכום בוט</div>
              <div className="text-muted-foreground leading-relaxed">{lead.botSummary}</div>
            </div>
          )}
          {lead.notes && (() => {
            const entries = lead.notes.split(/\n\n(?=\[)/g).filter(Boolean);
            return (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">הערות ({entries.length})</div>
                {entries.slice(-3).map((entry, i) => {
                  const stamp = entry.match(/^(\[[^\]]+\])/)?.[1] ?? "";
                  const body = entry.replace(/^(\[[^\]]+\]\s*)/, "").trim();
                  return (
                    <div key={i} className="border-r-2 border-border pr-2 space-y-0.5">
                      {stamp && <div className="text-[10px] text-muted-foreground/60">{stamp}</div>}
                      <div className="text-muted-foreground leading-relaxed text-xs">{body}</div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {lead.updatedAt && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">עדכון אחרון</div>
              <div>{new Date(lead.updatedAt).toLocaleString("he-IL")}</div>
            </div>
          )}
        </div>
        <div className="border-t border-border p-4 space-y-2">
          <a
            href={`/dashboard/v3/leads?lead=${encodeURIComponent(lead.sid)}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            כרטיס מלא + החלטות בוט
          </a>
          <a
            href={`/dashboard/v3/conversations?lead=${encodeURIComponent(lead.sid)}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
            פתח שיחה
          </a>
        </div>
      </div>
    </>
  );
}

export function LeadsView({
  leads,
  sheetGapsTotal,
  sheetGapsPendingCount,
  sheetGapsBadPhoneCount,
  sheetGapsSendFailedCount,
  sheetGapsOtherErrorCount,
  sheetGapsRows,
  sheetGapsSpreadsheetId,
}: {
  leads: LeadRow[];
  sheetGapsTotal: number;
  sheetGapsPendingCount: number;
  sheetGapsBadPhoneCount: number;
  sheetGapsSendFailedCount: number;
  sheetGapsOtherErrorCount: number;
  sheetGapsRows: SheetGapRow[];
  sheetGapsSpreadsheetId: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Stage filter is URL-persisted so that the lead card (opened via /leads
  // ?stage=X&lead=Y) can paginate prev/next over the same filtered subset.
  const activeStage = params.get("stage") ?? "ALL";
  const setActiveStage = (s: string) => {
    const sp = new URLSearchParams(params.toString());
    if (s === "ALL") sp.delete("stage");
    else sp.set("stage", s);
    router.replace(sp.toString() ? `/dashboard/v3/leads?${sp.toString()}` : "/dashboard/v3/leads");
  };
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<LeadRow | null>(null);

  const isGapsView = activeStage === "GAPS";

  const filtered = useMemo(() => {
    if (isGapsView) return [];
    let result = leads;
    if (activeStage !== "ALL") result = result.filter((l) => l.stage === activeStage);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (l) =>
          l.name?.toLowerCase().includes(q) ||
          l.phone?.includes(q) ||
          l.botSummary?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [leads, activeStage, isGapsView, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: leads.length };
    for (const l of leads) {
      if (l.stage) c[l.stage] = (c[l.stage] ?? 0) + 1;
    }
    return c;
  }, [leads]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">לידים</h1>
        {!isGapsView && (
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש שם / טלפון..."
              className="w-52 rounded-xl border border-border bg-background pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}
      </div>

      {/* Stage filter pills */}
      <div className="flex flex-wrap gap-2">
        {ALL_STAGES.map((s) => {
          const isGaps = s === "GAPS";
          const count = isGaps ? sheetGapsTotal : (counts[s] ?? 0);
          const active = activeStage === s;
          const hasGapAlert = isGaps && count > 0;
          return (
            <button
              key={s}
              onClick={() => setActiveStage(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : hasGapAlert
                  ? "bg-destructive/20 text-destructive border-destructive/40 hover:bg-destructive/30"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {STAGE_FILTER_LABEL[s]} {count > 0 && <span className="opacity-70">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Count */}
      <div className="text-xs text-muted-foreground">
        {isGapsView
          ? `${sheetGapsTotal} פערים (ממתינים: ${sheetGapsPendingCount}, טלפון פגום: ${sheetGapsBadPhoneCount}, שליחה נכשלה: ${sheetGapsSendFailedCount}${sheetGapsOtherErrorCount > 0 ? `, שגיאות: ${sheetGapsOtherErrorCount}` : ""})`
          : `${filtered.length} לידים`}
      </div>

      {/* Content — gaps table or lead cards */}
      {isGapsView ? (
        <GapsTable rows={sheetGapsRows} spreadsheetId={sheetGapsSpreadsheetId} />
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">אין לידים תואמים</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((l) => (
            <LeadCard key={l.sid} lead={l} onPreview={setPreview} activeStage={activeStage} />
          ))}
        </div>
      )}

      {/* Preview drawer */}
      {preview && <PreviewDrawer lead={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
