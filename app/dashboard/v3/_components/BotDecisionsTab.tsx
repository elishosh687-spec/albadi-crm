"use client";

/**
 * Bot Supervisor Phase 1 — read-only timeline of supervisor decisions for a
 * lead. Three lanes per row:
 *   LLM     — what the supervisor recommended (intent, confidence, reason).
 *   Code    — what the deterministic handler / bot actually did.
 *   Eli     — what Eli decided after the fact (approve / edit / reject /
 *             manual reply / stage override / direct WA reply), if anything.
 *
 * No actions on this surface. To approve drafts, go to /dashboard/v3/drafts.
 * To override a stage, use the lead's overview tab.
 */

import { useEffect, useState, useTransition } from "react";
import { Code, User, AlertTriangle, Sparkles, ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  loadBotDecisionsAction,
  correctLLMDecisionAction,
  confirmLLMDecisionAction,
  confirmStageDecisionAction,
  correctStageDecisionAction,
  type BotDecisionRowDto,
} from "@/app/actions/v2";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/stages";

type DecisionRow = BotDecisionRowDto;

// Top 10 most common intents — short list for fast picking.
const INTENT_OPTIONS = [
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

export function BotDecisionsTab({ sid }: { sid: string }) {
  const [rows, setRows] = useState<DecisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBotDecisionsAction(sid)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setRows(r.rows);
        else setError(r.error);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [sid]);

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="size-4" />
        טעינת החלטות נכשלה: {error}
      </div>
    );
  }
  if (rows === null) {
    return <div className="p-4 text-sm text-muted-foreground">טוען החלטות...</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        אין החלטות שנרשמו עדיין לליד הזה. הלוג מתחיל לרשום מההודעה הראשונה אחרי הפעלת ה-Supervisor.
      </div>
    );
  }

  const handleRowCorrected = (rowId: number, intent: string) => {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  eliIntentOverride: intent,
                  eliCorrectionType: "routing",
                  eliAction: r.eliAction ?? "stage_override",
                  eliDecidedAt: new Date().toISOString(),
                }
              : r
          )
        : prev
    );
  };

  const handleRowConfirmed = (rowId: number) => {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  eliAction: "approved_as_is", // overwrite — explicit verdict is the stronger signal
                  eliCorrectionType: null,
                  eliDecidedAt: new Date().toISOString(),
                }
              : r
          )
        : prev
    );
  };

  const handleStageConfirmed = (rowId: number) => {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  eliStageFrom: r.stageAfter ?? null,
                  eliStageTo: r.stageAfter ?? null,
                  eliAction: r.eliAction ?? "approved_as_is",
                  eliDecidedAt: new Date().toISOString(),
                }
              : r
          )
        : prev
    );
  };

  const handleStageCorrected = (rowId: number, stage: string) => {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  eliStageFrom: r.stageAfter ?? null,
                  eliStageTo: stage,
                  eliCorrectionType: "routing",
                  eliAction: r.eliAction ?? "stage_override",
                  eliDecidedAt: new Date().toISOString(),
                }
              : r
          )
        : prev
    );
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      {rows.map((row) => (
        <DecisionCard
          key={row.id}
          row={row}
          sid={sid}
          onRowConfirmed={handleRowConfirmed}
          onRowCorrected={handleRowCorrected}
          onStageConfirmed={handleStageConfirmed}
          onStageCorrected={handleStageCorrected}
        />
      ))}
    </div>
  );
}

