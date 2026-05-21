"use client";

/**
 * Bot Decisions sidebar widget — picker + read-only table of bot_decision_log.
 *
 * Auth: every fetch carries `?widget_token=<apiToken>`.
 * No mutations — only filters (action / source) + pagination via `limit`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X, User, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, Check } from "lucide-react";

const INTENT_OPTIONS: { value: string; label: string }[] = [
  { value: "accept", label: "אישור" },
  { value: "reject", label: "דחייה" },
  { value: "negotiating", label: "יקר / מיקוח" },
  { value: "question_meeting", label: "בקשת שיחה" },
  { value: "question_delivery", label: "שאלת אספקה" },
  { value: "meta_question", label: 'שאלה מטא ("למה שואל")' },
  { value: "frustrated", label: "תסכול / כעס" },
  { value: "custom_size", label: "מידה/כמות מותאמת" },
  { value: "spec_change", label: "שינוי מפרט" },
  { value: "other", label: "אחר (טקסט חופשי)" },
];

interface LeadOption {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  updatedAt: string;
}

interface DecisionRow {
  id: number;
  createdAt: string;
  manychatSubId: string;
  inboundText: string | null;
  stageBefore: string | null;
  stageAfter: string | null;
  llmIntent: string | null;
  llmRecommended: string | null;
  llmReason: string | null;
  decidedBy: string;
  action: string;
  replyText: string | null;
  escalationKind: string | null;
  draftId: number | null;
  eliAction: string | null;
  eliIntentOverride: string | null;
  eliCorrectionType: string | null;
  // source may not exist yet pre-Track-C1 migration; treat null as 'bridge'.
  source?: string | null;
}

function widgetUrl(path: string, token: string, extra?: Record<string, string | undefined>): string {
  const u = new URL(path, "http://placeholder.local");
  u.searchParams.set("widget_token", token);
  if (extra) for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== "") u.searchParams.set(k, v);
  }
  return u.pathname + u.search;
}

const ACTION_LABELS: Record<string, { label: string; tone: string }> = {
  reply_sent: { label: "תשובה נשלחה", tone: "bg-success/15 text-success border-success/30" },
  sub_state_advanced: { label: "התקדמות שאלון", tone: "bg-primary/15 text-primary border-primary/30" },
  escalated: { label: "אסקלציה", tone: "bg-warning/15 text-warning border-warning/30" },
  stage_transition: { label: "שינוי stage", tone: "bg-primary/15 text-primary border-primary/30" },
  no_op: { label: "ללא פעולה", tone: "bg-muted/40 text-muted-foreground border-border" },
  paused: { label: "בוט הושהה", tone: "bg-muted/40 text-muted-foreground border-border" },
  unpaused_on_inbound: { label: "בוט חזר לפעולה", tone: "bg-success/15 text-success border-success/30" },
  draft_queued: { label: "טיוטה ב-queue", tone: "bg-warning/15 text-warning border-warning/30" },
};

const LLM_LABELS: Record<string, string> = {
  approve_code: "אשר קוד",
  override_with_text: "החלף בטקסט",
  escalate_to_eli: "העבר לאלי",
  silence: "השתק",
  supervisor_error: "שגיאת supervisor",
};

const DECIDED_BY_LABELS: Record<string, string> = {
  code: "קוד",
  llm_override: "LLM override",
  llm_unmatch: "LLM לא תאם",
  llm_spec: "LLM ספק",
  eli: "אלי",
  supervisor_error: "שגיאה",
  silent: "שקט",
};

export function BotDecisionsView({ apiToken }: { apiToken: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadOption[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedSid, setSelectedSid] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const runSearch = useCallback(
    async (q: string) => {
      setLoadingResults(true);
      try {
        const res = await fetch(widgetUrl("/api/widget/leads/recent", apiToken, { q }));
        const data = await res.json();
        if (data?.ok) setResults(data.leads || []);
      } catch (err) {
        console.error("[BotDecisionsView] search failed", err);
      } finally {
        setLoadingResults(false);
      }
    },
    [apiToken]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const loadRows = useCallback(
    async (sid: string, action: string) => {
      setLoadingRows(true);
      setError(null);
      try {
        const res = await fetch(
          widgetUrl("/api/widget/decisions", apiToken, {
            lead: sid,
            limit: "50",
            action,
          })
        );
        const data = await res.json();
        if (data?.ok) {
          setRows(data.rows || []);
        } else {
          setError(data?.error ?? "כשל בטעינת החלטות");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingRows(false);
      }
    },
    [apiToken]
  );

  useEffect(() => {
    if (selectedSid) loadRows(selectedSid, actionFilter);
  }, [selectedSid, actionFilter, loadRows]);

  const handlePick = (lead: LeadOption) => {
    setSelectedSid(lead.sid);
    setSelectedName(lead.name || lead.phone || lead.sid);
    setOpen(false);
    setQuery(lead.name || lead.phone || lead.sid);
  };

  const handleClear = () => {
    setSelectedSid(null);
    setSelectedName(null);
    setRows([]);
    setQuery("");
    setOpen(true);
    setTimeout(() => runSearch(""), 0);
  };

  const placeholder = useMemo(
    () => (selectedSid ? "החלף לקוח..." : "חפש לפי שם / טלפון / sid"),
    [selectedSid]
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div ref={containerRef} className="relative">
        <div className="relative">
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search className="size-4" />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setOpen(true);
              if (results.length === 0) runSearch(query.trim());
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-border bg-background pr-9 pl-9 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {selectedSid && (
            <button
              type="button"
              onClick={handleClear}
              title="בחר ליד אחר"
              className="absolute left-2 top-1/2 -translate-y-1/2 size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {open && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-popover shadow-xl max-h-80 overflow-auto">
            {loadingResults ? (
              <div className="px-3 py-4 text-xs text-muted-foreground flex items-center gap-2 justify-center">
                <Loader2 className="size-3.5 animate-spin" />
                טוען…
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                לא נמצאו לידים.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {results.map((r) => (
                  <li key={r.sid}>
                    <button
                      type="button"
                      onClick={() => handlePick(r)}
                      className="w-full px-3 py-2 text-right hover:bg-accent flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{r.name || "(ללא שם)"}</div>
                        <div className="text-[11px] text-muted-foreground tabular-nums truncate">
                          {r.phone || r.sid}
                          {r.stage ? ` · ${r.stage}` : ""}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {new Date(r.updatedAt).toLocaleDateString("he-IL")}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!selectedSid && (
        <div className="rounded-lg border border-dashed border-border bg-card/30 p-6 text-center text-sm text-muted-foreground">
          <User className="size-5 mx-auto mb-2 opacity-50" />
          בחר ליד מהרשימה למעלה כדי לראות את היסטוריית החלטות הבוט.
        </div>
      )}

      {selectedSid && (
        <>
          <div className="rounded-lg border border-border bg-card/40 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{selectedName}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums truncate">
                sid {selectedSid} · {rows.length} החלטות
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="all">כל הפעולות</option>
                {Object.entries(ACTION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              ⚠️ {error}
            </div>
          )}

          {loadingRows ? (
            <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              <Loader2 className="size-4 mx-auto mb-2 animate-spin" />
              טוען החלטות…
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/30 p-6 text-center text-sm text-muted-foreground">
              אין החלטות בוט עבור הליד הזה (או עם הסינון הנבחר).
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <DecisionRowCard
                  key={r.id}
                  row={r}
                  apiToken={apiToken}
                  onUpdated={(updated) =>
                    setRows((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function DecisionRowCard({
  row,
  apiToken,
  onUpdated,
}: {
  row: DecisionRow;
  apiToken: string;
  onUpdated: (patch: Partial<DecisionRow> & { id: number }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickedIntent, setPickedIntent] = useState("");
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);

  const postFeedback = async (kind: "confirm" | "correct", body?: object) => {
    setSubmitting(true);
    setFbError(null);
    try {
      const res = await fetch(
        `/api/widget/decisions/${row.id}/${kind}?widget_token=${apiToken}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        setFbError(data?.error ?? "שמירה נכשלה");
        return false;
      }
      return true;
    } catch (e) {
      setFbError(e instanceof Error ? e.message : "שמירה נכשלה");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (await postFeedback("confirm")) {
      onUpdated({
        id: row.id,
        eliAction: "approved_as_is",
        eliCorrectionType: null,
      });
    }
  };

  const handleSubmitCorrection = async () => {
    const intent =
      pickedIntent === "other" && freeText.trim() ? freeText.trim() : pickedIntent;
    if (!intent) {
      setFbError("בחר intent");
      return;
    }
    if (await postFeedback("correct", { intent })) {
      onUpdated({
        id: row.id,
        eliIntentOverride: intent,
        eliCorrectionType: "routing",
        eliAction: row.eliAction ?? "stage_override",
      });
      setShowPicker(false);
    }
  };
  const action = ACTION_LABELS[row.action] ?? {
    label: row.action,
    tone: "bg-muted/40 text-muted-foreground border-border",
  };
  const llm = row.llmRecommended ? LLM_LABELS[row.llmRecommended] ?? row.llmRecommended : null;
  const decidedBy = DECIDED_BY_LABELS[row.decidedBy] ?? row.decidedBy;
  const source = row.source || "bridge";
  const sourceLabel = source === "ghl" ? "GHL" : "Bridge";
  const sourceTone =
    source === "ghl"
      ? "bg-primary/15 text-primary border-primary/30"
      : "bg-muted/40 text-muted-foreground border-border";

  return (
    <li className="rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] rounded-full px-2 py-0.5 border ${action.tone}`}>
            {action.label}
          </span>
          <span className={`text-[10px] rounded-full px-2 py-0.5 border ${sourceTone}`}>
            {sourceLabel}
          </span>
          {row.eliAction && (
            <span className="text-[10px] rounded-full px-2 py-0.5 border bg-warning/15 text-warning border-warning/30">
              🧑 אלי: {row.eliAction}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {new Date(row.createdAt).toLocaleString("he-IL")}
        </span>
      </div>

      {row.inboundText && (
        <div className="text-xs text-foreground/90 mb-1.5 leading-snug border-r-2 border-muted-foreground/30 pr-2">
          <span className="text-muted-foreground">📩 inbound:</span>{" "}
          {row.inboundText.length > 100 && !expanded
            ? row.inboundText.slice(0, 100) + "…"
            : row.inboundText}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {llm && (
          <div>
            <span className="text-muted-foreground/70">LLM:</span>{" "}
            <span className="text-foreground">{llm}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground/70">decided_by:</span>{" "}
          <span className="text-foreground">{decidedBy}</span>
        </div>
        {row.llmIntent && (
          <div>
            <span className="text-muted-foreground/70">intent:</span>{" "}
            <span className="text-foreground">{row.llmIntent}</span>
          </div>
        )}
        {row.stageBefore && row.stageAfter && row.stageBefore !== row.stageAfter && (
          <div>
            <span className="text-muted-foreground/70">stage:</span>{" "}
            <span className="text-foreground">
              {row.stageBefore} → {row.stageAfter}
            </span>
          </div>
        )}
      </div>

      {(row.replyText || row.llmReason || (row.inboundText && row.inboundText.length > 100)) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          {expanded ? "סגור" : "פרטים נוספים"}
        </button>
      )}

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5 text-xs">
          {row.replyText && (
            <div>
              <span className="text-muted-foreground">תשובה:</span>{" "}
              <span className="text-foreground whitespace-pre-wrap">{row.replyText}</span>
            </div>
          )}
          {row.llmReason && (
            <div>
              <span className="text-muted-foreground">נימוק LLM:</span>{" "}
              <span className="text-foreground whitespace-pre-wrap">{row.llmReason}</span>
            </div>
          )}
          {row.escalationKind && (
            <div>
              <span className="text-muted-foreground">סוג אסקלציה:</span>{" "}
              <span className="text-foreground">{row.escalationKind}</span>
            </div>
          )}
          {row.draftId && (
            <div>
              <span className="text-muted-foreground">draft_id:</span>{" "}
              <span className="text-foreground font-mono">{row.draftId}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-border/30">
        {row.eliIntentOverride ? (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-500">
            <ThumbsDown className="size-3" />
            <span>
              סווג מחדש כ-<strong>{row.eliIntentOverride}</strong>
            </span>
          </div>
        ) : row.eliAction === "approved_as_is" && row.eliCorrectionType === null ? (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-500">
            <ThumbsUp className="size-3" />
            <span>אישרת את ההחלטה</span>
          </div>
        ) : !showPicker ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <ThumbsUp className="size-3" />
              ה-LLM צדק
            </button>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <ThumbsDown className="size-3" />
              ה-LLM טעה
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2">
            <div className="text-[11px] text-muted-foreground">
              מה היה ה-intent הנכון?
            </div>
            <select
              value={pickedIntent}
              onChange={(e) => setPickedIntent(e.target.value)}
              disabled={submitting}
              className="text-[11px] rounded border border-border bg-background px-1.5 py-1"
            >
              <option value="">בחר…</option>
              {INTENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {pickedIntent === "other" && (
              <input
                type="text"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="כתוב intent בעברית או באנגלית"
                className="text-[11px] rounded border border-border bg-background px-1.5 py-1"
              />
            )}
            {fbError && (
              <div className="text-[11px] text-destructive">{fbError}</div>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleSubmitCorrection}
                disabled={submitting || !pickedIntent}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
              >
                <Check className="size-3" />
                {submitting ? "שומר…" : "שמור"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPicker(false);
                  setPickedIntent("");
                  setFreeText("");
                  setFbError(null);
                }}
                disabled={submitting}
                className="px-2 py-1 text-[11px] rounded border border-border text-muted-foreground hover:bg-secondary disabled:opacity-50"
              >
                ביטול
              </button>
            </div>
          </div>
        )}
        {fbError && !showPicker && (
          <div className="mt-1 text-[11px] text-destructive">{fbError}</div>
        )}
      </div>
    </li>
  );
}
