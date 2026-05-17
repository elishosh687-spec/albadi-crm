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

import { useEffect, useState } from "react";
import { Code, User, AlertTriangle, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  loadBotDecisionsAction,
  type BotDecisionRowDto,
} from "@/app/actions/v2";

type DecisionRow = BotDecisionRowDto;

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

  return (
    <div className="flex flex-col gap-2 p-2">
      {rows.map((row) => (
        <DecisionCard key={row.id} row={row} />
      ))}
    </div>
  );
}

function DecisionCard({ row }: { row: DecisionRow }) {
  const divergence =
    !!row.llmRecommended &&
    row.llmRecommended !== "approve_code" &&
    row.decidedBy === "code";

  const eliOverride = !!row.eliAction;

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
