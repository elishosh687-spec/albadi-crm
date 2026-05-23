"use client";

import { useEffect, useState, useMemo } from "react";
import { ExternalLink, Search, FileText, Loader2, Download } from "lucide-react";

interface FactoryQuoteRow {
  id: string;
  leadSid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  quotationNo: string | null;
  status: string; // pending | received | finalized
  productSpec: Record<string, unknown> | null;
  factoryResponse: Record<string, unknown> | null;
  finalPricing: Record<string, unknown> | null;
  pdfUrl: string | null;
  sentToCustomerAt: string | null;
  createdAt: string;
  updatedAt: string;
  ghlUrl: string | null;
}

function fmtMoney(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "—";
  return `₪${Math.round(n).toLocaleString("he-IL")}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
    " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}
function specSummary(spec: Record<string, unknown> | null): string {
  if (!spec) return "—";
  const parts: string[] = [];
  const desc = spec.description as string | undefined;
  const qty = spec.quantity as number | undefined;
  const w = spec.widthCm as number | undefined;
  const h = spec.heightCm as number | undefined;
  const d = spec.depthCm as number | undefined;
  if (desc) parts.push(desc);
  if (qty) parts.push(`${qty.toLocaleString("he-IL")} יח'`);
  if (w && h) {
    const dims = d ? `${w}×${h}×${d}` : `${w}×${h}`;
    parts.push(`${dims} ס״מ`);
  }
  return parts.join(" · ") || "—";
}
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "ממתין למפעל", cls: "bg-amber-500/15 text-amber-400" },
  received: { text: "תשובה התקבלה", cls: "bg-blue-500/15 text-blue-400" },
  finalized: { text: "נשלח ללקוח", cls: "bg-emerald-500/15 text-emerald-400" },
};

export function QuotesHistoryView({ apiToken }: { apiToken: string }) {
  const [data, setData] = useState<FactoryQuoteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
        מציג {filtered.length} מתוך {data.length} הצעות מפעל
      </div>

      <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">לא נמצאו הצעות מתאימות</div>
        ) : (
          filtered.map((q) => {
            const isOpen = expanded[q.id];
            const fp = q.finalPricing ?? {};
            const fr = q.factoryResponse ?? {};
            return (
              <div key={q.id} className="px-3 py-2.5">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{q.name ?? q.leadSid.slice(0, 25)}</span>
                      <span className="text-[10px] text-muted-foreground">{q.phone ?? "—"}</span>
                      {q.quotationNo && (
                        <span className="text-[10px] font-mono text-muted-foreground">#{q.quotationNo}</span>
                      )}
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${STATUS_LABEL[q.status]?.cls ?? "bg-muted"}`}>
                        {STATUS_LABEL[q.status]?.text ?? q.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      נשלח למפעל: {fmtDate(q.createdAt)}
                      {q.sentToCustomerAt && ` · ללקוח: ${fmtDate(q.sentToCustomerAt)}`}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {specSummary(q.productSpec)}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right tabular-nums">
                      {q.status === "finalized" && fp ? (
                        <>
                          <div className="text-sm font-semibold">{fmtMoney((fp as any).totalOrderPriceIls ?? (fp as any).totalPriceIls)}</div>
                          <div className="text-[10px] text-muted-foreground">
                            יח': {fmtMoney((fp as any).unitPriceIls)}
                          </div>
                        </>
                      ) : q.status === "received" && fr ? (
                        <div className="text-[11px] text-amber-400">
                          ₥{(fr as any).unitCostCny ?? "?"} CNY/יח'
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">—</div>
                      )}
                    </div>

                    <button
                      onClick={() => setExpanded((s) => ({ ...s, [q.id]: !s[q.id] }))}
                      className="rounded-md border border-border bg-secondary/40 hover:bg-secondary p-1.5 transition-colors"
                      title={isOpen ? "סגור" : "פירוט"}
                    >
                      <FileText className="size-3.5" />
                    </button>
                    {q.pdfUrl && (
                      <a
                        href={q.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-border bg-secondary/40 hover:bg-secondary p-1.5 transition-colors"
                        title="הורד PDF"
                      >
                        <Download className="size-3.5" />
                      </a>
                    )}
                    {q.ghlUrl && (
                      <a
                        href={q.ghlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-border bg-secondary/40 hover:bg-secondary p-1.5 transition-colors"
                        title="פתח ב-GHL"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                    <Detail title="📦 spec ללקוח" obj={q.productSpec} />
                    <Detail title="🏭 תשובת מפעל" obj={q.factoryResponse} />
                    <Detail title="💰 תמחור סופי" obj={q.finalPricing} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Detail({ title, obj }: { title: string; obj: Record<string, unknown> | null }) {
  if (!obj) return (
    <div className="rounded-md bg-background/40 border border-border p-2">
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-muted-foreground">—</div>
    </div>
  );
  return (
    <div className="rounded-md bg-background/40 border border-border p-2">
      <div className="font-semibold mb-1">{title}</div>
      <pre className="whitespace-pre-wrap text-muted-foreground text-[10px] leading-snug overflow-x-auto">{JSON.stringify(obj, null, 2)}</pre>
    </div>
  );
}
