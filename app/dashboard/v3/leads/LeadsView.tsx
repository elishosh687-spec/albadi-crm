"use client";

import { useState, useMemo } from "react";
import { Search, MessageSquare, X } from "lucide-react";
import { STAGE_LABEL, STAGE_TONE } from "@/app/dashboard/v3/_components/stage-meta";

const ALL_STAGES = ["ALL", "NEW", "AWAITING_ESTIMATE", "AWAITING_LOGO", "WAITING_FACTORY", "AWAITING_FINAL", "WON", "DROPPED"] as const;
const STAGE_FILTER_LABEL: Record<string, string> = {
  ALL: "הכל",
  NEW: "חדשים",
  AWAITING_ESTIMATE: "ממתינים להצעה",
  AWAITING_LOGO: "ממתינים ללוגו",
  WAITING_FACTORY: "אצל המפעל",
  AWAITING_FINAL: "אישור סופי",
  WON: "נסגרו",
  DROPPED: "ננטשו",
};

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

function LeadCard({ lead, onPreview }: { lead: LeadRow; onPreview: (l: LeadRow) => void }) {
  const pill = STAGE_TONE[lead.stage ?? ""]?.pill ?? "bg-muted text-muted-foreground";
  const stageLabel = STAGE_LABEL[lead.stage ?? ""] ?? lead.stage ?? "—";
  const updatedAt = lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString("he-IL") : "—";

  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-md transition-all duration-150">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
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
      <div className="font-semibold text-base leading-tight">{lead.name ?? "ללא שם"}</div>

      {/* Phone */}
      {lead.phone && (
        <div className="text-sm text-muted-foreground" dir="ltr">{lead.phone}</div>
      )}

      {/* Quote */}
      {lead.quoteTotal && (
        <div className="text-sm font-medium text-emerald-400">
          ₪{Number(lead.quoteTotal).toLocaleString("he-IL")}
        </div>
      )}

      {/* Summary */}
      {(lead.botSummary || lead.notes) && (
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {lead.botSummary ?? lead.notes}
        </p>
      )}

      {/* Actions — visible on hover (desktop) or always (mobile) */}
      <div className="flex gap-2 pt-1 opacity-0 group-hover:opacity-100 md:transition-opacity duration-150 md:opacity-0 max-md:opacity-100">
        <a
          href={`/dashboard/v3/conversations?lead=${encodeURIComponent(lead.sid)}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted transition-colors"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          פתח שיחה
        </a>
        <button
          onClick={() => onPreview(lead)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition-colors"
        >
          תצוגה מקדימה
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
          {lead.notes && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">הערות</div>
              <div className="text-muted-foreground leading-relaxed">{lead.notes}</div>
            </div>
          )}
          {lead.updatedAt && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">עדכון אחרון</div>
              <div>{new Date(lead.updatedAt).toLocaleString("he-IL")}</div>
            </div>
          )}
        </div>
        <div className="border-t border-border p-4">
          <a
            href={`/dashboard/v3/conversations?lead=${encodeURIComponent(lead.sid)}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
            פתח שיחה
          </a>
        </div>
      </div>
    </>
  );
}

export function LeadsView({ leads }: { leads: LeadRow[] }) {
  const [activeStage, setActiveStage] = useState("ALL");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<LeadRow | null>(null);

  const filtered = useMemo(() => {
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
  }, [leads, activeStage, search]);

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
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש שם / טלפון..."
            className="w-52 rounded-xl border border-border bg-background pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Stage filter pills */}
      <div className="flex flex-wrap gap-2">
        {ALL_STAGES.map((s) => {
          const count = counts[s] ?? 0;
          const active = activeStage === s;
          return (
            <button
              key={s}
              onClick={() => setActiveStage(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {STAGE_FILTER_LABEL[s]} {count > 0 && <span className="opacity-70">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Count */}
      <div className="text-xs text-muted-foreground">{filtered.length} לידים</div>

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">אין לידים תואמים</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((l) => (
            <LeadCard key={l.sid} lead={l} onPreview={setPreview} />
          ))}
        </div>
      )}

      {/* Preview drawer */}
      {preview && <PreviewDrawer lead={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
