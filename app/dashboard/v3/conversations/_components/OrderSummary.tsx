"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  Banknote,
  FileText,
  Pencil,
  Check,
  X,
  ChevronDown,
  Trash2,
  Loader2,
  History,
} from "lucide-react";
import { STAGE_LABEL, STAGE_TONE } from "../../_components/stage-meta";
import { deleteLeadAction, updateLeadContactAction } from "@/app/actions/v2";
import { NotesPanel } from "../../_components/NotesPanel";
import { FactoryQuotePanel } from "../../_components/factory/FactoryQuotePanel";

export interface OrderSummaryData {
  name: string | null;
  phone: string | null;
  stage: string | null;
  flag: string | null;
  flags: string[];
  botPaused: boolean;
  botSummary: string | null;
  notes: string | null;
  quoteTotal: string | null;
  quoteAlt: string | null;
  qState: Record<string, unknown> | null;
  factorySpecDraft?: Record<string, unknown> | null;
}

/**
 * Right-pane summary for the per-lead view. Sections are collapsible so the
 * panel stays compact; Contact header is always visible at the top.
 *
 * The questionnaire spec view (decoded product/qty/handles/etc.) lives inside
 * FactoryQuotePanel — that panel is now the single source of truth for the
 * factory-quote flow (manual override, notes, send to Feishu).
 */
export function OrderSummary({
  data,
  sid,
}: {
  data: OrderSummaryData;
  sid?: string;
}) {
  const stage = (data.stage ?? "UNCLASSIFIED").toUpperCase();
  const tone = STAGE_TONE[stage] ?? STAGE_TONE.UNCLASSIFIED;
  const hasAnyData = !!(
    data.botSummary ||
    data.notes ||
    data.quoteTotal ||
    data.qState
  );

  return (
    <div className="flex flex-col gap-3">
      <ContactHeader sid={sid} name={data.name} phone={data.phone}>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={cn("text-[10px] rounded-full px-2 py-0.5", tone.pill)}>
            {STAGE_LABEL[stage] ?? stage}
          </span>
          {data.flag === "NEEDS_ELI" && (
            <span className="text-[10px] rounded-full px-2 py-0.5 bg-destructive/15 text-destructive border border-destructive/30">
              דורש אותך
            </span>
          )}
          {data.botPaused && (
            <span className="text-[10px] rounded-full px-2 py-0.5 bg-warning/15 text-warning border border-warning/30">
              bot paused
            </span>
          )}
          {data.flags.map((f) => (
            <span
              key={f}
              className="text-[10px] rounded-full border border-border bg-background/40 text-muted-foreground px-2 py-0.5"
            >
              {f}
            </span>
          ))}
        </div>
      </ContactHeader>

      {sid && (
        <FactoryQuotePanel
          leadId={sid}
          leadName={data.name}
          qState={data.qState}
          factorySpecDraft={data.factorySpecDraft ?? null}
        />
      )}

      {(data.quoteTotal || data.quoteAlt) && (
        <CollapsibleSection
          icon={<Banknote className="size-3.5" />}
          title="מחירים (מהבוט)"
        >
          <dl className="text-sm divide-y divide-border/60">
            {data.quoteTotal && (
              <Row label="הצעה ראשית" value={`₪${data.quoteTotal}`} highlight />
            )}
            {data.quoteAlt && (
              <Row label="הצעה משנית" value={`₪${data.quoteAlt}`} />
            )}
          </dl>
        </CollapsibleSection>
      )}

      {sid && (
        <CollapsibleSection
          icon={<History className="size-3.5" />}
          title="היסטוריית הצעות"
        >
          <QuoteHistory sid={sid} />
        </CollapsibleSection>
      )}

      {data.botSummary && (
        <CollapsibleSection
          icon={<FileText className="size-3.5" />}
          title="סיכום הבוט"
        >
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {data.botSummary}
          </p>
        </CollapsibleSection>
      )}

      {sid && (
        <CollapsibleSection
          icon={<Pencil className="size-3.5" />}
          title="הערות פנימיות"
        >
          <NotesPanel sid={sid} initialNotes={data.notes} compact />
        </CollapsibleSection>
      )}

      {!hasAnyData && (
        <div className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">
          עוד אין מספיק מידע לסיכום הזמנה. ככל שהשיחה מתקדמת — השלבים, המחירים והתשובות יופיעו פה.
        </div>
      )}
    </div>
  );
}

