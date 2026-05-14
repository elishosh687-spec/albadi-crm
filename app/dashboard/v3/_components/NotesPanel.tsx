"use client";

import { useState, useTransition } from "react";
import { StickyNote, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { appendLeadNote } from "@/app/actions/v2";

// Renders the read-only note log + a "add new note" input. Notes are stored
// in leads.notes as a single text column with per-entry timestamp prefixes
// (see appendLeadNote in app/actions/v2.ts). New entries land on top.
//
// Used in:
//   - ExpandedLead (full lead page)
//   - OrderSummary side panel (conversations view)
export function NotesPanel({
  sid,
  initialNotes,
  compact = false,
}: {
  sid: string;
  initialNotes: string | null;
  compact?: boolean;
}) {
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    setErr(null);
    startTransition(async () => {
      const r = await appendLeadNote(sid, t);
      if (r.ok) {
        setNotes(r.notes);
        setDraft("");
      } else {
        setErr(r.error);
      }
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter submits — same convention as the chat composer.
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card",
        compact ? "p-3 space-y-2" : "p-4 space-y-3"
      )}
    >
      <header className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <StickyNote className="size-3.5" />
        הערות
      </header>

      {notes ? (
        <div
          className={cn(
            "rounded-lg border border-border/60 bg-background/40 p-3 text-sm whitespace-pre-wrap leading-relaxed",
            compact ? "max-h-40" : "max-h-72",
            "overflow-y-auto"
          )}
        >
          {notes}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic px-1">
          אין הערות עדיין.
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={compact ? 2 : 3}
          placeholder="הוסף הערה חדשה… (Ctrl+Enter לשליחה)"
          className="w-full bg-background/50 border border-border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            תיווסף עם חותמת תאריך/שעה אוטומטית
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !draft.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3" />
            )}
            הוסף הערה
          </button>
        </div>
        {err && (
          <div className="text-xs text-destructive">שגיאה: {err}</div>
        )}
      </div>
    </section>
  );
}
