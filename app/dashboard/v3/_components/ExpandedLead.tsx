"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Pause,
  Play,
  ExternalLink,
  Sparkles,
  Send,
  Clock,
  LayoutDashboard,
  MessagesSquare,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  setLeadStage,
  setBotPaused,
  snoozeLead,
  suggestRepliesAction,
  sendManualReply,
  updateLeadContactAction,
  createCrmTaskAction,
  createSlaTimerAction,
  saveLeadScoreSnapshotAction,
  openOpportunityAction,
} from "@/app/actions/v2";
import {
  V2_FLAG_NAMES,
  V2_PIPELINE_STAGES,
  type V2FlagName,
  type V2PipelineStage,
} from "@/lib/manychat/stages";
import { STAGE_LABEL, STAGE_TONE } from "./stage-meta";
import {
  LIFECYCLE_LABEL,
  PRIORITY_LABEL,
  lifecycleOf,
  quoteNumber,
  type PriorityBand,
} from "./crm-insights";
import { ChatThread, type ChatMessage } from "../conversations/_components/ChatThread";
import { OrderSummary, type OrderSummaryData } from "../conversations/_components/OrderSummary";
import { Composer } from "../conversations/_components/Composer";
import { NotesPanel } from "./NotesPanel";

type TabKey = "overview" | "chat" | "summary";

export interface ExpandedLeadProps {
  sid: string;
  summary: OrderSummaryData;
  messages: ChatMessage[];
}

