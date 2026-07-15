"use client";

/**
 * Widget variant of FactoryQuotePanel — same UX, but every fetch goes through
 * /api/widget/factory/* with the widget_token. The parent (FactoryFlowView)
 * supplies `apiToken` and an `onReload` callback that refreshes the lead
 * context after mutations.
 *
 * State machine is identical to the dashboard original:
 *   - none      → "Send to factory" buttons
 *   - pending   → wait + refresh
 *   - received  → factory response + Finalize
 *   - finalized → summary + PDF + WhatsApp + re-finalize
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
import type { FactoryPricingConfig } from "@/lib/factory/types";
import { DetailedBreakdown } from "@/components/calculator/DetailedBreakdown";
import { QuoteHtmlPreviewWidget } from "./QuoteHtmlPreview.widget";
import {
  decodeQStateToSpec,
  decodeShipping,
  humanizeFinishing,
  humanizeMaterial,
  humanizePrinting,
} from "@/lib/factory/qstate-decode";
import { SendToFactoryFormWidget } from "./SendToFactoryForm.widget";
import { FinalizeModalWidget } from "./FinalizeModal.widget";
import { HistoryDetailModalWidget } from "./HistoryDetailModal.widget";
import type { FactoryQuoteRow } from "./types";
import { widgetUrl } from "./widget-url";

function hebrewSize(spec: { widthCm?: number; heightCm?: number; depthCm?: number }): string {
  const parts: string[] = [];
  if (spec.widthCm) parts.push(`רוחב ${spec.widthCm}`);
  if (spec.heightCm) parts.push(`גובה ${spec.heightCm}`);
  if (spec.depthCm) parts.push(`עומק ${spec.depthCm}`);
  if (parts.length === 0) return "";
  return `${parts.join(" × ")} ס״מ`;
}

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function statusBadge(status: FactoryQuoteRow["factoryStatus"]) {
  const map: Record<FactoryQuoteRow["factoryStatus"], { label: string; tone: string }> = {
    draft: { label: "טיוטה", tone: "bg-muted/40 text-muted-foreground border-border" },
    pending: { label: "ממתין למפעל", tone: "bg-warning/15 text-warning border-warning/30" },
    received: { label: "התקבלה תשובה", tone: "bg-primary/15 text-primary border-primary/30" },
    finalized: { label: "הצעה סופית", tone: "bg-success/15 text-success border-success/30" },
  };
  const m = map[status];
  return (
    <span className={cn("text-[10px] rounded-full px-2 py-0.5 border", m.tone)}>{m.label}</span>
  );
}

export function FactoryQuotePanelWidget({
  apiToken,
  leadId,
  leadName,
  qState,
  factorySpecDraft,
}: {
  apiToken: string;
  leadId: string;
  leadName: string | null;
  qState: Record<string, unknown> | null;
  factorySpecDraft?: Record<string, unknown> | null;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FactoryQuoteRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [extraFormOpen, setExtraFormOpen] = useState(false);
  const [finalizing, setFinalizing] = useState<FactoryQuoteRow | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState<string | null>(null);
  const [editingAsNew, setEditingAsNew] = useState(false);

  const [draft, setDraft] = useState<Record<string, unknown> | null>(factorySpecDraft ?? null);
  useEffect(() => {
    setDraft(factorySpecDraft ?? null);
  }, [factorySpecDraft]);

  const [notesDraft, setNotesDraft] = useState<string>(
    String((factorySpecDraft as Record<string, unknown> | null)?.notes ?? "")
  );
  const [sendingSummary, setSendingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

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
        widgetUrl("/api/widget/factory/list", apiToken, { lead: leadId })
      );
      const data = await res.json();
      if (data?.ok) setRows(data.requests || []);
    } catch (err) {
      console.error("[FactoryQuotePanel.widget] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [leadId, apiToken]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(widgetUrl("/api/widget/factory/refresh", apiToken), {
        method: "POST",
      });
      const data = await res.json();
      if (data?.ok) {
        await load();
      }
    } catch (err) {
      console.error("[FactoryQuotePanel.widget] refresh failed", err);
    } finally {
      setRefreshing(false);
    }
  }, [load, apiToken]);

  const handleEditAsNew = useCallback(
    async (row: FactoryQuoteRow) => {
      if (editingAsNew) return;
      setEditingAsNew(true);
      try {
        const res = await fetch(widgetUrl(`/api/widget/factory/${row.id}/clone`, apiToken), {
          method: "POST",
        });
        const data = await res.json();
        if (!data?.ok) {
          alert(`שגיאה בשכפול: ${data?.error ?? "unknown"}`);
          return;
        }
        const clonedId: string = data.id;
        const listRes = await fetch(widgetUrl("/api/widget/factory/list", apiToken, { lead: leadId }));
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
    [editingAsNew, apiToken, leadId]
  );

  const handleSendWhatsapp = useCallback(
    async (row: FactoryQuoteRow) => {
      if (!confirm(`לשלוח את ההצעה ב-WhatsApp ל-${row.customerName ?? "הלקוח"}?`)) return;
      setWhatsappLoading(row.id);
      try {
        const res = await fetch(
          widgetUrl(`/api/widget/factory/${row.id}/send-whatsapp`, apiToken),
          { method: "POST" }
        );
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
    [load, apiToken]
  );

  const active = rows.find((r) => r.factoryStatus !== "draft") ?? null;

  const handleSendFromSummary = useCallback(async () => {
    if (!resolvedSpec) return;
    setSummaryError(null);
    setSendingSummary(true);
    try {
      const res = await fetch(widgetUrl("/api/widget/factory/quote-request", apiToken), {
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
            ...(resolvedSpec.shippingCode ? { shippingOptionId: resolvedSpec.shippingCode } : {}),
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
  }, [leadId, leadName, resolvedSpec, notesDraft, load, apiToken]);

  const handleClearDraft = useCallback(async () => {
    if (!draft) return;
    if (!confirm("למחוק את הנתונים הידניים שמילאת?")) return;
    try {
      await fetch(
        widgetUrl(`/api/widget/leads/${encodeURIComponent(leadId)}/factory-draft`, apiToken),
        { method: "DELETE" }
      );
      setDraft(null);
      setNotesDraft("");
    } catch (err) {
      console.error("[FactoryQuotePanel.widget] clear draft failed", err);
    }
  }, [draft, leadId, apiToken]);

  return (
    <section className="rounded-xl border border-border bg-card p-4" dir="rtl">
      <header className="flex items-center justify-between gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-1">
        <div className="flex items-center gap-1.5">
          <Factory className="size-3.5" />
          הצעות מפעל (ידניות)
        </div>
        {active && statusBadge(active.factoryStatus)}
      </header>
      <p className="mb-3 text-[11px] leading-snug text-muted-foreground border-r-2 border-muted-foreground/30 pr-2">
        בקשות ציטוט מהמפעל ששלחת ידנית ל-Feishu. כל פעם ש-{`"`}שלח לסיכום הזמנה{`"`} נלחץ —
        נוספת שורה חדשה. <strong>לא</strong> מתעדכן אוטומטית מההצעות שהבוט שולח ללקוח.
      </p>

      {loading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" />
          טוען…
        </div>
      ) : !active ? (
        <NoQuoteState
          apiToken={apiToken}
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
        <ReceivedState row={active} onFinalize={() => setFinalizing(active)} />
      ) : (
        <FinalizedState
          apiToken={apiToken}
          row={active}
          onEditAsNew={() => handleEditAsNew(active)}
          editingAsNew={editingAsNew}
          onSendWhatsapp={() => handleSendWhatsapp(active)}
          whatsappLoading={whatsappLoading === active.id}
        />
      )}

      {active && (
        <ExtraQuoteSection
          apiToken={apiToken}
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

      {rows.length > 0 && <HistoryList apiToken={apiToken} rows={rows} onChange={load} />}

      {finalizing && (
        <FinalizeModalWidget
          apiToken={apiToken}
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
  apiToken,
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
  apiToken: string;
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
        <SpecPreview spec={spec} hasDraft={hasDraft} onClearDraft={onClearDraft} />
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
          {summaryError && <p className="text-xs text-destructive">{summaryError}</p>}
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
          {formOpen ? "סגור טופס ידני" : spec ? "ערוך / החלף ידנית" : "פתח טופס ידני"}
        </span>
      </button>
      {formOpen && (
        <div className="rounded-md border border-border bg-background/40 p-3">
          <SendToFactoryFormWidget
            apiToken={apiToken}
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
        {sizeHe && <SpecRow icon={<Package className="size-3" />} label="מידות" value={sizeHe} />}
        {spec.quantity > 0 && (
          <SpecRow icon={<Hash className="size-3" />} label="כמות" value={spec.quantity.toLocaleString("he-IL") + " יח׳"} />
        )}
        {materialHe && <SpecRow icon={<Package className="size-3" />} label="חומר" value={materialHe} />}
        {printingHe && <SpecRow icon={<Palette className="size-3" />} label="הדפסה" value={printingHe} />}
        {finishingHe && <SpecRow icon={<Package className="size-3" />} label="גימור" value={finishingHe} />}
        {spec.shippingCode && (
          <SpecRow icon={<Truck className="size-3" />} label="משלוח" value={decodeShipping(spec.shippingCode)} />
        )}
      </dl>
    </div>
  );
}

function SpecRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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
      <p className="text-muted-foreground text-xs">נשלח ל-Feishu — ממתין שהמפעל ימלא את המפרט והמחיר.</p>
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
        {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        רענן מ-Feishu
      </button>
    </div>
  );
}

function ReceivedState({ row, onFinalize }: { row: FactoryQuoteRow; onFinalize: () => void }) {
  const resp = row.factoryResponse!;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground text-xs">
        תשובת המפעל התקבלה. בחר אחוז רווח ושיטת שילוח כדי לחשב הצעה סופית.
      </p>
      <dl className="text-xs divide-y divide-border/60">
        <Row label="עלות יחידה" value={`¥${resp.unitCostCny}`} />
        {resp.cartonQty !== undefined && <Row label="יח׳/קרטון" value={String(resp.cartonQty)} />}
        {resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm && (
          <Row
            label="מידות קרטון (cm)"
            value={`${resp.cartonLengthCm}×${resp.cartonWidthCm}×${resp.cartonHeightCm}`}
          />
        )}
        {resp.cartonCbm !== undefined && <Row label="CBM לקרטון" value={resp.cartonCbm.toFixed(3)} />}
        {resp.weightKg !== undefined && <Row label="משקל קרטון" value={`${resp.weightKg} ק״ג`} />}
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
function fetchFactoryConfigCached(apiToken: string): Promise<FactoryPricingConfig | null> {
  if (cachedConfigPromise) return cachedConfigPromise;
  cachedConfigPromise = fetch(widgetUrl("/api/widget/factory/config", apiToken))
    .then((r) => r.json())
    .then((d) => (d?.ok && d?.config ? (d.config as FactoryPricingConfig) : null))
    .catch(() => null);
  return cachedConfigPromise;
}

function FinalizedState({
  apiToken,
  row,
  onEditAsNew,
  editingAsNew,
  onSendWhatsapp,
  whatsappLoading,
}: {
  apiToken: string;
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
    fetchFactoryConfigCached(apiToken).then(setCfg);
  }, [apiToken]);
  const spec = row.productSpec;
  const sizeHe = hebrewSize(spec);
  const productHe = spec.description
    ? sizeHe
      ? `${spec.description} · ${sizeHe}`
      : spec.description
    : sizeHe || "—";

  const waPhone = row.customerPhone ? row.customerPhone.replace(/[^\d]/g, "") : "";
  const waCaption = (() => {
    const greeting = row.customerName ? `היי ${row.customerName},` : "היי,";
    const product = spec.description || "שקיות";
    const sizeStr = [
      spec.widthCm ? `W${spec.widthCm}` : null,
      spec.depthCm ? `D${spec.depthCm}` : null,
      spec.heightCm ? `H${spec.heightCm}` : null,
    ]
      .filter(Boolean)
      .join("×");
    const quotationNo = row.quotationNo ?? row.id.slice(-8).toUpperCase();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const pdfLink = `${origin}/api/factory/${row.id}/pdf`;
    return [
      greeting,
      `מצורפת הצעת מחיר #${quotationNo} ל-${product}.`,
      sizeStr
        ? `מפרט: ${sizeStr} cm · ${spec.quantity.toLocaleString("he-IL")} יח'.`
        : `כמות: ${spec.quantity.toLocaleString("he-IL")} יח'.`,
      `מחיר ליחידה: ${formatIls(p.unitSellingPrice)} · סה"כ: ${formatIls(p.totalSellingPrice)} (לא כולל מע"מ).`,
      p.shippingOptionName ? `שיטת שילוח: ${p.shippingOptionName}.` : null,
      pdfLink ? `הצעה מלאה: ${pdfLink}` : null,
      "ההצעה בתוקף ל-14 יום. נשמח לקבל אישור 🙂",
    ]
      .filter(Boolean)
      .join("\n");
  })();
  const waMeUrl = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waCaption)}` : null;
  const materialHe = spec.material ? humanizeMaterial(spec.material) : "";
  const printingHe = spec.printing ? humanizePrinting(spec.printing) : "";
  const finishingHe = spec.finishing ? humanizeFinishing(spec.finishing) : "";

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg border border-success/30 bg-success/5 p-3">
        <div className="text-[10px] uppercase tracking-wider text-success/80 mb-1">מחיר ללקוח</div>
        <div className="text-2xl font-bold text-success tabular-nums">{formatIls(p.totalSellingPrice)}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {formatIls(p.unitSellingPrice)}/יח׳ · {p.quantity.toLocaleString("he-IL")} יח׳
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background/40 p-3">
        <dl className="text-xs">
          <SpecRow icon={<ShoppingBag className="size-3" />} label="מוצר" value={productHe} />
          {materialHe && <SpecRow icon={<Package className="size-3" />} label="חומר" value={materialHe} />}
          {printingHe && <SpecRow icon={<Palette className="size-3" />} label="הדפסה" value={printingHe} />}
          {finishingHe && <SpecRow icon={<Package className="size-3" />} label="גימור" value={finishingHe} />}
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
          moldsInTotalCost
          totalShipping={p.totalShipping}
          totalProfit={p.totalProfit}
          totalSellingPrice={p.totalSellingPrice}
          quantity={p.quantity}
          profitMarginPct={p.profitMarginPct}
          commissionPct={p.commissionPct}
          totalCartons={p.totalCartons}
          totalWeightKg={p.totalWeightKg}
          totalCbm={p.totalCbm}
          shippingType={cfg.shippingOptions.find((s) => s.id === p.shippingOptionId)?.type ?? null}
          factoryUnitCostCny={row.factoryResponse?.unitCostCny}
          usdToIls={cfg.usdToIls}
          usdToCny={cfg.usdToCny}
          seaRate={
            cfg.shippingOptions.find((s) => s.id === p.shippingOptionId && s.type === "sea")?.seaRate
          }
          rawCbm={p.totalCbm}
          seaMinCbm={1}
          platePerColorCny={p.platePerColorCny}
          plateFeeLogoColors={p.plateFeeLogoColors}
          plateFeeTotalCny={p.plateFeeTotalCny}
          plateFeeTotalCostIls={p.plateFeeTotalCostIls}
          platePerUnitCny={p.platePerUnitCny}
          platePerUnitIls={p.platePerUnitIls}
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
        {row.pdfUrl ? (
          <button
            type="button"
            onClick={onSendWhatsapp}
            disabled={whatsappLoading}
            title="שלח את ה-PDF ישירות ב-WhatsApp דרך ה-bridge"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#25D366] px-3 py-2 text-sm font-medium text-white hover:bg-[#1da856] disabled:opacity-60"
          >
            {whatsappLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MessageCircle className="size-3.5" />
            )}
            שלח ב-WhatsApp
          </button>
        ) : waMeUrl ? (
          <a
            href={waMeUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="פתח שיחת WhatsApp עם הודעה מוכנה + קישור ל-PDF"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#25D366] px-3 py-2 text-sm font-medium text-white hover:bg-[#1da856]"
          >
            <MessageCircle className="size-3.5" />
            פתח ב-WhatsApp
          </a>
        ) : (
          <button
            type="button"
            disabled
            title="חסר טלפון בליד"
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#25D366]/40 px-3 py-2 text-sm font-medium text-white opacity-60"
          >
            <MessageCircle className="size-3.5" />
            חסר טלפון
          </button>
        )}
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
              <span className="text-sm font-medium">
                צפייה בהצעה — #{row.quotationNo ?? row.id.slice(-8).toUpperCase()}
              </span>
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
            <QuoteHtmlPreviewWidget apiToken={apiToken} row={row} />
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

function ExtraQuoteSection({
  apiToken,
  leadId,
  leadName,
  qState,
  activeRow,
  open,
  onToggle,
  onSent,
  onSavedDraft,
}: {
  apiToken: string;
  leadId: string;
  leadName: string | null;
  qState: Record<string, unknown> | null;
  activeRow: FactoryQuoteRow;
  open: boolean;
  onToggle: () => void;
  onSent: () => void;
  onSavedDraft: () => void;
}) {
  const draftFromActive = activeRow.productSpec as unknown as Record<string, unknown>;
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
            <br />• <strong>שמור כסיכום הזמנה</strong> — טיוטה חדשה תופיע בהיסטוריה, אפשר לערוך ולשלוח ל-Feishu מאוחר יותר.
            <br />• <strong>שלח ל-Feishu</strong> — שורה חדשה נוצרת מיידית עם מספר הצעה חדש.
          </p>
          <SendToFactoryFormWidget
            apiToken={apiToken}
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
  apiToken,
  rows,
  onChange,
}: {
  apiToken: string;
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
  // wa.me link to send the combined PDF to the customer (same pattern as the
  // single-quote "פתח ב-WhatsApp"). Phone/name taken from any selected row —
  // they all belong to the same client.
  const combineWaUrl = (() => {
    if (selected.size < 2) return null;
    const sel = rows.filter((r) => selected.has(r.id));
    const phone = sel[0]?.customerPhone?.replace(/[^\d]/g, "") || "";
    if (!phone) return null;
    const name = sel[0]?.customerName ?? "";
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

  const handleDelete = async (row: FactoryQuoteRow) => {
    if (!confirm(`למחוק את ההצעה ${row.quotationNo ?? row.id.slice(-6)}? Feishu לא יושפע.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(widgetUrl(`/api/widget/factory/${row.id}`, apiToken), {
        method: "DELETE",
      });
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
    if (!confirm(`ליצור שורה חדשה ב-Feishu מההצעה ${row.quotationNo ?? row.id.slice(-6)}?`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(widgetUrl(`/api/widget/factory/${row.id}/resend`, apiToken), {
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

  const handleSendDraftToFeishu = async (row: FactoryQuoteRow) => {
    if (!confirm(`לשלוח את הטיוטה ${row.quotationNo ?? row.id.slice(-6)} ל-Feishu?`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(widgetUrl(`/api/widget/factory/${row.id}/send-to-feishu`, apiToken), {
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
        <HistoryDetailModalWidget
          apiToken={apiToken}
          row={opened}
          onClose={() => setOpened(null)}
          onChanged={onChange}
        />
      )}
    </details>
  );
}