function DecisionCard({
  row,
  sid,
  onRowConfirmed,
  onRowCorrected,
  onStageConfirmed,
  onStageCorrected,
}: {
  row: DecisionRow;
  sid: string;
  onRowConfirmed: (rowId: number) => void;
  onRowCorrected: (rowId: number, intent: string) => void;
  onStageConfirmed: (rowId: number) => void;
  onStageCorrected: (rowId: number, stage: string) => void;
}) {
  const divergence =
    !!row.llmRecommended &&
    row.llmRecommended !== "approve_code" &&
    row.decidedBy === "code";

  const eliOverride = !!row.eliAction;

  const [showPicker, setShowPicker] = useState(false);
  const [pickedIntent, setPickedIntent] = useState<string>("");
  const [freeText, setFreeText] = useState<string>("");
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const confirmCorrect = () => {
    setError(null);
    startSubmit(async () => {
      const r = await confirmLLMDecisionAction(row.id);
      if (r.ok) {
        onRowConfirmed(row.id);
      } else {
        setError(r.error ?? "save failed");
      }
    });
  };

  const submitCorrection = () => {
    const intent =
      pickedIntent === "other" && freeText.trim()
        ? freeText.trim()
        : pickedIntent;
    if (!intent) {
      setError("בחר intent");
      return;
    }
    setError(null);
    startSubmit(async () => {
      const r = await correctLLMDecisionAction(row.id, intent);
      if (r.ok) {
        setShowPicker(false);
        onRowCorrected(row.id, intent);
      } else {
        setError(r.error ?? "save failed");
      }
    });
  };

  // Stage feedback state — separate from intent feedback.
  const [showStagePicker, setShowStagePicker] = useState(false);
  const [pickedStage, setPickedStage] = useState<string>("");
  const [stageError, setStageError] = useState<string | null>(null);
  const stageTransitioned = !!row.stageAfter && row.stageAfter !== row.stageBefore;
  const stageFeedbackGiven =
    row.eliStageFrom !== null && row.eliStageTo !== null;
  const stageCorrected =
    stageFeedbackGiven && row.eliStageFrom !== row.eliStageTo;
  const stageConfirmedExplicit =
    stageFeedbackGiven && row.eliStageFrom === row.eliStageTo;

  const confirmStage = () => {
    setStageError(null);
    startSubmit(async () => {
      const r = await confirmStageDecisionAction(row.id);
      if (r.ok) onStageConfirmed(row.id);
      else setStageError(r.error ?? "save failed");
    });
  };

  const submitStageCorrection = () => {
    if (!pickedStage) {
      setStageError("בחר שלב");
      return;
    }
    setStageError(null);
    startSubmit(async () => {
      const r = await correctStageDecisionAction(row.id, pickedStage, sid);
      if (r.ok) {
        setShowStagePicker(false);
        onStageCorrected(row.id, pickedStage);
      } else {
        setStageError(r.error ?? "save failed");
      }
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 text-sm",
        divergence && "border-amber-500/50",
        eliOverride && "border-emerald-500/50"
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <time
          dateTime={row.createdAt}
          className="text-xs text-muted-foreground font-mono"
        >
          {new Date(row.createdAt).toLocaleString("he-IL", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        <div className="flex items-center gap-2 text-xs">
          {row.stageBefore && (
            <span className="font-mono text-muted-foreground">
              {row.stageBefore}
              {row.stageAfter && row.stageAfter !== row.stageBefore && (
                <span className="text-foreground"> → {row.stageAfter}</span>
              )}
            </span>
          )}
        </div>
      </header>

      {row.inboundText && (
        <blockquote className="border-r-2 border-muted-foreground/30 pr-2 mb-3 text-foreground/80 text-xs">
          {row.inboundText}
        </blockquote>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <Lane
          icon={<Sparkles className="size-3.5" />}
          title="LLM (Supervisor)"
          tone={
            row.llmRecommended === "supervisor_error" ? "destructive" : "primary"
          }
        >
          {row.llmRecommended ? (
            <>
              <Badge>{row.llmRecommended}</Badge>
              {row.llmIntent && <div>intent: {row.llmIntent}</div>}
              {typeof row.llmConfidence === "number" && (
                <div>confidence: {row.llmConfidence.toFixed(2)}</div>
              )}
              {row.llmReason && <div className="text-muted-foreground">{row.llmReason}</div>}
              {row.llmRiskFlags && row.llmRiskFlags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {row.llmRiskFlags.map((f) => (
                    <Badge key={f} variant="warning">
                      {f}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Feedback: thumbs-up / thumbs-down on the LLM verdict.
                  Buttons hide only after Eli explicitly rates (correct/wrong)
                  via this UI. Other feedback (manual reply, direct WA, etc.)
                  keeps the buttons visible so the rating can still be given. */}
              {row.eliIntentOverride ? (
                <div className="mt-2 flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <ThumbsDown className="size-3" />
                  <span className="text-xs">
                    סווג מחדש כ-<strong>{row.eliIntentOverride}</strong>
                  </span>
                </div>
              ) : row.eliCorrectionType === null && row.eliAction === "approved_as_is" ? (
                <div className="mt-2 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <ThumbsUp className="size-3" />
                  <span className="text-xs">הLLM צדק (אישרת)</span>
                </div>
              ) : !showPicker ? (
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={confirmCorrect}
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    <ThumbsUp className="size-3" />
                    הLLM צדק
                  </button>
                  <button
                    onClick={() => setShowPicker(true)}
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    <ThumbsDown className="size-3" />
                    הLLM טעה
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                  <div className="text-xs text-muted-foreground">
                    מה היה ה-intent הנכון?
                  </div>
                  <select
                    value={pickedIntent}
                    onChange={(e) => setPickedIntent(e.target.value)}
                    disabled={submitting}
                    className="text-xs rounded border border-border bg-background px-1.5 py-1"
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
                      className="text-xs rounded border border-border bg-background px-1.5 py-1"
                    />
                  )}
                  {error && (
                    <div className="text-xs text-destructive">{error}</div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      onClick={submitCorrection}
                      disabled={submitting || !pickedIntent}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      <Check className="size-3" />
                      {submitting ? "שומר…" : "שמור"}
                    </button>
                    <button
                      onClick={() => {
                        setShowPicker(false);
                        setError(null);
                        setPickedIntent("");
                        setFreeText("");
                      }}
                      disabled={submitting}
                      className="flex-1 inline-flex items-center justify-center rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">לא רץ supervisor</div>
          )}
        </Lane>

        <Lane
          icon={<Code className="size-3.5" />}
          title="Code"
          tone={row.decidedBy === "supervisor_error" ? "destructive" : "neutral"}
        >
          <Badge>{row.decidedBy}</Badge>
          <div>{row.action}</div>
          {row.replyText && (
            <div className="text-muted-foreground italic line-clamp-3">
              "{row.replyText}"
            </div>
          )}
          {row.draftId && (
            <div className="text-muted-foreground">draft #{row.draftId}</div>
          )}
          {row.escalationKind && (
            <div className="text-muted-foreground">escalation: {row.escalationKind}</div>
          )}

          {/* Stage feedback — always visible. Shows current stage info + thumbs. */}
          <div className="mt-2 border-t border-border/50 pt-2">
            <div className="text-xs text-muted-foreground mb-1">
              {stageTransitioned ? (
                <>
                  stage: {row.stageBefore ?? "—"} →{" "}
                  <strong>{row.stageAfter}</strong>
                </>
              ) : row.stageBefore || row.stageAfter ? (
                <>
                  stage נשאר:{" "}
                  <strong>{row.stageAfter ?? row.stageBefore}</strong>
                </>
              ) : (
                <>ללא stage</>
              )}
            </div>
              {stageCorrected ? (
                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <ThumbsDown className="size-3" />
                  <span className="text-xs">
                    תוקן ל-<strong>{row.eliStageTo}</strong>
                  </span>
                </div>
              ) : stageConfirmedExplicit ? (
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <ThumbsUp className="size-3" />
                  <span className="text-xs">השלב נכון (אישרת)</span>
                </div>
              ) : !showStagePicker ? (
                <div className="flex gap-1.5">
                  <button
                    onClick={confirmStage}
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    <ThumbsUp className="size-3" />
                    השלב נכון
                  </button>
                  <button
                    onClick={() => setShowStagePicker(true)}
                    disabled={submitting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    <ThumbsDown className="size-3" />
                    שלב שגוי
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                  <div className="text-xs text-muted-foreground">
                    מה השלב הנכון?
                  </div>
                  <select
                    value={pickedStage}
                    onChange={(e) => setPickedStage(e.target.value)}
                    disabled={submitting}
                    className="text-xs rounded border border-border bg-background px-1.5 py-1"
                  >
                    <option value="">בחר שלב…</option>
                    {V2_PIPELINE_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {stageError && (
                    <div className="text-xs text-destructive">{stageError}</div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      onClick={submitStageCorrection}
                      disabled={submitting || !pickedStage}
                      className="flex-1 inline-flex items-center justify-center gap-1 rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                    >
                      <Check className="size-3" />
                      {submitting ? "שומר…" : "תקן והעבר"}
                    </button>
                    <button
                      onClick={() => {
                        setShowStagePicker(false);
                        setStageError(null);
                        setPickedStage("");
                      }}
                      disabled={submitting}
                      className="flex-1 inline-flex items-center justify-center rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )}
          </div>
        </Lane>

        <Lane
          icon={<User className="size-3.5" />}
          title="Eli"
          tone={eliOverride ? "success" : "neutral"}
        >
          {row.eliAction ? (
            <>
              <div className="flex flex-wrap gap-1">
                <Badge variant="success">{row.eliAction}</Badge>
                {row.eliCorrectionType && (
                  <Badge variant={row.eliCorrectionType === "content" ? "default" : "warning"}>
                    {row.eliCorrectionType}
                  </Badge>
                )}
              </div>
              {row.eliEditText && (
                <div className="text-muted-foreground italic line-clamp-3">
                  "{row.eliEditText}"
                </div>
              )}
              {row.eliManualReply && (
                <div className="text-muted-foreground italic line-clamp-3">
                  "{row.eliManualReply}"
                </div>
              )}
              {row.eliRejectReason && (
                <div className="text-muted-foreground">סיבה: {row.eliRejectReason}</div>
              )}
              {row.eliStageFrom && row.eliStageTo && (
                <div className="text-muted-foreground font-mono">
                  {row.eliStageFrom} → {row.eliStageTo}
                </div>
              )}
              {row.eliDecidedAt && (
                <div className="text-xs text-muted-foreground">
                  {new Date(row.eliDecidedAt).toLocaleString("he-IL", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">ללא משוב</div>
          )}
        </Lane>
      </div>
    </div>
  );
}

function Lane({
  icon,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone: "primary" | "neutral" | "destructive" | "success";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded border p-2 flex flex-col gap-1",
        tone === "primary" && "border-sky-500/40 bg-sky-500/5",
        tone === "neutral" && "border-border bg-muted/30",
        tone === "destructive" && "border-destructive/50 bg-destructive/5",
        tone === "success" && "border-emerald-500/40 bg-emerald-500/5"
      )}
    >
      <header className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {icon}
        {title}
      </header>
      <div className="flex flex-col gap-1 text-foreground">{children}</div>
    </div>
  );
}

function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "warning" | "success";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono",
        variant === "default" && "bg-foreground/10 text-foreground",
        variant === "warning" && "bg-amber-500/20 text-amber-700 dark:text-amber-300",
        variant === "success" && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
      )}
    >
      {children}
    </span>
  );
}
