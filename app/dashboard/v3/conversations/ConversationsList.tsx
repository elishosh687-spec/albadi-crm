"use client";

import { useMemo, useState } from "react";
import { Search, Bot, User, UserCog, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { STAGE_LABEL, STAGE_TONE, timeAgoHe } from "../_components/stage-meta";

export interface ConversationRow {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  flag: string | null;
  botPaused: boolean;
  lastText: string | null;
  lastSender: "lead" | "bot" | "eli";
  lastAt: string | null;
  inboundLast24h: number;
}

const SENDER_META: Record<
  ConversationRow["lastSender"],
  { label: string; icon: typeof Bot; tone: string }
> = {
  lead: { label: "לקוח", icon: User, tone: "text-sky-300" },
  bot: { label: "בוט", icon: Bot, tone: "text-primary" },
  eli: { label: "אני", icon: UserCog, tone: "text-success" },
};

export function ConversationsList({ rows }: { rows: ConversationRow[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "needs_eli">("all");

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

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-3xl font-medium tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              שיחות
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {filtered.length.toLocaleString("he-IL")} שיחות, ממוינות לפי הודעה אחרונה. לחיצה על ליד פותחת drawer מ-Leads.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש שם / טלפון / טקסט…"
              className="w-72 rounded-lg border border-border bg-card pl-3 pr-8 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {[
            { key: "all" as const, label: `הכל (${rows.length})` },
            {
              key: "unread" as const,
              label: `נכנס ב-24ש׳ (${rows.filter((r) => r.inboundLast24h > 0).length})`,
            },
            {
              key: "needs_eli" as const,
              label: `דורש אותך (${rows.filter((r) => r.flag === "NEEDS_ELI" || r.botPaused).length})`,
            },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors border",
                filter === f.key
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            אין שיחות שמתאימות לסינון.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r) => (
              <ConversationRowItem key={r.sid} row={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ConversationRowItem({ row }: { row: ConversationRow }) {
  const senderMeta = SENDER_META[row.lastSender];
  const SenderIcon = senderMeta.icon;
  const tone =
    STAGE_TONE[(row.stage ?? "UNCLASSIFIED").toUpperCase()] ??
    STAGE_TONE.UNCLASSIFIED;
  const waLink = row.phone
    ? `https://wa.me/${row.phone.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <li className="flex items-center gap-3 p-4 hover:bg-card/70 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium truncate">
            {row.name || row.phone || row.sid}
          </span>
          {row.stage && (
            <span className={cn("text-[10px] rounded-full px-2 py-0.5", tone.pill)}>
              {STAGE_LABEL[row.stage] ?? row.stage}
            </span>
          )}
          {row.flag === "NEEDS_ELI" && (
            <span className="text-[10px] rounded-full px-2 py-0.5 bg-destructive/15 text-destructive border border-destructive/30">
              צריך אותך
            </span>
          )}
          {row.botPaused && (
            <span className="text-[10px] rounded-full px-2 py-0.5 bg-warning/15 text-warning border border-warning/30">
              bot paused
            </span>
          )}
          {row.inboundLast24h > 0 && (
            <span className="text-[10px] rounded-full px-2 py-0.5 bg-primary text-primary-foreground">
              +{row.inboundLast24h}
            </span>
          )}
        </div>
        <div className="flex items-start gap-2">
          <span
            className={cn("text-[10px] uppercase tracking-wider mt-0.5 shrink-0 flex items-center gap-1", senderMeta.tone)}
          >
            <SenderIcon className="size-2.5" />
            {senderMeta.label}
          </span>
          <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
            {row.lastText || "—"}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {timeAgoHe(row.lastAt)}
        </span>
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            WhatsApp
            <ExternalLink className="size-2.5" />
          </a>
        )}
      </div>
    </li>
  );
}
