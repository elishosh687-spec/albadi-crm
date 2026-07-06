"use client";

/**
 * Two modals used from the quotes tab (QuotesHistoryView) to inspect a
 * salesperson's factory-quote REQUEST before it has a factory reply:
 *
 *   SpecModal      — read-only view of exactly what the salesperson submitted
 *                    (description, material, dims, qty, printing, finishing…).
 *   EstimateModal  — runs the self-quote estimator (מחשבון משוער) on the spec
 *                    via GET /api/factory/estimate and shows the estimated ILS
 *                    price + the cheapest factory + confidence/reasoning. When
 *                    the estimator refuses (out of envelope / not an 80g bag),
 *                    it surfaces the reason and a "send to factory" action.
 */

import { useEffect, useState } from "react";
import { X, Loader2, Sparkles, Send, ExternalLink } from "lucide-react";

export interface RequestSpec {
  description?: string;
  material?: string;
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
  quantity?: number;
  printing?: string;
  finishing?: string;
  notes?: string;
  shippingOptionId?: string;
}

export interface RequestRow {
  id: string;
  leadSid: string;
  quotationNo: string | null;
  name: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  productSpec: RequestSpec | null;
}

// Parse colours / handles / lamination out of the free-text spec strings, the
// same way FinalizeModal does. Shared by the estimate call and the full-calc
// deep-link.
function decodeSpecFeatures(s: RequestSpec): { colors: number; handles: boolean; lamination: boolean } {
  const m = String(s.printing ?? "").match(/(\d+)/);
  const colors = m ? Math.max(1, parseInt(m[1], 10)) : 1;
  const fin = String(s.finishing ?? "");
  const handles = /handle|ידיות/i.test(fin) && !/no handle|ללא ידיות|לא ידיות/i.test(fin);
  const lamination = /laminat|למינציה/i.test(fin) && !/not laminat|ללא למינציה|לא מלומ/i.test(fin);
  return { colors, handles, lamination };
}

// Deep-link to the FULL calculator, estimate tab, pre-filled from this spec +
// wired to the customer (sid) so Eli can adjust margin and send the customer a
// quote (PDF/text) straight from the real calculator UI.
function fullCalculatorHref(row: RequestRow, token: string): string {
  const s = row.productSpec ?? {};
  const { colors, handles, lamination } = decodeSpecFeatures(s);
  const p = new URLSearchParams({
    widget_token: token,
    tab: "estimate",
    estH: String(s.heightCm ?? ""),
    estD: String(s.depthCm ?? ""),
    estW: String(s.widthCm ?? ""),
    estQty: String(s.quantity ?? ""),
    estColors: String(colors),
    estHandles: String(handles),
    estLam: String(lamination),
  });
  if (row.leadSid && !row.leadSid.startsWith("manual_")) p.set("sid", row.leadSid);
  return `/widget/calculator?${p.toString()}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function ils(v: number | undefined | null): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return `₪${Math.round(Number(v)).toLocaleString("he-IL")}`;
}
function sizeLabel(s: RequestSpec): string {
  const parts: string[] = [];
  if (s.heightCm) parts.push(`H${s.heightCm}`);
  if (s.depthCm) parts.push(`D${s.depthCm}`);
  if (s.widthCm) parts.push(`W${s.widthCm}`);
  return parts.join("×") || "—";
}

// Map a stored productSpec to the /api/factory/estimate query params, mirroring
// the parsing FinalizeModal uses (colors from the printing string; handles /
// lamination flags from the finishing string).
function specToEstimateParams(s: RequestSpec, token: string): string {
  const { colors, handles, lamination } = decodeSpecFeatures(s);
  const p = new URLSearchParams({
    widthCm: String(s.widthCm ?? 0),
    heightCm: String(s.heightCm ?? 0),
    depthCm: String(s.depthCm ?? 0),
    qty: String(s.quantity ?? 0),
    colors: String(colors),
    handles: String(handles),
    lamination: String(lamination),
    shipping: s.shippingOptionId || "s1",
    widget_token: token,
  });
  return p.toString();
}

function ModalShell({ title, subtitle, onClose, children, footer }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-lg max-h-[90vh] rounded-lg border border-border bg-card flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/80">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="size-7 rounded grid place-items-center hover:bg-secondary">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="border-t border-border px-4 py-2.5 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-[12px] text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-right">{value ?? "—"}</span>
    </div>
  );
}

export function SpecModal({ row, onClose }: { row: RequestRow; onClose: () => void }) {
  const s = row.productSpec ?? {};
  return (
    <ModalShell
      title={row.name ?? "בקשת הצעת מחיר"}
      subtitle={`#${row.quotationNo ?? row.id.slice(-6)} · ${fmtDate(row.createdAt)}`}
      onClose={onClose}
    >
      <div className="space-y-0.5">
        <Row label="תיאור" value={s.description} />
        <Row label="חומר" value={s.material} />
        <Row label="מידות" value={<span className="font-mono tabular-nums">{sizeLabel(s)}</span>} />
        <Row label="כמות" value={<span className="tabular-nums">{s.quantity ? Number(s.quantity).toLocaleString("he-IL") : "—"}</span>} />
        <Row label="הדפסה" value={s.printing} />
        <Row label="גימור" value={s.finishing} />
        {s.notes ? <Row label="הערות למפעל" value={s.notes} /> : null}
      </div>
    </ModalShell>
  );
}

