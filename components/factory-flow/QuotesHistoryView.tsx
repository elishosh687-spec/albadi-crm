"use client";

import { useEffect, useState, useMemo } from "react";
import { ExternalLink, Search, Loader2, Eye, Download, Trash2, X, MessageCircle, Calculator, Pencil, ChevronDown, Check, Send, Sparkles, FolderOpen } from "lucide-react";
import { QuoteHtmlPreview } from "@/app/dashboard/v3/_components/factory/QuoteHtmlPreview";
import type { FactoryQuoteRow as DashboardFactoryQuoteRow } from "@/app/dashboard/v3/_components/factory/FactoryQuotePanel";
import { FinalizeModalWidget } from "./FinalizeModal.widget";
import { CombinedCalcModalWidget } from "./CombinedCalcModal.widget";
import { SpecModal, EstimateModal, type RequestRow } from "./RequestInspectModals";

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
  draftEstimate: Record<string, unknown> | null;
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
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Newest row matching a predicate (rows come pre-sorted newest-first per card,
 *  but be defensive and sort by createdAt). */
function latestMatching(rows: ApiQuoteRow[], pred: (r: ApiQuoteRow) => boolean): ApiQuoteRow | null {
  const m = rows.filter(pred).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return m[0] ?? null;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft: { text: "טיוטה", cls: "bg-muted/40 text-muted-foreground border-border" },
  pending: { text: "ממתין", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  received: { text: "התקבל", cls: "bg-accent/15 text-accent border-accent/40" },
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

// ApiQuoteRow → the lean shape the inspect/estimate modals consume.
function toRequestRow(r: ApiQuoteRow): RequestRow {
  return {
    id: r.id,
    leadSid: r.leadSid,
    quotationNo: r.quotationNo,
    name: r.name,
    phone: r.phone,
    status: r.status,
    createdAt: r.createdAt,
    productSpec: (r.productSpec ?? null) as RequestRow["productSpec"],
  };
}

// One card per customer: all their quotes, newest first, with a status summary.
interface CustomerGroup {
  leadSid: string;
  name: string | null;
  phone: string | null;
  rows: ApiQuoteRow[];
  latestAt: string;
  statusCounts: Record<string, number>;
  priceableCount: number;
}

export function QuotesHistoryView({ apiToken }: { apiToken: string }) {
  const [data, setData] = useState<ApiQuoteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [opened, setOpened] = useState<ApiQuoteRow | null>(null);
  const [specRow, setSpecRow] = useState<ApiQuoteRow | null>(null);
  const [estimateRow, setEstimateRow] = useState<ApiQuoteRow | null>(null);
  const [finalizing, setFinalizing] = useState<ApiQuoteRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Rows the import couldn't auto-match to a lead — the user assigns them manually.
  const [unmatched, setUnmatched] = useState<{ quotationNo: string; customer: string }[]>([]);

  // Customer cards: which are expanded, and which one's combined-calc is open.
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [calcGroup, setCalcGroup] = useState<CustomerGroup | null>(null);
  function toggleCard(sid: string) {
    setOpenCards((prev) => {
      const n = new Set(prev);
      if (n.has(sid)) n.delete(sid);
      else n.add(sid);
      return n;
    });
  }

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
      setUnmatched(j.unmatched ?? []);
      alert(
        `יובאו ${j.imported} הצעות.\n` +
          `אבחון: נסרקו ${j.scanned} שורות, ${j.withQuoteNo} עם מס' הצעה, ` +
          `${j.skippedExisting} כבר קיימות, ${j.unmatched?.length ?? 0} ללא ליד תואם.` +
          (j.unmatched?.length
            ? `\nבחר ללא-המותאמות לקוח ידנית בתיבה למטה.`
            : "")
      );
      await refresh();
    } catch (e) {
      alert(`כשל: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  // Promote a parked draft (from the standalone sales quote-request form, or
  // any other draft) to Feishu — appends the row and flips status to pending.
  async function handlePromote(r: ApiQuoteRow) {
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/widget/factory/${r.id}/send-to-feishu?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST" }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה בשליחה למפעל: ${j?.error ?? j?.detail ?? res.status}`);
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
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

  // Delete the whole combined offer = every quote of this customer.
  async function handleDeleteGroup(g: CustomerGroup) {
    if (
      !confirm(
        `למחוק את כל ${g.rows.length} ההצעות של ${g.name ?? "הלקוח"}? פעולה לא הפיכה.`
      )
    )
      return;
    setBusyId(`group:${g.leadSid}`);
    try {
      for (const r of g.rows) {
        await fetch(
          `/api/factory/${r.id}?widget_token=${encodeURIComponent(apiToken)}`,
          { method: "DELETE" }
        );
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

  // Mark a draft as sent-to-customer WITHOUT sending — for drafts the salesperson
  // already sent by hand (Eli 2026-07-22). Drops the row off the "טרם נשלחו" panel.
  async function handleMarkSent(r: ApiQuoteRow) {
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/widget/factory/${r.id}/mark-sent?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sent: true }) }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה: ${j?.error ?? res.status}`);
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handleSendWhatsApp(r: ApiQuoteRow) {
    const isDraft = r.status === "draft";
    const prompt = isDraft
      ? `לשלוח את האומדן (טיוטה) ל-${r.name ?? "לקוח"} ב-WhatsApp?\n\nזהו מחיר שחישבת — לא הצעה סופית מהמפעל.`
      : `לשלוח את ההצעה ל-${r.name ?? "לקוח"} ב-WhatsApp?`;
    if (!confirm(prompt)) return;
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

  // Send the combined PDF as a real WhatsApp document via the bridge (not a
  // wa.me text link). Stamps every quote as sent.
  async function handleSendCombined(
    leadSid: string,
    name: string | null,
    ids: string[]
  ) {
    if (ids.length === 0) return;
    const who = name ?? "לקוח";
    const label =
      ids.length > 1 ? `הצעה משולבת (${ids.length} מוצרים)` : "ההצעה";
    if (!confirm(`לשלוח ${label} ל-${who} ב-WhatsApp?`)) return;
    setBusyId(`combine:${leadSid}`);
    try {
      const res = await fetch(
        `/api/factory/combine/send-whatsapp?ids=${encodeURIComponent(
          ids.join(",")
        )}&widget_token=${encodeURIComponent(apiToken)}`,
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

  // Group the filtered rows into one card per customer (by leadSid), each
  // sorted newest-first, cards ordered by most-recent activity.
  const groups = useMemo<CustomerGroup[]>(() => {
    const m = new Map<string, ApiQuoteRow[]>();
    for (const r of filtered) {
      const arr = m.get(r.leadSid) ?? [];
      arr.push(r);
      m.set(r.leadSid, arr);
    }
    return [...m.entries()]
      .map(([leadSid, rs]) => {
        const sorted = [...rs].sort(
          (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
        );
        const statusCounts: Record<string, number> = {};
        for (const r of sorted) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
        const priceableCount = sorted.filter(
          (r) => r.factoryResponse || r.finalPricing
        ).length;
        return {
          leadSid,
          name: sorted[0].name,
          phone: sorted[0].phone,
          rows: sorted,
          latestAt: sorted[0].createdAt,
          statusCounts,
          priceableCount,
        };
      })
      .sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt));
  }, [filtered]);

  // "Who's still waiting" — drafts that carry a calculated price but were never
  // sent to the customer. This is Itay's "I asked for 10 quotes, which are still
  // unsent" list (Eli 2026-07-22). Newest first.
  const unsentDrafts = useMemo(() => {
    if (!data) return [];
    return data
      .filter((r) => r.status === "draft" && r.finalPricing && !r.sentToCustomerAt)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [data]);

  const counts = useMemo(() => {
    if (!data) return { all: 0, draft: 0, pending: 0, received: 0, finalized: 0 };
    return {
      all: data.length,
      draft: data.filter((r) => r.status === "draft").length,
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

  // One quote row — rendered inside its customer card (unchanged behaviour).
  function renderQuoteRow(r: ApiQuoteRow) {
    return (
      <li
        key={r.id}
        className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
          {r.sentToCustomerAt && (
            <span
              title={`נשלח ללקוח ${fmtDate(r.sentToCustomerAt)}`}
              className="shrink-0 inline-flex items-center gap-0.5 text-[10px] rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5"
            >
              <Check className="size-3" /> נשלח
            </span>
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
          {(r.status === "finalized" || r.status === "draft") && r.finalPricing && (
            <span
              className={`text-[11px] tabular-nums shrink-0 ${r.status === "draft" ? "text-muted-foreground" : "text-emerald-400"}`}
              title={r.status === "draft" ? "מחיר משוער (טיוטה — לא ממפעל)" : undefined}
            >
              {r.status === "draft" ? "~" : ""}{fmtMoney((r.finalPricing as any).totalOrderPriceIls ?? (r.finalPricing as any).totalSellingPrice)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => (r.finalPricing ? setOpened(r) : setSpecRow(r))}
            title={r.finalPricing ? "פתח הצעה מלאה" : "צפה בבקשה"}
            disabled={busyId === r.id}
            className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50"
          >
            <Eye className="size-3.5" />
          </button>
          {!r.finalPricing && (
            <button
              type="button"
              onClick={() => setEstimateRow(r)}
              title="מחשבון משוער — מחיר מיידי"
              disabled={busyId === r.id}
              className="size-7 rounded grid place-items-center text-muted-foreground hover:text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <Sparkles className="size-3.5" />
            </button>
          )}
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
          {r.status === "finalized" && (
            <a
              href={`/widget/closed-quotes?widget_token=${encodeURIComponent(apiToken)}&focus=${encodeURIComponent(r.id)}`}
              title="פתח תיק עסקה (ציר שלבים + רווח בפועל)"
              className="size-7 rounded grid place-items-center text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
            >
              <FolderOpen className="size-3.5" />
            </a>
          )}
          {r.status === "draft" && r.finalPricing && (
            <button
              type="button"
              onClick={() => handleSendWhatsApp(r)}
              disabled={busyId === r.id}
              title="שלח את האומדן (טיוטה) ללקוח ב-WhatsApp"
              className="size-7 rounded grid place-items-center text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
            >
              {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
            </button>
          )}
          {r.status === "draft" && (
            <button
              type="button"
              onClick={() => handlePromote(r)}
              disabled={busyId === r.id}
              title="אשר ושלח למפעל"
              className="size-7 rounded grid place-items-center text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </button>
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
              {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Pencil className="size-3.5" />}
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

        {unmatched.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <div className="text-xs font-medium text-amber-400">
              {unmatched.length} הצעות לא הותאמו ללקוח — בחר לכל אחת:
            </div>
            {unmatched.map((u) => (
              <div
                key={u.quotationNo}
                className="flex items-center gap-2 flex-wrap rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
              >
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {u.quotationNo}
                </span>
                <span className="text-xs shrink-0">{u.customer || "ללא שם"}</span>
                <div className="flex-1 min-w-[180px]">
                  <LeadPickerAssign
                    apiToken={apiToken}
                    quotationNo={u.quotationNo}
                    customer={u.customer}
                    onDone={() => {
                      setUnmatched((cur) =>
                        cur.filter((x) => x.quotationNo !== u.quotationNo)
                      );
                      refresh();
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {unsentDrafts.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5" dir="rtl">
            <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
              🔔 טיוטות שטרם נשלחו ללקוח ({unsentDrafts.length})
            </div>
            <p className="text-[10px] text-muted-foreground">
              אומדנים שחישבת אך עוד לא נשלחו — שלח ללקוח או אשר ושלח למפעל.
            </p>
            <ul className="space-y-1">
              {unsentDrafts.slice(0, 12).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                    <label
                      className="shrink-0 inline-flex items-center gap-1 cursor-pointer text-[10px] text-muted-foreground hover:text-emerald-400"
                      title="סמן כנשלח ידנית ללקוח (בלי לשלוח מהמערכת)"
                    >
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={busyId === r.id}
                        onChange={() => handleMarkSent(r)}
                        className="accent-emerald-500"
                      />
                      שלחתי כבר
                    </label>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {fmtDate(r.createdAt)}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                      {r.quotationNo ?? r.id.slice(-6)}
                    </span>
                    <span className="text-sm font-medium truncate min-w-0">
                      {r.name ?? r.leadSid.slice(0, 20)}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground shrink-0" title="מחיר משוער">
                      ~{fmtMoney((r.finalPricing as Record<string, unknown>).totalOrderPriceIls ?? (r.finalPricing as Record<string, unknown>).totalSellingPrice)}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => (r.finalPricing ? setOpened(r) : setSpecRow(r))}
                      title="צפה בהצעה"
                      disabled={busyId === r.id}
                      className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      <Eye className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendWhatsApp(r)}
                      disabled={busyId === r.id}
                      title="שלח את האומדן ללקוח ב-WhatsApp"
                      className="size-7 rounded grid place-items-center text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {([
            { id: "all", label: "הכל", n: counts.all },
            { id: "draft", label: "טיוטות", n: counts.draft },
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
          מציג {filtered.length} מתוך {data.length} · לחישוב/שליחה משולבת — פתח כרטיס לקוח ולחץ "חישוב משולב"
        </div>

        <div className="space-y-1.5">
          {groups.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm rounded-lg border border-border bg-card/40">
              לא נמצאו הצעות מתאימות
            </div>
          ) : (
            groups.map((g) => {
              const open = openCards.has(g.leadSid);
              const canCalc = g.priceableCount > 0;
              // Combined offer = all this customer's FINALIZED quotes (the
              // combined PDF route requires every id to be finalized).
              const finalizedIds = g.rows
                .filter((r) => r.status === "finalized" && r.finalPricing)
                .map((r) => r.id);
              const canSendCombined = finalizedIds.length >= 1;
              const combinedPdfHref = `/api/factory/combine/pdf?ids=${finalizedIds.join(",")}`;
              const ghlUrl = g.rows[0]?.ghlUrl ?? null;
              const sentCount = g.rows.filter((r) => r.sentToCustomerAt).length;
              return (
                <div
                  key={g.leadSid}
                  className="rounded-lg border border-border/60 bg-card/30 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleCard(g.leadSid)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-right"
                    >
                      <ChevronDown
                        className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
                      />
                      <span className="text-sm font-medium truncate min-w-0">
                        {g.name ?? g.leadSid.slice(0, 20)}
                      </span>
                      <span className="text-[10px] rounded-full border border-border px-1.5 py-0.5 text-muted-foreground shrink-0">
                        {g.rows.length} הצעות
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {fmtDate(g.latestAt)}
                      </span>
                      {sentCount > 0 && (
                        <span
                          title={`${sentCount} הצעות נשלחו ללקוח`}
                          className="shrink-0 inline-flex items-center gap-0.5 text-[10px] rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 font-medium"
                        >
                          <Check className="size-3" /> נשלח {sentCount}
                        </span>
                      )}
                      <span className="hidden sm:flex items-center gap-1 shrink-0">
                        {Object.entries(g.statusCounts).map(([st, n]) => (
                          <span
                            key={st}
                            className={`text-[10px] rounded-full border px-1.5 py-0.5 ${STATUS_LABEL[st]?.cls ?? "bg-muted"}`}
                          >
                            {STATUS_LABEL[st]?.text ?? st} {n}
                          </span>
                        ))}
                      </span>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {/* Combined-offer toolbar — same actions a single quote has.
                          Eye opens the FULL combined view (boss breakdown of both
                          quotes + customer-PDF link inside), matching the single-
                          quote eye. Per Eli 2026-07-17: "the eye should open
                          everything, not just the customer PDF." */}
                      {canCalc && (
                        <button
                          type="button"
                          onClick={() => setCalcGroup(g)}
                          title="הצג הכל — פירוט מלא לבוס + PDF"
                          className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
                        >
                          <Eye className="size-3.5" />
                        </button>
                      )}
                      {canSendCombined && (
                        <a
                          href={combinedPdfHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="הורד PDF משולב ללקוח"
                          className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
                        >
                          <Download className="size-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setCalcGroup(g)}
                        disabled={!canCalc}
                        title={canCalc ? "ערוך / חישוב משולב" : "אין הצעות עם תשובת מפעל"}
                        className="size-7 rounded grid place-items-center text-primary hover:bg-primary/10 disabled:opacity-40"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {canSendCombined && (
                        <button
                          type="button"
                          onClick={() =>
                            handleSendCombined(g.leadSid, g.name, finalizedIds)
                          }
                          disabled={busyId === `combine:${g.leadSid}`}
                          title="שלח הצעה משולבת ב-WhatsApp"
                          className="size-7 rounded grid place-items-center text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          {busyId === `combine:${g.leadSid}` ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <MessageCircle className="size-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(g)}
                        disabled={busyId === `group:${g.leadSid}`}
                        title="מחק את כל הצעות הלקוח"
                        className="size-7 rounded grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        {busyId === `group:${g.leadSid}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                      {ghlUrl && (
                        <a
                          href={ghlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="פתח ב-GHL"
                          className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  {open && (
                    <div className="border-t border-border/60 bg-background/30 px-2 py-2">
                      <DraftVsFactoryStrip rows={g.rows} />
                      <ul className="space-y-1">
                        {g.rows.map((r) => renderQuoteRow(r))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {opened && <QuoteModal row={opened} onClose={() => setOpened(null)} widgetToken={apiToken} />}
      {specRow && <SpecModal row={toRequestRow(specRow)} onClose={() => setSpecRow(null)} />}
      {estimateRow && (
        <EstimateModal
          row={toRequestRow(estimateRow)}
          apiToken={apiToken}
          sending={busyId === estimateRow.id}
          onSendToFactory={
            estimateRow.status === "draft"
              ? async () => {
                  const r = estimateRow;
                  await handlePromote(r);
                  setEstimateRow(null);
                }
              : undefined
          }
          onClose={() => setEstimateRow(null)}
        />
      )}
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
      {calcGroup && (
        <CombinedCalcModalWidget
          apiToken={apiToken}
          rows={calcGroup.rows.map(toDashboardRow)}
          customerName={calcGroup.name}
          customerPhone={calcGroup.phone}
          onClose={() => setCalcGroup(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

function LeadPickerAssign({
  apiToken,
  quotationNo,
  customer,
  onDone,
}: {
  apiToken: string;
  quotationNo: string;
  customer: string;
  onDone: () => void;
}) {
  const [q, setQ] = useState(customer ?? "");
  const [results, setResults] = useState<
    { sid: string; name: string | null; phone: string | null }[]
  >([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/widget/leads/recent?widget_token=${encodeURIComponent(
            apiToken
          )}&q=${encodeURIComponent(q.trim())}`
        );
        const j = await res.json();
        if (alive && j?.ok) setResults(j.leads ?? []);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, apiToken]);

  async function pick(sid: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/factory/import-feishu/assign?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quotationNo, leadSid: sid }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה בשיוך: ${j?.error ?? res.status}`);
        return;
      }
      setOpen(false);
      onDone();
    } catch (e) {
      alert(`כשל: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="חפש לקוח לשיוך…"
        disabled={busy}
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {results.map((r) => (
            <button
              key={r.sid}
              type="button"
              onClick={() => pick(r.sid)}
              disabled={busy}
              className="block w-full text-right px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
            >
              <span className="font-medium">{r.name || "(ללא שם)"}</span>
              {r.phone ? <span className="text-muted-foreground"> · {r.phone}</span> : null}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <Loader2 className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

/**
 * "Draft vs factory quote" comparison. Shows how close the self-calculated draft
 * (מחשבון משוער estimate) was to the factory's real, finalized quote — on unit
 * price AND on shipping volume (our physical-model CBM vs the factory's actual).
 * Renders only when the customer has BOTH a draft carrying finalPricing AND a
 * finalized factory quote carrying finalPricing (Eli 2026-07-22).
 */
function DraftVsFactoryStrip({ rows }: { rows: ApiQuoteRow[] }) {
  const factory = latestMatching(rows, (r) => r.status === "finalized" && !!r.finalPricing);
  if (!factory) return null;
  // Estimate source, in priority order:
  //  1. SAME-row snapshot — this finalized quote was promoted from a priced draft,
  //     so its own draftEstimate holds the original self-calculated price.
  //  2. CROSS-row — a separate draft row (with finalPricing) for the same lead.
  let estimateFp: Record<string, unknown> | null = null;
  let estId: string | null = null;
  if (factory.draftEstimate) {
    estimateFp = factory.draftEstimate as Record<string, unknown>;
    estId = factory.quotationNo ?? factory.id.slice(-5);
  } else {
    const draft = latestMatching(rows, (r) => r.status === "draft" && !!r.finalPricing);
    if (draft) {
      estimateFp = draft.finalPricing as Record<string, unknown>;
      estId = draft.quotationNo ?? draft.id.slice(-5);
    }
  }
  if (!estimateFp) return null;
  const dp = estimateFp;
  const fp = factory.finalPricing as Record<string, unknown>;

  // Eli's working unit is "CBM", not m³ (2026-07-22).
  const fmtCbm = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)} CBM`);
  const fmtUnit = (v: number | null) => (v === null ? "—" : `₪${v.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`);

  const rowsCmp: { label: string; draftV: number | null; factV: number | null; fmt: (v: number | null) => string }[] = [
    { label: "מחיר ליחידה", draftV: num(dp.unitSellingPrice), factV: num(fp.unitSellingPrice), fmt: fmtUnit },
    { label: "נפח משלוח (CBM)", draftV: num(dp.totalCbm), factV: num(fp.totalCbm), fmt: fmtCbm },
    { label: "עלות שילוח", draftV: num(dp.totalShipping), factV: num(fp.totalShipping), fmt: fmtUnit },
  ];

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 mb-1.5" dir="rtl">
      <div className="text-[11px] font-medium text-amber-400 mb-1.5 flex items-center gap-1.5">
        <Sparkles className="size-3" />
        טיוטה מול הצעת מפעל
        <span className="text-[10px] text-muted-foreground font-normal">
          (אומדן #{estId} · מפעל #{factory.quotationNo ?? factory.id.slice(-5)})
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[11px] items-center">
        <span className="text-muted-foreground" />
        <span className="text-muted-foreground text-left">טיוטה</span>
        <span className="text-muted-foreground text-left">מפעל</span>
        <span className="text-muted-foreground text-left">פער</span>
        {rowsCmp.map((c) => {
          const gap =
            c.draftV !== null && c.factV !== null && c.draftV !== 0
              ? ((c.factV - c.draftV) / c.draftV) * 100
              : null;
          const gapCls = gap === null ? "text-muted-foreground" : Math.abs(gap) <= 10 ? "text-emerald-400" : "text-amber-400";
          return (
            <div key={c.label} className="contents">
              <span className="text-foreground">{c.label}</span>
              <span className="tabular-nums text-left text-muted-foreground">{c.fmt(c.draftV)}</span>
              <span className="tabular-nums text-left text-foreground">{c.fmt(c.factV)}</span>
              <span className={`tabular-nums text-left ${gapCls}`}>
                {gap === null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(0)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
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
