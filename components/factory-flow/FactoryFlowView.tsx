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
    <div className="gg-theme space-y-4 rounded-xl p-4" dir="rtl">
      <div className="rounded-lg border border-border bg-card/40 p-3 space-y-3">
        <div className="text-xs text-muted-foreground">
          חפש לקוח כדי לפתוח / לשלוח הצעה חדשה למפעל
        </div>
      <div ref={containerRef} className="relative">
        <div className="relative">
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search className="size-4" />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setOpen(true);
              if (results.length === 0) runSearch(query.trim());
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-border bg-background pr-9 pl-9 py-2.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {selectedSid && (
            <button
              type="button"
              onClick={handleClear}
              title="בחר ליד אחר"
              className="absolute left-2 top-1/2 -translate-y-1/2 size-6 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
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
        <div className="rounded-lg border border-dashed border-border bg-card/30 p-6 text-center text-sm text-muted-foreground">
          <User className="size-5 mx-auto mb-2 opacity-50" />
          בחר ליד מהרשימה למעלה כדי להתחיל זרימת הצעת מפעל.
        </div>
      )}

      {selectedSid && contextLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="size-4 mx-auto mb-2 animate-spin" />
          טוען נתוני ליד…
        </div>
      )}

      {selectedSid && contextError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          ⚠️ {contextError}
        </div>
      )}

      {selectedSid && context && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card/40 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {context.lead.name || context.lead.phone || context.lead.sid}
              </div>
              <div className="text-[11px] text-muted-foreground truncate tabular-nums">
                {context.lead.phone ?? "—"} · sid {context.lead.sid}
                {context.lead.stage ? ` · ${context.lead.stage}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {context.lead.quoteTotal && (
                <span className="rounded-full border border-border bg-background/40 px-2 py-0.5">
                  ציטוט: {context.lead.quoteTotal}
                </span>
              )}
              {context.lead.followUpDate && (
                <span className="rounded-full border border-border bg-background/40 px-2 py-0.5">
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
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-3">
        <div className="text-xs text-muted-foreground mb-2">היסטוריית הצעות מפעל</div>
        <QuotesHistoryView apiToken={apiToken} />
      </div>
    </div>
  );
}
