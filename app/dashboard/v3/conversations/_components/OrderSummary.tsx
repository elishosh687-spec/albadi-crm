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
  Package,
  Truck,
  Palette,
  Hash,
  ShoppingBag,
  Receipt,
} from "lucide-react";
import { STAGE_LABEL, STAGE_TONE } from "../../_components/stage-meta";
import { updateLeadContactAction } from "@/app/actions/v2";
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
}

// Bot questionnaire option-code → human label. Source of truth:
// lib/autoresponder/questionnaire.ts QUESTIONS array.
const SHIPPING_LABEL: Record<string, string> = {
  s1: "✈️ אקספרס (~25 יום)",
  s2: "🚢 רגיל (~90 יום)",
};
const QUANTITY_LABEL: Record<string, string> = {
  q0: "1,000 יח׳",
  q1: "3,000 יח׳",
  q2: "5,000 יח׳",
  q3: "10,000 יח׳",
};
const PRODUCT_LABEL: Record<string, string> = {
  p1: "20×8×25 ס״מ — קוסמטיקה, תכשיטים",
  p2: "30×10×30 ס״מ — ביגוד קל, מתנות",
  p3: "40×12×30 ס״מ — נעליים, ביגוד",
  p4: "40×15×50 ס״מ — פריטים גדולים",
  p5: "30×40 ס״מ — פריטים רחבים",
  p6: "20×15 ס״מ — פריטים קטנים",
};

