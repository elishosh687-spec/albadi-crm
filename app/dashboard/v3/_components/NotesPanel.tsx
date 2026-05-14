"use client";

import { useMemo, useState, useTransition } from "react";
import { StickyNote, Plus, Loader2, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  appendLeadNote,
  deleteLeadNoteAt,
  updateLeadNoteAt,
} from "@/app/actions/v2";

// Renders one card per timestamped entry (newest on top), with edit + delete
// affordances. Storage stays as a single text column in leads.notes; entries
// are joined by "\n\n" and each starts with "[DD/MM/YYYY HH:mm] " — see
// appendLeadNote in app/actions/v2.ts.
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

  const entries = useMemo(() => parseNoteEntries(notes), [notes]);

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

      {entries.length > 0 ? (
        <ul
          className={cn(
            "space-y-1.5",
            compact ? "max-h-40" : "max-h-72",
            "overflow-y-auto pr-1"
          )}
        >
          {entries.map((entry, idx) => (
            <NoteEntryCard
              key={`${idx}-${entry.slice(0, 32)}`}
              sid={sid}
              index={idx}
              entry={entry}
              onUpdated={(next) => setNotes(next)}
            />
          ))}
        </ul>
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

function NoteEntryCard({
  sid,
  index,
  entry,
  onUpdated,
}: {
  sid: string;
  index: number;
  entry: string;
  onUpdated: (nextNotes: string) => void;
}) {
  const { stamp, body } = splitEntry(entry);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startEdit = () => {
    setDraft(body);
    setErr(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(body);
    setErr(null);
    setEditing(false);
  };

  const save = () => {
    const t = draft.trim();
    if (!t) {
      setErr("טקסט ריק");
      return;
    }
    setErr(null);
    startTransition(async () => {
      const r = await updateLeadNoteAt(sid, index, t);
      if (r.ok) {
        onUpdated(r.notes);
        setEditing(false);
      } else {
        setErr(r.error);
      }
    });
  };

  const remove = () => {
    if (!confirm("למחוק הערה זו?")) return;
    setErr(null);
    startTransition(async () => {
      const r = await deleteLeadNoteAt(sid, index);
      if (r.ok) {
        onUpdated(r.notes);
      } else {
        setErr(r.error);
      }
    });
  };

  return (
    <li className="group rounded-lg border border-border/60 bg-background/40 p-2.5 text-sm">
      {editing ? (
        <div className="flex flex-col gap-1.5">
          {stamp && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {stamp.replace(/\s+$/, "")}
            </span>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            disabled={isPending}
            className="w-full bg-background/60 border border-border rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              שמור
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2.5 py-1 text-xs hover:bg-secondary disabled:opacity-60"
            >
              <X className="size-3" />
              ביטול
            </button>
            {err && (
              <span className="text-[10px] text-destructive">{err}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {stamp && (
              <div className="text-[10px] text-muted-foreground tabular-nums mb-0.5">
                {stamp.replace(/\s+$/, "")}
              </div>
            )}
            <div className="whitespace-pre-wrap leading-relaxed">{body}</div>
            {err && (
              <div className="text-[10px] text-destructive mt-1">{err}</div>
            )}
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
            <button
              type="button"
              onClick={startEdit}
              disabled={isPending}
              className="size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-60"
              title="ערוך הערה"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={isPending}
              className="size-6 rounded grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-60"
              title="מחק הערה"
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function parseNoteEntries(blob: string): string[] {
  if (!blob) return [];
  return blob.split(/\n\n(?=\[)/g).filter((s) => s.length > 0);
}

function splitEntry(entry: string): { stamp: string; body: string } {
  const m = entry.match(/^(\[[^\]]+\]\s*)([\s\S]*)$/);
  if (!m) return { stamp: "", body: entry };
  return { stamp: m[1], body: m[2] };
}
