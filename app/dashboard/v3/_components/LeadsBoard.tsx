"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Pause,
  Play,
  AlertCircle,
  MessageSquare,
  Trash2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { STAGE_LABEL, STAGE_TONE } from "./stage-meta";
import { TimeAgo } from "./TimeAgo";
import {
  BUCKET_LABEL,
  BUCKET_ORDER,
  BUCKET_TONE,
  bucketOf,
  type BucketKey,
} from "./buckets";

export interface LeadCardData {
  sid: string;
  name: string | null;
  phone: string | null;
  jid: string | null;
  source?: string | null;
  leadSource?: string | null;
  stage: string | null;
  qState?: Record<string, unknown> | null;
  pipelineFlag: string | null;
  flags: string[];
  botSummary: string | null;
  notes: string | null;
  quoteTotal: string | null;
  botPaused: boolean;
  followUpCount: number;
  lastInboundText: string | null;
  lastInboundAt: string | null;
  updatedAt: string;
}

export function LeadsBoard({ cards }: { cards: LeadCardData[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<BucketKey | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [deletingSid, setDeletingSid] = useState<string | null>(null);

  const openLead = (sid: string) => {
    router.push(`/dashboard/v3?lead=${encodeURIComponent(sid)}`);
  };

  const handleDelete = async (sid: string, displayName: string) => {
    if (
      !confirm(
        `למחוק את הליד ${displayName}?\n\nכל ההיסטוריה (שיחות, הצעות מפעל, טיוטות, תגיות) תימחק. פעולה לא הפיכה.`
      )
    )
      return;
    setDeletingSid(sid);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(sid)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`שגיאה במחיקה: ${data?.error ?? res.status}`);
      }
    } finally {
      setDeletingSid(null);
    }
  };

  const enriched = useMemo(
    () =>
      cards.map((c) => ({
        card: c,
        bucket: bucketOf({
          stage: c.stage,
          pipelineFlag: c.pipelineFlag,
          botPaused: c.botPaused,
          qState: (c.qState ?? null) as { subFlow?: string | null } | null,
        }),
      })),
    [cards]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return enriched.filter(({ card, bucket }) => {
      if (bucketFilter && bucket !== bucketFilter) return false;
      if (stageFilter && (card.stage ?? "").toUpperCase() !== stageFilter) return false;
      if (!s) return true;
      const hay = [
        card.name,
        card.phone,
        card.sid,
        card.botSummary,
        card.notes,
        card.lastInboundText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [enriched, search, bucketFilter, stageFilter]);

  const groupedByBucket = useMemo(() => {
    const map = new Map<BucketKey, LeadCardData[]>();
    for (const b of BUCKET_ORDER) map.set(b, []);
    for (const { card, bucket } of filtered) {
      map.get(bucket)!.push(card);
    }
    return map;
  }, [filtered]);

  const bucketTotals = useMemo(() => {
    const totals = new Map<BucketKey, number>();
    for (const b of BUCKET_ORDER) totals.set(b, 0);
    for (const { bucket } of enriched) {
      totals.set(bucket, (totals.get(bucket) ?? 0) + 1);
    }
    return totals;
  }, [enriched]);

  const totalShown = filtered.length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-3xl font-medium tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              לידים
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {totalShown.toLocaleString("he-IL")} לידים בתצוגה, מקובצים לפי
              סטטוס פעולה.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש שם / טלפון / טקסט…"
                className="w-full sm:w-72 rounded-lg border border-border bg-card pl-3 pr-8 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setBucketFilter(null);
              setStageFilter(null);
            }}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors border",
              bucketFilter === null && stageFilter === null
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            הכל ({cards.length})
          </button>
          {BUCKET_ORDER.map((b) => {
            const count = bucketTotals.get(b) ?? 0;
            const tone = BUCKET_TONE[b];
            const active = bucketFilter === b;
            return (
              <button
                key={b}
                type="button"
                onClick={() => {
                  setBucketFilter(active ? null : b);
                  setStageFilter(null);
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition-colors border flex items-center gap-1.5",
                  active
                    ? tone.pill
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <span className={cn("inline-block size-1.5 rounded-full", tone.dot)} />
                {BUCKET_LABEL[b]} ({count})
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {BUCKET_ORDER.map((bucket) => {
          const items = groupedByBucket.get(bucket) ?? [];
          return (
            <BucketColumn
              key={bucket}
              bucket={bucket}
              cards={items}
              onSelect={openLead}
              onDelete={handleDelete}
              deletingSid={deletingSid}
            />
          );
        })}
      </div>
    </div>
  );
}

function BucketColumn({
  bucket,
  cards,
  onSelect,
  onDelete,
  deletingSid,
}: {
  bucket: BucketKey;
  cards: LeadCardData[];
  onSelect: (sid: string) => void;
  onDelete: (sid: string, displayName: string) => void;
  deletingSid: string | null;
}) {
  const tone = BUCKET_TONE[bucket];
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card/40 backdrop-blur min-h-32">
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("inline-block size-2.5 rounded-full", tone.dot)} />
          <h2 className="text-sm font-medium truncate">
            {BUCKET_LABEL[bucket]}
          </h2>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {cards.length}
        </span>
      </header>
      <div className="flex flex-col gap-2 p-3 max-h-[72dvh] overflow-y-auto">
        {cards.map((c) => (
          <LeadCard
            key={c.sid}
            card={c}
            onClick={() => onSelect(c.sid)}
            onDelete={onDelete}
            isDeleting={deletingSid === c.sid}
          />
        ))}
        {cards.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">
            —
          </div>
        )}
      </div>
    </section>
  );
}

function lastNoteBody(notes: string | null, maxLen = 90): string | null {
  if (!notes) return null;
  const entries = notes.split(/\n\n(?=\[)/g).filter(Boolean);
  const last = entries.at(-1);
  if (!last) return null;
  const body = last.replace(/^(\[[^\]]+\]\s*)/, "").trim();
  return body ? (body.length > maxLen ? body.slice(0, maxLen) + "…" : body) : null;
}

function shortSid(sid: string): string {
  // 133144455962747@lid -> …62747
  // 1811084322@s.whatsapp.net -> …84322
  const before = sid.split("@")[0] || sid;
  return before.length > 5 ? `…${before.slice(-5)}` : before;
}

function LeadCard({
  card,
  onClick,
  onDelete,
  isDeleting,
}: {
  card: LeadCardData;
  onClick: () => void;
  onDelete: (sid: string, displayName: string) => void;
  isDeleting: boolean;
}) {
  const stageTone =
    STAGE_TONE[(card.stage ?? "").toUpperCase()] ?? STAGE_TONE.UNCLASSIFIED;
  const displayName = card.name || card.phone || shortSid(card.sid);
  const initials = (displayName ?? "?").trim().slice(0, 2);
  const needsEli = card.pipelineFlag === "NEEDS_ELI";

  const hasPreview =
    !!card.botSummary || !!card.notes || !!card.lastInboundText;

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full relative flex flex-col gap-2 rounded-lg border border-border/80 bg-card hover:bg-card/70 transition-colors p-3 text-right",
          needsEli && "ring-1 ring-destructive/30"
        )}
      >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {displayName}
            </span>
            {card.botPaused ? (
              <Pause className="size-3 text-warning shrink-0" />
            ) : (
              <Play className="size-3 text-success/80 shrink-0" />
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {card.phone || card.sid}
          </div>
        </div>
        <div
          className={cn(
            "size-9 shrink-0 rounded-full grid place-items-center text-xs font-medium",
            stageTone.pill
          )}
        >
          {initials}
        </div>
      </div>

      {card.lastInboundText && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <MessageSquare className="size-3 shrink-0 mt-0.5" />
          <span className="line-clamp-2 text-right">
            {card.lastInboundText}
          </span>
        </div>
      )}

      {(() => {
        const note = lastNoteBody(card.notes);
        if (!note) return null;
        return (
          <div className="flex items-start gap-1.5 text-xs border-r-2 border-primary/30 pr-2 text-muted-foreground/80">
            <span className="line-clamp-1 text-right italic">{note}</span>
          </div>
        );
      })()}

      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1 flex-wrap">
          <span className={cn("text-[10px] rounded-full px-2 py-0.5", stageTone.pill)}>
            {STAGE_LABEL[(card.stage ?? "").toUpperCase()] ?? card.stage ?? "—"}
          </span>
          {needsEli && (
            <span className="text-[10px] font-medium rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.5">
              <AlertCircle className="inline size-2.5 -mt-0.5 ml-0.5" />
              צריך אותך
            </span>
          )}
          {card.flags.slice(0, 2).map((f) => (
            <span
              key={f}
              className="text-[10px] rounded-full border border-border/80 bg-background/40 text-muted-foreground px-2 py-0.5"
            >
              {f}
            </span>
          ))}
          {card.flags.length > 2 && (
            <span className="text-[10px] text-muted-foreground">
              +{card.flags.length - 2}
            </span>
          )}
          {card.quoteTotal && (
            <span className="text-[10px] rounded-full border border-border/80 bg-background/40 text-foreground px-2 py-0.5 tabular-nums">
              ₪{card.quoteTotal}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          <TimeAgo iso={card.lastInboundAt ?? card.updatedAt} />
        </span>
      </div>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(card.sid, displayName);
        }}
        disabled={isDeleting}
        title="מחק ליד וכל ההיסטוריה"
        className={cn(
          "absolute top-2 left-2 z-10 grid place-items-center size-6 rounded-md",
          "bg-card/80 backdrop-blur border border-destructive/40 text-destructive",
          // Visible always on touch; hover-reveal on desktop.
          "opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100",
          "transition-opacity hover:bg-destructive/10 disabled:opacity-60"
        )}
      >
        {isDeleting ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Trash2 className="size-3" />
        )}
      </button>

      {hasPreview && <LeadHoverPreview card={card} />}
    </div>
  );
}

