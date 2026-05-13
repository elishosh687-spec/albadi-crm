"use client";

import { useState, useTransition } from "react";
import { Check, X, MessageSquare, ExternalLink, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { approveDraftAction, rejectDraftAction } from "@/app/actions/v2";
import { STAGE_LABEL, STAGE_TONE, timeAgoHe } from "../_components/stage-meta";

export interface DraftV3Row {
  id: number;
  manychatSubId: string;
  draftText: string;
  moneyReason: string | null;
  pipelineStageAtGen: string | null;
  generatedAt: string;
  leadName: string | null;
  leadPhone: string | null;
  leadStage: string | null;
  leadFlag: string | null;
  leadBotSummary: string | null;
  leadBotPaused: boolean;
  lastInboundText: string | null;
  lastInboundAt: string | null;
}

export function DraftQueueV3({ drafts }: { drafts: DraftV3Row[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(
    drafts[0]?.id ?? null
  );
  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-3xl font-medium tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            תור אישורים
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {drafts.length} טיוטות ממתינות. הבוט מציע — אתה מאשר, עורך, או דוחה.
          </p>
        </div>
      </header>

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
          <Check className="mx-auto size-8 text-success mb-3" />
          <div className="text-lg font-medium">אין מה לאשר עכשיו</div>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto">
            הבוט עוד לא יצר טיוטות לרגעי כסף. כשתתעורר נקודה כספית, היא תופיע כאן.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_2fr] gap-5">
          <div className="flex flex-col gap-2">
            {drafts.map((d) => (
              <DraftRowButton
                key={d.id}
                draft={d}
                selected={d.id === selectedId}
                onSelect={() => setSelectedId(d.id)}
              />
            ))}
          </div>
          {selected ? (
            <DraftDetail draft={selected} key={selected.id} />
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/30 p-6 text-sm text-muted-foreground">
              בחר טיוטה מהרשימה.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DraftRowButton({
  draft,
  selected,
  onSelect,
}: {
  draft: DraftV3Row;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone =
    STAGE_TONE[(draft.leadStage ?? "UNCLASSIFIED").toUpperCase()] ??
    STAGE_TONE.UNCLASSIFIED;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "text-right rounded-xl border bg-card p-3 transition-colors flex flex-col gap-2",
        selected
          ? "border-primary/60 bg-primary/10"
          : "border-border hover:bg-card/70"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm truncate">
          {draft.leadName || draft.leadPhone || draft.manychatSubId}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {timeAgoHe(draft.generatedAt)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {draft.leadStage && (
          <span className={cn("text-[10px] rounded-full px-2 py-0.5", tone.pill)}>
            {STAGE_LABEL[draft.leadStage] ?? draft.leadStage}
          </span>
        )}
        {draft.moneyReason && (
          <span className="text-[10px] rounded-full border border-border bg-background/40 px-2 py-0.5 text-muted-foreground">
            {draft.moneyReason}
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground line-clamp-2">
        {draft.draftText}
      </div>
    </button>
  );
}

function DraftDetail({ draft }: { draft: DraftV3Row }) {
  const [text, setText] = useState(draft.draftText);
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const approve = () => {
    setMsg(null);
    const edited = text.trim() === draft.draftText.trim() ? undefined : text;
    startTransition(async () => {
      const r = await approveDraftAction(draft.id, edited);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשלח" : r.error ?? "כשל" });
    });
  };

  const reject = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await rejectDraftAction(draft.id, reason.trim() || undefined);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נדחה" : r.error ?? "כשל" });
      if (r.ok) setShowReject(false);
    });
  };

  const waLink = draft.leadPhone
    ? `https://wa.me/${draft.leadPhone.replace(/[^0-9]/g, "")}`
    : null;
  const tone =
    STAGE_TONE[(draft.leadStage ?? "UNCLASSIFIED").toUpperCase()] ??
    STAGE_TONE.UNCLASSIFIED;

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-5">
      <div>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xl font-medium" style={{ fontFamily: "var(--font-display)" }}>
              {draft.leadName || "(ללא שם)"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {draft.leadPhone || draft.manychatSubId}
              {draft.lastInboundAt && ` · ${timeAgoHe(draft.lastInboundAt)}`}
            </div>
          </div>
          {draft.leadStage && (
            <span className={cn("text-xs rounded-full px-2.5 py-1 shrink-0", tone.pill)}>
              {STAGE_LABEL[draft.leadStage] ?? draft.leadStage}
            </span>
          )}
        </div>
      </div>

      {draft.leadBotSummary && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
            סיכום הבוט
          </div>
          <div className="text-sm bg-background/50 border border-border rounded-lg p-3">
            {draft.leadBotSummary}
          </div>
        </div>
      )}

      {draft.lastInboundText && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <MessageSquare className="size-3" />
            הודעה אחרונה מהלקוח
          </div>
          <div className="text-sm bg-background/50 border border-border rounded-lg p-3 whitespace-pre-wrap">
            {draft.lastInboundText}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
          טיוטה לאישור — אפשר לערוך
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full bg-background/50 border border-border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          disabled={isPending}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={isPending || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Send className="size-3.5" />
          {isPending ? "שולח…" : "אשר ושלח"}
        </button>
        <button
          type="button"
          onClick={() => setShowReject((v) => !v)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-4 py-2 text-sm font-medium hover:bg-secondary"
        >
          <X className="size-3.5" />
          דחה
        </button>
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            <ExternalLink className="size-3.5" />
            WhatsApp
          </a>
        )}
      </div>

      {showReject && (
        <div className="flex items-center gap-2 pt-2 border-t border-dashed border-border">
          <input
            type="text"
            placeholder="סיבה (אופציונלי)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
            className="flex-1 bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={reject}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
          >
            אישור דחייה
          </button>
        </div>
      )}

      {msg && (
        <div
          className={cn(
            "text-sm",
            msg.ok ? "text-success" : "text-destructive"
          )}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
