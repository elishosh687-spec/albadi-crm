"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  Banknote,
  FileText,
  Pencil,
  ChevronDown,
  Factory,
  CalendarClock,
  Tag as TagIcon,
} from "lucide-react";
import { STAGE_LABEL, STAGE_TONE } from "@/app/dashboard/v3/_components/stage-meta";

export interface OrderSummaryWidgetData {
  sid: string | null;
  name: string | null;
  phone: string | null;
  leadSource: string | null;
  stage: string | null;
  flag: string | null;
  flags: string[];
  botPaused: boolean;
  botSummary: string | null;
  notes: string | null;
  quoteTotal: string | null;
  quoteAlt: string | null;
  qState: Record<string, unknown> | null;
  factorySpecDraft: Record<string, unknown> | null;
  followUpDate: string | null;
}

export function OrderSummaryView({ data }: { data: OrderSummaryWidgetData }) {
  const stage = (data.stage ?? "NEW").toUpperCase();
  const tone = STAGE_TONE[stage] ?? STAGE_TONE.UNCLASSIFIED;
  const hasAnyData = !!(
    data.botSummary ||
    data.notes ||
    data.quoteTotal ||
    data.qState ||
    data.factorySpecDraft
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <ContactHeaderReadOnly name={data.name} phone={data.phone}>
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
              className="text-[10px] rounded-full border border-primary/30 bg-primary/10 text-primary px-2 py-0.5 inline-flex items-center gap-1"
            >
              <TagIcon className="size-2.5" />
              {f}
            </span>
          ))}
          {data.leadSource && (
            <span className="text-[10px] rounded-full border border-border bg-background/40 text-muted-foreground px-2 py-0.5">
              {data.leadSource}
            </span>
          )}
        </div>
      </ContactHeaderReadOnly>

      {data.followUpDate && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/40 border border-border/60 rounded-lg px-3 py-2">
          <CalendarClock className="size-3.5" />
          <span>תאריך מעקב:</span>
          <span className="text-foreground tabular-nums">{data.followUpDate}</span>
        </div>
      )}

      {(data.quoteTotal || data.quoteAlt) && (
        <CollapsibleSection
          icon={<Banknote className="size-3.5" />}
          title="מחירים (מהבוט)"
          defaultOpen
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

      {data.qState && Object.keys(data.qState).length > 0 && (
        <CollapsibleSection
          icon={<FileText className="size-3.5" />}
          title="מפרט השאלון (q_state)"
        >
          <SpecGrid spec={data.qState} />
        </CollapsibleSection>
      )}

      {data.factorySpecDraft && (
        <CollapsibleSection
          icon={<Factory className="size-3.5" />}
          title="טיוטת מפרט למפעל"
        >
          <SpecGrid spec={data.factorySpecDraft} />
        </CollapsibleSection>
      )}

      {data.botSummary && (
        <CollapsibleSection
          icon={<FileText className="size-3.5" />}
          title="סיכום הבוט"
          defaultOpen
        >
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {data.botSummary}
          </p>
        </CollapsibleSection>
      )}

      {data.notes && (
        <CollapsibleSection
          icon={<Pencil className="size-3.5" />}
          title="הערות פנימיות"
        >
          <p className="text-sm text-foreground whitespace-pre-wrap">{data.notes}</p>
          <p className="mt-2 text-[10px] text-muted-foreground">
            עריכה ב-GHL Notes (native).
          </p>
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

function ContactHeaderReadOnly({
  name,
  phone,
  children,
}: {
  name: string | null;
  phone: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="text-xl font-medium truncate"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {name || (
          <span className="text-muted-foreground italic font-normal">ללא שם</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5" dir="ltr">
        {phone || <span className="italic">ללא טלפון</span>}
      </div>
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

function SpecGrid({ spec }: { spec: Record<string, unknown> }) {
  const entries = Object.entries(spec).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground">ריק</div>;
  }
  return (
    <dl className="text-sm divide-y divide-border/60">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 py-1.5">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="text-sm text-right break-all">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