function LeadHoverPreview({ card }: { card: LeadCardData }) {
  return (
    <div
      className={cn(
        // Hidden by default. Shown on hover or focus-within within the group.
        // Pointer-events-none keeps the preview from stealing clicks; the
        // underlying card stays the click target.
        "pointer-events-none absolute z-50 right-0 top-full mt-1 w-80 max-w-[90vw]",
        "opacity-0 translate-y-[-4px] transition-all duration-150",
        "group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100"
      )}
    >
      <div className="rounded-xl border border-border bg-popover shadow-2xl p-3 text-right space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          תצוגה מקדימה
        </div>
        {card.botSummary && (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              סיכום הבוט
            </div>
            <p className="text-xs whitespace-pre-wrap line-clamp-4">
              {card.botSummary}
            </p>
          </div>
        )}
        {card.notes && (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              הערות
            </div>
            <p className="text-xs whitespace-pre-wrap line-clamp-3">
              {card.notes}
            </p>
          </div>
        )}
        {card.lastInboundText && (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              הודעה אחרונה מהלקוח
            </div>
            <p className="text-xs whitespace-pre-wrap line-clamp-3 bg-background/50 rounded p-1.5 mt-1">
              {card.lastInboundText}
            </p>
          </div>
        )}
        {card.quoteTotal && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">הצעת מחיר</span>
            <span className="tabular-nums font-medium">
              ₪{card.quoteTotal}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