export function ExpandedLead({ sid, summary, messages }: ExpandedLeadProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>("chat");

  const goBack = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("lead");
    router.replace(
      sp.toString() ? `/dashboard/v3?${sp.toString()}` : "/dashboard/v3"
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stage = (summary.stage ?? "UNCLASSIFIED").toUpperCase();
  const tone = STAGE_TONE[stage] ?? STAGE_TONE.UNCLASSIFIED;
  const needsHuman =
    summary.flag === "NEEDS_ELI" || summary.flags.includes("NEEDS_ELI");
  const quoteValue = quoteNumber(summary.quoteTotal);
  const sourceLabel = summary.leadSource || summary.source || "לא ידוע";
  const lifecycle = lifecycleOf(summary.stage);
  const priority: PriorityBand =
    needsHuman || summary.botPaused || quoteValue >= 10000
      ? "HOT"
      : quoteValue > 0 || stage === "WAITING_FACTORY" || stage === "AWAITING_FINAL"
        ? "WARM"
        : "LOW";

  return (
    <div className="flex flex-col gap-4 min-h-[calc(100dvh-3rem)]">
      <header className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          <ArrowRight className="size-3.5" />
          חזרה לרשימה
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1
              className="text-2xl font-medium truncate"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {summary.name || summary.phone || "(ליד)"}
            </h1>
            <span className={cn("text-xs rounded-full px-2.5 py-1 shrink-0", tone.pill)}>
              {STAGE_LABEL[stage] ?? stage}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {summary.phone || sid}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <StatusTile
          label="סטטוס טיפול"
          value={needsHuman ? "צריך אותך" : "בוט מטפל"}
          tone={needsHuman ? "danger" : "success"}
        />
        <StatusTile
          label="בוט"
          value={summary.botPaused ? "מושעה" : "פעיל"}
          tone={summary.botPaused ? "warning" : "success"}
        />
        <StatusTile
          label="הצעת מחיר"
          value={
            quoteValue > 0
              ? `₪${quoteValue.toLocaleString("he-IL")}`
              : "אין סכום"
          }
          tone={quoteValue >= 10000 ? "success" : "muted"}
        />
        <StatusTile
          label="מחזור חיים"
          value={LIFECYCLE_LABEL[lifecycle]}
          tone="muted"
        />
        <StatusTile
          label="עדיפות"
          value={PRIORITY_LABEL[priority]}
          tone={priority === "HOT" ? "danger" : priority === "WARM" ? "warning" : "muted"}
        />
        <StatusTile
          label="מקור"
          value={sourceLabel}
          tone="muted"
        />
        <StatusTile
          label="פעולה הבאה"
          value={
            summary.botPaused
              ? "להחליט על הבוט"
              : needsHuman
                ? "לענות ידנית"
                : "לעקוב"
          }
          tone={summary.botPaused || needsHuman ? "warning" : "muted"}
        />
      </section>

      <nav className="flex items-center gap-1 border-b border-border">
        {(
          [
            { key: "overview", label: "סקירה", icon: LayoutDashboard },
            { key: "chat", label: `שיחה (${messages.length})`, icon: MessagesSquare },
            { key: "summary", label: "סיכום הזמנה", icon: ClipboardList },
          ] as { key: TabKey; label: string; icon: typeof LayoutDashboard }[]
        ).map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2 -mb-px border-b-2 text-sm transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 min-h-0">
        {tab === "overview" && (
          <OverviewTab sid={sid} summary={summary} />
        )}
        {tab === "chat" && (
          <ChatTab sid={sid} summary={summary} messages={messages} />
        )}
        {tab === "summary" && (
          <div className="max-w-2xl">
            <OrderSummary data={summary} sid={sid} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "danger" | "warning" | "success" | "muted";
}) {
  const toneClass = {
    danger: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    muted: "border-border bg-card/60 text-foreground",
  }[tone];

  return (
    <div className={cn("rounded-lg border p-3", toneClass)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function OverviewTab({
  sid,
  summary,
}: {
  sid: string;
  summary: OrderSummaryData;
}) {
  const [stage, setStage] = useState<V2PipelineStage>(
    (V2_PIPELINE_STAGES.includes((summary.stage ?? "NEW") as V2PipelineStage)
      ? summary.stage
      : "NEW") as V2PipelineStage
  );
  const [flags, setFlags] = useState<V2FlagName[]>(
    summary.flags.filter((f) =>
      V2_FLAG_NAMES.includes(f as V2FlagName)
    ) as V2FlagName[]
  );
  const [paused, setPaused] = useState(summary.botPaused);
  const [name, setName] = useState(summary.name ?? "");
  const [phone, setPhone] = useState(summary.phone ?? "");
  const [hint, setHint] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [replyText, setReplyText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggleFlag = (f: V2FlagName) => {
    setFlags((cur) =>
      cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]
    );
  };

  const saveStage = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await setLeadStage({ manychatSubId: sid, stage, flags });
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשמר" : r.error ?? "כשל" });
    });
  };
  const saveContact = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await updateLeadContactAction(sid, { name, phone });
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשמר" : r.error ?? "כשל" });
    });
  };
  const togglePause = () => {
    setMsg(null);
    const next = !paused;
    startTransition(async () => {
      const r = await setBotPaused(sid, next);
      if (r.ok) setPaused(next);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error ?? "כשל" });
    });
  };
  const snooze = (hours: number) => {
    setMsg(null);
    startTransition(async () => {
      const r = await snoozeLead(sid, hours);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "" : r.error ?? "כשל" });
    });
  };
  const suggest = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await suggestRepliesAction(sid, hint || undefined);
      if (r.ok) setSuggestions(r.replies);
      else setMsg({ ok: false, text: r.error });
    });
  };
  const sendReply = () => {
    const t = replyText.trim();
    if (!t) return;
    setMsg(null);
    startTransition(async () => {
      const r = await sendManualReply(sid, t);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשלח" : r.error ?? "כשל" });
      if (r.ok) {
        setReplyText("");
        setSuggestions([]);
      }
    });
  };

  const waLink = summary.phone
    ? `https://wa.me/${summary.phone.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
      <div className="space-y-5">
        {summary.botSummary && (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              סיכום הבוט
            </div>
            <p className="text-sm whitespace-pre-wrap">{summary.botSummary}</p>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            פרטי קשר
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="שם הלקוח"
              className="bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="טלפון (E.164: 972...)"
              dir="ltr"
              inputMode="tel"
              className="bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <button
            type="button"
            onClick={saveContact}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            שמור פרטי קשר
          </button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            הbridge מספק רק chat_jid (לא טלפון). השם מתעדכן ידנית פה ויופיע
            בכל המסכים.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            פעולות
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={togglePause}
              disabled={isPending}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium",
                paused
                  ? "bg-warning/15 border-warning/40 text-warning"
                  : "bg-success/10 border-success/30 text-success"
              )}
            >
              {paused ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {paused ? "הבוט מושהה" : "הבוט פעיל"}
            </button>
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs font-medium hover:bg-secondary"
              >
                WhatsApp
                <ExternalLink className="size-3" />
              </a>
            )}
            <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
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

        <CrmOpsPanel sid={sid} quoteTotal={summary.quoteTotal} />

        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
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
          <div className="text-xs uppercase tracking-wider text-muted-foreground pt-1">
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
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            שמור שלב + דגלים
          </button>
        </section>

        <NotesPanel sid={sid} initialNotes={summary.notes} />

        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            הצעות LLM + ענייה ידנית
          </div>
          <div className="flex gap-2">
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="רמז: ‘הצע הנחה 5%’"
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
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={3}
            placeholder="ענה ידני (משהה את הבוט)…"
            className="w-full bg-background/50 border border-border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="button"
            onClick={sendReply}
            disabled={isPending || !replyText.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Send className="size-3" />
            שלח
          </button>
        </section>

        {msg && (
          <p
            className={cn(
              "text-xs",
              msg.ok ? "text-success" : "text-destructive"
            )}
          >
            {msg.text}
          </p>
        )}
      </div>

      <div className="lg:sticky lg:top-6">
        <OrderSummary data={summary} sid={sid} />
      </div>
    </div>
  );
}

function CrmOpsPanel({
  sid,
  quoteTotal,
}: {
  sid: string;
  quoteTotal: string | null;
}) {
  const [taskTitle, setTaskTitle] = useState("לחזור לליד");
  const [scoreReason, setScoreReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setResult = (r: { ok: boolean; message?: string; error?: string }) => {
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשמר" : r.error ?? "נכשל" });
  };

  const createTask = () => {
    startTransition(async () => {
      const due = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      setResult(
        await createCrmTaskAction({
          manychatSubId: sid,
          title: taskTitle,
          taskType: "follow_up",
          dueAt: due,
          assignedTo: "eli",
        })
      );
    });
  };

  const createSla = () => {
    startTransition(async () => {
      const due = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
      setResult(
        await createSlaTimerAction({
          manychatSubId: sid,
          slaType: "human_response",
          dueAt: due,
        })
      );
    });
  };

  const saveScore = () => {
    startTransition(async () => {
      const quote = quoteNumber(quoteTotal);
      setResult(
        await saveLeadScoreSnapshotAction({
          manychatSubId: sid,
          fitScore: quote >= 10000 ? 20 : quote > 0 ? 12 : 6,
          intentScore: quote > 0 ? 28 : 12,
          engagementScore: 15,
          frictionPenalty: 0,
          reason: scoreReason || "ניקוד ידני מהדאשבורד",
        })
      );
    });
  };

  const openOpp = () => {
    startTransition(async () => {
      setResult(
        await openOpportunityAction({
          manychatSubId: sid,
          valueIls: quoteNumber(quoteTotal) || null,
        })
      );
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        CRM מתקדם
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          value={taskTitle}
          onChange={(e) => setTaskTitle(e.target.value)}
          className="rounded-lg border border-border bg-background/50 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/30"
          placeholder="כותרת משימה"
        />
        <input
          value={scoreReason}
          onChange={(e) => setScoreReason(e.target.value)}
          className="rounded-lg border border-border bg-background/50 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/30"
          placeholder="סיבת ניקוד"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={createTask}
          disabled={isPending || !taskTitle.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          צור משימה 24ש׳
        </button>
        <button
          type="button"
          onClick={createSla}
          disabled={isPending}
          className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-60"
        >
          פתח SLA 2ש׳
        </button>
        <button
          type="button"
          onClick={saveScore}
          disabled={isPending}
          className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-60"
        >
          שמור ניקוד
        </button>
        <button
          type="button"
          onClick={openOpp}
          disabled={isPending}
          className="rounded-md border border-success/40 bg-success/10 px-3 py-1.5 text-xs text-success hover:bg-success/15 disabled:opacity-60"
        >
          פתח Opportunity
        </button>
      </div>
      {msg && (
        <p className={cn("text-xs", msg.ok ? "text-success" : "text-destructive")}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

function ChatTab({
  sid,
  summary,
  messages,
}: {
  sid: string;
  summary: OrderSummaryData;
  messages: ChatMessage[];
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden h-[calc(100dvh-12rem)] min-h-[400px]">
      <ChatThread messages={messages} />
      <Composer
        sid={sid}
        phone={summary.phone}
        initialBotPaused={summary.botPaused}
      />
    </div>
  );
}