function ContactHeader({
  sid,
  name,
  phone,
  children,
}: {
  sid: string | undefined;
  name: string | null;
  phone: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const editable = !!sid;
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(name ?? "");
  const [phoneDraft, setPhoneDraft] = useState(phone ?? "");
  const [isPending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const handleDeleteLead = () => {
    if (!sid) return;
    const label = name || phone || sid;
    if (!confirm(`למחוק את הליד "${label}"? פעולה לא הפיכה.`)) return;
    setErr(null);
    startDelete(async () => {
      const r = await deleteLeadAction(sid);
      if (r.ok) {
        router.push("/dashboard/v3/conversations");
        router.refresh();
      } else {
        setErr(r.error ?? "מחיקה נכשלה");
      }
    });
  };

  const save = () => {
    if (!sid) return;
    setErr(null);
    startTransition(async () => {
      const r = await updateLeadContactAction(sid, {
        name: nameDraft,
        phone: phoneDraft,
      });
      if (r.ok) {
        setEditing(false);
      } else {
        setErr(r.error ?? "כשל");
      }
    });
  };

  const cancel = () => {
    setNameDraft(name ?? "");
    setPhoneDraft(phone ?? "");
    setEditing(false);
    setErr(null);
  };

  if (editing && editable) {
    return (
      <div className="flex flex-col gap-2">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder="שם הלקוח"
          autoFocus
          className="bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <input
          value={phoneDraft}
          onChange={(e) => setPhoneDraft(e.target.value)}
          placeholder="טלפון (E.164: 972...)"
          dir="ltr"
          inputMode="tel"
          className="bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Check className="size-3" />
            שמור
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs hover:bg-secondary"
          >
            <X className="size-3" />
            ביטול
          </button>
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div
            className="text-xl font-medium truncate"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {name || (
              <span className="text-muted-foreground italic font-normal">
                ללא שם — לחץ לעריכה
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {phone || (
              <span className="italic">לחץ לעריכה והוסף טלפון</span>
            )}
          </div>
        </div>
        {editable && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
              title="ערוך פרטי קשר"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDeleteLead}
              disabled={deleting}
              className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-60"
              title="מחק ליד"
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
            </button>
          </div>
        )}
      </div>
      {err && (
        <div className="text-[11px] text-destructive mt-1">{err}</div>
      )}
      {children}
    </div>
  );
}

function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <div className="px-4 pb-4 pt-0">{children}</div>}
    </section>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm text-right tabular-nums",
          highlight && "text-success font-medium"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

interface BotQuoteRow {
  id: number;
  source: "initial" | "requote";
  qState: Record<string, unknown>;
  quoteText: string;
  quoteTotalIls: number | null;
  quoteAltTotalIls: number | null;
  sentAt: string;
}

function QuoteHistory({ sid }: { sid: string }) {
  const [rows, setRows] = useState<BotQuoteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/leads/${encodeURIComponent(sid)}/quotes`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setErr(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setRows(data.quotes ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid]);

  if (err) {
    return <div className="text-xs text-destructive">שגיאה: {err}</div>;
  }
  if (!rows) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin" />
        טוען…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        עוד לא נשלחו הצעות בוט ללקוח.
      </div>
    );
  }

  const fmt = (n: number | null) =>
    n === null ? "—" : `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("he-IL", {
      dateStyle: "short",
      timeStyle: "short",
    });
  const sourceLabel = (s: "initial" | "requote") =>
    s === "initial" ? "ראשונית" : "עדכון";

  // Compute price delta vs. the immediately-newer quote in the list (rows are
  // sorted DESC by sentAt). Lets the operator see "this requote was +200 ILS
  // higher than the previous one" at a glance.
  const deltas = rows.map((r, i) => {
    if (i === rows.length - 1) return null;
    const prev = rows[i + 1];
    if (r.quoteTotalIls === null || prev.quoteTotalIls === null) return null;
    return r.quoteTotalIls - prev.quoteTotalIls;
  });

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const isOpen = expanded === r.id;
        const delta = deltas[i];
        return (
          <li
            key={r.id}
            className="rounded-lg border border-border/60 bg-background/40"
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : r.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-right hover:bg-secondary/30 transition-colors"
            >
              <div className="flex flex-col items-start gap-0.5">
                <span
                  className={cn(
                    "text-[10px] rounded-full px-2 py-0.5 border",
                    r.source === "initial"
                      ? "border-success/40 text-success bg-success/10"
                      : "border-warning/40 text-warning bg-warning/10"
                  )}
                >
                  {sourceLabel(r.source)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {fmtDate(r.sentAt)}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-sm font-medium tabular-nums">
                  {fmt(r.quoteTotalIls)}
                </span>
                {delta !== null && delta !== 0 && (
                  <span
                    className={cn(
                      "text-[10px] tabular-nums",
                      delta > 0 ? "text-destructive" : "text-success"
                    )}
                  >
                    {delta > 0 ? "+" : ""}
                    {fmt(delta).replace("₪", "₪")}
                  </span>
                )}
              </div>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 pt-1 border-t border-border/60 flex flex-col gap-2 text-xs">
                {r.quoteAltTotalIls !== null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">הצעה משנית</span>
                    <span className="tabular-nums">{fmt(r.quoteAltTotalIls)}</span>
                  </div>
                )}
                <pre className="whitespace-pre-wrap font-sans text-foreground bg-card rounded-md p-2 border border-border/40 max-h-60 overflow-y-auto">
                  {r.quoteText}
                </pre>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
