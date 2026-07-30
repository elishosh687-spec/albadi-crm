"use client";

/**
 * Message-templates editor for the WIDGET settings screen. The dashboard-v3
 * TemplatesSection is dead (widget-only now), so this is the live place to
 * add / edit / reorder / enable message templates — the ones that show up
 * under "תבניות" in the שיחות inbox and get sent in one click.
 *
 * Reuses the same server actions as v3 (list/save/delete). They carry no auth
 * of their own — the widget page is already gated by widget_token.
 */

import { useEffect, useState, useTransition } from "react";
import { Mail, Plus, Pencil, Trash2, X, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  listTemplatesAction,
  saveTemplateAction,
  deleteTemplateAction,
  type TemplateRow,
} from "@/app/actions/v2";

const TYPE_LABEL: Record<string, string> = {
  text: "טקסט",
  cta_url: "כפתור קישור",
  restart_questionnaire: "שאלון מחדש",
};

type Draft = {
  id?: number;
  name: string;
  type: string;
  body: string;
  sortOrder: number;
  active: boolean;
  // preserved silently so editing a media/CTA template never wipes it
  headerType: string | null;
  mediaId: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

const EMPTY: Draft = {
  name: "",
  type: "text",
  body: "",
  sortOrder: 0,
  active: true,
  headerType: null,
  mediaId: null,
  ctaLabel: null,
  ctaUrl: null,
};

export function TemplatesManager() {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const reload = () => {
    setLoading(true);
    listTemplatesAction().then((r) => {
      if (r.ok) setTemplates(r.templates ?? []);
      setLoading(false);
    });
  };
  useEffect(() => {
    reload();
  }, []);

  const openNew = () => {
    setMsg(null);
    const nextSort = templates.length
      ? Math.max(...templates.map((t) => t.sortOrder ?? 0)) + 5
      : 0;
    setDraft({ ...EMPTY, sortOrder: nextSort });
  };
  const openEdit = (t: TemplateRow) => {
    setMsg(null);
    setDraft({
      id: t.id,
      name: t.name,
      type: t.type,
      body: t.body,
      sortOrder: t.sortOrder ?? 0,
      active: t.active,
      headerType: t.headerType ?? null,
      mediaId: t.mediaId ?? null,
      ctaLabel: t.ctaLabel ?? null,
      ctaUrl: t.ctaUrl ?? null,
    });
  };

  const save = () => {
    if (!draft) return;
    if (!draft.name.trim()) return setMsg({ ok: false, text: "שם חסר" });
    if (!draft.body.trim()) return setMsg({ ok: false, text: "גוף ההודעה חסר" });
    start(async () => {
      const r = await saveTemplateAction({
        id: draft.id,
        name: draft.name,
        type: draft.type,
        body: draft.body,
        sortOrder: draft.sortOrder,
        active: draft.active,
        headerType: draft.headerType,
        mediaId: draft.mediaId,
        ctaLabel: draft.ctaLabel,
        ctaUrl: draft.ctaUrl,
      });
      if (r.ok) {
        setDraft(null);
        setMsg({ ok: true, text: "נשמר" });
        reload();
      } else {
        setMsg({ ok: false, text: r.error ?? "שגיאה בשמירה" });
      }
    });
  };

  const remove = (id: number) => {
    start(async () => {
      const r = await deleteTemplateAction(id);
      if (r.ok) {
        setConfirmDelete(null);
        setMsg({ ok: true, text: "נמחק" });
        reload();
      } else {
        setMsg({ ok: false, text: r.error ?? "שגיאה במחיקה" });
      }
    });
  };

  return (
    <div className="rounded-xl border border-border/70 bg-background/20 p-4" dir="rtl">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-right"
        >
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground shrink-0 transition-transform",
              open ? "" : "-rotate-90"
            )}
          />
          <span
            className="grid place-items-center size-7 rounded-lg shrink-0"
            style={{
              background: "rgba(190,198,224,0.12)",
              color: "#bec6e0",
              boxShadow: "inset 0 0 0 1px rgba(190,198,224,0.22)",
            }}
          >
            <Mail className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">תבניות הודעה</h3>
            <p className="text-[11px] text-muted-foreground leading-tight">
              ההודעות שנשלחות בקליק מלשונית שיחות · ערוך נוסח, הוסף או כבה
            </p>
          </div>
        </button>
        {open && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1 text-xs rounded-md border border-border bg-background/40 px-2 py-1 hover:bg-secondary shrink-0"
          >
            <Plus className="size-3" />
            תבנית
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
              <Loader2 className="size-3 animate-spin" /> טוען…
            </div>
          ) : templates.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border rounded-md">
              אין תבניות עדיין. הוסף אחת.
            </p>
          ) : (
            templates.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{t.name}</span>
                    {!t.active && (
                      <span className="text-[10px] rounded px-1 py-0.5 bg-background/60 text-muted-foreground border border-border/60">
                        כבוי
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {TYPE_LABEL[t.type] ?? t.type} · #{t.sortOrder}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {t.body.replace(/\n/g, " ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  title="ערוך"
                  className="grid place-items-center size-7 rounded-md border border-border/60 hover:bg-secondary shrink-0"
                >
                  <Pencil className="size-3.5" />
                </button>
                {confirmDelete === t.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => remove(t.id)}
                      disabled={pending}
                      className="text-[11px] rounded-md px-2 py-1 bg-destructive/20 text-destructive border border-destructive/40"
                    >
                      מחק
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="grid place-items-center size-7 rounded-md border border-border/60 hover:bg-secondary"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(t.id)}
                    title="מחק"
                    className="grid place-items-center size-7 rounded-md border border-border/60 hover:bg-secondary shrink-0"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))
          )}

          {msg && (
            <span className={cn("text-xs", msg.ok ? "text-success" : "text-destructive")}>
              {msg.text}
            </span>
          )}
        </div>
      )}

      {/* Edit / add drawer */}
      {draft && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
          onClick={() => setDraft(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "#1b1917", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">
                {draft.id ? "עריכת תבנית" : "תבנית חדשה"}
              </h4>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="grid place-items-center size-7 rounded-md border border-border/60 hover:bg-secondary"
              >
                <X className="size-4" />
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">שם התבנית</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="למשל: 📝 בריף הזמנה"
                className="w-full bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">נוסח ההודעה</span>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={9}
                className="w-full bg-background/50 border border-border rounded-md px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/30"
                style={{ whiteSpace: "pre-wrap" }}
              />
              <span className="text-[10px] text-muted-foreground">
                כוכביות *מדגישות* טקסט בוואטסאפ. שורות חדשות נשמרות.
              </span>
            </label>

            <div className="flex items-center gap-3">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-[11px] text-muted-foreground">סוג</span>
                <select
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                  className="w-full bg-background/50 border border-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                >
                  <option value="text">טקסט</option>
                  <option value="cta_url">כפתור קישור</option>
                  <option value="restart_questionnaire">שאלון מחדש</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 w-24">
                <span className="text-[11px] text-muted-foreground">סדר</span>
                <input
                  type="number"
                  value={draft.sortOrder}
                  onChange={(e) =>
                    setDraft({ ...draft, sortOrder: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </label>
            </div>

            {draft.type === "cta_url" && (
              <div className="flex items-center gap-3">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-[11px] text-muted-foreground">טקסט הכפתור</span>
                  <input
                    value={draft.ctaLabel ?? ""}
                    onChange={(e) => setDraft({ ...draft, ctaLabel: e.target.value })}
                    className="w-full bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </label>
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-[11px] text-muted-foreground">קישור</span>
                  <input
                    value={draft.ctaUrl ?? ""}
                    onChange={(e) => setDraft({ ...draft, ctaUrl: e.target.value })}
                    dir="ltr"
                    className="w-full bg-background/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </label>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              <span>פעילה (מוצגת ברשימת התבניות)</span>
            </label>

            {msg && !msg.ok && (
              <span className="text-xs text-destructive">{msg.text}</span>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="lux-cta-champagne"
                style={{ minHeight: 40, padding: "0 18px", fontSize: 14 }}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                שמור
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-sm rounded-md border border-border/60 px-4 py-2 hover:bg-secondary"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
