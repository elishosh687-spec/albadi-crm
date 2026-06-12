"use client";

import { useEffect, useState, useMemo } from "react";
import { ExternalLink, Search, Loader2, Eye, Download, Trash2, X, MessageCircle, Calculator, Copy } from "lucide-react";
import { QuoteHtmlPreview } from "@/app/dashboard/v3/_components/factory/QuoteHtmlPreview";
import type { FactoryQuoteRow as DashboardFactoryQuoteRow } from "@/app/dashboard/v3/_components/factory/FactoryQuotePanel";
import { FinalizeModalWidget } from "./FinalizeModal.widget";

interface ApiQuoteRow {
  id: string;
  leadSid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  quotationNo: string | null;
  status: string; // pending | received | finalized | draft
  productSpec: Record<string, unknown> | null;
  factoryResponse: Record<string, unknown> | null;
  finalPricing: Record<string, unknown> | null;
  pdfUrl: string | null;
  sentToCustomerAt: string | null;
  createdAt: string;
  updatedAt: string;
  ghlUrl: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtMoney(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "—";
  return `₪${Math.round(n).toLocaleString("he-IL")}`;
}
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: "טיוטה", cls: "bg-muted/40 text-muted-foreground border-border" },
  pending: { text: "ממתין", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  received: { text: "התקבל", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  finalized: { text: "סופי", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

// Convert API row → dashboard FactoryQuoteRow shape for QuoteHtmlPreview.
function toDashboardRow(r: ApiQuoteRow): DashboardFactoryQuoteRow {
  return {
    id: r.id,
    manychatSubId: r.leadSid,
    quotationNo: r.quotationNo,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    productSpec: (r.productSpec ?? {}) as unknown as DashboardFactoryQuoteRow["productSpec"],
    feishuRowIndex: null,
    factoryStatus: r.status as DashboardFactoryQuoteRow["factoryStatus"],
    factoryResponse: (r.factoryResponse ?? null) as DashboardFactoryQuoteRow["factoryResponse"],
    finalPricing: (r.finalPricing ?? null) as DashboardFactoryQuoteRow["finalPricing"],
    pdfUrl: r.pdfUrl,
    sentToCustomerAt: r.sentToCustomerAt,
    customerName: r.name,
    customerPhone: r.phone,
  };
}

export function QuotesHistoryView({ apiToken }: { apiToken: string }) {
  const [data, setData] = useState<ApiQuoteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [opened, setOpened] = useState<ApiQuoteRow | null>(null);
  const [finalizing, setFinalizing] = useState<ApiQuoteRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Multi-select of finalized quotes → combine into one PDF. This list spans
  // many clients, so selection is locked to the first-picked row's client.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lockSid =
    selected.size === 0 || !data
      ? null
      : data.find((r) => selected.has(r.id))?.leadSid ?? null;
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const combineHref = `/api/factory/combine/pdf?ids=${[...selected].join(",")}`;
  const combineWaUrl = (() => {
    if (selected.size < 2 || !data) return null;
    const sel = data.filter((r) => selected.has(r.id));
    const phone = sel[0]?.phone?.replace(/[^\d]/g, "") || "";
    if (!phone) return null;
    const name = sel[0]?.name ?? "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${origin}/api/factory/combine/pdf?ids=${[...selected].join(",")}`;
    const caption = [
      name ? `היי ${name},` : "היי,",
      `מצורפת הצעת מחיר משולבת ל-${selected.size} מוצרים.`,
      `הצעה מלאה: ${link}`,
      "ההצעה בתוקף ל-14 יום. נשמח לקבל אישור 🙂",
    ].join("\n");
    return `https://wa.me/${phone}?text=${encodeURIComponent(caption)}`;
  })();

  async function refresh() {
    try {
      const r = await fetch(`/api/widget/quotes/list?widget_token=${encodeURIComponent(apiToken)}&limit=300`);
      const j = await r.json();
      setData(j.quotes);
    } catch {}
  }

  async function handleImport() {
    if (
      !confirm(
        "לייבא מ-Feishu הצעות שנמחקו מהמערכת? הן ייווצרו מחדש עם אותו מספר הצעה ועם תשובת המפעל."
      )
    )
      return;
    setImporting(true);
    try {
      const res = await fetch(
        `/api/factory/import-feishu?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST" }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה בייבוא: ${j?.error ?? res.status}`);
        return;
      }
      const unm =
        j.unmatched?.length > 0
          ? `\n${j.unmatched.length} לא נמצא להן ליד תואם (לפי שם): ${j.unmatched
              .map((u: { quotationNo: string }) => u.quotationNo)
              .slice(0, 10)
              .join(", ")}`
          : "";
      alert(`יובאו ${j.imported} הצעות.${unm}`);
      await refresh();
    } catch (e) {
      alert(`כשל: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(r: ApiQuoteRow) {
    if (!confirm(`למחוק את הצעה #${r.quotationNo ?? r.id.slice(-6)}? פעולה לא הפיכה.`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/factory/${r.id}?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "DELETE" }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה במחיקה: ${j?.error ?? res.status}`);
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleEditAsNew(r: ApiQuoteRow) {
    if (busyId) return;
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/widget/factory/${r.id}/clone?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST" }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה בשכפול: ${j?.error ?? res.status}`);
        return;
      }
      const clonedId: string = j.id;
      const listRes = await fetch(`/api/widget/quotes/list?widget_token=${encodeURIComponent(apiToken)}&limit=300`);
      const listJ = await listRes.json();
      const fresh: ApiQuoteRow[] = listJ?.quotes ?? [];
      setData(fresh);
      const cloned = fresh.find((row) => row.id === clonedId);
      if (cloned) {
        setFinalizing(cloned);
      } else {
        alert("השכפול נוצר אך לא נמצא — רענן ידנית.");
      }
    } catch (err) {
      alert(`כשל: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleSendWhatsApp(r: ApiQuoteRow) {
    if (!confirm(`לשלוח את ההצעה ל-${r.name ?? "לקוח"} ב-WhatsApp?`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/factory/${r.id}/send-whatsapp?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST" }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה בשליחה: ${j?.error ?? j?.detail ?? res.status}`);
        return;
      }
      alert("נשלח בהצלחה ✓");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/widget/quotes/list?widget_token=${encodeURIComponent(apiToken)}&limit=300`);
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        setData(j.quotes);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "fetch failed");
      }
    })();
  }, [apiToken]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        (r.name ?? "").toLowerCase().includes(needle) ||
        (r.phone ?? "").includes(needle) ||
        (r.quotationNo ?? "").toLowerCase().includes(needle) ||
        r.leadSid.toLowerCase().includes(needle)
      );
    });
  }, [data, q, statusFilter]);

  const counts = useMemo(() => {
    if (!data) return { all: 0, pending: 0, received: 0, finalized: 0 };
    return {
      all: data.length,
      pending: data.filter((r) => r.status === "pending").length,
      received: data.filter((r) => r.status === "received").length,
      finalized: data.filter((r) => r.status === "finalized").length,
    };
  }, [data]);

  if (err) return <div className="text-red-400 text-sm">שגיאה: {err}</div>;
  if (!data) {
    return (
      <div className="text-muted-foreground text-sm flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin" /> טוען...
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="חפש לפי שם / טלפון / מס' הצעה"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-border bg-background pr-9 pl-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            נמחקו הצעות? ייבא אותן מחדש מ-Feishu (עם אותו מס' הצעה).
          </span>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
          >
            {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            ייבא מ-Feishu
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          {([
            { id: "all", label: "הכל", n: counts.all },
            { id: "pending", label: "ממתינים", n: counts.pending },
            { id: "received", label: "התקבלו", n: counts.received },
            { id: "finalized", label: "סופיים", n: counts.finalized },
          ] as const).map((b) => (
            <button
              key={b.id}
              onClick={() => setStatusFilter(b.id)}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                statusFilter === b.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border bg-card/40 text-muted-foreground hover:bg-secondary"
              }`}
            >
              {b.label} ({b.n})
            </button>
          ))}
        </div>

        <div className="text-xs text-muted-foreground">
          מציג {filtered.length} מתוך {data.length} · סמן 2+ הצעות סופיות של אותו לקוח כדי לאחד ל-PDF אחד
        </div>

        {selected.size >= 2 && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
            <span className="text-xs font-medium text-primary">
              {selected.size} הצעות נבחרו לאיחוד
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                נקה
              </button>
              <a
                href={combineHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
              >
                פתח PDF
              </a>
              {combineWaUrl && (
                <a
                  href={combineWaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                >
                  שלח ב-WhatsApp
                </a>
              )}
            </div>
          </div>
        )}

        <ul className="space-y-1">
          {filtered.length === 0 ? (
            <li className="p-6 text-center text-muted-foreground text-sm rounded-lg border border-border bg-card/40">
              לא נמצאו הצעות מתאימות
            </li>
          ) : (
            filtered.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                  {r.status === "finalized" && (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      disabled={lockSid !== null && r.leadSid !== lockSid}
                      onChange={() => toggleSelected(r.id)}
                      title={
                        lockSid !== null && r.leadSid !== lockSid
                          ? "אפשר לאחד רק הצעות של אותו לקוח"
                          : "בחר לאיחוד ל-PDF"
                      }
                      className="shrink-0 accent-[var(--color-primary,#4A7C59)] disabled:opacity-40"
                    />
                  )}
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {fmtDate(r.createdAt)}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    {r.quotationNo ?? r.id.slice(-6)}
                  </span>
                  <span className={`text-[10px] rounded-full border px-1.5 py-0.5 shrink-0 ${STATUS_LABEL[r.status]?.cls ?? "bg-muted"}`}>
                    {STATUS_LABEL[r.status]?.text ?? r.status}
                  </span>
                  <span className="text-sm font-medium truncate min-w-0">
                    {r.name ?? r.leadSid.slice(0, 20)}
                  </span>
                  {r.status === "finalized" && r.finalPricing && (
                    <span className="text-[11px] tabular-nums text-emerald-400 shrink-0">
                      {fmtMoney((r.finalPricing as any).totalOrderPriceIls ?? (r.finalPricing as any).totalSellingPrice)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpened(r)}
                    title="פתח מפרט מלא"
                    disabled={busyId === r.id}
                    className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50"
                  >
                    <Eye className="size-3.5" />
                  </button>
                  {r.pdfUrl && (
                    <a
                      href={r.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="הורד PDF"
                      className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
                    >
                      <Download className="size-3.5" />
                    </a>
                  )}
                  {r.status === "received" && !r.finalPricing && (
                    <button
                      type="button"
                      onClick={() => setFinalizing(r)}
                      disabled={busyId === r.id}
                      title="חשב הצעת מחיר"
                      className="size-7 rounded grid place-items-center text-primary hover:bg-primary/10 disabled:opacity-50"
                    >
                      <Calculator className="size-3.5" />
                    </button>
                  )}
                  {r.status === "finalized" && (
                    <button
                      type="button"
                      onClick={() => handleEditAsNew(r)}
                      disabled={busyId === r.id}
                      title="ערוך כעותק חדש — מקור נשמר"
                      className="size-7 rounded grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                    </button>
                  )}
                  {r.status === "finalized" && (
                    <button
                      type="button"
                      onClick={() => handleSendWhatsApp(r)}
                      disabled={busyId === r.id}
                      title="שלח ללקוח ב-WhatsApp"
                      className="size-7 rounded grid place-items-center text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(r)}
                    disabled={busyId === r.id}
                    title="מחק הצעה"
                    className="size-7 rounded grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  {r.ghlUrl && (
                    <a
                      href={r.ghlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="פתח ב-GHL"
                      className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      {opened && <QuoteModal row={opened} onClose={() => setOpened(null)} widgetToken={apiToken} />}
      {finalizing && (
        <FinalizeModalWidget
          apiToken={apiToken}
          row={toDashboardRow(finalizing)}
          onClose={() => setFinalizing(null)}
          onFinalized={async () => {
            setFinalizing(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function QuoteModal({ row, onClose, widgetToken }: { row: ApiQuoteRow; onClose: () => void; widgetToken: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] rounded-lg border border-border bg-card flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80">
          <div className="text-sm font-semibold">
            {row.name ?? row.leadSid.slice(0, 25)}
            <span className="text-[11px] text-muted-foreground font-mono mx-2">
              #{row.quotationNo ?? row.id.slice(-6)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded grid place-items-center hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <QuoteHtmlPreview row={toDashboardRow(row)} widgetToken={widgetToken} />
        </div>
      </div>
    </div>
  );
}
