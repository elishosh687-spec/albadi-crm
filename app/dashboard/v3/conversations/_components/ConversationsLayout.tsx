"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  ChevronRight,
  Bot,
  BotOff,
  User,
  UserCog,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { STAGE_LABEL, STAGE_TONE, timeAgoHe } from "../../_components/stage-meta";
import type { ConversationRow } from "../page";
import { ChatThread, type ChatMessage } from "./ChatThread";
import { OrderSummary, type OrderSummaryData } from "./OrderSummary";
import { Composer } from "./Composer";
import { deleteLeadAction, setBotPaused } from "@/app/actions/v2";

const SENDER_TONE: Record<"lead" | "bot" | "eli", string> = {
  lead: "text-sky-300",
  bot: "text-primary",
  eli: "text-success",
};

const SENDER_ICON: Record<"lead" | "bot" | "eli", typeof Bot> = {
  lead: User,
  bot: Bot,
  eli: UserCog,
};

export function ConversationsLayout({
  rows,
  selected,
}: {
  rows: ConversationRow[];
  selected: {
    sid: string;
    summary: OrderSummaryData;
    messages: ChatMessage[];
  } | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "needs_eli">("all");
  const [summaryOpen, setSummaryOpen] = useState(true);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "unread" && r.inboundLast24h === 0) return false;
      if (filter === "needs_eli" && r.flag !== "NEEDS_ELI" && !r.botPaused) {
        return false;
      }
      if (!s) return true;
      const hay = [r.name, r.phone, r.sid, r.lastText]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [rows, search, filter]);

  const setLead = (sid: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (sid) sp.set("lead", sid);
    else sp.delete("lead");
    router.replace(`/dashboard/v3/conversations?${sp.toString()}`);
  };

  const handleDelete = async (sid: string, label: string) => {
    if (!confirm(`למחוק את הליד "${label}"? פעולה לא הפיכה.`)) return;
    const r = await deleteLeadAction(sid);
    if (!r.ok) {
      alert(`שגיאה: ${r.error ?? "מחיקה נכשלה"}`);
      return;
    }
    if (selected?.sid === sid) {
      setLead(null);
    }
    router.refresh();
  };

  // Mobile: when a lead is selected, hide the list; show only the chat.
  const isChatOpen = !!selected;

  return (
    <div className="flex flex-col gap-3 h-[calc(100dvh-3rem)]">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1
            className="text-2xl font-medium tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            שיחות
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length} שיחות פעילות.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-0 lg:gap-3 flex-1 min-h-0">
        {/* LEFT: contacts list (narrow) */}
        <aside
          className={cn(
            "rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-0",
            isChatOpen && "hidden lg:flex"
          )}
        >
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש…"
                className="w-full rounded-md border border-border bg-background/50 pl-2 pr-7 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <div className="flex items-center gap-1">
              {[
                { key: "all" as const, label: "הכל" },
                { key: "unread" as const, label: "נכנס 24ש׳" },
                { key: "needs_eli" as const, label: "צריך אותך" },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] border",
                    filter === f.key
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-border/60">
            {filtered.map((r) => (
              <ConversationListItem
                key={r.sid}
                row={r}
                active={selected?.sid === r.sid}
                onClick={() => setLead(r.sid)}
                onDelete={() =>
                  handleDelete(r.sid, r.name || r.phone || r.sid)
                }
              />
            ))}
            {filtered.length === 0 && (
              <li className="text-xs text-muted-foreground text-center py-6">
                —
              </li>
            )}
          </ul>
        </aside>

        {/* RIGHT: chat panel + collapsible summary inside */}
        <main
          className={cn(
            "relative rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-0",
            !isChatOpen && "hidden lg:flex"
          )}
        >
          {selected ? (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_auto] min-h-0">
              {/* Chat column */}
              <div className="flex flex-col min-h-0">
                <ChatHeader
                  sid={selected.sid}
                  summary={selected.summary}
                  onBack={() => setLead(null)}
                  summaryOpen={summaryOpen}
                  onToggleSummary={() => setSummaryOpen((v) => !v)}
                />
                <ChatThread messages={selected.messages} />
                <Composer
                  sid={selected.sid}
                  phone={selected.summary.phone}
                  initialBotPaused={selected.summary.botPaused}
                />
              </div>
              {/* Summary sidebar (collapsible) */}
              {summaryOpen && (
                <aside
                  className={cn(
                    "w-full lg:w-[300px] border-t lg:border-t-0 lg:border-r border-border bg-background/30",
                    "overflow-y-auto p-4"
                  )}
                >
                  <OrderSummary data={selected.summary} sid={selected.sid} />
                </aside>
              )}
            </div>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground p-6 text-center">
              בחר ליד מהרשימה לצפייה בשיחה ובסיכום ההזמנה.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ChatHeader({
  sid,
  summary,
  onBack,
  summaryOpen,
  onToggleSummary,
}: {
  sid: string;
  summary: OrderSummaryData;
  onBack: () => void;
  summaryOpen: boolean;
  onToggleSummary: () => void;
}) {
  const stage = (summary.stage ?? "UNCLASSIFIED").toUpperCase();
  const tone = STAGE_TONE[stage] ?? STAGE_TONE.UNCLASSIFIED;
  // Local state mirrors summary.botPaused for instant feedback; the server
  // action is the source of truth and the page re-fetches on next nav.
  const [paused, setPaused] = useState(summary.botPaused);
  const [toggling, startToggle] = useTransition();
  const displayName = summary.name || summary.phone || "(ליד)";

  const onToggleBot = () => {
    const next = !paused;
    setPaused(next); // optimistic
    startToggle(async () => {
      const r = await setBotPaused(sid, next);
      if (!r?.ok) setPaused(!next); // revert on failure
    });
  };

  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-3 bg-card/80">
      <button
        type="button"
        onClick={onBack}
        className="lg:hidden size-8 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
      >
        <ChevronRight className="size-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onToggleBot}
            disabled={toggling}
            title={paused ? "הבוט/LLM מושהה — לחץ להפעיל" : "הבוט/LLM פעיל — לחץ להשהות"}
            aria-pressed={!paused}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full pl-2 pr-1.5 py-0.5 text-base font-medium truncate transition-colors",
              "hover:bg-secondary disabled:opacity-60",
              paused
                ? "text-muted-foreground"
                : "text-foreground"
            )}
          >
            {toggling ? (
              <Loader2 className="size-3.5 animate-spin shrink-0" />
            ) : paused ? (
              <BotOff className="size-3.5 text-warning shrink-0" />
            ) : (
              <Bot className="size-3.5 text-success shrink-0" />
            )}
            <span className="truncate">{displayName}</span>
          </button>
          <span className={cn("text-[10px] rounded-full px-2 py-0.5 shrink-0", tone.pill)}>
            {STAGE_LABEL[stage] ?? stage}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {summary.phone || "—"}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleSummary}
        className={cn(
          "size-8 rounded-md grid place-items-center transition-colors",
          summaryOpen
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary"
        )}
        title={summaryOpen ? "סגור סיכום הזמנה" : "פתח סיכום הזמנה"}
        aria-pressed={summaryOpen}
      >
        {summaryOpen ? (
          <PanelLeftClose className="size-4" />
        ) : (
          <PanelLeftOpen className="size-4" />
        )}
      </button>
      <Link
        href="/dashboard/v3"
        className="text-xs text-muted-foreground hover:text-foreground hidden sm:inline-flex"
      >
        חזרה
      </Link>
    </header>
  );
}

