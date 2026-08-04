"use client";

/**
 * The salesperson's own quote history (createdBy='sales'), with re-send. Customer
 * fields only — no cost/profit/margin/commission (served by /api/sales/history).
 */
import { useEffect, useState } from "react";
import { Loader2, Send, RefreshCw, Check } from "lucide-react";
import { cn } from "@/lib/cn";

interface Row {
  id: string;
  quotationNo: string;
  customerName: string | null;
  dimensions: string;
  quantity: number | null;
  totalOrderIls: number | null;
  sentAt: string | null;
  createdAt: string | null;
}

const ils = (n: number) => `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

export function SalesHistory({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setRows(null);
    try {
      const res = await fetch(`/api/sales/history?token=${encodeURIComponent(token)}`);
      const j = await res.json();
      setRows(j?.ok ? j.quotes : []);
    } catch (e) {
      setErr(String(e));
      setRows([]);
    }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function resend(id: string) {
    setResending(id);
    setErr(null);
    try {
      const res = await fetch(`/api/sales/resend?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.detail || j?.error || "resend failed");
      setSentId(id);
      setTimeout(() => setSentId(null), 3000);
    } catch (e) {
      setErr(String(e));
    } finally {
      setResending(null);
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">היסטוריית הצעות</h1>
        <button type="button" onClick={() => void load()} className="text-xs text-muted-foreground inline-flex items-center gap-1 underline"><RefreshCw className="size-3.5" /> רענן</button>
      </div>

      {rows === null && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> טוען…</div>}
      {rows && rows.length === 0 && <div className="text-sm text-muted-foreground">עדיין לא שלחת הצעות.</div>}
      {err && <div className="text-xs text-red-400">{err}</div>}

      <div className="space-y-2">
        {rows?.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-card/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{r.customerName ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  #{r.quotationNo}{r.dimensions ? ` · ${r.dimensions} ס״מ` : ""}{r.quantity ? ` · ${r.quantity.toLocaleString()} יח׳` : ""}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {r.totalOrderIls ? `${ils(r.totalOrderIls)} · ` : ""}
                  {r.sentAt ? `נשלח ${fmtDate(r.sentAt)}` : `טיוטה ${fmtDate(r.createdAt)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void resend(r.id)}
                disabled={resending === r.id}
                className={cn(
                  "shrink-0 px-3 py-2 rounded-lg text-xs inline-flex items-center gap-1.5 transition-colors",
                  sentId === r.id ? "bg-emerald-500/15 text-emerald-400" : "border border-border-strong hover:bg-secondary"
                )}
              >
                {resending === r.id ? <Loader2 className="size-3.5 animate-spin" /> : sentId === r.id ? <Check className="size-3.5" /> : <Send className="size-3.5" />}
                {sentId === r.id ? "נשלח" : "שלח שוב"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
