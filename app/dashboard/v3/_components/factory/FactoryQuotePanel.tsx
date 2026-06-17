"use client";

/**
 * Order-summary panel embedded in the per-lead view (under "הערות").
 *
 * Four states based on the linked factory_quote_requests row:
 *   - none      → "Send to factory" button
 *   - pending   → "waiting for factory + refresh" affordance
 *   - received  → factory response read-only + "Finalize" CTA
 *   - finalized → full summary + PDF + WhatsApp + re-finalize
 *
 * State is fetched on mount via /api/factory/list?lead={sid} and refreshed
 * after each mutation. No real-time push.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Factory,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  Download,
  MessageCircle,
  Loader2,
  Send,
  ShoppingBag,
  Hash,
  Package,
  Palette,
  Truck,
  TrendingUp,
  Boxes,
  CheckCircle2,
  Eye,
  Trash2,
  Repeat,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  FactoryProductSpec,
  FactoryResponse,
  FactoryPricingResult,
  FactoryPricingConfig,
  FactoryQuoteStatus,
} from "@/lib/factory/types";
import { DetailedBreakdown } from "@/components/calculator/DetailedBreakdown";
import { QuoteHtmlPreview } from "./QuoteHtmlPreview";
import {
  decodeQStateToSpec,
  decodeShipping,
  humanizeFinishing,
  humanizeMaterial,
  humanizePrinting,
  PRODUCT_LABEL,
} from "@/lib/factory/qstate-decode";
import { SendToFactoryForm } from "./SendToFactoryForm";
import { FinalizeModal } from "./FinalizeModal";
import { HistoryDetailModal } from "./HistoryDetailModal";

// Hebrew "W×H×D ס״מ" for the order-summary preview. The factory-facing string
// stays English ("H20*D8*W25"); this is only for the dashboard operator view.
function hebrewSize(spec: {
  widthCm?: number;
  heightCm?: number;
  depthCm?: number;
}): string {
  const parts: string[] = [];
  if (spec.widthCm) parts.push(`רוחב ${spec.widthCm}`);
  if (spec.heightCm) parts.push(`גובה ${spec.heightCm}`);
  if (spec.depthCm) parts.push(`עומק ${spec.depthCm}`);
  if (parts.length === 0) return "";
  return `${parts.join(" × ")} ס״מ`;
}

export interface FactoryQuoteRow {
  id: string;
  manychatSubId: string;
  quotationNo: string | null;
  createdAt: string;
  updatedAt: string;
  productSpec: FactoryProductSpec;
  feishuRowIndex: string | null;
  factoryStatus: FactoryQuoteStatus;
  factoryResponse: FactoryResponse | null;
  finalPricing: FactoryPricingResult | null;
  pdfUrl: string | null;
  sentToCustomerAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
}

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function statusBadge(status: FactoryQuoteStatus) {
  const map: Record<FactoryQuoteStatus, { label: string; tone: string }> = {
    draft: { label: "טיוטה", tone: "bg-muted/40 text-muted-foreground border-border" },
    pending: { label: "ממתין למפעל", tone: "bg-warning/15 text-warning border-warning/30" },
    received: { label: "התקבלה תשובה", tone: "bg-primary/15 text-primary border-primary/30" },
    finalized: { label: "הצעה סופית", tone: "bg-success/15 text-success border-success/30" },
  };
  const m = map[status];
  return (
    <span className={cn("text-[10px] rounded-full px-2 py-0.5 border", m.tone)}>
      {m.label}
    </span>
  );
}

export function FactoryQuotePanel({
  leadId,
  leadName,
  qState,
  factorySpecDraft,
}: {
  leadId: string;
  leadName: string | null;
  qState: Record<string, unknown> | null;
  factorySpecDraft?: Record<string, unknown> | null;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FactoryQuoteRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  // Separate toggle for the "create an additional quote" form that's available
  // even when an active quote exists (e.g. customer wants a second offer
  // before the factory returns the first).
  const [extraFormOpen, setExtraFormOpen] = useState(false);
  const [finalizing, setFinalizing] = useState<FactoryQuoteRow | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState<string | null>(null);
  const [editingAsNew, setEditingAsNew] = useState(false);

  // Local view of the draft so we can update without a full page reload.
  const [draft, setDraft] = useState<Record<string, unknown> | null>(
    factorySpecDraft ?? null
  );
  useEffect(() => {
    setDraft(factorySpecDraft ?? null);
  }, [factorySpecDraft]);

  const [notesDraft, setNotesDraft] = useState<string>(
    String((factorySpecDraft as Record<string, unknown> | null)?.notes ?? "")
  );
  const [sendingSummary, setSendingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Resolved spec for the inline view: prefer draft, fall back to decoded qState.
  const resolvedSpec = useMemo(() => {
    if (draft && Object.keys(draft).length > 0) {
      return {
        source: "draft" as const,
        description: String(draft.description ?? ""),
        material: String(draft.material ?? ""),
        widthCm: Number(draft.widthCm) || 0,
        heightCm: Number(draft.heightCm) || 0,
        depthCm: Number(draft.depthCm) || 0,
        quantity: Number(draft.quantity) || 0,
        printing: String(draft.printing ?? ""),
        finishing: String(draft.finishing ?? ""),
        shippingCode: null as string | null,
      };
    }
    const decoded = decodeQStateToSpec(qState);
    if (!decoded) return null;
    return {
      source: "bot" as const,
      description: decoded.description,
      material: "80g non-woven",
      widthCm: decoded.widthCm,
      heightCm: decoded.heightCm,
      depthCm: decoded.depthCm,
      quantity: decoded.quantity,
      printing: `${decoded.logoColors} color${decoded.logoColors > 1 ? "s" : ""}`,
      finishing: `${decoded.hasHandles ? "With handles" : "No handles"} / Not laminated`,
      shippingCode: decoded.shippingOptionCode,
    };
  }, [draft, qState]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/factory/list?lead=${encodeURIComponent(leadId)}`
      );
      const data = await res.json();
      if (data?.ok) setRows(data.requests || []);
    } catch (err) {
      console.error("[FactoryQuotePanel] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/factory/refresh", { method: "POST" });
      const data = await res.json();
      if (data?.ok) {
        await load();
      }
    } catch (err) {
      console.error("[FactoryQuotePanel] refresh failed", err);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const handleSendWhatsapp = useCallback(
    async (row: FactoryQuoteRow) => {
      if (!confirm(`לשלוח את ההצעה ב-WhatsApp ל-${row.customerName ?? "הלקוח"}?`)) return;
      setWhatsappLoading(row.id);
      try {
        const res = await fetch(`/api/factory/${row.id}/send-whatsapp`, {
          method: "POST",
        });
        const data = await res.json();
        if (data?.ok) {
          alert("נשלח ✓");
          await load();
        } else {
          alert(`שגיאה: ${data?.error ?? "unknown"}\n${data?.message ?? data?.detail ?? ""}`);
        }
      } catch (err) {
        alert(`כשל: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setWhatsappLoading(null);
      }
    },
    [load]
  );

  // Active = most recent non-draft row. Drafts are parked alongside the main
  // pipeline (operator hasn't sent them to Feishu yet) and live exclusively in
  // the history list, where they can be promoted via send-to-feishu.
  const active = rows.find((r) => r.factoryStatus !== "draft") ?? null;

  const handleEditAsNew = useCallback(
    async (row: FactoryQuoteRow) => {
      if (editingAsNew) return;
      setEditingAsNew(true);
      try {
        const res = await fetch(`/api/factory/${row.id}/clone`, { method: "POST" });
        const data = await res.json();
        if (!data?.ok) {
          alert(`שגיאה בשכפול: ${data?.error ?? "unknown"}`);
          return;
        }
        const clonedId: string = data.id;
        const listRes = await fetch(`/api/factory/list?lead=${encodeURIComponent(leadId)}`);
        const listData = await listRes.json();
        const fresh: FactoryQuoteRow[] = listData?.ok ? listData.requests : [];
        setRows(fresh);
        const cloned = fresh.find((r) => r.id === clonedId);
        if (cloned) {
          setFinalizing(cloned);
        } else {
          alert("השכפול נוצר אך לא נמצא — רענן ידנית.");
        }
      } catch (err) {
        alert(`כשל: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setEditingAsNew(false);
      }
    },
    [editingAsNew, leadId]
  );

  const handleSendFromSummary = useCallback(async () => {
    if (!resolvedSpec) return;
    setSummaryError(null);
    setSendingSummary(true);
    try {
      const res = await fetch("/api/factory/quote-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manychatSubId: leadId,
          customerName: leadName ?? undefined,
          productSpec: {
            description: notesDraft.trim() || resolvedSpec.description,
            material: resolvedSpec.material || "80g non-woven",
            widthCm: resolvedSpec.widthCm,
            heightCm: resolvedSpec.heightCm,
            depthCm: resolvedSpec.depthCm,
            quantity: resolvedSpec.quantity,
            printing: resolvedSpec.printing,
            finishing: resolvedSpec.finishing,
            notes: notesDraft.trim() || undefined,
            // Carry the customer's bot-chosen shipping (s1/s2) so FinalizeModal
            // defaults to it instead of the first-enabled fallback.
            ...(resolvedSpec.shippingCode
              ? { shippingOptionId: resolvedSpec.shippingCode }
              : {}),
          },
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        setDraft(null);
        setNotesDraft("");
        await load();
      } else {
        setSummaryError(data?.error ?? data?.detail ?? "כשל בשליחה");
      }
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingSummary(false);
    }
  }, [leadId, leadName, resolvedSpec, notesDraft, load]);

  const handleClearDraft = useCallback(async () => {
    if (!draft) return;
    if (!confirm("למחוק את הנתונים הידניים שמילאת?")) return;
    try {
      await fetch(`/api/leads/${encodeURIComponent(leadId)}/factory-draft`, {
        method: "DELETE",
      });
      setDraft(null);
      setNotesDraft("");
    } catch (err) {
      console.error("[FactoryQuotePanel] clear draft failed", err);
    }
  }, [draft, leadId]);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="flex items-center justify-between gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-1">
        <div className="flex items-center gap-1.5">
          <Factory className="size-3.5" />
          הצעות מפעל (ידניות)
        </div>
        {active && statusBadge(active.factoryStatus)}
      </header>
      <p className="mb-3 text-[11px] leading-snug text-muted-foreground border-r-2 border-muted-foreground/30 pr-2">
        בקשות ציטוט מהמפעל ששלחת ידנית ל-Feishu. כל פעם ש-{`"`}שלח לסיכום
        הזמנה{`"`} נלחץ (מפה או מהיסטוריית הבוט) — נוספת שורה חדשה.{" "}
        <strong>לא</strong> מתעדכן אוטומטית מההצעות שהבוט שולח ללקוח.
      </p>

      {loading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" />
          טוען…
        </div>
      ) : !active ? (
        <NoQuoteState
          spec={resolvedSpec}
          notes={notesDraft}
          onNotesChange={setNotesDraft}
          sending={sendingSummary}
          summaryError={summaryError}
          onSendFromSummary={handleSendFromSummary}
          hasDraft={!!draft}
          onClearDraft={handleClearDraft}
          formOpen={formOpen}
          onToggleForm={() => setFormOpen((v) => !v)}
          leadId={leadId}
          leadName={leadName}
          qState={qState}
          draft={draft}
          onFormSent={() => {
            setFormOpen(false);
            setDraft(null);
            setNotesDraft("");
            load();
          }}
          onFormSavedDraft={(saved) => {
            setDraft(saved);
            setNotesDraft(String(saved.notes ?? ""));
            setFormOpen(false);
          }}
        />
      ) : active.factoryStatus === "pending" ? (
        <PendingState row={active} onRefresh={handleRefresh} refreshing={refreshing} />
      ) : active.factoryStatus === "received" ? (
        <ReceivedState
          row={active}
          onFinalize={() => setFinalizing(active)}
        />
      ) : (
        <FinalizedState
          row={active}
          onEditAsNew={() => handleEditAsNew(active)}
          editingAsNew={editingAsNew}
          onSendWhatsapp={() => handleSendWhatsapp(active)}
          whatsappLoading={whatsappLoading === active.id}
        />
      )}

      {active && (
        <ExtraQuoteSection
          leadId={leadId}
          leadName={leadName}
          qState={qState}
          activeRow={active}
          open={extraFormOpen}
          onToggle={() => setExtraFormOpen((v) => !v)}
          onSent={() => {
            setExtraFormOpen(false);
            load();
          }}
          onSavedDraft={() => {
            setExtraFormOpen(false);
            load();
          }}
        />
      )}

      {rows.length > 0 && (
        <HistoryList rows={rows} onChange={load} />
      )}

      {finalizing && (
        <FinalizeModal
          row={finalizing}
          onClose={() => setFinalizing(null)}
          onFinalized={() => {
            setFinalizing(null);
            load();
          }}
        />
      )}
    </section>
  );
}

type ResolvedSpec = {
  source: "bot" | "draft";
  description: string;
  material: string;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  quantity: number;
  printing: string;
  finishing: string;
  shippingCode: string | null;
};

function NoQuoteState({
  spec,
  notes,
  onNotesChange,
  sending,
  summaryError,
  onSendFromSummary,
  hasDraft,
  onClearDraft,
  formOpen,
  onToggleForm,
  leadId,
  leadName,
  qState,
  draft,
  onFormSent,
  onFormSavedDraft,
}: {
  spec: ResolvedSpec | null;
  notes: string;
  onNotesChange: (v: string) => void;
  sending: boolean;
  summaryError: string | null;
  onSendFromSummary: () => void;
  hasDraft: boolean;
  onClearDraft: () => void;
  formOpen: boolean;
  onToggleForm: () => void;
  leadId: string;
  leadName: string | null;
  qState: Record<string, unknown> | null;
  draft: Record<string, unknown> | null;
  onFormSent: () => void;
  onFormSavedDraft: (saved: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      {spec ? (
        <SpecPreview
          spec={spec}
          hasDraft={hasDraft}
          onClearDraft={onClearDraft}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          עוד לא נשלחה הצעה למפעל ואין נתונים אוטומטיים. מלא ידנית למטה.
        </p>
      )}

      {spec && (
        <div className="space-y-1.5">
          <label className="block text-[11px] text-muted-foreground text-right">
            הערות להזמנה (Description ב-Feishu)
          </label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={2}
            placeholder="הערות חופשיות שיוצגו בעמודת התיאור בטבלת המפעל"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {summaryError && (
            <p className="text-xs text-destructive">{summaryError}</p>
          )}
          <button
            type="button"
            onClick={onSendFromSummary}
            disabled={sending}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            שלח ל-Feishu מהסיכום
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onToggleForm}
        className="w-full inline-flex items-center justify-between gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary"
      >
        <span className="inline-flex items-center gap-1.5">
          {formOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {formOpen ? "סגור טופס ידני" : (spec ? "ערוך / החלף ידנית" : "פתח טופס ידני")}
        </span>
      </button>
      {formOpen && (
        <div className="rounded-md border border-border bg-background/40 p-3">
          <SendToFactoryForm
            leadId={leadId}
            leadName={leadName}
            qState={qState}
            draft={draft}
            onSent={onFormSent}
            onSavedDraft={(saved) => onFormSavedDraft(saved)}
            onCancel={onToggleForm}
          />
        </div>
      )}
    </div>
  );
}

function SpecPreview({
  spec,
  hasDraft,
  onClearDraft,
}: {
  spec: ResolvedSpec;
  hasDraft: boolean;
  onClearDraft: () => void;
}) {
  const sizeHe = hebrewSize(spec);
  const materialHe = spec.material ? humanizeMaterial(spec.material) : "";
  const printingHe = spec.printing ? humanizePrinting(spec.printing) : "";
  const finishingHe = spec.finishing ? humanizeFinishing(spec.finishing) : "";
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2 -mt-1">
        <span
          className={cn(
            "text-[10px] rounded-full px-2 py-0.5 border",
            spec.source === "draft"
              ? "bg-primary/10 text-primary border-primary/30"
              : "bg-muted/40 text-muted-foreground border-border"
          )}
        >
          {spec.source === "draft" ? "📝 הוזן ידנית" : "🤖 אוטומטית מהבוט"}
        </span>
        {hasDraft && (
          <button
            type="button"
            onClick={onClearDraft}
            className="text-[10px] text-muted-foreground hover:text-destructive underline-offset-2 hover:underline"
          >
            מחק נתונים ידניים
          </button>
        )}
      </div>
      <dl className="text-xs">
        <SpecRow icon={<ShoppingBag className="size-3" />} label="מוצר" value={spec.description || "—"} />
        {sizeHe && (
          <SpecRow icon={<Package className="size-3" />} label="מידות" value={sizeHe} />
        )}
        {spec.quantity > 0 && (
          <SpecRow icon={<Hash className="size-3" />} label="כמות" value={spec.quantity.toLocaleString("he-IL") + " יח׳"} />
        )}
        {materialHe && (
          <SpecRow icon={<Package className="size-3" />} label="חומר" value={materialHe} />
        )}
        {printingHe && (
          <SpecRow icon={<Palette className="size-3" />} label="הדפסה" value={printingHe} />
        )}
        {finishingHe && (
          <SpecRow icon={<Package className="size-3" />} label="גימור" value={finishingHe} />
        )}
        {spec.shippingCode && (
          <SpecRow icon={<Truck className="size-3" />} label="משלוח" value={decodeShipping(spec.shippingCode)} />
        )}
      </dl>
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
    <div className="flex items-center justify-between gap-2 py-0.5">
      <dt className="text-muted-foreground inline-flex items-center gap-1 shrink-0">
        {icon}
        {label}
      </dt>
      <dd className="text-right text-foreground break-words min-w-0">{value}</dd>
    </div>
  );
}

function PendingState({
  row,
  onRefresh,
  refreshing,
}: {
  row: FactoryQuoteRow;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground text-xs">
        נשלח ל-Feishu — ממתין שהמפעל ימלא את המפרט והמחיר.
      </p>
      <dl className="text-xs divide-y divide-border/60">
        <Row label="הצעה" value={row.quotationNo ?? row.id.slice(-6)} />
        <Row label="שורה ב-Feishu" value={row.feishuRowIndex ?? "—"} />
        <Row label="נשלח" value={new Date(row.createdAt).toLocaleString("he-IL")} />
      </dl>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2 text-sm hover:bg-secondary disabled:opacity-60"
      >
        {refreshing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        רענן מ-Feishu
      </button>
    </div>
  );
}

function ReceivedState({
  row,
  onFinalize,
}: {
  row: FactoryQuoteRow;
  onFinalize: () => void;
}) {
  const resp = row.factoryResponse!;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground text-xs">
        תשובת המפעל התקבלה. בחר אחוז רווח ושיטת שילוח כדי לחשב הצעה סופית.
      </p>
      <dl className="text-xs divide-y divide-border/60">
        <Row label="עלות יחידה" value={`¥${resp.unitCostCny}`} />
        {resp.cartonQty !== undefined && (
          <Row label="יח׳/קרטון" value={String(resp.cartonQty)} />
        )}
        {resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm && (
          <Row
            label="מידות קרטון (cm)"
            value={`${resp.cartonLengthCm}×${resp.cartonWidthCm}×${resp.cartonHeightCm}`}
          />
        )}
        {resp.cartonCbm !== undefined && (
          <Row label="CBM לקרטון" value={resp.cartonCbm.toFixed(3)} />
        )}
        {resp.weightKg !== undefined && (
          <Row label="משקל קרטון" value={`${resp.weightKg} ק״ג`} />
        )}
        {resp.supplier && <Row label="ספק" value={resp.supplier} />}
      </dl>
      <button
        type="button"
        onClick={onFinalize}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Sparkles className="size-3.5" />
        חשב הצעה סופית
      </button>
    </div>
  );
}

let cachedConfigPromise: Promise<FactoryPricingConfig | null> | null = null;
function fetchFactoryConfigCached(): Promise<FactoryPricingConfig | null> {
  if (cachedConfigPromise) return cachedConfigPromise;
  cachedConfigPromise = fetch("/api/factory/config")
    .then((r) => r.json())
    .then((d) => (d?.ok && d?.config ? (d.config as FactoryPricingConfig) : null))
    .catch(() => null);
  return cachedConfigPromise;
}

function FinalizedState({
  row,
  onEditAsNew,
  editingAsNew,
  onSendWhatsapp,
  whatsappLoading,
}: {
  row: FactoryQuoteRow;
  onEditAsNew: () => void;
  editingAsNew: boolean;
  onSendWhatsapp: () => void;
  whatsappLoading: boolean;
}) {
  const p = row.finalPricing!;
  const [cfg, setCfg] = useState<FactoryPricingConfig | null>(null);
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  useEffect(() => {
    fetchFactoryConfigCached().then(setCfg);
  }, []);
  const spec = row.productSpec;
  const sizeHe = hebrewSize(spec);
  const productHe = spec.description
    ? sizeHe
      ? `${spec.description} · ${sizeHe}`
      : spec.description
    : sizeHe || "—";

  const materialHe = spec.material ? humanizeMaterial(spec.material) : "";
  const printingHe = spec.printing ? humanizePrinting(spec.printing) : "";
  const finishingHe = spec.finishing ? humanizeFinishing(spec.finishing) : "";

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg border border-success/30 bg-success/5 p-3">
        <div className="text-[10px] uppercase tracking-wider text-success/80 mb-1">
          מחיר ללקוח
        </div>
        <div className="text-2xl font-bold text-success tabular-nums">
          {formatIls(p.totalSellingPrice)}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {formatIls(p.unitSellingPrice)}/יח׳ · {p.quantity.toLocaleString("he-IL")} יח׳
        </div>
      </div>

      {/* Spec — Hebrew icon rows, mirroring the SpecPreview style. Internal
          panel; the customer never sees it. */}
      <div className="rounded-lg border border-border bg-background/40 p-3">
        <dl className="text-xs">
          <SpecRow icon={<ShoppingBag className="size-3" />} label="מוצר" value={productHe} />
          {materialHe && (
            <SpecRow icon={<Package className="size-3" />} label="חומר" value={materialHe} />
          )}
          {printingHe && (
            <SpecRow icon={<Palette className="size-3" />} label="הדפסה" value={printingHe} />
          )}
          {finishingHe && (
            <SpecRow icon={<Package className="size-3" />} label="גימור" value={finishingHe} />
          )}
          <SpecRow
            icon={<Hash className="size-3" />}
            label="כמות"
            value={`${spec.quantity.toLocaleString("he-IL")} יח׳`}
          />
          {p.shippingOptionName && (
            <SpecRow icon={<Truck className="size-3" />} label="שילוח" value={p.shippingOptionName} />
          )}
        </dl>
      </div>

      {/* Internal-only: profit + logistics + sent-at. Lighter background. */}
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          נתונים פנימיים (לא נראה ללקוח)
        </div>
        <dl className="text-xs">
          <SpecRow
            icon={<TrendingUp className="size-3 text-success" />}
            label="רווח"
            value={`${formatIls(p.unitProfit)}/יח׳ · סה״כ ${formatIls(p.totalProfit)} · ${p.profitMarginPct}%`}
          />
          <SpecRow
            icon={<Boxes className="size-3" />}
            label="לוגיסטיקה"
            value={`${p.totalCartons} קרטונים · ${p.totalWeightKg} ק״ג · ${p.totalCbm} CBM`}
          />
          {row.sentToCustomerAt && (
            <SpecRow
              icon={<CheckCircle2 className="size-3 text-success" />}
              label="נשלח ללקוח"
              value={new Date(row.sentToCustomerAt).toLocaleString("he-IL")}
            />
          )}
        </dl>
      </div>

      {cfg && (
        <DetailedBreakdown
          unitCost={p.unitCost}
          unitShipping={p.unitShipping}
          unitProfit={p.unitProfit}
          unitSellingPrice={p.unitSellingPrice}
          totalCost={p.totalCost}
          totalShipping={p.totalShipping}
          totalProfit={p.totalProfit}
          totalSellingPrice={p.totalSellingPrice}
          quantity={p.quantity}
          profitMarginPct={p.profitMarginPct}
          commissionPct={p.commissionPct}
          totalCartons={p.totalCartons}
          totalWeightKg={p.totalWeightKg}
          totalCbm={p.totalCbm}
          shippingType={
            cfg.shippingOptions.find((s) => s.id === p.shippingOptionId)?.type ?? null
          }
          factoryUnitCostCny={row.factoryResponse?.unitCostCny}
          usdToIls={cfg.usdToIls}
          usdToCny={cfg.usdToCny}
          seaRate={
            cfg.shippingOptions.find((s) => s.id === p.shippingOptionId && s.type === "sea")?.seaRate
          }
          rawCbm={p.totalCbm}
          seaMinCbm={1}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setPdfPreviewOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          <FileText className="size-3.5" />
          צפה בהצעה
        </button>
        <a
          href={`/api/factory/${row.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          <Download className="size-3.5" />
          הורד PDF
        </a>
        {/* Always send via the bot endpoint — it attaches the real PDF
            (re-rendering on the fly when pdfUrl is empty). The old wa.me
            fallback only prefilled a text *link*, which is what made the
            summary card "send a link instead of the PDF". */}
        <button
          type="button"
          onClick={onSendWhatsapp}
          disabled={whatsappLoading}
          title="שלח את ה-PDF ישירות ב-WhatsApp"
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#25D366] px-3 py-2 text-sm font-medium text-white hover:bg-[#1da856] disabled:opacity-60"
        >
          {whatsappLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <MessageCircle className="size-3.5" />
          )}
          שלח ב-WhatsApp
        </button>
      </div>

      <button
        type="button"
        onClick={onEditAsNew}
        disabled={editingAsNew}
        title="יוצר עותק חדש של ההצעה לעריכה — המקור נשמר בהיסטוריה"
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-60"
      >
        {editingAsNew ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            יוצר עותק…
          </>
        ) : (
          "ערוך ושלח שוב (עותק חדש)"
        )}
      </button>

      {pdfPreviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPdfPreviewOpen(false)}
        >
          <div
            className="relative flex w-full max-w-4xl flex-col rounded-lg border border-border bg-background shadow-2xl"
            style={{ height: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-sm font-medium">צפייה בהצעה — #{row.quotationNo ?? row.id.slice(-8).toUpperCase()}</span>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/factory/${row.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-1 text-xs hover:bg-secondary"
                >
                  <Download className="size-3" />
                  הורד
                </a>
                <button
                  type="button"
                  onClick={() => setPdfPreviewOpen(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="סגור"
                >
                  ✕
                </button>
              </div>
            </div>
            <QuoteHtmlPreview row={row} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-right">{value}</dd>
    </div>
  );
}

// Renders a "create an additional quote" button + collapsible form, visible
// only when an active quote already exists. Pre-fills from the active row's
// productSpec so the operator only has to tweak what differs (e.g. quantity
// or size for a second variant offer to the same customer).
function ExtraQuoteSection({
  leadId,
  leadName,
  qState,
  activeRow,
  open,
  onToggle,
  onSent,
  onSavedDraft,
}: {
  leadId: string;
  leadName: string | null;
  qState: Record<string, unknown> | null;
  activeRow: FactoryQuoteRow;
  open: boolean;
  onToggle: () => void;
  onSent: () => void;
  onSavedDraft: () => void;
}) {
  // Cast the active row's spec into the "draft" shape that SendToFactoryForm
  // expects. Same field names, so this is a no-op at runtime.
  const draftFromActive = activeRow.productSpec as unknown as Record<
    string,
    unknown
  >;
  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full inline-flex items-center justify-between gap-1.5 rounded-md border border-dashed border-border bg-background/30 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary"
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {open ? "סגור טופס" : "צור הצעה נוספת (הצעה מקבילה)"}
        </span>
      </button>
      {open && (
        <div className="rounded-md border border-border bg-background/40 p-3">
          <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
            ההצעה הקיימת ({activeRow.quotationNo ?? activeRow.id.slice(-6)}) נשארת ב-Feishu.
            <br />
            • <strong>שמור כסיכום הזמנה</strong> — טיוטה חדשה תופיע בהיסטוריה, אפשר לערוך ולשלוח ל-Feishu מאוחר יותר.
            <br />
            • <strong>שלח ל-Feishu</strong> — שורה חדשה נוצרת מיידית עם מספר הצעה חדש.
          </p>
          <SendToFactoryForm
            leadId={leadId}
            leadName={leadName}
            qState={qState}
            draft={draftFromActive}
            onSent={onSent}
            onSavedDraft={onSavedDraft}
            saveDraftAs="new-quote"
            saveDraftLabel="שמור כסיכום הזמנה"
            onCancel={onToggle}
          />
        </div>
      )}
    </div>
  );
}

function HistoryList({
  rows,
  onChange,
}: {
  rows: FactoryQuoteRow[];
  onChange: () => void | Promise<void>;
}) {
  const [opened, setOpened] = useState<FactoryQuoteRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Multi-select of finalized quotes → combine into one customer PDF.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const combineHref = `/api/factory/combine/pdf?ids=${[...selected].join(",")}`;
  const [sendingCombined, setSendingCombined] = useState(false);
  // Send the merged PDF to the customer as a real WhatsApp document via the
  // bridge — same path as the single-quote "שלח ב-WhatsApp" (no wa.me link).
  const handleSendCombined = async () => {
    if (selected.size < 2) return;
    const name = rows.find((r) => selected.has(r.id))?.customerName ?? "הלקוח";
    if (!confirm(`לשלוח הצעה משולבת (${selected.size} מוצרים) ב-WhatsApp ל-${name}?`))
      return;
    setSendingCombined(true);
    try {
      const ids = [...selected].join(",");
      const res = await fetch(
        `/api/factory/combine/send-whatsapp?ids=${encodeURIComponent(ids)}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data?.ok) {
        alert("נשלח ✓");
        setSelected(new Set());
        await onChange();
      } else {
        alert(`שגיאה: ${data?.error ?? "unknown"}\n${data?.message ?? data?.detail ?? ""}`);
      }
    } catch (err) {
      alert(`כשל: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingCombined(false);
    }
  };

  const handleDelete = async (row: FactoryQuoteRow) => {
    if (!confirm(`למחוק את ההצעה ${row.quotationNo ?? row.id.slice(-6)}? Feishu לא יושפע.`)) {
      return;
    }
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/factory/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data?.ok) {
        alert(`שגיאה: ${data?.error ?? "מחיקה נכשלה"}`);
        return;
      }
      await onChange();
    } catch (err) {
      alert(`כשל: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleResend = async (row: FactoryQuoteRow) => {
    if (!confirm(`ליצור שורה חדשה ב-Feishu מההצעה ${row.quotationNo ?? row.id.slice(-6)}?`)) {
      return;
    }
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/factory/${row.id}/resend`, { method: "POST" });
      const data = await res.json();
      if (!data?.ok) {
        alert(`שגיאה: ${data?.error ?? data?.detail ?? "שליחה נכשלה"}`);
        return;
      }
      await onChange();
    } catch (err) {
      alert(`כשל: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSendDraftToFeishu = async (row: FactoryQuoteRow) => {
    if (!confirm(`לשלוח את הטיוטה ${row.quotationNo ?? row.id.slice(-6)} ל-Feishu?`)) {
      return;
    }
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/factory/${row.id}/send-to-feishu`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data?.ok) {
        alert(`שגיאה: ${data?.error ?? data?.detail ?? "שליחה נכשלה"}`);
        return;
      }
      await onChange();
    } catch (err) {
      alert(`כשל: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <details className="mt-3 text-xs" open>
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
        היסטוריית הצעות ({rows.length})
      </summary>
      <p className="mt-1 text-[10px] text-muted-foreground">
        סמן שתי הצעות סופיות או יותר כדי לאחד אותן ל-PDF אחד.
      </p>
      {selected.size >= 2 && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5">
          <span className="text-[11px] font-medium text-primary">
            {selected.size} הצעות נבחרו
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
            <button
              type="button"
              onClick={handleSendCombined}
              disabled={sendingCombined}
              title="שלח את ה-PDF המשולב ישירות ב-WhatsApp"
              className="inline-flex items-center gap-1 rounded-md bg-[#25D366] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#1da856] disabled:opacity-60"
            >
              {sendingCombined ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <MessageCircle className="size-3" />
              )}
              שלח ב-WhatsApp
            </button>
          </div>
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {rows.map((r) => {
          const isBusy = busyId === r.id;
          return (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {r.factoryStatus === "finalized" && (
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelected(r.id)}
                    title="בחר לאיחוד ל-PDF"
                    className="shrink-0 accent-[var(--color-primary,#4A7C59)]"
                  />
                )}
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {new Date(r.createdAt).toLocaleDateString("he-IL")}
                </span>
                <span className="text-[11px] font-mono truncate">
                  {r.quotationNo ?? r.id.slice(-6)}
                </span>
                {statusBadge(r.factoryStatus)}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setOpened(r)}
                  disabled={isBusy}
                  title="פתח מפרט מלא"
                  className="size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-60"
                >
                  <Eye className="size-3" />
                </button>
                {r.factoryStatus === "draft" ? (
                  <button
                    type="button"
                    onClick={() => handleSendDraftToFeishu(r)}
                    disabled={isBusy}
                    title="שלח את הטיוטה ל-Feishu"
                    className="size-6 rounded grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-60"
                  >
                    {isBusy ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleResend(r)}
                    disabled={isBusy}
                    title="שלח שוב ל-Feishu (שורה חדשה)"
                    className="size-6 rounded grid place-items-center text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-60"
                  >
                    {isBusy ? <Loader2 className="size-3 animate-spin" /> : <Repeat className="size-3" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(r)}
                  disabled={isBusy}
                  title="מחק הצעה"
                  className="size-6 rounded grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-60"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {opened && (
        <HistoryDetailModal
          row={opened}
          onClose={() => setOpened(null)}
          onChanged={onChange}
        />
      )}
    </details>
  );
}

