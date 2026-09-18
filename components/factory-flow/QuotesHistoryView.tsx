"use client";

import { useEffect, useState, useMemo } from "react";
import { type LucideIcon, ExternalLink, Search, Loader2, Eye, Download, Trash2, Trash, X, MessageCircle, Calculator, Pencil, ChevronDown, Check, Send, Sparkles, FolderOpen, RotateCcw, CheckCircle2, RefreshCw } from "lucide-react";
import { QuoteHtmlPreview } from "@/app/dashboard/v3/_components/factory/QuoteHtmlPreview";
import { splitCustomerView } from "@/lib/factory/shipping-split";
import { customerTotalExVat } from "@/lib/factory/customer-total";
import {
  PAYMENT_PRESETS,
  DEFAULT_PAYMENT_PLAN_ID,
  customDepositPlan,
} from "@/lib/factory/payment-terms";
import type { ShippingSplit } from "@/lib/factory/types";
import type { FactoryQuoteRow as DashboardFactoryQuoteRow } from "@/app/dashboard/v3/_components/factory/FactoryQuotePanel";
import { FinalizeModalWidget } from "./FinalizeModal.widget";
import { CombinedCalcModalWidget } from "./CombinedCalcModal.widget";
import { SpecModal, EstimateModal, fullCalculatorHref, type RequestRow } from "./RequestInspectModals";
import { matchCatalogProduct } from "@/lib/factory/catalog-dims";

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
  reminderDismissedAt: string | null;
  /** "sales" = the salesperson's quote-request form; "eli" = parked from the
   *  calculator; null on pre-2026-07-28 rows. */
  createdBy: string | null;
  closedDealAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
/** The total to SHOW for a quote — the SAME figure the customer received in the
 *  PDF/WhatsApp (rounded per-bag × qty + molds; per-leg on a split shipment).
 *  Reading the engine's `totalSellingPrice` here instead made the row disagree
 *  with the opened quote, with the deal card, and with the invoice — the split
 *  case was patched 2026-07-28, the plain case only 2026-07-31 (Eli). */
