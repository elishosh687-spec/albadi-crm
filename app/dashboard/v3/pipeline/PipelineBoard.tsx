"use client";

import { useMemo, useState } from "react";
import { Pause, Play, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { STAGE_LABEL, STAGE_TONE, timeAgoHe } from "../_components/stage-meta";

export interface PipelineCard {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string;
  flag: string | null;
  botPaused: boolean;
  botSummary: string | null;
  quoteTotal: string | null;
  lastInboundText: string | null;
  lastInboundAt: string | null;
  updatedAt: string;
}

export function PipelineBoard({
  cards,
  stages,
}: {
  cards: PipelineCard[];
  stages: string[];
}) {
  const [showClosed, setShowClosed] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, PipelineCard[]>();
    for (const s of stages) map.set(s, []);
    for (const c of cards) {
      const key = (c.stage || "UNCLASSIFIED").toUpperCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [cards, stages]);

  const visibleStages = useMemo(
    () =>
      stages.filter((s) => {
        if (!showClosed && (s === "WON" || s === "DROPPED")) return false;
        return (grouped.get(s)?.length ?? 0) > 0;
      }),
    [stages, grouped, showClosed]
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-3xl font-medium tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            תצוגת kanban מפורטת — 11 שלבים של הבוט. Drag-drop יגיע בעדכון הבא.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
            className="rounded border-border bg-card"
          />
          הראה סגורים (WON / DROPPED)
        </label>
      </header>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-200 flex items-start gap-2">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        <span>
          לעריכת stage של ליד — חזרו ל-<a href="/dashboard/v3" className="underline">סקירה</a> ולחצו על הליד. Drag-drop בתצוגה זו יופעל אחרי השלמת ה-toggle ב-Settings.
        </span>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
        {visibleStages.map((stage) => (
          <StageColumn
            key={stage}
            stage={stage}
            cards={grouped.get(stage) ?? []}
          />
        ))}
      </div>
    </div>
  );
}

function StageColumn({
  stage,
  cards,
}: {
  stage: string;
  cards: PipelineCard[];
}) {
  const tone = STAGE_TONE[stage] ?? STAGE_TONE.UNCLASSIFIED;
  return (
    <section className="shrink-0 w-72 flex flex-col rounded-xl border border-border bg-card/40 backdrop-blur">
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("inline-block size-2 rounded-full", tone.bar)} />
          <h2 className="text-sm font-medium truncate">
            {STAGE_LABEL[stage] ?? stage}
          </h2>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {cards.length}
        </span>
      </header>
      <div className="flex flex-col gap-2 p-3 max-h-[75dvh] overflow-y-auto">
        {cards.map((c) => (
          <PipelineLeadCard key={c.sid} card={c} />
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

function PipelineLeadCard({ card }: { card: PipelineCard }) {
  const tone = STAGE_TONE[card.stage.toUpperCase()] ?? STAGE_TONE.UNCLASSIFIED;
  const needsEli = card.flag === "NEEDS_ELI";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-3",
        needsEli && "ring-1 ring-destructive/30"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {card.name || card.phone || card.sid}
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
        {card.quoteTotal && (
          <span
            className={cn(
              "text-[10px] rounded-full px-1.5 py-0.5 tabular-nums shrink-0",
              tone.pill
            )}
          >
            ₪{card.quoteTotal}
          </span>
        )}
      </div>
      {card.lastInboundText && (
        <p className="text-xs text-muted-foreground line-clamp-2 text-right">
          {card.lastInboundText}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        {needsEli ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.5">
            <AlertCircle className="size-2.5" />
            צריך אותך
          </span>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {timeAgoHe(card.lastInboundAt ?? card.updatedAt)}
        </span>
      </div>
    </div>
  );
}
