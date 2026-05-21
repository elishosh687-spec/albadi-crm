"use client";

/**
 * Widget variant of DraftQueueV3 — fetches the pending queue itself and posts
 * approve/reject through /api/widget/drafts/*. Auto-refreshes every 30s and
 * after each action.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, X, MessageSquare, ExternalLink, Send, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { STAGE_LABEL, STAGE_TONE, timeAgoHe } from "@/lib/messaging/stage-meta";

export interface DraftWidgetRow {
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

function widgetUrl(path: string, token: string): string {
  const u = new URL(path, "http://placeholder.local");
  u.searchParams.set("widget_token", token);
  return u.pathname + u.search;
}

const REFRESH_INTERVAL_MS = 30_000;

export function DraftsView({ apiToken }: { apiToken: string }) {
  const [drafts, setDrafts] = useState<DraftWidgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  const load = useCallback(
    async (preserveSelection = true) => {
      try {
        const res = await fetch(widgetUrl("/api/widget/drafts/pending", apiToken));
        const data = await res.json();
        if (data?.ok) {
          const list = (data.drafts || []) as DraftWidgetRow[];
          setDrafts(list);
          setRefreshedAt(new Date());
          if (!preserveSelection || !list.some((d) => d.id === selectedId)) {
            setSelectedId(list[0]?.id ?? null);
          }
          setError(null);
        } else {
          setError(data?.error ?? "כשל בטעינת תור");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [apiToken, selectedId]
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(() => load(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-2xl font-medium tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            תור אישורים
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {drafts.length} טיוטות ממתינות. הבוט מציע — אתה מאשר, עורך, או דוחה.
            <span className="mr-2 text-[11px] text-muted-foreground/70">
              · עודכן {timeAgoHe(refreshedAt.toISOString())}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          רענן
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          ⚠️ {error}
        </div>
      )}

      {loading && drafts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
          <Loader2 className="size-5 mx-auto mb-2 animate-spin opacity-70" />
          טוען תור…
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
          <Check className="mx-auto size-8 text-success mb-3" />
          <div className="text-lg font-medium">אין מה לאשר עכשיו</div>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto">
            הבוט עוד לא יצר טיוטות לרגעי כסף. כשתתעורר נקודה כספית, היא תופיע כאן.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_2fr] gap-4">
          <div className="flex flex-col gap-2 max-h-[70vh] overflow-auto pr-1">
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
            <DraftDetail
              key={selected.id}
              draft={selected}
              apiToken={apiToken}
              onActionDone={() => load(false)}
            />
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
  draft: DraftWidgetRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone =
    STAGE_TONE[(draft.leadStage ?? "UNCLASSIFIED").toUpperCase()] ?? STAGE_TONE.UNCLASSIFIED;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "text-right rounded-xl border bg-card p-3 transition-colors flex flex-col gap-2",
        selected ? "border-primary/60 bg-primary/10" : "border-border hover:bg-card/70"
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
      <div className="flex items-center gap-1.5 flex-wrap">
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
        {draft.leadBotPaused && (
          <span className="text-[10px] rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
            בוט מושהה
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground line-clamp-2">{draft.draftText}</div>
    </button>
  );
}

function DraftDetail({
  draft,
  apiToken,
  onActionDone,
}: {
  draft: DraftWidgetRow;
  apiToken: string;
  onActionDone: () => void;
}) {
  const [text, setText] = useState(draft.draftText);
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const approve = async () => {
    setMsg(null);
    setPending(true);
    const edited = text.trim() === draft.draftText.trim() ? undefined : text;
    try {
      const res = await fetch(widgetUrl(`/api/widget/drafts/${draft.id}/approve`, apiToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edited_text: edited }),
      });
      const data = await res.json();
      if (data?.ok) {
        setMsg({ ok: true, text: data.message ?? "נשלח" });
        onActionDone();
      } else {
        setMsg({ ok: false, text: data?.error ?? "כשל" });
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  };

  const reject = async () => {
    setMsg(null);
    setPending(true);
    try {
      const res = await fetch(widgetUrl(`/api/widget/drafts/${draft.id}/reject`, apiToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (data?.ok) {
        setMsg({ ok: true, text: data.message ?? "נדחה" });
        setShowReject(false);
        onActionDone();
      } else {
        setMsg({ ok: false, text: data?.error ?? "כשל" });
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  };

  const waLink = draft.leadPhone
    ? `https://wa.me/${draft.leadPhone.replace(/[^0-9]/g, "")}`
    : null;
  const tone =
    STAGE_TONE[(draft.leadStage ?? "UNCLASSIFIED").toUpperCase()] ?? STAGE_TONE.UNCLASSIFIED;

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-5 max-h-[70vh] overflow-auto">
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
          <div className="text-sm bg-background/50 border border-border rounded-lg p-3 whitespace-pre-wrap">
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
          dir="rtl"
          className="w-full bg-background/50 border border-border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          disabled={pending}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {pending ? "שולח…" : "אשר ושלח"}
        </button>
        <button
          type="button"
          onClick={() => setShowReject((v) => !v)}
          disabled={pending}
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
            disabled={pending}
            dir="rtl"
            className="flex-1 bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={reject}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
          >
            אישור דחייה
          </button>
        </div>
      )}

      {msg && (
        <div className={cn("text-sm", msg.ok ? "text-success" : "text-destructive")}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