function displayTotal(finalPricing: Record<string, unknown> | null): unknown {
  return customerTotalExVat(finalPricing);
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

/** Status in Eli's words + the pill tone (colour AND words). */
const STATUS_LABEL: Record<string, { text: string; tone: "idle" | "warn" | "go" | "good" }> = {
  draft: { text: "טיוטה", tone: "idle" },
  pending: { text: "ממתין למפעל", tone: "warn" },
  received: { text: "המפעל ענה", tone: "go" },
  finalized: { text: "סופי", tone: "good" },
};

const GROUP_PAGE = 30;

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
  /**
   * Rows ticked in the reminder panels.
   *
   * One set across all three panels — ids are unique, and each panel's
   * "בחר הכל" only ever touches its own ids. Eli works these lists in a burst
   * ("סימנתי הכל, ראיתי הכל"), and doing it one row at a time was the whole
   * complaint.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  // Payment-plan picker shown before a send (Eli 2026-07-28).
  const [payModal, setPayModal] = useState<
    { row: ApiQuoteRow; planId: string; customPct: string } | null
  >(null);
  const [defaultPlanId, setDefaultPlanId] = useState<string>(DEFAULT_PAYMENT_PLAN_ID);
  const [importing, setImporting] = useState(false);
  // Rows the import couldn't auto-match to a lead — the user assigns them manually.
  const [unmatched, setUnmatched] = useState<{ quotationNo: string; customer: string }[]>([]);
  // "סל מיחזור" recycle bin — soft-deleted quotes, loaded on demand.
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<ApiQuoteRow[] | null>(null);

  // Customer cards: which are expanded, and which one's combined-calc is open.
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [calcGroup, setCalcGroup] = useState<CustomerGroup | null>(null);
  const [groupLimit, setGroupLimit] = useState(GROUP_PAGE);
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
      const refreshed: { quotationNo: string; note: string }[] = j.refreshed ?? [];
      alert(
        `יובאו ${j.imported} הצעות חדשות.\n` +
          `עודכנו מהמפעל: ${refreshed.length}\n` +
          (refreshed.length
            ? refreshed.map((r) => `   • ${r.quotationNo} — ${r.note}`).join("\n") + "\n"
            : "") +
          `\nאבחון: נסרקו ${j.scanned} שורות, ${j.withQuoteNo} עם מס' הצעה, ` +
          `${j.unchanged ?? 0} ללא שינוי, ${j.unmatched?.length ?? 0} ללא ליד תואם.` +
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
    if (!confirm(`למחוק את הצעה #${r.quotationNo ?? r.id.slice(-6)}? היא תעבור לסל המיחזור וניתן לשחזר.`)) return;
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
      if (showTrash) await loadTrash();
    } finally {
      setBusyId(null);
    }
  }

  // Recycle bin: load, restore, and permanent-delete.
  async function loadTrash() {
    try {
      const r = await fetch(
        `/api/widget/quotes/list?widget_token=${encodeURIComponent(apiToken)}&deleted=1&limit=300`
      );
      const j = await r.json();
      setTrash(j.quotes ?? []);
    } catch {
      setTrash([]);
    }
  }

  async function toggleTrash() {
    const next = !showTrash;
    setShowTrash(next);
    if (next && trash === null) await loadTrash();
  }

  async function handleRestore(r: ApiQuoteRow) {
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/widget/factory/${r.id}/restore?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST" }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה בשחזור: ${j?.error ?? res.status}`);
        return;
      }
      await Promise.all([refresh(), loadTrash()]);
    } finally {
      setBusyId(null);
    }
  }

  async function handleHardDelete(r: ApiQuoteRow) {
    if (!confirm(`למחוק לצמיתות את הצעה #${r.quotationNo ?? r.id.slice(-6)}? פעולה לא הפיכה!`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/factory/${r.id}?widget_token=${encodeURIComponent(apiToken)}&hard=1`,
        { method: "DELETE" }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(`שגיאה במחיקה: ${j?.error ?? res.status}`);
        return;
      }
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  }

  // "רענן מהמפעל" — re-pull ONE quote's Feishu row even when finalized (the
  // scheduled refresh skips finalized rows so it can't overwrite a priced
  // quote). The factory does edit rows after we've priced them, so this is the
  // manual escape hatch. Updates the factory data only — never re-prices.
  async function handleForceRefresh(r: ApiQuoteRow) {
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/widget/factory/force-refresh/${r.id}?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST" }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) {
        alert(
          j?.error === "row_not_found_in_sheet"
            ? "השורה לא נמצאה בגיליון המפעל."
            : j?.error === "sheet_row_has_no_factory_data"
              ? "המפעל עדיין לא מילא נתונים בשורה."
              : `שגיאה: ${j?.error ?? res.status}`
        );
        return;
      }
      const changes: { field: string; from: unknown; to: unknown }[] = j.changes ?? [];
      if (changes.length === 0) {
        alert("אין שינוי — הנתונים במפעל זהים למה שכבר שמור.");
      } else {
        const LABELS: Record<string, string> = {
          unitCostCny: "מחיר יחידה ¥",
          cartonQty: "כמות בקרטון",
          cartonCbm: "CBM",
          weightKg: 'משקל ק"ג',
          cartonLengthCm: "אורך",
          cartonWidthCm: "רוחב",
          cartonHeightCm: "גובה",
          supplier: "ספק",
          notes: "הערות",
        };
        const lines = changes
          .map((c) => `• ${LABELS[c.field] ?? c.field}: ${String(c.from ?? "—")} ← ${String(c.to)}`)
          .join("\n");
        alert(
          `עודכן מהמפעל:\n${lines}` +
            (j.pricingStale
              ? "\n\n⚠️ עלות המפעל השתנתה וההצעה כבר מתומחרת — המחיר ללקוח לא עודכן אוטומטית. אם צריך, חשב מחדש."
              : "")
        );
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  // "סגור עסקה" — pull a finalized quote into the עסקאות tab (toggle).
  async function handleCloseDeal(r: ApiQuoteRow, closed: boolean) {
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/widget/factory/close-deal/${r.id}?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closed }) }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) { alert(`שגיאה: ${j?.error ?? res.status}`); return; }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  // "סגור עסקה משולבת" — close ALL a customer's finalized quotes as ONE deal.
  async function handleCloseDealGroup(leadSid: string, ids: string[]) {
    if (!confirm(`לסגור עסקה משולבת מ-${ids.length} מוצרים? הם יופיעו כעסקה אחת עם חשבונית אחת.`)) return;
    setBusyId(`closegroup:${leadSid}`);
    try {
      const res = await fetch(
        `/api/widget/factory/close-deal-group?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteIds: ids }) }
      );
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) { alert(`שגיאה: ${j?.error ?? res.status}`); return; }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  // Delete the whole combined offer = every quote of this customer.
  async function handleDeleteGroup(g: CustomerGroup) {
    if (
      !confirm(
        `למחוק את כל ${g.rows.length} ההצעות של ${g.name ?? "הלקוח"}? הן יעברו לסל המיחזור וניתן לשחזר.`
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
      if (showTrash) await loadTrash();
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

  const toggleRow = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (ids: string[], on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  /**
   * Apply one reminder action to every ticked row, then refresh ONCE.
   *
   * Deliberately sequential: these are writes against the same table and the
   * lists are short. It also keeps the progress counter honest — "3/12" means
   * three are actually done.
   */
  async function runBulk(
    label: string,
    rows: ApiQuoteRow[],
    path: (r: ApiQuoteRow) => string,
    body: Record<string, unknown>
  ) {
    if (!rows.length) return;
    if (!confirm(`${label} — ${rows.length} הצעות. להמשיך?`)) return;
    let done = 0;
    let failed = 0;
    for (const r of rows) {
      setBulkBusy(`${label} ${done + 1}/${rows.length}`);
      try {
        const res = await fetch(
          `/api/widget/factory/${r.id}/${path(r)}?widget_token=${encodeURIComponent(apiToken)}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        );
        const j = await res.json().catch(() => ({}));
        if (j?.ok) done++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(null);
    setSelected(new Set());
    await refresh();
    if (failed) alert(`${label}: ${done} הצליחו, ${failed} נכשלו.`);
  }

  const bulkMarkSent = (rows: ApiQuoteRow[]) =>
    runBulk("סמן כנשלח", rows, () => "mark-sent", { sent: true });
  const bulkDismiss = (rows: ApiQuoteRow[]) =>
    runBulk("הסר מהתזכורת", rows, () => "dismiss-reminder", { dismissed: true });

  // Remove a quote from the "צריך לשלוח" reminder without sending/deleting — a
  // dead lead Eli will never price/send. Persistent (reminder_dismissed_at).
  async function handleDismissReminder(r: ApiQuoteRow) {
    if (!confirm(`להסיר את ההצעה של ${r.name ?? "הלקוח"} מתזכורת "צריך לשלוח"?\n\nההצעה לא נמחקת — רק יורדת מהתזכורת ולא תחזור.`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/widget/factory/${r.id}/dismiss-reminder?widget_token=${encodeURIComponent(apiToken)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismissed: true }) }
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

  // Sending now goes through the payment-plan picker (Eli 2026-07-28): the
  // message carries VAT + the payment schedule + bank details, and the deposit
  // split changes per deal (50/50, 30/70, 3 payments, or a custom %).
  function handleSendWhatsApp(r: ApiQuoteRow) {
    setPayModal({ row: r, planId: defaultPlanId, customPct: "" });
  }

  async function doSendWhatsApp(r: ApiQuoteRow, paymentPlanId: string) {
    setBusyId(r.id);
    try {
      const res = await fetch(
        `/api/factory/${r.id}/send-whatsapp?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentPlanId }),
        }
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

  // The operator's default payment schedule, preselected in the picker.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/widget/factory/config?widget_token=${encodeURIComponent(apiToken)}`);
        const j = await r.json();
        const id = j?.config?.paymentTerms?.defaultPlanId ?? j?.paymentTerms?.defaultPlanId;
        if (typeof id === "string" && id) setDefaultPlanId(id);
      } catch { /* keep the built-in default */ }
    })();
  }, [apiToken]);

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

  // Parked WITHOUT a price — nobody can send these until Eli prices them. The
  // salesperson's form (createdBy="sales") lands here, and its Eli DM was too
  // easy to miss, so the request could sit unnoticed for days (Eli 2026-07-28).
  // Sales requests sort first — someone is actively waiting on them.
  const needsPricing = useMemo(() => {
    if (!data) return [];
    return data
      .filter(
        (r) =>
          r.status === "draft" &&
          !r.finalPricing &&
          !r.sentToCustomerAt &&
          !r.reminderDismissedAt
      )
      .sort((a, b) => {
        const sales = (r: ApiQuoteRow) => (r.createdBy === "sales" ? 0 : 1);
        return sales(a) - sales(b) || +new Date(b.createdAt) - +new Date(a.createdAt);
      });
  }, [data]);

  // Factory replied but the customer hasn't got the quote yet. `finalized` =
  // priced, ready to send; `received` = factory answered, still needs finalizing
  // (pricing) before sending. Eli's reminder "the factory sent quotes — send
  // them to the customer" (2026-07-26).
  const needsSending = useMemo(() => {
    if (!data) return [];
    return data
      .filter(
        (r) =>
          (r.status === "received" || r.status === "finalized") &&
          !r.sentToCustomerAt &&
          !r.reminderDismissedAt
      )
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

  if (err) return <p className="ux-note" style={{ color: "#f0c0c0" }}>לא הצלחתי לטעון את ההצעות ({err}) — נסה לרענן.</p>;
  if (!data) {
    return (
      <div className="grid gap-3" aria-label="טוען הצעות">
        <div className="ux-skel" style={{ height: 120 }} />
        <div className="ux-skel" style={{ height: 320 }} />
      </div>
    );
  }

  // One quote inside a customer card: what it is on one line (number, date,
  // status in words, price), then its actions as labelled 44px buttons — they
  // were up to 13 unlabelled 28px icons, readable only by hovering on desktop.
  function renderQuoteRow(r: ApiQuoteRow) {
    const st = STATUS_LABEL[r.status];
    const busy = busyId === r.id;
    const priced = (r.status === "finalized" || r.status === "draft") && r.finalPricing;
    return (
      <li key={r.id} className="qh-q">
        <div className="l1">
          <span className="no tnum">{r.quotationNo ?? r.id.slice(-6)}</span>
          <span className="tnum" style={{ color: "var(--lux-muted)" }}>{fmtDate(r.createdAt)}</span>
          <span className="ux-pill" data-tone={st?.tone ?? "idle"}>{st?.text ?? r.status}</span>
          {priced && (
            <span className="tnum" style={{ color: r.status === "draft" ? "var(--lux-muted)" : "var(--lux-success, #a8c0a0)" }} title={r.status === "draft" ? "מחיר משוער (טיוטה — לא ממפעל)" : undefined}>
              {r.status === "draft" ? "~" : ""}
              {fmtMoney(displayTotal(r.finalPricing as Record<string, unknown>))}
            </span>
          )}
          {r.sentToCustomerAt && (
            <span className="ux-pill" data-tone="good" title={`נשלח ללקוח ${fmtDate(r.sentToCustomerAt)}`}>
              <Check className="size-3.5" aria-hidden /> נשלח ללקוח
            </span>
          )}
          {priced && r.closedDealAt && (
            <span className="ux-pill" data-tone="good" title="עסקה סגורה — בלשונית עסקאות">
              <Check className="size-3.5" aria-hidden /> בעסקאות
            </span>
          )}
        </div>
        <div className="ux-acts">
          {/* the main next step first */}
          {r.status === "received" && !r.finalPricing && (
            <Act icon={Calculator} label="חשב הצעת מחיר" tone="primary" onClick={() => setFinalizing(r)} disabled={busy} />
          )}
          {r.status === "draft" && r.finalPricing && (
            <Act icon={MessageCircle} label="שלח אומדן ב-WhatsApp" tone="go" onClick={() => handleSendWhatsApp(r)} busy={busy} />
          )}
          {r.status === "finalized" && (
            <Act icon={MessageCircle} label="שלח ב-WhatsApp" tone="go" onClick={() => handleSendWhatsApp(r)} busy={busy} />
          )}
          {r.status === "draft" && (
            <Act icon={Send} label="אשר ושלח למפעל" onClick={() => handlePromote(r)} busy={busy} />
          )}
          <Act
            icon={Eye}
            label={r.finalPricing ? "הצעה מלאה" : "צפה בבקשה"}
            onClick={() => (r.finalPricing ? setOpened(r) : setSpecRow(r))}
            disabled={busy}
          />
          {!r.finalPricing && (
            <Act icon={Sparkles} label="מחיר משוער" title="מחשבון משוער — מחיר מיידי" onClick={() => setEstimateRow(r)} disabled={busy} />
          )}
          {/* The PDF the CUSTOMER gets — always through the route, never the
              stored Blob. That Blob was rendered at finalize time, before any
              payment plan existed, so opening it showed a quote with no
              schedule and no bank details while the sent one had them (Eli
              02/09: "אני מציג את ה-PDF ולא רואה תנאי ופרטי תשלום"). The route
              re-renders with the current terms. */}
          {(r.pdfUrl || r.finalPricing) && (
            <Act icon={Download} label="PDF ללקוח" title="ה-PDF שהלקוח מקבל (כולל תנאי תשלום)" href={`/api/factory/${r.id}/pdf`} newTab />
          )}
          {(r.status === "finalized" || (r.status === "draft" && r.finalPricing)) && !r.closedDealAt && (
            <Act
              icon={CheckCircle2}
              label={r.status === "draft" ? "סגור עסקה (אומדן)" : "סגור עסקה"}
              title={r.status === "draft" ? "סגור עסקה מהאומדן — הלקוח קיבל את המחיר" : "סגור עסקה — העבר ללשונית עסקאות"}
              tone="warn"
              onClick={() => handleCloseDeal(r, true)}
              busy={busy}
            />
          )}
          {(r.status === "finalized" || (r.status === "draft" && r.closedDealAt)) && (
            <Act
              icon={FolderOpen}
              label="תיק עסקה"
              title="פתח תיק עסקה (ציר שלבים + רווח בפועל)"
              href={`/widget/closed-quotes?widget_token=${encodeURIComponent(apiToken)}&focus=${encodeURIComponent(r.id)}`}
            />
          )}
          {r.status === "draft" && r.finalPricing && (
            <Act
              icon={Calculator}
              label="ערוך מחיר"
              title="חשב מחדש / ערוך מחיר — יעדכן את אותה טיוטה"
              href={fullCalculatorHref(
                toRequestRow(r),
                apiToken,
                matchCatalogProduct(
                  Number((r.productSpec as Record<string, unknown> | null)?.heightCm) || 0,
                  Number((r.productSpec as Record<string, unknown> | null)?.depthCm) || 0,
                  Number((r.productSpec as Record<string, unknown> | null)?.widthCm) || 0
                ),
                r.id
              )}
            />
          )}
          {(r.status === "finalized" || r.status === "received") && (
            <Act
              icon={RefreshCw}
              label="רענן מהמפעל"
              title="משוך שוב את נתוני הגיליון (גם להצעה סופית)"
              onClick={() => handleForceRefresh(r)}
              busy={busy}
            />
          )}
          {r.status === "finalized" && (
            <Act icon={Pencil} label="ערוך כעותק" title="ערוך כעותק חדש — מקור נשמר" onClick={() => handleEditAsNew(r)} busy={busy} />
          )}
          {r.ghlUrl && <Act icon={ExternalLink} label="GHL" title="פתח ב-GHL" href={r.ghlUrl} newTab />}
          <Act icon={Trash2} label="מחק" title="מחק הצעה (לסל המיחזור)" tone="danger" onClick={() => handleDelete(r)} disabled={busy} />
        </div>
      </li>
    );
  }

  const shownGroups = groups.slice(0, groupLimit);

  return (
    <>
      <div className="grid gap-5">
        {unmatched.length > 0 && (
          <section className="ux-panel" aria-label="הצעות שלא הותאמו ללקוח">
            <h2>{unmatched.length} הצעות לא הותאמו ללקוח</h2>
            <p className="d">בחר לקוח לכל אחת:</p>
            <ul className="grid gap-2">
              {unmatched.map((u) => (
                <li key={u.quotationNo} className="flex items-center gap-3 flex-wrap">
                  <span className="tnum" style={{ fontFamily: "ui-monospace, monospace", color: "var(--lux-muted)" }}>{u.quotationNo}</span>
                  <span>{u.customer || "ללא שם"}</span>
                  <div className="flex-1 min-w-[200px]">
                    <LeadPickerAssign
                      apiToken={apiToken}
                      quotationNo={u.quotationNo}
                      customer={u.customer}
                      onDone={() => {
                        setUnmatched((cur) => cur.filter((x) => x.quotationNo !== u.quotationNo));
                        refresh();
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {needsSending.length + needsPricing.length + unsentDrafts.length === 0 ? (
          <section className="ux-todo ok" aria-label="לטיפול עכשיו">
            <h2>
              <CheckCircle2 className="size-4" aria-hidden /> אין הצעות שמחכות לך — כל מה שהמפעל החזיר נשלח ללקוח.
            </h2>
          </section>
        ) : (
          <>
            {needsSending.length > 0 && (
              <AlertShell
                tone="stop"
                icon={Send}
                title={`המפעל ענה — לשלוח ללקוח · ${needsSending.length}`}
                hint="«סופי» = מוכן לשליחה. «התקבל» = צריך לתמחר קודם, ואז לשלוח."
                ids={needsSending.map((r) => r.id)}
                selectedIds={needsSending.filter((r) => selected.has(r.id)).map((r) => r.id)}
                onToggleAll={(on) => toggleAll(needsSending.map((r) => r.id), on)}
                onClear={() => setSelected(new Set())}
                bulkBusy={bulkBusy}
                actions={
                  <>
                    {/* Only finalized rows can be "already sent" — a quote with no
                        price was never sent to anyone. */}
                    {needsSending.some((r) => selected.has(r.id) && r.status === "finalized") && (
                      <BulkButton
                        tone="go"
                        onClick={() => bulkMarkSent(needsSending.filter((r) => selected.has(r.id) && r.status === "finalized"))}
                      >
                        שלחתי כבר
                      </BulkButton>
                    )}
                    <BulkButton tone="danger" onClick={() => bulkDismiss(needsSending.filter((r) => selected.has(r.id)))}>
                      הסר מהתזכורת
                    </BulkButton>
                  </>
                }
              >
                {needsSending.map((r) => (
                  <AlertRow
                    key={r.id}
                    checked={selected.has(r.id)}
                    onCheck={() => toggleRow(r.id)}
                    name={r.name ?? r.leadSid.slice(0, 20)}
                    meta={
                      <>
                        <span className="tnum">{fmtDate(r.createdAt)}</span>
                        <span className="tnum">{r.quotationNo ?? r.id.slice(-6)}</span>
                        <span className="ux-pill" data-tone={r.status === "finalized" ? "good" : "warn"}>
                          {r.status === "finalized" ? "סופי — מוכן לשליחה" : "התקבל — צריך לתמחר"}
                        </span>
                      </>
                    }
                    actions={
                      <>
                        {r.status === "finalized" ? (
                          <>
                            <Act icon={MessageCircle} label="שלח ב-WhatsApp" tone="go" onClick={() => handleSendWhatsApp(r)} busy={busyId === r.id} />
                            <Act icon={Eye} label="צפה" title="צפה בהצעה" onClick={() => (r.finalPricing ? setOpened(r) : setSpecRow(r))} disabled={busyId === r.id} />
                            <Act icon={Check} label="שלחתי כבר" title="סמן כנשלח ידנית (בלי לשלוח מהמערכת)" onClick={() => handleMarkSent(r)} disabled={busyId === r.id} />
                          </>
                        ) : (
                          <>
                            {!r.finalPricing && (
                              <Act icon={Calculator} label="חשב הצעת מחיר" tone="primary" onClick={() => setFinalizing(r)} disabled={busyId === r.id} />
                            )}
                            <Act icon={Eye} label="צפה" title="פתח לתמחור ושליחה" onClick={() => (r.finalPricing ? setOpened(r) : setSpecRow(r))} disabled={busyId === r.id} />
                          </>
                        )}
                        <Act icon={X} label="הסר" title="הסר מהתזכורת (ליד מת — לא נמחק ולא נשלח, לא יחזור)" tone="danger" onClick={() => handleDismissReminder(r)} disabled={busyId === r.id} />
                      </>
                    }
                  />
                ))}
              </AlertShell>
            )}

            {needsPricing.length > 0 && (
              <AlertShell
                tone="go"
                icon={Calculator}
                title={`בקשות שממתינות לתמחור · ${needsPricing.length}${
                  needsPricing.some((r) => r.createdBy === "sales")
                    ? ` (${needsPricing.filter((r) => r.createdBy === "sales").length} מאיש מכירות)`
                    : ""
                }`}
                hint="מפרטים בלי מחיר — לתמחר במחשבון, ואז לשלוח ללקוח או למפעל."
                ids={needsPricing.map((r) => r.id)}
                selectedIds={needsPricing.filter((r) => selected.has(r.id)).map((r) => r.id)}
                onToggleAll={(on) => toggleAll(needsPricing.map((r) => r.id), on)}
                onClear={() => setSelected(new Set())}
                bulkBusy={bulkBusy}
                actions={
                  <BulkButton tone="danger" onClick={() => bulkDismiss(needsPricing.filter((r) => selected.has(r.id)))}>
                    הסר מהתזכורת
                  </BulkButton>
                }
              >
                {needsPricing.map((r) => (
                  <AlertRow
                    key={r.id}
                    checked={selected.has(r.id)}
                    onCheck={() => toggleRow(r.id)}
                    name={r.name ?? r.leadSid.slice(0, 20)}
                    meta={
                      <>
                        <span className="tnum">{fmtDate(r.createdAt)}</span>
                        <span className="tnum">{r.quotationNo ?? r.id.slice(-6)}</span>
                        {r.createdBy === "sales" && <span className="ux-pill" data-tone="go">בקשה מאיש מכירות</span>}
                      </>
                    }
                    actions={
                      <>
                        <Act icon={Calculator} label="תמחר" tone="primary" title="תמחר במחשבון" onClick={() => setEstimateRow(r)} disabled={busyId === r.id} />
                        <Act icon={Eye} label="מפרט" title="פתח את המפרט" onClick={() => setSpecRow(r)} disabled={busyId === r.id} />
                        <Act icon={X} label="הסר" title="הסר מהתזכורת (לא נמחק, לא יחזור)" tone="danger" onClick={() => handleDismissReminder(r)} disabled={busyId === r.id} />
                      </>
                    }
                  />
                ))}
              </AlertShell>
            )}

            {unsentDrafts.length > 0 && (
              <AlertShell
                tone="warn"
                icon={MessageCircle}
                title={`טיוטות שעוד לא נשלחו ללקוח · ${unsentDrafts.length}`}
                hint="אומדנים שחישבת ולא נשלחו — שלח ללקוח, או אשר ושלח למפעל."
                ids={unsentDrafts.map((r) => r.id)}
                selectedIds={unsentDrafts.filter((r) => selected.has(r.id)).map((r) => r.id)}
                onToggleAll={(on) => toggleAll(unsentDrafts.map((r) => r.id), on)}
                onClear={() => setSelected(new Set())}
                bulkBusy={bulkBusy}
                actions={
                  <BulkButton tone="go" onClick={() => bulkMarkSent(unsentDrafts.filter((r) => selected.has(r.id)))}>
                    שלחתי כבר
                  </BulkButton>
                }
              >
                {unsentDrafts.map((r) => (
                  <AlertRow
                    key={r.id}
                    checked={selected.has(r.id)}
                    onCheck={() => toggleRow(r.id)}
                    name={r.name ?? r.leadSid.slice(0, 20)}
                    meta={
                      <>
                        <span className="tnum">{fmtDate(r.createdAt)}</span>
                        <span className="tnum">{r.quotationNo ?? r.id.slice(-6)}</span>
                        <span className="tnum" style={{ color: "var(--lux-ink)" }} title="מחיר משוער">
                          ~{fmtMoney(displayTotal(r.finalPricing as Record<string, unknown>))}
                        </span>
                      </>
                    }
                    actions={
                      <>
                        <Act icon={MessageCircle} label="שלח ב-WhatsApp" tone="go" title="שלח את האומדן ללקוח ב-WhatsApp" onClick={() => handleSendWhatsApp(r)} busy={busyId === r.id} />
                        <Act icon={Eye} label="צפה" title="צפה בהצעה" onClick={() => (r.finalPricing ? setOpened(r) : setSpecRow(r))} disabled={busyId === r.id} />
                        <Act icon={Check} label="שלחתי כבר" title="סמן כנשלח ידנית (בלי לשלוח מהמערכת)" onClick={() => handleMarkSent(r)} disabled={busyId === r.id} />
                      </>
                    }
                  />
                ))}
              </AlertShell>
            )}
          </>
        )}

        <section aria-labelledby="qh-all">
          <div className="ux-sechead">
            <h2 id="qh-all">כל ההצעות · {groups.length === 1 ? "לקוח אחד" : `${groups.length} לקוחות`}</h2>
            <span className="hint">לחיצה על לקוח פותחת את ההצעות שלו</span>
          </div>
          <label className="ux-search" style={{ marginBottom: 12 }}>
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="ux-sr">חיפוש הצעה</span>
            <input
              type="search"
              placeholder="חיפוש לפי שם, טלפון או מספר הצעה"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setGroupLimit(GROUP_PAGE);
              }}
            />
          </label>
          <div className="ux-chips" role="group" aria-label="סינון לפי מצב" style={{ marginBottom: 14 }}>
            {([
              { id: "all", label: "הכל", n: counts.all },
              { id: "draft", label: "טיוטות", n: counts.draft },
              { id: "pending", label: "ממתינים למפעל", n: counts.pending },
              { id: "received", label: "המפעל ענה", n: counts.received },
              { id: "finalized", label: "סופיים", n: counts.finalized },
            ] as const).map((b) => (
              <button
                key={b.id}
                type="button"
                className="ux-chip"
                aria-pressed={statusFilter === b.id}
                onClick={() => {
                  setStatusFilter(b.id);
                  setGroupLimit(GROUP_PAGE);
                }}
              >
                {b.label} <span className="tnum">{b.n}</span>
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <div className="ux-panel" style={{ textAlign: "center", color: "var(--lux-muted)" }}>
              {q ? `לא נמצאה הצעה עם ״${q}״.` : "אין הצעות במצב הזה."}
            </div>
          ) : (
            <div className="ux-list">
              {shownGroups.map((g) => {
                const open = openCards.has(g.leadSid);
                const canCalc = g.priceableCount > 0;
                // Combined offer = all this customer's FINALIZED quotes (the
                // combined PDF route requires every id to be finalized).
                // Anything PRICED can form a combined offer — a factory-finalized
                // quote or a self-calculated draft. Restricting this to finalized
                // meant a customer holding only estimates could never get a
                // combined offer (Eli 2026-08-02).
                const finalizedIds = g.rows
                  .filter((r) => r.finalPricing && (r.status === "finalized" || r.status === "draft"))
                  .map((r) => r.id);
                const canSendCombined = finalizedIds.length >= 1;
                const combinedPdfHref = `/api/factory/combine/pdf?ids=${finalizedIds.join(",")}`;
                const ghlUrl = g.rows[0]?.ghlUrl ?? null;
                const sentCount = g.rows.filter((r) => r.sentToCustomerAt).length;
                const name = g.name ?? g.leadSid.slice(0, 20);
                return (
                  <div key={g.leadSid} className="qh-g">
                    <button
                      type="button"
                      className="qh-head"
                      aria-expanded={open}
                      onClick={() => toggleCard(g.leadSid)}
                    >
                      <span className="main">
                        <span className="nm">{name}</span>
                        <span className="sub tnum">
                          {g.rows.length === 1 ? "הצעה אחת" : `${g.rows.length} הצעות`} · {fmtDate(g.latestAt)}
                          {sentCount > 0 ? ` · ${sentCount} נשלחו ללקוח` : ""}
                        </span>
                      </span>
                      <span className="pills">
                        {Object.entries(g.statusCounts).map(([st, n]) => (
                          <span key={st} className="ux-pill" data-tone={STATUS_LABEL[st]?.tone ?? "idle"}>
                            {STATUS_LABEL[st]?.text ?? st} {n}
                          </span>
                        ))}
                      </span>
                      <ChevronDown className="size-4 chev" aria-hidden />
                    </button>
                    {open && (
                      <div className="qh-body">
                        <div className="ux-acts qh-gacts" role="group" aria-label={`פעולות על כל ההצעות של ${name}`}>
                          <span className="qh-gl">כל ההצעות של הלקוח:</span>
                          {/* Eye opens the FULL combined view (boss breakdown of
                              every quote + customer-PDF link inside) — Eli
                              2026-07-17: "the eye should open everything". */}
                          {canCalc && <Act icon={Pencil} label="חישוב משולב ופירוט" tone="primary" title="פירוט מלא לבוס + PDF, עריכה וחישוב משולב" onClick={() => setCalcGroup(g)} />}
                          {canSendCombined && (
                            <Act
                              icon={MessageCircle}
                              label="שלח הצעה משולבת"
                              tone="go"
                              title="שלח הצעה משולבת ב-WhatsApp"
                              onClick={() => handleSendCombined(g.leadSid, g.name, finalizedIds)}
                              busy={busyId === `combine:${g.leadSid}`}
                            />
                          )}
                          {canSendCombined && <Act icon={Download} label="PDF משולב" title="הורד PDF משולב ללקוח" href={combinedPdfHref} newTab />}
                          {finalizedIds.length >= 2 && (
                            <Act
                              icon={CheckCircle2}
                              label={`סגור עסקה משולבת (${finalizedIds.length})`}
                              title={`${finalizedIds.length} מוצרים → עסקה אחת עם חשבונית אחת`}
                              tone="warn"
                              onClick={() => handleCloseDealGroup(g.leadSid, finalizedIds)}
                              busy={busyId === `closegroup:${g.leadSid}`}
                            />
                          )}
                          {ghlUrl && <Act icon={ExternalLink} label="GHL" title="פתח ב-GHL" href={ghlUrl} newTab />}
                          <Act
                            icon={Trash2}
                            label="מחק הכל"
                            title="מחק את כל הצעות הלקוח (לסל המיחזור)"
                            tone="danger"
                            onClick={() => handleDeleteGroup(g)}
                            busy={busyId === `group:${g.leadSid}`}
                          />
                        </div>
                        <DraftVsFactoryStrip rows={g.rows} />
                        <ul>{g.rows.map((r) => renderQuoteRow(r))}</ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {groups.length > groupLimit && (
            <button type="button" className="ux-btn" style={{ marginTop: 12, width: "100%" }} onClick={() => setGroupLimit((n) => n + GROUP_PAGE)}>
              הצג עוד {Math.min(GROUP_PAGE, groups.length - groupLimit)} מתוך {groups.length - groupLimit}
            </button>
          )}
        </section>

        {/* Rarely used tools live at the bottom, folded. */}
        <details className="ux-panel ux-fold" open={showTrash} style={{ marginTop: 0 }}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              void toggleTrash();
            }}
          >
            <span className="flex items-center gap-2">
              <Trash className="size-4" aria-hidden />
              סל מיחזור וייבוא מ-Feishu{trash && trash.length > 0 ? ` · ${trash.length} בסל` : ""}
            </span>
            <ChevronDown className="size-4 chev" aria-hidden />
          </summary>
          <div className="grid gap-3" style={{ paddingBottom: 6 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontSize: 14, color: "var(--lux-muted)", flex: "1 1 240px" }}>
                נמחקו הצעות? אפשר לייבא אותן מחדש מ-Feishu, עם אותו מספר הצעה ועם תשובת המפעל.
              </span>
              <Act icon={Download} label="ייבא מ-Feishu" onClick={handleImport} busy={importing} />
            </div>
            <div style={{ fontSize: 14, color: "var(--lux-muted)" }}>הצעות שנמחקו — שחזר כדי להחזיר לרשימה, או מחק לצמיתות.</div>
            {trash === null ? (
              <div className="ux-skel" style={{ height: 60 }} aria-label="טוען" />
            ) : trash.length === 0 ? (
              <div style={{ fontSize: 14, color: "var(--lux-muted)" }}>הסל ריק.</div>
            ) : (
              <ul className="ux-list">
                {trash.map((r) => (
                  <li key={r.id} className="qh-q">
                    <div className="l1">
                      <span className="nm">{r.name ?? r.leadSid.slice(0, 20)}</span>
                      <span className="no tnum">{r.quotationNo ?? r.id.slice(-6)}</span>
                      <span className="tnum" style={{ color: "var(--lux-muted)" }}>{fmtDate(r.createdAt)}</span>
                      <span className="ux-pill" data-tone={STATUS_LABEL[r.status]?.tone ?? "idle"}>{STATUS_LABEL[r.status]?.text ?? r.status}</span>
                    </div>
                    <div className="ux-acts">
                      <Act icon={RotateCcw} label="שחזר" tone="go" onClick={() => handleRestore(r)} busy={busyId === r.id} />
                      <Act icon={Trash2} label="מחק לצמיתות" tone="danger" onClick={() => handleHardDelete(r)} disabled={busyId === r.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>

      {payModal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
          dir="rtl"
          onClick={() => setPayModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border p-5 space-y-4"
            style={{ backgroundColor: "#1b1917" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-base font-semibold">שליחת הצעה ל-{payModal.row.name ?? "לקוח"}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {payModal.row.status === "draft"
                  ? "זהו מחיר שחישבת — לא הצעה סופית מהמפעל."
                  : "ההודעה תכלול מע״מ, סה״כ לתשלום, פריסת תשלומים ופרטי בנק."}
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">פריסת תשלומים</div>
              <div className="flex flex-wrap gap-2">
                {PAYMENT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPayModal({ ...payModal, planId: p.id, customPct: "" })}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      payModal.planId === p.id && !payModal.customPct
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border bg-card/40 text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    placeholder="אחר %"
                    value={payModal.customPct}
                    onChange={(e) => setPayModal({ ...payModal, customPct: e.target.value })}
                    className="w-20 rounded-md border border-border bg-background/40 px-2 py-1.5 text-xs text-center tabular-nums"
                  />
                  <span className="text-[13px] text-muted-foreground">מקדמה</span>
                </div>
              </div>
              <p className="text-[13px] text-muted-foreground">
                {(() => {
                  const pct = parseInt(payModal.customPct, 10);
                  const plan =
                    Number.isFinite(pct) && pct > 0 && pct < 100
                      ? customDepositPlan(pct)
                      : PAYMENT_PRESETS.find((p) => p.id === payModal.planId) ?? PAYMENT_PRESETS[0];
                  return `יישלח: ${plan.pcts.map((x) => `${x}%`).join(" · ")}`;
                })()}
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setPayModal(null)}
                className="text-xs px-3 py-2 rounded-md border border-border text-muted-foreground hover:bg-secondary"
              >
                ביטול
              </button>
              <button
                type="button"
                disabled={busyId === payModal.row.id}
                onClick={() => {
                  const pct = parseInt(payModal.customPct, 10);
                  const planId =
                    Number.isFinite(pct) && pct > 0 && pct < 100
                      ? customDepositPlan(pct).id
                      : payModal.planId;
                  const row = payModal.row;
                  setPayModal(null);
                  void doSendWhatsApp(row, planId);
                }}
                className="text-xs px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busyId === payModal.row.id ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
                שלח ב-WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

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

  const fmtUnit3 = (v: number | null) => (v === null ? "—" : `₪${v.toLocaleString("he-IL", { maximumFractionDigits: 3 })}`);
  // What Eli actually wants to validate: how close was MY estimate of the
  // factory's cost/volume to what the factory ACTUALLY charged. So compare the
  // raw factory COST (not the customer selling price, which bundles shipping +
  // margin). Selling price kept as a secondary row.
  const rowsCmp: { label: string; draftV: number | null; factV: number | null; fmt: (v: number | null) => string }[] = [
    { label: "עלות מפעל ליחידה", draftV: num(dp.unitCost), factV: num(fp.unitCost), fmt: fmtUnit3 },
    { label: "עלות מפעל סה״כ", draftV: num(dp.totalCost), factV: num(fp.totalCost), fmt: fmtUnit },
    { label: "נפח משלוח (CBM)", draftV: num(dp.totalCbm), factV: num(fp.totalCbm), fmt: fmtCbm },
    { label: "עלות שילוח", draftV: num(dp.totalShipping), factV: num(fp.totalShipping), fmt: fmtUnit },
    { label: "מחיר ללקוח ליחידה", draftV: num(dp.unitSellingPrice), factV: num(fp.unitSellingPrice), fmt: fmtUnit },
  ];

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 mb-1.5" dir="rtl">
      <div className="text-[13px] font-medium text-amber-400 mb-1.5 flex items-center gap-1.5">
        <Sparkles className="size-3" />
        טיוטה מול הצעת מפעל
        <span className="text-xs text-muted-foreground font-normal">
          (אומדן #{estId} · מפעל #{factory.quotationNo ?? factory.id.slice(-5)})
        </span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[13px] items-center">
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


/**
 * The reminder panels — one shell, three uses (ui-ux-pro-max, 18/09).
 *
 * Every row is the same block: tick · name + details · labelled actions (they
 * wrap under the name on a phone). Each panel can be worked in one pass: tick
 * "בחר הכל", then one action for the lot. Colour AND words mark the kind.
 */
type Tone = "stop" | "go" | "warn";

function AlertShell({
  tone,
  icon: Icon,
  title,
  hint,
  ids,
  selectedIds,
  onToggleAll,
  onClear,
  bulkBusy,
  actions,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  hint: string;
  ids: string[];
  selectedIds: string[];
  onToggleAll: (on: boolean) => void;
  onClear: () => void;
  bulkBusy: string | null;
  /** Bulk buttons — rendered only while something is ticked. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const allOn = ids.length > 0 && selectedIds.length === ids.length;
  return (
    <section className="ux-panel qh-alert" data-tone={tone} aria-label={title}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="flex items-center gap-2">
          <Icon className="size-4 shrink-0" aria-hidden />
          {title}
        </h2>
        <label className="qh-check">
          <input type="checkbox" checked={allOn} onChange={(e) => onToggleAll(e.target.checked)} />
          בחר הכל
        </label>
      </div>
      <p className="d">{hint}</p>

      {selectedIds.length > 0 && (
        <div className="qh-bulk" aria-live="polite">
          <span className="tnum">{selectedIds.length} מסומנות</span>
          {bulkBusy ? (
            <span className="inline-flex items-center gap-2" style={{ color: "var(--lux-muted)" }}>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {bulkBusy}
            </span>
          ) : (
            <>
              {actions}
              <BulkButton onClick={onClear}>נקה בחירה</BulkButton>
            </>
          )}
        </div>
      )}

      <ul className="qh-items">{children}</ul>
    </section>
  );
}

function BulkButton({ onClick, children, tone }: { onClick: () => void; children: React.ReactNode; tone?: "go" | "danger" }) {
  return (
    <button type="button" onClick={onClick} className={`ux-btn sm${tone ? ` ${tone}` : ""}`}>
      {children}
    </button>
  );
}

/** One reminder row: tick · name + details · the row's own actions. */
function AlertRow({
  checked,
  onCheck,
  name,
  meta,
  actions,
}: {
  checked: boolean;
  onCheck: () => void;
  name: string;
  meta: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <li className="qh-item" data-on={checked || undefined}>
      <label className="qh-check">
        <input type="checkbox" checked={checked} onChange={onCheck} />
        <span className="ux-sr">בחר את {name}</span>
      </label>
      <div className="main">
        <div className="nm">{name}</div>
        <div className="meta">{meta}</div>
      </div>
      <div className="ux-acts">{actions}</div>
    </li>
  );
}

/** A labelled action — 44px, icon + words (never an icon alone). */
function Act({
  icon: Icon,
  label,
  title,
  onClick,
  href,
  newTab,
  busy,
  disabled,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  onClick?: () => void;
  href?: string;
  newTab?: boolean;
  busy?: boolean;
  disabled?: boolean;
  tone?: "primary" | "go" | "warn" | "danger";
}) {
  const cls = `ux-btn sm${tone ? ` ${tone}` : ""}`;
  const body = (
    <>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      {label}
    </>
  );
  if (href) {
    return (
      <a className={cls} href={href} title={title} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" className={cls} title={title} onClick={onClick} disabled={disabled || busy}>
      {body}
    </button>
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
        className="relative w-full max-w-3xl max-h-[90dvh] rounded-lg border border-border bg-card flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80">
          <div className="text-sm font-semibold">
            {row.name ?? row.leadSid.slice(0, 25)}
            <span className="text-[13px] text-muted-foreground font-mono mx-2">
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