interface EstimateApiResponse {
  ok: boolean;
  estimate?: {
    ok: boolean;
    refused?: string;
    factoryName?: string;
    confidence?: string | number;
    reasoning?: string[];
    candidates?: { factory: string; unitCny: number; inRange: boolean }[];
  };
  result?: {
    quantity: number;
    sellingPricePerUnitIls: number;
    totalOrderPriceIls: number;
    moldsTotalSellingPriceIls?: number;
    shippingOption?: { name?: string; type?: string } | null;
  };
  computed?: { shippingPerUnitIls: number };
}

export function EstimateModal({
  row,
  apiToken,
  onSendToFactory,
  sending,
  onClose,
}: {
  row: RequestRow;
  apiToken: string;
  onSendToFactory?: () => void;
  sending?: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<EstimateApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const s = row.productSpec ?? {};
  const non80g = !!s.material && !/80\s*g/i.test(s.material);
  // Albadi's minimum order is 3000 units — below that there's no quote at all.
  const belowMoq = (Number(s.quantity) || 0) < 3000;

  useEffect(() => {
    if (belowMoq) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/factory/estimate?${specToEstimateParams(s, apiToken)}`, { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok || !j.ok) {
          setErr(j.error ?? `HTTP ${res.status}`);
          setData(null);
        } else {
          setData(j);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, apiToken, belowMoq]);

  const est = data?.estimate;
  const r = data?.result;
  const c = data?.computed;
  const refused = est && !est.ok;
  const calcHref = fullCalculatorHref(row, apiToken);

  const factoryBtn = onSendToFactory ? (
    <button
      type="button"
      onClick={onSendToFactory}
      disabled={sending}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
    >
      {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
      שלח למפעל
    </button>
  ) : null;

  return (
    <ModalShell
      title="מחשבון משוער"
      subtitle={`${row.name ?? "בקשה"} · ${sizeLabel(s)} · ${s.quantity ? Number(s.quantity).toLocaleString("he-IL") : "—"} יח׳`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm hover:bg-secondary">
            סגור
          </button>
          {factoryBtn}
          <a
            href={calcHref}
            target="_blank"
            rel="noopener noreferrer"
            title="פותח את המחשבון המשוער המלא, ממולא מראש — שם אפשר לכוונן מרווח ולשלוח ללקוח PDF"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
          >
            <ExternalLink className="size-3.5" />
            מחשבון מלא + שלח ללקוח
          </a>
        </>
      }
    >
      {non80g && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
          ⚠️ החומר אינו 80g — האומדן מניח 80g בלבד, ייתכן שאינו מדויק. לשקול שליחה למפעל.
        </div>
      )}

      {belowMoq && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <div className="font-bold text-amber-500 mb-1">מתחת למינימום הזמנה</div>
          <div className="text-muted-foreground">
            הכמות ({(Number(s.quantity) || 0).toLocaleString("he-IL")} יח׳) מתחת למינימום של 3,000 יח׳ — אין תמחור. יש לחזור ללקוח על כמות מינימלית.
          </div>
        </div>
      )}

      {!belowMoq && loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
          <Loader2 className="size-4 animate-spin" /> מחשב אומדן…
        </div>
      )}

      {!loading && err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          שגיאה: {err}
        </div>
      )}

      {!loading && refused && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <div className="font-bold text-amber-500 mb-1">⚠️ לא ניתן לאמוד — שלח למפעל</div>
          <div className="text-muted-foreground">{est?.refused}</div>
          {est?.candidates && est.candidates.length > 0 && (
            <div className="text-[11px] text-muted-foreground mt-2">
              מחירים שנבדקו: {est.candidates.map((x) => `${x.factory} ¥${x.unitCny}${x.inRange ? "" : " (מחוץ לטווח)"}`).join(" · ")}
            </div>
          )}
        </div>
      )}

      {!loading && est?.ok && r && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="מחיר ליחידה" value={ils(r.sellingPricePerUnitIls)} big />
            <Stat label={`סה״כ (${r.quantity.toLocaleString("he-IL")} יח׳)`} value={ils(r.totalOrderPriceIls)} big accent />
          </div>
          <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-0.5">
            <Row label="מפעל נבחר" value={est.factoryName} />
            {est.confidence !== undefined && <Row label="ביטחון" value={String(est.confidence)} />}
            <Row label="שילוח" value={r.shippingOption?.name} />
            {c && <Row label="שילוח ליחידה" value={ils(c.shippingPerUnitIls)} />}
            {r.moldsTotalSellingPriceIls ? <Row label="גלופות/מולדים (חד״פ)" value={ils(r.moldsTotalSellingPriceIls)} /> : null}
          </div>
          {est.reasoning && est.reasoning.length > 0 && (
            <div className="rounded-lg border border-border/40 bg-background/30 p-3">
              <div className="text-[11px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Sparkles className="size-3" /> היגיון האומדן
              </div>
              <ul className="text-[12px] text-muted-foreground space-y-0.5 list-disc pr-4">
                {est.reasoning.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[11px] text-muted-foreground text-center">
            אומדן בלבד — לשליחת ההצעה הסופית ללקוח, חשב על בסיס תשובת המפעל האמיתית.
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function Stat({ label, value, big, accent }: { label: string; value: string; big?: boolean; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 text-center ${accent ? "border-emerald-500/30 bg-emerald-500/10" : "border-border/60 bg-background/40"}`}>
      <div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`tabular-nums font-semibold ${big ? "text-lg" : "text-sm"} ${accent ? "text-emerald-400" : ""}`}>{value}</div>
    </div>
  );
}
