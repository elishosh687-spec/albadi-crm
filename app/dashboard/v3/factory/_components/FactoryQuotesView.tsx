"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Factory, ExternalLink, Sparkles, Download, MessageCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  FactoryQuoteRow,
} from "../../_components/factory/FactoryQuotePanel";
import { FinalizeModal } from "../../_components/factory/FinalizeModal";
import type { FactoryQuoteStatus } from "@/lib/factory/types";

type StatusFilter = FactoryQuoteStatus | "all";

const STATUS_LABEL: Record<FactoryQuoteStatus, string> = {
  pending: "ממתין למפעל",
  received: "התקבלה תשובה",
  finalized: "הצעה סופית",
};

function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

export function FactoryQuotesView() {
  const [rows, setRows] = useState<FactoryQuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [finalizing, setFinalizing] = useState<FactoryQuoteRow | null>(null);
  const [whatsapping, setWhatsapping] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url =
        filter === "all"
          ? "/api/factory/list"
          : `/api/factory/list?status=${filter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data?.ok) setRows(data.requests || []);
    } catch (err) {
      console.error("[factory] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/factory/refresh", { method: "POST" });
      const data = await res.json();
      if (data?.ok) {
        alert(`נסרקו ${data.scanned} ממתינות. התעדכנו ${data.updated}.`);
        await load();
      } else {
        alert(`שגיאה: ${data?.error}`);
      }
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const handleSendWa = useCallback(
    async (row: FactoryQuoteRow) => {
      if (!confirm(`לשלוח את ההצעה ב-WhatsApp ל-${row.customerName ?? "הלקוח"}?`)) return;
      setWhatsapping(row.id);
      try {
        const res = await fetch(`/api/factory/${row.id}/send-whatsapp`, {
          method: "POST",
        });
        const data = await res.json();
        if (data?.ok) {
          alert("נשלח ✓");
          await load();
        } else {
          alert(`שגיאה: ${data?.error}\n${data?.message ?? data?.detail ?? ""}`);
        }
      } finally {
        setWhatsapping(null);
      }
    },
    [load]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(
      (r) =>
        (r.customerName ?? "").toLowerCase().includes(s) ||
        (r.quotationNo ?? "").toLowerCase().includes(s) ||
        (r.productSpec.description ?? "").toLowerCase().includes(s)
    );
  }, [rows, search]);

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Factory className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold">הצעות מפעל</h1>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          רענן מ-Feishu
        </button>
      </header>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(["all", "pending", "received", "finalized"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3 py-1 text-xs border",
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            )}
          >
            {f === "all" ? "הכל" : STATUS_LABEL[f as FactoryQuoteStatus]}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="חיפוש לפי לקוח / מס׳ הצעה / תיאור"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-right mb-4"
      />

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          אין הצעות תואמות
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-border bg-card p-4 hover:bg-card/80"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        "text-[10px] rounded-full px-2 py-0.5 border",
                        r.factoryStatus === "pending" &&
                          "bg-warning/15 text-warning border-warning/30",
                        r.factoryStatus === "received" &&
                          "bg-primary/15 text-primary border-primary/30",
                        r.factoryStatus === "finalized" &&
                          "bg-success/15 text-success border-success/30"
                      )}
                    >
                      {STATUS_LABEL[r.factoryStatus]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      #{r.quotationNo ?? r.id.slice(-6)} ·{" "}
                      {new Date(r.createdAt).toLocaleDateString("he-IL")}
                    </span>
                  </div>
                  <div className="text-sm font-medium">
                    {r.customerName ?? "—"}
                    {r.customerPhone ? (
                      <span className="text-muted-foreground font-normal">
                        {" · "}
                        {r.customerPhone}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.productSpec.description} · {r.productSpec.widthCm}
                    {r.productSpec.depthCm > 0 ? `×${r.productSpec.depthCm}` : ""}×
                    {r.productSpec.heightCm} cm · {r.productSpec.quantity} יח׳
                  </div>
                  {r.finalPricing && (
                    <div className="text-xs mt-1">
                      <span className="text-success font-semibold">
                        {formatIls(r.finalPricing.totalSellingPrice)}
                      </span>
                      <span className="text-muted-foreground">
                        {" · רווח "}
                        {formatIls(r.finalPricing.totalProfit)}
                        {" ("}
                        {r.finalPricing.profitMarginPct}%{")"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Link
                    href={`/dashboard/v3/conversations?lead=${encodeURIComponent(r.manychatSubId)}`}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-secondary"
                  >
                    <ExternalLink className="size-3" />
                    שיחה
                  </Link>
                  {r.factoryStatus === "received" && (
                    <button
                      onClick={() => setFinalizing(r)}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Sparkles className="size-3" />
                      חישוב
                    </button>
                  )}
                  {r.factoryStatus === "finalized" && (
                    <>
                      <a
                        href={`/api/factory/${r.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-primary text-primary px-2 py-1 text-[11px] hover:bg-primary/10"
                      >
                        <Download className="size-3" />
                        PDF
                      </a>
                      <button
                        onClick={() => handleSendWa(r)}
                        disabled={whatsapping === r.id || !r.pdfUrl}
                        title={!r.pdfUrl ? "צריך BLOB_READ_WRITE_TOKEN" : ""}
                        className="inline-flex items-center gap-1 rounded-md bg-[#25D366] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#1da856] disabled:opacity-60"
                      >
                        {whatsapping === r.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <MessageCircle className="size-3" />
                        )}
                        WA
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
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
    </main>
  );
}
