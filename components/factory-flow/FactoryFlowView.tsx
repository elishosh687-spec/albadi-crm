"use client";

/**
 * Top-level widget client component. Renders a contact picker (typeahead) +
 * the per-lead factory-quote panel for the selected lead.
 *
 * Auth: every fetch carries `?widget_token=<apiToken>`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
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
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const closePicker = () => {
    setPickerOpen(false);
    setSelectedSid(null);
    setContext(null);
    setQuery("");
    setOpen(false);
  };

  const placeholder = useMemo(
    () => (selectedSid ? "החלף לקוח…" : "חיפוש לפי שם או טלפון"),
    [selectedSid]
  );

  return (
    <LuxShell className="ux ux-floor">
      <LuxTitle
        overline="— Quotes"
        subtitle="מה מחכה לך למעלה, ואז כל ההצעות לפי לקוח."
        aside={
          !pickerOpen && !selectedSid ? (
            <button type="button" className="ux-btn primary" onClick={() => { setPickerOpen(true); setOpen(true); runSearch(""); }}>
              <Plus className="size-4" aria-hidden /> הצעה חדשה
            </button>
          ) : null
        }
      >
        הצעות <LuxAccent>מחיר.</LuxAccent>
      </LuxTitle>

      {(pickerOpen || selectedSid) && (
        <section className="ux-panel" style={{ marginBottom: 20 }} aria-labelledby="ff-new">
          <div className="flex items-center justify-between gap-2">
            <h2 id="ff-new" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
              {selectedSid ? "הצעה חדשה" : "הצעה חדשה — לאיזה לקוח?"}
            </h2>
            <button type="button" className="ux-btn sm" onClick={closePicker}>
              <X className="size-4" aria-hidden /> סגור
            </button>
          </div>

          <div ref={containerRef} className="relative" style={{ marginTop: 12 }}>
            <label className="ux-search" style={{ marginBottom: 0 }}>
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="ux-sr">חיפוש לקוח</span>
              <input
                type="search"
                value={query}
                autoFocus={!selectedSid}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => {
                  setOpen(true);
                  if (results.length === 0) runSearch(query.trim());
                }}
                placeholder={placeholder}
              />
            </label>

            {open && (
              <div className="ff-results" role="listbox" aria-label="לקוחות">
                {loadingResults ? (
                  <div className="ux-skel" style={{ height: 120 }} aria-label="טוען" />
                ) : results.length === 0 ? (
                  <div style={{ padding: 16, textAlign: "center", color: "var(--lux-muted)", fontSize: 14 }}>לא נמצא לקוח.</div>
                ) : (
                  <ul>
                    {results.map((r) => (
                      <li key={r.sid}>
                        <button type="button" role="option" aria-selected={r.sid === selectedSid} onClick={() => handlePick(r)}>
                          <span className="min-w-0 flex-1">
                            <span className="block" style={{ fontSize: 15 }}>{r.name || "(ללא שם)"}</span>
                            <span className="block tnum" style={{ fontSize: 13.5, color: "var(--lux-muted)" }}>
                              {r.phone || r.sid}
                              {r.stage ? ` · ${r.stage}` : ""}
                            </span>
                          </span>
                          <span className="tnum shrink-0" style={{ fontSize: 13.5, color: "var(--lux-muted)" }}>
                            {new Date(r.updatedAt).toLocaleDateString("he-IL")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {selectedSid && contextLoading && <div className="ux-skel" style={{ height: 160, marginTop: 14 }} aria-label="טוען נתוני לקוח" />}

          {selectedSid && contextError && (
            <p className="ux-note" style={{ color: "#f0c0c0" }}>לא הצלחתי לטעון את הלקוח: {contextError}</p>
          )}

          {selectedSid && context && (
            <div className="grid gap-4" style={{ marginTop: 14 }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="min-w-0">
                  <div style={{ fontSize: 16 }}>{context.lead.name || context.lead.phone || context.lead.sid}</div>
                  <div className="tnum" style={{ fontSize: 13.5, color: "var(--lux-muted)" }}>
                    {context.lead.phone ?? "—"}
                    {context.lead.stage ? ` · ${context.lead.stage}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {context.lead.quoteTotal && <span className="ux-pill" data-tone="go">הצעה: {context.lead.quoteTotal}</span>}
                  {context.lead.followUpDate && <span className="ux-pill" data-tone="idle">מעקב: {context.lead.followUpDate}</span>}
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
        </section>
      )}

      <QuotesHistoryView apiToken={apiToken} />
    </LuxShell>
  );
}
