"use client";

import { useEffect, useState, useMemo } from "react";
import { ExternalLink, Search, Loader2, Eye, Download, Trash2, X, MessageCircle, Calculator, Pencil, ChevronDown, Check, Send } from "lucide-react";
import { QuoteHtmlPreview } from "@/app/dashboard/v3/_components/factory/QuoteHtmlPreview";
import type { FactoryQuoteRow as DashboardFactoryQuoteRow } from "@/app/dashboard/v3/_components/factory/FactoryQuotePanel";
import { FinalizeModalWidget } from "./FinalizeModal.widget";
import { CombinedCalcModalWidget } from "./CombinedCalcModal.widget";

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
                      {/* Combined-offer toolbar — same actions a single quote has */}
                      {canSendCombined && (
                        <a
                          href={combinedPdfHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="הצג PDF משולב"
                          className="size-7 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
                        >
                          <Eye className="size-3.5" />
                        </a>
                      )}
                      {canSendCombined && (
                        <a
                          href={combinedPdfHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="הורד PDF משולב"
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
                    <ul className="space-y-1 border-t border-border/60 bg-background/30 px-2 py-2">
                      {g.rows.map((r) => renderQuoteRow(r))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>
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
