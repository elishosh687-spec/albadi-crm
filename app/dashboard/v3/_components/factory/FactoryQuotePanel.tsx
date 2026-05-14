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

import { useCallback, useEffect, useState } from "react";
import { Factory, ChevronDown, ChevronUp, RefreshCw, Sparkles, Download, MessageCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  FactoryProductSpec,
  FactoryResponse,
  FactoryPricingResult,
  FactoryQuoteStatus,
} from "@/lib/factory/types";
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
}: {
  leadId: string;
  leadName: string | null;
  qState: Record<string, unknown> | null;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FactoryQuoteRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [finalizing, setFinalizing] = useState<FactoryQuoteRow | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState<string | null>(null);

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
        <EmptyState
          open={formOpen}
          onToggle={() => setFormOpen((v) => !v)}
          leadId={leadId}
          leadName={leadName}
          qState={qState}
          onSent={() => {
            setFormOpen(false);
            load();
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

function EmptyState({
  open,
  onToggle,
  leadId,
  leadName,
  qState,
  onSent,
}: {
  open: boolean;
  onToggle: () => void;
  leadId: string;
  leadName: string | null;
  qState: Record<string, unknown> | null;
  onSent: () => void;
}) {
  return (
    <div className="space-y-2">
      {!open && (
        <p className="text-xs text-muted-foreground">
          עוד לא נשלחה הצעה למפעל. פתח טופס למילוי ידני או מאוכלס מתשובות הבוט.
        </p>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="w-full inline-flex items-center justify-between gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {open ? "סגור טופס" : "פתח טופס שליחה למפעל"}
        </span>
      </button>
      {open && (
        <div className="rounded-md border border-border bg-background/40 p-3">
          <SendToFactoryForm
            leadId={leadId}
            leadName={leadName}
            qState={qState}
            onSent={onSent}
            onCancel={onToggle}
          />
        </div>
      )}
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
