"use client";

/**
 * Top-level widget client component. Renders a contact picker (typeahead) +
 * the per-lead factory-quote panel for the selected lead.
 *
 * Auth: every fetch carries `?widget_token=<apiToken>`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X, User } from "lucide-react";
import { FactoryQuotePanelWidget } from "./FactoryQuotePanel.widget";
import { QuotesHistoryView } from "./QuotesHistoryView";
import { widgetUrl } from "./widget-url";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";

interface LeadOption {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  updatedAt: string;
}

interface LeadContext {
  lead: {
    sid: string;
    name: string | null;
    phone: string | null;
    stage: string | null;
    qState: unknown;
    factorySpecDraft: unknown;
    quoteTotal: string | null;
    followUpDate: string | null;
  };
}

export function FactoryFlowView({ apiToken }: { apiToken: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadOption[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedSid, setSelectedSid] = useState<string | null>(null);
  const [context, setContext] = useState<LeadContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Debounced search. Fires `recent?q=…` 250ms after the last keystroke.
  // Empty query → most-recent-updated leads.
  const runSearch = useCallback(
    async (q: string) => {
      setLoadingResults(true);
      try {
        const res = await fetch(widgetUrl("/api/widget/leads/recent", apiToken, { q }));
        const data = await res.json();
        if (data?.ok) setResults(data.leads || []);
      } catch (err) {
        console.error("[FactoryFlowView] search failed", err);
      } finally {
        setLoadingResults(false);
      }
    },
    [apiToken]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Close dropdown on outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const loadContext = useCallback(
    async (sid: string) => {
      setContextLoading(true);
      setContextError(null);
      setContext(null);
      try {
        const res = await fetch(
          widgetUrl(`/api/widget/leads/${encodeURIComponent(sid)}/factory-context`, apiToken)
        );
        const data = await res.json();
        if (data?.ok && data?.lead) {
          setContext({ lead: data.lead });
        } else {
          setContextError(data?.error ?? "כשל בטעינת הליד");
        }
      } catch (err) {
        setContextError(err instanceof Error ? err.message : String(err));
      } finally {
        setContextLoading(false);
      }
    },
    [apiToken]
  );

  const handlePick = (lead: LeadOption) => {
    setSelectedSid(lead.sid);
    setOpen(false);
    setQuery(lead.name || lead.phone || lead.sid);
    loadContext(lead.sid);
  };

  const handleClear = () => {
    setSelectedSid(null);
    setContext(null);
    setQuery("");
    setOpen(true);
    setTimeout(() => runSearch(""), 0);
  };

  const placeholder = useMemo(
    () => (selectedSid ? "החלף לקוח..." : "חפש לפי שם / טלפון / sid"),
    [selectedSid]
  );

  return (
    <LuxShell>
      <LuxTitle
        overline="— Factory quotes"
        subtitle="חפש לקוח כדי לפתוח או לשלוח הצעה חדשה למפעל."
      >
        הצעות <LuxAccent>מהמפעל.</LuxAccent>
      </LuxTitle>

      <div ref={containerRef} className="relative" style={{ marginBottom: 14 }}>
        <div
          className="relative"
          style={{
            background: "#211f1e",
            borderRadius: 8,
            boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.2)",
            display: "flex",
            alignItems: "center",
            padding: "13px 16px",
            gap: 10,
          }}
        >
          <Search className="size-4" style={{ color: "#8a7f74" }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setOpen(true);
              if (results.length === 0) runSearch(query.trim());
            }}
            placeholder={placeholder}
            className="flex-1 text-right focus:outline-none"
            style={{
              background: "transparent",
              border: 0,
              fontSize: 14,
              color: "#e6e1e0",
            }}
          />
          {selectedSid && (
            <button
              type="button"
              onClick={handleClear}
              title="בחר ליד אחר"
              className="grid place-items-center"
              style={{
                width: 24,
                height: 24,
                border: 0,
                background: "transparent",
                borderRadius: 6,
                color: "#8a7f74",
                cursor: "pointer",
              }}
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {open && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-popover shadow-xl max-h-80 overflow-auto">
            {loadingResults ? (
              <div className="px-3 py-4 text-xs text-muted-foreground flex items-center gap-2 justify-center">
                <Loader2 className="size-3.5 animate-spin" />
                טוען…
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                לא נמצאו לידים.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {results.map((r) => (
                  <li key={r.sid}>
                    <button
                      type="button"
                      onClick={() => handlePick(r)}
                      className="w-full px-3 py-2 text-right hover:bg-accent flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {r.name || "(ללא שם)"}
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums truncate">
                          {r.phone || r.sid}
                          {r.stage ? ` · ${r.stage}` : ""}
                        </div>
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {new Date(r.updatedAt).toLocaleDateString("he-IL")}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!selectedSid && (
        <div
          className="text-center"
          style={{
            background: "var(--lux-card)",
            borderRadius: 10,
            padding: "32px 18px",
            color: "#8a7f74",
            fontSize: 14,
            boxShadow: "inset 0 0 0 1px var(--lux-line)",
            marginBottom: 18,
          }}
        >
          <User className="size-5 mx-auto mb-2 opacity-60" />
          בחר ליד מהרשימה למעלה כדי להתחיל זרימת הצעת מפעל.
        </div>
      )}

      {selectedSid && contextLoading && (
        <div
          className="text-center"
          style={{
            background: "#1d1b1a",
            borderRadius: 10,
            padding: "24px 18px",
            color: "#8a7f74",
            fontSize: 14,
            boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.16)",
            marginBottom: 16,
          }}
        >
          <Loader2 className="size-4 mx-auto mb-2 animate-spin" />
          טוען נתוני ליד…
        </div>
      )}

      {selectedSid && contextError && (
        <div
          style={{
            background: "rgba(232,180,180,0.06)",
            borderRadius: 10,
            padding: "14px 18px",
            color: "#e8b4b4",
            fontSize: 14,
            boxShadow: "inset 0 0 0 1px rgba(232,180,180,0.2)",
            marginBottom: 16,
          }}
        >
          ⚠️ {contextError}
        </div>
      )}

      {selectedSid && context && (
        <div className="space-y-4">
          <div
            className="flex items-center justify-between flex-wrap"
            style={{
              background: "#1d1b1a",
              borderRadius: 8,
              padding: "14px 18px",
              gap: 10,
              boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.16)",
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <User className="size-5" style={{ color: "#bec6e0" }} />
              <div className="min-w-0">
                <div style={{ fontSize: 15, color: "#e6e1e0", fontWeight: 500 }}>
                  {context.lead.name || context.lead.phone || context.lead.sid}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-editorial-sans), Manrope, system-ui",
                    fontSize: 11,
                    color: "#8a7f74",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {context.lead.phone ?? "—"} · sid {context.lead.sid}
                  {context.lead.stage ? ` · ${context.lead.stage}` : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {context.lead.quoteTotal && (
                <span
                  style={{
                    padding: "5px 12px",
                    borderRadius: 9999,
                    fontSize: 12,
                    color: "#d6c4ac",
                    background: "rgba(214,196,172,0.08)",
                    boxShadow: "inset 0 0 0 1px rgba(214,196,172,0.2)",
                  }}
                >
                  ציטוט: {context.lead.quoteTotal}
                </span>
              )}
              {context.lead.followUpDate && (
                <span
                  style={{
                    padding: "5px 12px",
                    borderRadius: 9999,
                    fontSize: 12,
                    color: "#c6c6cd",
                    background: "#211f1e",
                    boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.2)",
                  }}
                >
                  מעקב: {context.lead.followUpDate}
                </span>
              )}
            </div>
          </div>

          <FactoryQuotePanelWidget
            apiToken={apiToken}
            leadId={context.lead.sid}
            leadName={context.lead.name}
            qState={(context.lead.qState as Record<string, unknown> | null) ?? null}
            factorySpecDraft={(context.lead.factorySpecDraft as Record<string, unknown> | null) ?? null}
          />
        </div>
      )}

      <div
        style={{
          marginTop: 18,
          background: "var(--lux-card)",
          borderRadius: 10,
          padding: "16px 18px",
          boxShadow: "inset 0 0 0 1px var(--lux-line)",
        }}
      >
        <div className="lux-label" style={{ marginBottom: 10 }}>
          היסטוריית הצעות מפעל
        </div>
        <QuotesHistoryView apiToken={apiToken} />
      </div>
    </LuxShell>
  );
}