function ConversationListItem({
  row,
  active,
  onClick,
  onDelete,
}: {
  row: ConversationRow;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const tone =
    STAGE_TONE[(row.stage ?? "UNCLASSIFIED").toUpperCase()] ??
    STAGE_TONE.UNCLASSIFIED;
  const SenderIcon = SENDER_ICON[row.lastSender];
  const [deleting, startDelete] = useTransition();
  const [paused, setPaused] = useState(row.botPaused);
  const [toggling, startToggle] = useTransition();

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    startDelete(async () => {
      await onDelete();
    });
  };

  const handleBotToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const next = !paused;
    setPaused(next); // optimistic
    startToggle(async () => {
      const r = await setBotPaused(row.sid, next);
      if (!r?.ok) setPaused(!next); // revert on failure
    });
  };

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full text-right p-3 flex flex-col gap-1.5 transition-colors",
          active ? "bg-primary/10" : "hover:bg-card/70"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate flex-1 min-w-0">
            {row.name || row.phone || row.sid}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {timeAgoHe(row.lastAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {row.stage && (
            <span className={cn("text-[10px] rounded-full px-1.5 py-0.5", tone.pill)}>
              {STAGE_LABEL[row.stage] ?? row.stage}
            </span>
          )}
          {row.flag === "NEEDS_ELI" && (
            <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-destructive/15 text-destructive border border-destructive/30">
              צריך אותך
            </span>
          )}
          {row.inboundLast24h > 0 && (
            <span className="text-[10px] rounded-full bg-primary text-primary-foreground px-1.5 py-0.5">
              +{row.inboundLast24h}
            </span>
          )}
        </div>
        <div className="flex items-start gap-1.5 text-xs">
          <span className={cn("shrink-0 mt-0.5", SENDER_TONE[row.lastSender])}>
            <SenderIcon className="size-3" />
          </span>
          <span className="line-clamp-2 text-muted-foreground flex-1">
            {row.lastText || "—"}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={handleBotToggle}
        disabled={toggling}
        title={paused ? "הבוט מושהה — לחץ להפעיל" : "הבוט פעיל — לחץ להשהות"}
        aria-pressed={!paused}
        className={cn(
          "absolute top-2 left-11 size-7 rounded-md grid place-items-center",
          "bg-card/80 backdrop-blur-sm border",
          paused
            ? "border-warning/40 text-warning hover:bg-warning/10"
            : "border-success/40 text-success hover:bg-success/10",
          // Visible always on touch; hover-reveal on desktop.
          "opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity",
          "disabled:opacity-60"
        )}
      >
        {toggling ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : paused ? (
          <BotOff className="size-3.5" />
        ) : (
          <Bot className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={handleDeleteClick}
        disabled={deleting}
        title="מחק ליד"
        className={cn(
          "absolute top-2 left-2 size-7 rounded-md grid place-items-center",
          "bg-card/80 backdrop-blur-sm border border-border",
          "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
          // Visible always on touch; hover-reveal on desktop.
          "opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity",
          "disabled:opacity-60"
        )}
      >
        {deleting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </button>
    </li>
  );
}