function decodeShipping(v: unknown): string {
  const s = String(v ?? "");
  return SHIPPING_LABEL[s] ?? s;
}
function decodeQuantity(v: unknown, custom: unknown): string {
  const s = String(v ?? "");
  if (s === "custom" && custom) return `${String(custom)} יח׳ (מותאם)`;
  return QUANTITY_LABEL[s] ?? s;
}
function decodeProduct(v: unknown, custom: unknown): string {
  const s = String(v ?? "");
  if (s === "custom" && custom) return `${String(custom)} (מותאם)`;
  return PRODUCT_LABEL[s] ?? s;
}
function decodeHandles(v: unknown): string {
  if (v === true || v === "true") return "עם ידיות";
  if (v === false || v === "false") return "ללא ידיות";
  return "—";
}
function decodeColors(v: unknown): string {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    return n === 1 ? "צבע אחד" : `${n} צבעים`;
  }
  return "—";
}
function formatHebrewDate(iso: unknown): string {
  if (!iso) return "—";
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ParsedQuote {
  primary: { label: string; total: string } | null;
  alternates: { label: string; perUnit: string; total: string }[];
  notes: string[];
}

/**
 * The bot stores quoteResult as a single text blob with `---` separators between
 * the primary quote, alternates, and footer notes. Parse it into structured
 * pieces so we can render each cleanly instead of dumping the raw text.
 */
function parseQuoteResult(raw: unknown): ParsedQuote | null {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;

  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const primary: { label: string; total: string } | null = (() => {
    const first = lines.find((l) => l.includes("הצעת מחיר"));
    if (!first) return null;
    const totalMatch = text.match(/סה\W*כ\s*[:]?\s*([0-9.,]+)\s*ש["״]?ח/);
    return { label: first.replace(/^[^א-ת]*/, "").trim(), total: totalMatch?.[1] ?? "" };
  })();

  const alternates: { label: string; perUnit: string; total: string }[] = [];
  // Look for blocks that include "ליחידה" + "סה״כ" — these are alternate prices
  // (e.g. express vs sea, larger qty, etc.).
  const altRegex = /([^\n]+?(?:אקספרס|רגיל|חליפה|אופציה|משלוח)[^\n]*?)[\s\S]*?ליחידה[:\s]*([0-9.,]+)\s*ש["״]?ח[\s\S]*?סה\W*כ[:\s]*([0-9.,]+)\s*ש["״]?ח/g;
  let m: RegExpExecArray | null;
  while ((m = altRegex.exec(text)) !== null) {
    alternates.push({
      label: m[1].replace(/^[^א-ת]*/, "").trim().replace(/\s*$/, ""),
      perUnit: m[2],
      total: m[3],
    });
  }

  const notes: string[] = [];
  // Footer lines: anything after the last "---" or specific markers
  const parts = text.split(/-{3,}/);
  if (parts.length > 1) {
    const footer = parts[parts.length - 1].trim();
    footer.split(/\n/).forEach((l) => {
      const t = l.trim();
      if (t) notes.push(t);
    });
  }

  return { primary, alternates, notes };
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
  const q = data.qState ?? {};
  const step = (q.step as number | undefined) ?? null;
  const hasAnyAnswer =
    q.shipping !== undefined ||
    q.quantity !== undefined ||
    q.product !== undefined ||
    q.handles !== undefined ||
    q.colors !== undefined;
  const parsedQuote = parseQuoteResult(q.quoteResult);
  const doneAt = q.doneAt as string | undefined;
  const bailed = q.bailed === true;
  const routedToFactory = q.routedToFactory === true;

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

      {(hasAnyAnswer || step) && (
        <Section
          icon={<ClipboardList className="size-3.5" />}
          title={`מפרט הזמנה${step ? ` (שלב ${step})` : ""}`}
        >
          <div className="space-y-2.5">
            {(routedToFactory || bailed || doneAt) && (
              <div className="flex flex-wrap items-center gap-1.5 -mt-1">
                {doneAt && (
                  <span className="inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 bg-success/10 text-success border border-success/30">
                    <Check className="size-3" />
                    הושלם · {formatHebrewDate(doneAt)}
                  </span>
                )}
                {routedToFactory && (
                  <span className="text-[10px] rounded-full px-2 py-0.5 bg-primary/10 text-primary border border-primary/30">
                    נשלח למפעל
                  </span>
                )}
                {bailed && (
                  <span className="text-[10px] rounded-full px-2 py-0.5 bg-warning/10 text-warning border border-warning/30">
                    הופסק
                  </span>
                )}
              </div>
            )}
            <dl className="text-sm divide-y divide-border/60">
              {q.product !== undefined && (
                <SpecRow
                  icon={<ShoppingBag className="size-3.5" />}
                  label="מוצר"
                  value={decodeProduct(q.product, q.productCustom)}
                />
              )}
              {q.quantity !== undefined && (
                <SpecRow
                  icon={<Hash className="size-3.5" />}
                  label="כמות"
                  value={decodeQuantity(q.quantity, q.quantityCustom)}
                />
              )}
              {q.handles !== undefined && (
                <SpecRow
                  icon={<Package className="size-3.5" />}
                  label="ידיות"
                  value={decodeHandles(q.handles)}
                />
              )}
              {q.colors !== undefined && (
                <SpecRow
                  icon={<Palette className="size-3.5" />}
                  label="צבעי לוגו"
                  value={decodeColors(q.colors)}
                />
              )}
              {q.shipping !== undefined && (
                <SpecRow
                  icon={<Truck className="size-3.5" />}
                  label="משלוח"
                  value={decodeShipping(q.shipping)}
                />
              )}
            </dl>
          </div>
        </Section>
      )}

      {parsedQuote && (
        <Section
          icon={<Receipt className="size-3.5" />}
          title="הצעת מחיר ראשונית של הבוט"
        >
          <div className="space-y-2 text-sm">
            {parsedQuote.primary && (
              <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-success/80 mb-1">
                  הצעה ראשית
                </div>
                <div className="text-xl font-bold text-success tabular-nums">
                  ₪{parsedQuote.primary.total || "—"}
                </div>
                {parsedQuote.primary.label && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {parsedQuote.primary.label}
                  </div>
                )}
              </div>
            )}
            {parsedQuote.alternates.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  הצעות חלופיות
                </div>
                {parsedQuote.alternates.map((alt, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-background/40 p-2 text-xs"
                  >
                    <div className="font-medium truncate">{alt.label}</div>
                    <div className="text-muted-foreground tabular-nums mt-0.5">
                      ₪{alt.perUnit}/יח׳ · סה״כ ₪{alt.total}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {parsedQuote.notes.length > 0 && (
              <ul className="text-[11px] text-muted-foreground leading-relaxed list-disc pr-4 space-y-0.5">
                {parsedQuote.notes.map((n, i) => (
                  <li key={i} className="break-words">
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
        !hasAnyAnswer &&
        !data.quoteTotal && (
          <div className="text-xs text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">
            עוד אין מספיק מידע לסיכום הזמנה. ככל שהשיחה מתקדמת — השלבים, המחירים והתשובות יופיעו פה.
          </div>
        )}

      {sid && (
        <FactoryQuotePanel
          leadId={sid}
          leadName={data.name}
          qState={data.qState}
        />
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

function SpecRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-xs text-muted-foreground inline-flex items-center gap-1.5 shrink-0">
        <span className="text-muted-foreground/70">{icon}</span>
        {label}
      </dt>
      <dd className="text-sm text-right text-foreground break-words min-w-0">
        {value}
      </dd>
    </div>
  );
}
