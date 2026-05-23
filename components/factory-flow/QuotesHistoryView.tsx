"use client";

import { useEffect, useState, useMemo } from "react";
import { ExternalLink, Search, FileText, Loader2 } from "lucide-react";

interface QuoteRow {
  id: number;
  leadSid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  source: string; // 'initial' | 'requote'
  quoteTotalIls: number | null;
  quoteAltTotalIls: number | null;
  qState: Record<string, unknown> | null;
  quoteText: string | null;
  sentAt: string;
  ghlUrl: string | null;
}

function fmtMoney(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return `₪${Math.round(v).toLocaleString("he-IL")}`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
    " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}
function quoteSpec(q: QuoteRow): string {
  const s = q.qState ?? {};
  const parts: string[] = [];
  const qty = (s.quantityCustom ?? s.quantity) as string | undefined;
  const prod = (s.productCustom ?? s.product) as string | undefined;
  if (qty) parts.push(`${qty} יח'`);
  if (prod) parts.push(prod);
  const ship = s.shipping as string | undefined;
  if (ship === "s1") parts.push("אקספרס");
  else if (ship === "s2") parts.push("רגיל");
  return parts.join(" · ") || "—";
}

export function QuotesHistoryView({ apiToken }: { apiToken: string }) {
  const [data, setData] = useState<QuoteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/widget/quotes/list?widget_token=${encodeURIComponent(apiToken)}&limit=200`);
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
    if (!needle) return data;
    return data.filter((r) =>
      (r.name ?? "").toLowerCase().includes(needle) ||
      (r.phone ?? "").includes(needle) ||
      r.leadSid.toLowerCase().includes(needle)
    );
  }, [data, q]);

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
          placeholder="חפש לפי שם / טלפון / sid"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-lg border border-border bg-background pr-9 pl-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      <div className="text-xs text-muted-foreground">
        מציג {filtered.length} מתוך {data.length} הצעות
      </div>

      <div className="rounded-lg border border-border bg-card/40 divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">לא נמצאו הצעות</div>
        ) : (
          filtered.map((q) => {
            const isOpen = expanded[q.id];
            return (
              <div key={q.id} className="px-3 py-2">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{q.name ?? q.leadSid.slice(0, 25)}</span>
                      <span className="text-[10px] text-muted-foreground">{q.phone ?? "—"}</span>
                      {q.stage && (
                        <span className="text-[10px] rounded-full bg-secondary/40 px-1.5 py-0.5">{q.stage}</span>
                      )}
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${q.source === "initial" ? "bg-blue-500/15 text-blue-400" : "bg-amber-500/15 text-amber-400"}`}>
                        {q.source === "initial" ? "ראשונית" : "תיקון"}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {fmtDate(q.sentAt)} · {quoteSpec(q)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right tabular-nums">
                      <div className="text-sm font-semibold">{fmtMoney(q.quoteTotalIls)}</div>
                      {q.quoteAltTotalIls !== null && q.quoteAltTotalIls !== q.quoteTotalIls && (
                        <div className="text-[10px] text-muted-foreground">חלופה: {fmtMoney(q.quoteAltTotalIls)}</div>
                      )}
                    </div>
                    <button
                      onClick={() => setExpanded((s) => ({ ...s, [q.id]: !s[q.id] }))}
                      className="rounded-md border border-border bg-secondary/40 hover:bg-secondary p-1.5 transition-colors"
                      title={isOpen ? "סגור פירוט" : "פתח פירוט"}
                    >
                      <FileText className="size-3.5" />
                    </button>
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
                {isOpen && q.quoteText && (
                  <div className="mt-2 rounded-md bg-background/40 border border-border p-2 text-xs whitespace-pre-wrap font-mono leading-relaxed text-muted-foreground">
                    {q.quoteText}
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
