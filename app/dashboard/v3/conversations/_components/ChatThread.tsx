"use client";

import { useEffect, useRef } from "react";
import { Bot, User, UserCog } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ChatMessage {
  id: number;
  direction: "in" | "out";
  sender: "lead" | "bot" | "eli" | null;
  text: string | null;
  receivedAt: string;
  /**
   * Set when the bridge payload carries a media URL. The Bubble renders an
   * `<img>` (kind=image) or a download link (other kinds). Media bytes are
   * served via /api/bridge/media/[id] so the browser doesn't have to talk
   * to the bridge directly.
   */
  mediaKind?: "image" | "video" | "audio" | "document" | null;
  /** Original filename when the bridge supplied one. Used as link text. */
  mediaFilename?: string | null;
}

const SENDER_META: Record<
  "lead" | "bot" | "eli",
  { label: string; icon: typeof Bot; bubble: string; chip: string }
> = {
  lead: {
    label: "לקוח",
    icon: User,
    bubble: "bg-card text-foreground border-border",
    chip: "text-sky-300",
  },
  bot: {
    label: "בוט",
    icon: Bot,
    bubble: "bg-primary/20 text-foreground border-primary/30",
    chip: "text-primary",
  },
  eli: {
    label: "אני",
    icon: UserCog,
    bubble: "bg-success/15 text-foreground border-success/30",
    chip: "text-success",
  },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ymd = new Date(d);
  ymd.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (today.getTime() - ymd.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "היום";
  if (diffDays === 1) return "אתמול";
  if (diffDays < 7) return d.toLocaleDateString("he-IL", { weekday: "long" });
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function ChatThread({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
        אין הודעות בשיחה הזו עדיין.
      </div>
    );
  }

  // Group messages by day for the date separators.
  const grouped: Array<{ day: string; items: ChatMessage[] }> = [];
  for (const m of messages) {
    const day = formatDay(m.receivedAt);
    const last = grouped[grouped.length - 1];
    if (last && last.day === day) {
      last.items.push(m);
    } else {
      grouped.push({ day, items: [m] });
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background/40">
      {grouped.map((g, gi) => (
        <div key={gi} className="space-y-2.5">
          <div className="sticky top-0 z-10 flex justify-center">
            <span className="text-[10px] uppercase tracking-wider bg-card/90 border border-border rounded-full px-3 py-1 text-muted-foreground backdrop-blur-sm">
              {g.day}
            </span>
          </div>
          {g.items.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function MediaBlock({ message }: { message: ChatMessage }) {
  if (!message.mediaKind) return null;
  const src = `/api/bridge/media/${message.id}`;
  if (message.mediaKind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <a href={src} target="_blank" rel="noreferrer" className="block mb-1.5">
        <img
          src={src}
          alt={message.mediaFilename ?? "תמונה מהלקוח"}
          className="max-w-[260px] max-h-[320px] rounded-lg object-contain bg-background/30"
          loading="lazy"
        />
      </a>
    );
  }
  if (message.mediaKind === "video") {
    return (
      <video
        src={src}
        controls
        className="max-w-[260px] max-h-[320px] rounded-lg mb-1.5"
      />
    );
  }
  if (message.mediaKind === "audio") {
    return <audio src={src} controls className="block mb-1.5 max-w-full" />;
  }
  // document / fallback
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="block mb-1.5 underline text-xs text-primary"
    >
      📎 {message.mediaFilename ?? "הורד קובץ"}
    </a>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  // Sender resolution: prefer explicit `sender`, fall back to direction for
  // legacy rows pre-attribution.
  const sender: "lead" | "bot" | "eli" =
    message.sender ?? (message.direction === "in" ? "lead" : "bot");
  const meta = SENDER_META[sender];
  const Icon = meta.icon;
  // Lead on left, our outbound (bot/eli) on right.
  const isOutbound = sender !== "lead";

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[80%] flex flex-col gap-1", isOutbound && "items-end")}>
        <div className={cn("flex items-center gap-1.5 text-[10px]", meta.chip)}>
          <Icon className="size-3" />
          <span>{meta.label}</span>
        </div>
        <div
          className={cn(
            "rounded-2xl border px-3.5 py-2 text-sm whitespace-pre-wrap break-words text-right",
            meta.bubble,
            isOutbound ? "rounded-tr-sm" : "rounded-tl-sm"
          )}
        >
          <MediaBlock message={message} />
          {message.text && message.text.trim().length > 0 ? (
            message.text
          ) : !message.mediaKind ? (
            // Empty text + no media on outbound usually means the bridge fired
            // `message.sent` before our pre-insert landed and we lost the
            // original copy. Show something honest rather than blank.
            <span className="text-muted-foreground italic">
              {isOutbound ? "(תוכן לא נשמר — לפני תיקון race condition)" : "(הודעה ריקה)"}
            </span>
          ) : null}
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatTime(message.receivedAt)}
        </span>
      </div>
    </div>
  );
}
