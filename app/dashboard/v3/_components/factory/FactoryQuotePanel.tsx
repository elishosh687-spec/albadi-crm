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
} from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  FactoryProductSpec,
  FactoryResponse,
  FactoryPricingResult,
  FactoryQuoteStatus,
} from "@/lib/factory/types";
import {
  decodeQStateToSpec,
  decodeShipping,
  PRODUCT_LABEL,
} from "@/lib/factory/qstate-decode";
import { SendToFactoryForm } from "./SendToFactoryForm";
import { FinalizeModal } from "./FinalizeModal";

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
  const [finalizing, setFinalizing] = useState<FactoryQuoteRow | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState<string | null>(null);

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

  // Active = most recent non-rejected row. We don't have "rejected"; show the latest.
  const active = rows[0] ?? null;

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
      <header className="flex items-center justify-between gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-3">
        <div className="flex items-center gap-1.5">
          <Factory className="size-3.5" />
          סיכום הזמנה (מפעל)
        </div>
        {active && statusBadge(active.factoryStatus)}
      </header>

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
          onReFinalize={() => setFinalizing(active)}
          onSendWhatsapp={() => handleSendWhatsapp(active)}
          whatsappLoading={whatsappLoading === active.id}
        />
      )}

      {/* History of older rows */}
      {rows.length > 1 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            היסטוריה ({rows.length - 1})
          </summary>
          <ul className="mt-2 space-y-1">
            {rows.slice(1).map((r) => (
              <li key={r.id} className="text-[11px] flex justify-between gap-2">
                <span>
                  {new Date(r.createdAt).toLocaleDateString("he-IL")} ·{" "}
                  {r.quotationNo ?? r.id.slice(-6)}
                </span>
                {statusBadge(r.factoryStatus)}
              </li>
            ))}
          </ul>
        </details>
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
  const sizeStr = [
    spec.widthCm ? `W${spec.widthCm}` : null,
    spec.depthCm ? `D${spec.depthCm}` : null,
    spec.heightCm ? `H${spec.heightCm}` : null,
  ]
    .filter(Boolean)
    .join("×");
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
        {sizeStr && (
          <SpecRow icon={<Package className="size-3" />} label="מידות" value={`${sizeStr} cm`} />
        )}
        {spec.quantity > 0 && (
          <SpecRow icon={<Hash className="size-3" />} label="כמות" value={spec.quantity.toLocaleString("he-IL") + " יח׳"} />
        )}
        {spec.printing && (
          <SpecRow icon={<Palette className="size-3" />} label="הדפסה" value={spec.printing} />
        )}
        {spec.finishing && (
          <SpecRow icon={<Package className="size-3" />} label="גימור" value={spec.finishing} />
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

function FinalizedState({
  row,
  onReFinalize,
  onSendWhatsapp,
  whatsappLoading,
}: {
  row: FactoryQuoteRow;
  onReFinalize: () => void;
  onSendWhatsapp: () => void;
  whatsappLoading: boolean;
}) {
  const p = row.finalPricing!;
  const spec = row.productSpec;
  const resp = row.factoryResponse;
  const sizeStr = [
    spec.widthCm ? `W${spec.widthCm}` : null,
    spec.depthCm ? `D${spec.depthCm}` : null,
    spec.heightCm ? `H${spec.heightCm}` : null,
  ]
    .filter(Boolean)
    .join("×");

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

      <div className="rounded-lg border border-border p-3 space-y-1.5">
        <SummaryLine label="מוצר" value={`${spec.description} · ${sizeStr} cm · ${spec.material}`} />
        <SummaryLine label="הדפסה / גימור" value={`${spec.printing} · ${spec.finishing}`} />
        <SummaryLine label="כמות" value={`${spec.quantity.toLocaleString("he-IL")} יח׳`} />
        {resp?.supplier && <SummaryLine label="ספק" value={resp.supplier} />}
        <SummaryLine
          label="רווח"
          value={`${formatIls(p.unitProfit)}/יח׳ · סה״כ ${formatIls(p.totalProfit)} · ${p.profitMarginPct}%`}
          highlight
        />
        <SummaryLine
          label="לוגיסטיקה"
          value={`${p.totalCartons} קרטונים · ${p.totalWeightKg} ק״ג · ${p.totalCbm} CBM`}
        />
        {p.shippingOptionName && (
          <SummaryLine label="שילוח" value={p.shippingOptionName} />
        )}
        {row.sentToCustomerAt && (
          <SummaryLine
            label="נשלח ללקוח"
            value={new Date(row.sentToCustomerAt).toLocaleString("he-IL")}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={`/api/factory/${row.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          <Download className="size-3.5" />
          הורד PDF
        </a>
        <button
          type="button"
          onClick={onSendWhatsapp}
          disabled={whatsappLoading || !row.pdfUrl}
          title={!row.pdfUrl ? "צריך BLOB_READ_WRITE_TOKEN לשליחה ב-WhatsApp" : ""}
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
        onClick={onReFinalize}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary"
      >
        ערוך ושלח שוב
      </button>
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

function SummaryLine({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className={cn("text-right", highlight && "text-success font-medium")}>
        {value}
      </span>
    </div>
  );
}
