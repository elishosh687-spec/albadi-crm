"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Pause,
  Play,
  AlertCircle,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { STAGE_LABEL, STAGE_TONE, timeAgoHe } from "./stage-meta";
import { LeadDrawer } from "./LeadDrawer";

export interface LeadCardData {
  sid: string;
  name: string | null;
  phone: string | null;
  jid: string | null;
  stage: string;
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

const PRIORITY_ORDER = [
  "NEW",
  "QUOTED",
  "AWAITING_DECISION",
  "NEGOTIATING",
  "AWAITING_FINAL",
  "AWAITING_LOGO",
  "WAITING_CALL",
  "WAITING_FACTORY",
  "IN_PROGRESS",
  "WON",
  "DROPPED",
  "UNCLASSIFIED",
];

export function LeadsBoard({
  cards,
  stagesOrder,
}: {
  cards: LeadCardData[];
  stagesOrder: string[];
}) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [needsEliOnly, setNeedsEliOnly] = useState(false);
  const [selectedSid, setSelectedSid] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (needsEliOnly && c.pipelineFlag !== "NEEDS_ELI" && !c.botPaused) {
        return false;
      }
      if (stageFilter && c.stage.toUpperCase() !== stageFilter) return false;
      if (!s) return true;
      const hay = [
        c.name,
        c.phone,
        c.sid,
        c.botSummary,
        c.notes,
        c.lastInboundText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [cards, search, stageFilter, needsEliOnly]);

  const grouped = useMemo(() => {
    const map = new Map<string, LeadCardData[]>();
    for (const c of filtered) {
      const key = (c.stage || "UNCLASSIFIED").toUpperCase();
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return map;
  }, [filtered]);

  const stagesShown = PRIORITY_ORDER.filter(
    (s) => stagesOrder.includes(s) && (grouped.get(s)?.length ?? 0) > 0
  );

  const selectedLead = selectedSid
    ? cards.find((c) => c.sid === selectedSid) ?? null
    : null;

  const totalShown = filtered.length;
  const needsEliCount = cards.filter(
    (c) => c.pipelineFlag === "NEEDS_ELI" || c.botPaused
  ).length;

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
              {totalShown.toLocaleString("he-IL")} לידים פעילים, מקובצים לפי שלב.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNeedsEliOnly((v) => !v)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors border",
                needsEliOnly
                  ? "bg-destructive/15 border-destructive/40 text-destructive"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              <AlertCircle className="size-3.5" />
              צריך אותך
              <span className="rounded-full bg-background/40 px-1.5 py-0.5">
                {needsEliCount}
              </span>
            </button>
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש שם / טלפון / טקסט…"
                className="w-64 rounded-lg border border-border bg-card pl-3 pr-8 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setStageFilter(null)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors border",
              stageFilter === null
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            הכל ({totalShown})
          </button>
          {stagesShown.map((s) => {
            const count = grouped.get(s)?.length ?? 0;
            const tone = STAGE_TONE[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStageFilter(stageFilter === s ? null : s)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition-colors border",
                  stageFilter === s
                    ? tone.pill
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {STAGE_LABEL[s] ?? s} ({count})
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {stagesShown.map((stage) => (
          <StageColumn
            key={stage}
            stage={stage}
            cards={grouped.get(stage) ?? []}
            onSelect={setSelectedSid}
          />
        ))}
        {stagesShown.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border bg-card/30 p-8 text-center text-sm text-muted-foreground">
            אין לידים שמתאימים לסינון.
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          onClose={() => setSelectedSid(null)}
        />
      )}
    </div>
  );
}

function StageColumn({
  stage,
  cards,
  onSelect,
}: {
  stage: string;
  cards: LeadCardData[];
  onSelect: (sid: string) => void;
}) {
  const tone = STAGE_TONE[stage];
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card/40 backdrop-blur min-h-32">
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("inline-block size-2 rounded-full", tone.bar)} />
          <h2 className="text-sm font-medium truncate">{STAGE_LABEL[stage] ?? stage}</h2>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
      </header>
      <div className="flex flex-col gap-2 p-3 max-h-[70dvh] overflow-y-auto">
        {cards.map((c) => (
          <LeadCard key={c.sid} card={c} onClick={() => onSelect(c.sid)} />
        ))}
        {cards.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">—</div>
        )}
      </div>
    </section>
  );
}

function LeadCard({
  card,
  onClick,
}: {
  card: LeadCardData;
  onClick: () => void;
}) {
  const tone = STAGE_TONE[card.stage.toUpperCase()] ?? STAGE_TONE.UNCLASSIFIED;
  const displayName = card.name || card.phone || card.sid;
  const initials = (displayName ?? "?").trim().slice(0, 2);
  const needsEli = card.pipelineFlag === "NEEDS_ELI";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border border-border/80 bg-card hover:bg-card/70 transition-colors p-3 text-right",
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
            tone.pill
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

      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1 flex-wrap">
          {needsEli && (
            <span className="text-[10px] font-medium rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.5">
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
          {timeAgoHe(card.lastInboundAt ?? card.updatedAt)}
        </span>
      </div>
    </button>
  );
}
