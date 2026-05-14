"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  X,
  Pause,
  Play,
  ExternalLink,
  Sparkles,
  Send,
  Clock,
  MessagesSquare,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  setLeadStage,
  updateLeadNotes,
  setBotPaused,
  snoozeLead,
  suggestRepliesAction,
  sendManualReply,
} from "@/app/actions/v2";
import {
  V2_FLAG_NAMES,
  V2_PIPELINE_STAGES,
  type V2FlagName,
  type V2PipelineStage,
} from "@/lib/manychat/stages";
import { STAGE_LABEL, STAGE_TONE, timeAgoHe } from "./stage-meta";
import type { LeadCardData } from "./LeadsBoard";

export function LeadDrawer({
  lead,
  onClose,
}: {
  lead: LeadCardData;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<V2PipelineStage>(
    (V2_PIPELINE_STAGES.includes(lead.stage as V2PipelineStage)
      ? lead.stage
      : "NEW") as V2PipelineStage
  );
  const [flags, setFlags] = useState<V2FlagName[]>(
    (lead.flags.filter((f) => V2_FLAG_NAMES.includes(f as V2FlagName)) as V2FlagName[])
  );
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [paused, setPaused] = useState(lead.botPaused);
  const [replyText, setReplyText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleFlag = (f: V2FlagName) => {
    setFlags((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  };

  const saveStage = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await setLeadStage({
        manychatSubId: lead.sid,
        stage,
        flags,
      });
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשמר" : r.error ?? "כשל" });
    });
  };

  const saveNotes = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await updateLeadNotes(lead.sid, notes);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשמר" : r.error ?? "כשל" });
    });
  };

  const togglePause = () => {
    setMsg(null);
    const next = !paused;
    startTransition(async () => {
      const r = await setBotPaused(lead.sid, next);
      if (r.ok) setPaused(next);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error ?? "כשל" });
    });
  };

  const snooze = (hours: number) => {
    setMsg(null);
    startTransition(async () => {
      const r = await snoozeLead(lead.sid, hours);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error ?? "כשל" });
    });
  };

  const suggest = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await suggestRepliesAction(lead.sid, hint || undefined);
      if (r.ok) setSuggestions(r.replies);
      else setMsg({ ok: false, text: r.error });
    });
  };

  const sendReply = () => {
    const text = replyText.trim();
    if (!text) return;
    setMsg(null);
    startTransition(async () => {
      const r = await sendManualReply(lead.sid, text);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשלח" : r.error ?? "כשל" });
      if (r.ok) {
        setReplyText("");
        setSuggestions([]);
      }
    });
  };

  const tone = STAGE_TONE[stage] ?? STAGE_TONE.UNCLASSIFIED;
  const waLink = lead.phone
    ? `https://wa.me/${lead.phone.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <div className="fixed inset-0 z-50" dir="rtl">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in"
      />
      <aside
        role="dialog"
        className="absolute inset-y-0 left-0 w-full sm:w-[480px] lg:w-[560px] bg-card border-r border-border shadow-2xl flex flex-col animate-in slide-in-from-left"
      >
        <header className="flex items-start gap-3 p-5 border-b border-border">
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-md grid place-items-center hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h2
              className="text-xl font-medium truncate"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {lead.name || "(ללא שם)"}
            </h2>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {lead.phone || lead.sid}
              {lead.lastInboundAt && ` · עודכן ${timeAgoHe(lead.lastInboundAt)}`}
            </div>
          </div>
          <span className={cn("text-xs rounded-full px-2.5 py-1", tone.pill)}>
            {STAGE_LABEL[stage] ?? stage}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {lead.botSummary && (
            <section>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                סיכום הבוט
              </div>
              <div className="text-sm bg-background/50 border border-border rounded-lg p-3">
                {lead.botSummary}
              </div>
            </section>
          )}

          {lead.lastInboundText && (
            <section>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                הודעה אחרונה מהלקוח
              </div>
              <div className="text-sm bg-background/50 border border-border rounded-lg p-3 whitespace-pre-wrap">
                {lead.lastInboundText}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePause}
                disabled={isPending}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                  paused
                    ? "bg-warning/15 border-warning/40 text-warning"
                    : "bg-success/10 border-success/30 text-success"
                )}
              >
                {paused ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {paused ? "הבוט מושהה" : "הבוט פעיל"}
              </button>
              <Link
                href={`/dashboard/v3/conversations?lead=${encodeURIComponent(lead.sid)}`}
                className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20"
              >
                <MessagesSquare className="size-3.5" />
                פתח שיחה
              </Link>
              {waLink && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary"
                >
                  WhatsApp
                  <ExternalLink className="size-3" />
                </a>
              )}
              <div className="flex-1" />
              <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                <button
                  type="button"
                  onClick={() => snooze(24)}
                  disabled={isPending}
                  className="px-1.5 py-0.5 rounded hover:bg-secondary"
                >
                  +יום
                </button>
                <button
                  type="button"
                  onClick={() => snooze(24 * 3)}
                  disabled={isPending}
                  className="px-1.5 py-0.5 rounded hover:bg-secondary"
                >
                  +3
                </button>
                <button
                  type="button"
                  onClick={() => snooze(24 * 7)}
                  disabled={isPending}
                  className="px-1.5 py-0.5 rounded hover:bg-secondary"
                >
                  +ש׳
                </button>
              </div>
            </div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              שלב
            </div>
            <div className="flex flex-wrap gap-1.5">
              {V2_PIPELINE_STAGES.map((s) => {
                const t = STAGE_TONE[s];
                const active = stage === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStage(s)}
                    className={cn(
                      "rounded-full text-xs px-2.5 py-1 border transition-colors",
                      active
                        ? t.pill
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {STAGE_LABEL[s] ?? s}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              דגלים
            </div>
            <div className="flex flex-wrap gap-1.5">
              {V2_FLAG_NAMES.map((f) => {
                const active = flags.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFlag(f)}
                    className={cn(
                      "rounded-full text-xs px-2.5 py-1 border transition-colors",
                      active
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={saveStage}
              disabled={isPending}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              שמור שלב + דגלים
            </button>
          </section>

          <section>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              הערות
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-background/50 border border-border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
              placeholder="הערות פנימיות…"
            />
            <button
              type="button"
              onClick={saveNotes}
              disabled={isPending}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
            >
              שמור הערות
            </button>
          </section>

          <section className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              הצעות LLM
            </div>
            <div className="flex gap-2">
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="רמז: למשל ‘הצע הנחה 5%’ או ‘שאל על לוגו’"
                className="flex-1 bg-background/50 border border-border rounded-lg px-3 py-2 text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={suggest}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:opacity-90"
              >
                <Sparkles className="size-3" />
                הצע
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setReplyText(s)}
                    className="text-right text-sm border border-border rounded-lg p-2.5 hover:bg-secondary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              ענה ידני
            </div>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={3}
              placeholder="כתוב הודעה ללקוח…"
              className="w-full bg-background/50 border border-border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="button"
              onClick={sendReply}
              disabled={isPending || !replyText.trim()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Send className="size-3" />
              שלח (משהה את הבוט)
            </button>
          </section>
        </div>

        {msg && (
          <div
            className={cn(
              "border-t border-border px-5 py-2.5 text-xs",
              msg.ok ? "text-success" : "text-destructive"
            )}
          >
            {msg.text}
          </div>
        )}
      </aside>
    </div>
  );
}
