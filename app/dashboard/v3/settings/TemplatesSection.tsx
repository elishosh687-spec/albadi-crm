"use client";

import { useEffect, useState, useTransition } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  listTemplatesAction,
  saveTemplateAction,
  deleteTemplateAction,
  type TemplateRow,
} from "@/app/actions/v2";

const EMPTY_FORM = {
  id: undefined as number | undefined,
  name: "",
  type: "text" as "text" | "cta_url",
  body: "",
  headerType: "" as string,
  mediaId: "",
  ctaLabel: "",
  ctaUrl: "",
  sortOrder: "0",
};

export function TemplatesSection() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [form, setForm] = useState<typeof EMPTY_FORM | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const reload = () => {
    listTemplatesAction().then((r) => {
      if (r.ok) setTemplates(r.templates ?? []);
    });
  };

  useEffect(() => {
    reload();
  }, []);

  const openAdd = () => {
    setMsg(null);
    setForm({ ...EMPTY_FORM });
  };

  const openEdit = (t: TemplateRow) => {
    setMsg(null);
    setForm({
      id: t.id,
      name: t.name,
      type: t.type as "text" | "cta_url",
      body: t.body,
      headerType: t.headerType ?? "",
      mediaId: t.mediaId ?? "",
      ctaLabel: t.ctaLabel ?? "",
      ctaUrl: t.ctaUrl ?? "",
      sortOrder: String(t.sortOrder),
    });
  };

  const save = () => {
    if (!form) return;
    setMsg(null);
    startTransition(async () => {
      const r = await saveTemplateAction({
        id: form.id,
        name: form.name,
        type: form.type,
        body: form.body,
        headerType: form.headerType || null,
        mediaId: form.mediaId || null,
        ctaLabel: form.ctaLabel || null,
        ctaUrl: form.ctaUrl || null,
        sortOrder: Number(form.sortOrder) || 0,
      });
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נשמר" : r.error ?? "כשל" });
      if (r.ok) {
        setForm(null);
        reload();
      }
    });
  };

  const confirmDelete = (id: number) => {
    setConfirmDeleteId(id);
  };

  const doDelete = () => {
    if (confirmDeleteId === null) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    setMsg(null);
    startTransition(async () => {
      const r = await deleteTemplateAction(id);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? "נמחק" : r.error ?? "כשל" });
      if (r.ok) reload();
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">תבניות הודעה</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            תבניות לשליחה ידנית ללידים מתוך לוח הבקרה.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-3.5" />
          הוסף תבנית
        </button>
      </div>

      {msg && (
        <p
          className={cn(
            "text-xs rounded-md px-3 py-2",
            msg.ok
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-rose-500/10 text-rose-400"
          )}
        >
          {msg.text}
        </p>
      )}

      {confirmDeleteId !== null && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center justify-between gap-3">
          <span>למחוק את התבנית? פעולה בלתי הפיכה.</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={doDelete}
              disabled={isPending}
              className="rounded px-2 py-1 bg-rose-500/20 hover:bg-rose-500/30 font-medium"
            >
              מחק
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteId(null)}
              className="rounded px-2 py-1 hover:bg-secondary"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {form && (
        <div className="rounded-xl border border-border bg-background/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              {form.id ? "עריכת תבנית" : "תבנית חדשה"}
            </span>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })}
              placeholder="שם התבנית (לתצוגה פנימית)"
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => f && { ...f, type: "text" })}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                  form.type === "text"
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                טקסט
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => f && { ...f, type: "cta_url" })}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                  form.type === "cta_url"
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                CTA
              </button>
            </div>
          </div>

          <textarea
            value={form.body}
            onChange={(e) => setForm((f) => f && { ...f, body: e.target.value })}
            placeholder="גוף ההודעה"
            rows={4}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 resize-none"
          />

          {form.type === "cta_url" && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-[11px] text-muted-foreground">
                פרטי CTA (כפתור + header)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={form.headerType}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, headerType: e.target.value })
                  }
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">ללא header</option>
                  <option value="video">וידאו</option>
                  <option value="image">תמונה</option>
                </select>
                <input
                  value={form.mediaId}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, mediaId: e.target.value })
                  }
                  placeholder="Media ID (bridge)"
                  dir="ltr"
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <input
                  value={form.ctaLabel}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, ctaLabel: e.target.value })
                  }
                  placeholder="טקסט כפתור CTA"
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <input
                  value={form.ctaUrl}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, ctaUrl: e.target.value })
                  }
                  placeholder="URL יעד"
                  dir="ltr"
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="number"
              value={form.sortOrder}
              onChange={(e) =>
                setForm((f) => f && { ...f, sortOrder: e.target.value })
              }
              placeholder="סדר (0=ראשון)"
              className="w-24 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              שמור
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              disabled={isPending}
              className="rounded-md border border-border px-4 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-60"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          אין תבניות עדיין — הוסף את הראשונה.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-right pb-2 font-medium">שם</th>
                <th className="text-right pb-2 font-medium">סוג</th>
                <th className="text-right pb-2 font-medium hidden sm:table-cell">
                  תצוגה מקדימה
                </th>
                <th className="pb-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  className={cn(
                    "border-b border-border/50 hover:bg-secondary/30",
                    !t.active && "opacity-50"
                  )}
                >
                  <td className="py-2 pr-0 font-medium">{t.name}</td>
                  <td className="py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        t.type === "cta_url"
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {t.type === "cta_url" ? "CTA" : "טקסט"}
                    </span>
                  </td>
                  <td className="py-2 hidden sm:table-cell text-muted-foreground max-w-[240px] truncate">
                    {t.body.slice(0, 80)}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                        title="ערוך"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDelete(t.id)}
                        className="p-1 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400"
                        title="מחק"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
