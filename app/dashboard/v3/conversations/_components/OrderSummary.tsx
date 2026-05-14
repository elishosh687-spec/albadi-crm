"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import {
  Banknote,
  ClipboardList,
  FileText,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { STAGE_LABEL, STAGE_TONE } from "../../_components/stage-meta";
import { updateLeadContactAction } from "@/app/actions/v2";
import { NotesPanel } from "../../_components/NotesPanel";

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
}

// Friendly labels for known qState keys. Anything else falls through with the
// raw key, in case the questionnaire grew new fields.
const Q_LABEL: Record<string, string> = {
  step: "שלב בשאלון",
  shipping: "משלוח",
  quantity: "כמות",
  product: "מוצר",
  handles: "ידיות",
  colors: "צבעים",
  quoteResult: "תוצאת הצעה",
  doneAt: "הושלם בתאריך",
  bailed: "ננטש",
  decisionState: "מצב החלטה",
  finalState: "מצב סופי",
};

function formatQValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => formatQValue(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function OrderSummary({
  data,
  sid,
}: {
  data: OrderSummaryData;
  sid?: string;
}) {
  const stage = (data.stage ?? "UNCLASSIFIED").toUpperCase();
  const tone = STAGE_TONE[stage] ?? STAGE_TONE.UNCLASSIFIED;
  const qEntries = data.qState
    ? Object.entries(data.qState).filter(
        ([k, v]) => v !== null && v !== undefined && v !== "" && k !== "step"
      )
    : [];
  const step = (data.qState?.step as number | undefined) ?? null;

  return (
    <div className="flex flex-col gap-4">
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

      {(data.quoteTotal || data.quoteAlt) && (
        <Section
          icon={<Banknote className="size-3.5" />}
          title="מחירים"
        >
          <dl className="text-sm divide-y divide-border/60">
            {data.quoteTotal && (
              <Row label="הצעה ראשית" value={`₪${data.quoteTotal}`} highlight />
            )}
            {data.quoteAlt && (
              <Row label="הצעה משנית" value={`₪${data.quoteAlt}`} />
            )}
          </dl>
        </Section>
      )}

      {(qEntries.length > 0 || step) && (
        <Section
          icon={<ClipboardList className="size-3.5" />}
          title={`תשובות השאלון${step ? ` (שלב ${step})` : ""}`}
        >
          <dl className="text-sm divide-y divide-border/60">
            {qEntries.map(([k, v]) => (
              <Row key={k} label={Q_LABEL[k] ?? k} value={formatQValue(v)} />
            ))}
          </dl>
        </Section>
      )}

      {data.botSummary && (
        <Section
          icon={<FileText className="size-3.5" />}
          title="סיכום הבוט"
        >
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {data.botSummary}
          </p>
        </Section>
      )}

      {sid && (
        <NotesPanel sid={sid} initialNotes={data.notes} compact />
      )}

      {!data.botSummary &&
        !data.notes &&
        qEntries.length === 0 &&
        !data.quoteTotal && (
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
  const editable = !!sid;
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(name ?? "");
  const [phoneDraft, setPhoneDraft] = useState(phone ?? "");
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

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
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0"
            title="ערוך פרטי קשר"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-2">
        {icon}
        {title}
      </header>
      {children}
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
