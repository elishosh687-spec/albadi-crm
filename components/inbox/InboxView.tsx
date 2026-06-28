"use client";

import { type CSSProperties, useEffect, useMemo, useState, useTransition } from "react";
import {
  Search,
  RefreshCw,
  Pause,
  Play,
  Send,
  Wallet,
  BarChart3,
  Calculator,
  Mail,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import LeadAnalysisInline from "./LeadAnalysisInline";
import { Avatar, StatusPill, RowActions, T, type Tone, type RowActionItem } from "@/components/widget-ui";
import { normalizeStage, V2_STAGE_LABELS } from "@/lib/manychat/stages";

export interface InboxRow {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  botPaused: boolean;
  lastText: string | null;
  lastSender: "lead" | "bot" | "eli";
  lastAt: string | null;
  inboundLast24h: number;
  ghlContactUrl: string | null;
}

export interface QuickTemplate {
  id: number;
  name: string;
  /** First char/emoji of the name — used as the button label */
  icon: string;
}

interface Props {
  apiToken: string;
  initialRows: InboxRow[];
  selectedSid?: string;
  quickTemplates?: QuickTemplate[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "עכשיו";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}d`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  const days = Math.floor(ms / 86_400_000);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("he-IL");
}

// Map a (possibly legacy / null) pipeline stage code to a Hebrew label +
// tone for StatusPill. Pure presentation — reuses the client-safe stage maps
// (normalizeStage + V2_STAGE_LABELS) so we never hardcode a parallel map.
function stageMeta(raw: string | null): { label: string; tone: Tone } | null {
  const s = normalizeStage(raw);
  if (!s) return null;
  // Champagne is reserved for money (quote totals), NOT stages. Stages use
  // calm low-sat semantic tints; LOST stays neutral (a wall of red dead-leads
  // is noise, not signal).
  const tone: Tone =
    s === "WON"
      ? "success"
      : s === "LOST"
      ? "neutral"
      : s === "CONSIDERATION"
      ? "info"
      : s === "DISCAVERY"
      ? "engaged"
      : s === "FACTORY_WAIT"
      ? "warn"
      : "neutral";
  return { label: V2_STAGE_LABELS[s], tone };
}

// Short label for the message sender — clean text, no emoji.
function senderTag(s: "lead" | "bot" | "eli"): string {
  if (s === "lead") return "לקוח";
  if (s === "eli") return "אלי";
  return "בוט";
}

// Strip a leading pictographic char + whitespace so the visible label under
// the tile icon doesn't repeat the icon (e.g. "📐 הסבר מידות שקית" →
// "הסבר מידות שקית").
function stripLeadingEmoji(name: string): string {
  return name.trim().replace(/^\p{Extended_Pictographic}\s*/u, "").trim();
}

// Build the items for a row's ⋯ RowActions menu. Pure relocation of the old
// always-visible tile triggers — every onClick calls the SAME unchanged
// handler it did before. No new behavior.
function buildRowActions(
  r: InboxRow,
  h: {
    toggle: (sid: string, current: boolean) => void;
    sendTemplate: (sid: string, leadName: string, tpl: QuickTemplate) => void;
    quickTemplates: QuickTemplate[];
    openQuotes: () => void;
    openAnalyze: () => void;
  }
): RowActionItem[] {
  const leadName = r.name || r.phone || r.sid;
  return [
    {
      label: r.botPaused ? "הפעל בוט" : "השהה בוט",
      tone: r.botPaused ? "warn" : "neutral",
      onClick: () => h.toggle(r.sid, r.botPaused),
    },
    { label: "הצעות מחיר", tone: "champagne", onClick: h.openQuotes },
    { label: "נתח ליד", tone: "neutral", onClick: h.openAnalyze },
    ...h.quickTemplates.map((tpl) => ({
      label: stripLeadingEmoji(tpl.name) || "תבנית",
      onClick: () => h.sendTemplate(r.sid, leadName, tpl),
    })),
  ];
}

export default function InboxView({
  apiToken,
  initialRows,
  selectedSid,
  quickTemplates = [],
}: Props) {
  const [rows, setRows] = useState<InboxRow[]>(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // sid of the row whose inline factory-quotes panel is expanded. null = none.
  const [expandedSid, setExpandedSid] = useState<string | null>(null);
  // sid of the row whose inline lead-analysis panel is expanded. null = none.
  const [analyzeSid, setAnalyzeSid] = useState<string | null>(null);
  // Open conversation thread (Front-style list | thread). null = list only.
  const [threadSid, setThreadSid] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const threadRow = rows.find((r) => r.sid.trim() === threadSid);

  // Inbox is self-contained — clicking a name opens the lead's contact
  // card in GHL in a new tab. Cross-origin top-window navigation from an
  // iframe is blocked, so we use window.open with _blank.
  function selectLead(row: InboxRow) {
    if (!row.ghlContactUrl) return;
    window.open(row.ghlContactUrl, "_blank", "noopener");
  }

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) =>
      [r.name, r.phone, r.lastText].some((x) => x?.toLowerCase().includes(f))
    );
  }, [rows, filter]);

  async function toggle(sid: string, current: boolean) {
    setBusy(sid);
    const next = !current;
    // optimistic
    setRows((rs) => rs.map((r) => (r.sid === sid ? { ...r, botPaused: next } : r)));
    try {
      const res = await fetch(
        `/api/widget/toggle-pause?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid, paused: next }),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "toggle failed");
    } catch (e) {
      // revert
      setRows((rs) => rs.map((r) => (r.sid === sid ? { ...r, botPaused: current } : r)));
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function sendIntro(sid: string, name: string) {
    if (!window.confirm(`לשלוח הצגת חברה (וידאו + אתרים) ל-${name}?`)) return;
    setBusy(sid);
    try {
      const res = await fetch(
        `/api/widget/send-company-intro?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid }),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "send failed");
      alert("✅ הצגת חברה נשלחה");
    } catch (e) {
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function sendTemplate(sid: string, leadName: string, tpl: QuickTemplate) {
    if (!window.confirm(`לשלוח "${tpl.name}" ל-${leadName}?`)) return;
    setBusy(sid);
    try {
      const res = await fetch(
        `/api/widget/send-template?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid, templateId: tpl.id }),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "send failed");
      alert(`✅ נשלח: ${tpl.name}`);
    } catch (e) {
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function refresh() {
    startTransition(() => {
      location.reload();
    });
  }

  return (
    <div className="gg-theme" dir="rtl" style={{ maxWidth: threadSid ? "100%" : 720, margin: "0 auto", padding: "0 4px", borderRadius: 12 }}>
      {/* Responsive CSS — at ≤640px (mobile), collapse the inline template
          tiles into a ☰ hamburger that opens an overlay; on tablet/desktop
          show them inline. Inline styles can't do media queries, so this
          tiny <style> tag carries the breakpoint behavior. */}
      <style>{`
        /* Dense list rows — hover bg + the ⋯ trigger reveals on hover (and is
           always visible on touch, where :hover doesn't apply). */
        .inbox-row:hover { background: rgba(255,255,255,0.025); }
        .inbox-row .inbox-row-actions-btn { opacity: 0; transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease; }
        .inbox-row:hover .inbox-row-actions-btn { opacity: 1; }
        .inbox-row .inbox-row-actions-btn:focus-visible,
        .inbox-row .inbox-row-actions-btn[aria-expanded="true"] { opacity: 1; }
        @media (hover: none) { .inbox-row .inbox-row-actions-btn { opacity: 1; } }
        .inbox-row-actions-btn:hover { background: rgba(255,255,255,0.09); color: #f5f6f7; }
        /* list | thread | context — ONE seamless glass surface (Front 3-pane).
           RTL: list on the RIGHT (first column), thread+context fill the LEFT.
           No gaps between panes — the outer surface IS the card; panes are
           transparent and separated by hairline dividers only. */
        .inbox-split {
          display: grid;
          grid-template-columns: 290px 1fr;
          gap: 0;
          height: calc(100dvh - 40px);
          align-items: stretch;
          background: rgba(255,255,255,0.045);
          border: 1px solid rgba(255,255,255,0.11);
          border-radius: 16px;
          overflow: hidden;
          backdrop-filter: blur(30px) saturate(1.7);
          -webkit-backdrop-filter: blur(30px) saturate(1.7);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 50px rgba(0,0,0,0.45);
        }
        .inbox-split .inbox-listcol {
          overflow-y: auto;
          min-height: 0;
          padding: 12px;
          border-inline-end: 1px solid rgba(255,255,255,0.08);
        }
        /* graphite scrollbars inside the surface */
        .inbox-split ::-webkit-scrollbar { width: 8px; height: 8px; }
        .inbox-split ::-webkit-scrollbar-track { background: transparent; }
        .inbox-split ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 8px; }
        .inbox-split ::-webkit-scrollbar-thumb:hover { background: rgba(205,169,120,0.35); }
        .inbox-split { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent; }
        @media (max-width: 760px) { .inbox-split { grid-template-columns: 1fr; height: calc(100dvh - 40px); } .inbox-listcol { display: none; } }
      `}</style>
      <div className={threadSid ? "inbox-split" : undefined}>
      <div className={threadSid ? "inbox-listcol" : undefined}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          position: "sticky",
          top: 0,
          background: "rgba(14,14,16,0.82)",
          backdropFilter: "blur(20px) saturate(1.6)",
          WebkitBackdropFilter: "blur(20px) saturate(1.6)",
          padding: "8px 0",
          zIndex: 10,
        }}
      >
        <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
          <Search
            size={15}
            style={{ position: "absolute", insetInlineStart: 10, color: T.faint, pointerEvents: "none" }}
          />
          <input
            type="text"
            placeholder="חפש שם / טלפון / טקסט"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              flex: 1,
              width: "100%",
              height: 32,
              background: T.glassBg,
              color: T.text,
              border: `1px solid ${T.glassBorder}`,
              borderRadius: 6,
              padding: "0 12px 0 32px",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
        </div>
        <button
          onClick={refresh}
          title="רענן"
          aria-label="רענן"
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: T.glassBg,
            color: T.muted,
            border: `1px solid ${T.glassBorder}`,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Dense flat list (Attio/Stripe): rows separated by hairline
          border-top dividers; the container owns the 6px radii, rows are
          flat. Hover reveals a single ⋯ RowActions menu holding every action
          (pause/resume, templates, quotes, analyze) — handlers unchanged. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          border: threadSid ? "none" : `1px solid ${T.glassBorder}`,
          borderRadius: threadSid ? 0 : 6,
          overflow: "hidden",
          background: threadSid ? "transparent" : T.glassBg,
        }}
      >
        {visible.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: T.muted }}>
            אין שיחות
          </div>
        )}
        {visible.map((r, idx) => {
          const isSel = (selectedSid === r.sid.trim()) || (threadSid === r.sid.trim());
          const leadName = r.name || r.phone || r.sid;
          const stage = stageMeta(r.stage);
          const actionItems = buildRowActions(r, {
            toggle,
            sendTemplate,
            quickTemplates,
            openQuotes: () =>
              setExpandedSid((cur) => (cur === r.sid.trim() ? null : r.sid.trim())),
            openAnalyze: () =>
              setAnalyzeSid((cur) => (cur === r.sid.trim() ? null : r.sid.trim())),
          });
          return (
          <div
            key={r.sid}
            className="inbox-row"
            style={{
              borderTop: idx === 0 ? "none" : `1px solid ${T.hairline}`,
              borderInlineStart: `2px solid ${isSel ? T.champBorder : "transparent"}`,
              background: isSel ? "rgba(205,169,120,0.07)" : "transparent",
            }}
          >
            <div
              style={{
                minHeight: 48,
                padding: "7px 12px",
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <a
                href={r.ghlContactUrl ?? "#"}
                onClick={(e) => { e.preventDefault(); setThreadSid(r.sid.trim()); }}
                title="פתח שיחה"
                style={{
                  flex: 1,
                  minWidth: 0,
                  cursor: "pointer",
                  color: "inherit",
                  textDecoration: "none",
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                {!threadSid && <Avatar name={r.name || undefined} size={28} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* line 1: name + phone + stage pill + time
                      In rail mode (a conversation is open) rows go slim —
                      just name + time + snippet, like the Front list rail. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: T.text,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "55%",
                      }}
                    >
                      {leadName}
                    </span>
                    {!threadSid && r.phone && (
                      <span
                        style={{
                          fontSize: 11,
                          color: T.faint,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {r.phone}
                      </span>
                    )}
                    <span style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {!threadSid && stage && <StatusPill label={stage.label} tone={stage.tone} />}
                      <span style={{ fontSize: 11, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                        {timeAgo(r.lastAt)}
                      </span>
                    </span>
                  </div>
                  {/* line 2: snippet + signals */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        color: T.muted,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {!threadSid && <span style={{ color: T.faint, marginInlineEnd: 5 }}>{senderTag(r.lastSender)}:</span>}
                      {r.lastText?.slice(0, 100) || <span style={{ color: T.faint }}>—</span>}
                    </span>
                    {!threadSid && r.inboundLast24h > 0 && (
                      <span
                        title={`${r.inboundLast24h} הודעות חדשות ב-24ש`}
                        style={{
                          flexShrink: 0,
                          minWidth: 16,
                          height: 16,
                          padding: "0 5px",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 999,
                          background: T.champFill,
                          border: `1px solid ${T.champBorder}`,
                          color: T.champ,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {r.inboundLast24h}
                      </span>
                    )}
                    {!threadSid && r.botPaused && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: 10,
                          fontWeight: 600,
                          color: T.warn,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: "rgba(203,176,121,0.10)",
                          border: "1px solid rgba(203,176,121,0.26)",
                        }}
                      >
                        מושהה
                      </span>
                    )}
                  </div>
                </div>
              </a>

              {/* single ⋯ menu, revealed on row hover (or always on touch).
                  Hidden in rail mode — open-conversation actions live in the
                  thread header + context panel, not on the rail rows. */}
              {!threadSid && (
                <div style={{ flexShrink: 0 }}>
                  <RowActions items={actionItems} triggerClassName="inbox-row-actions-btn" />
                </div>
              )}
            </div>
            {expandedSid === r.sid.trim() && (
              <div style={{ borderTop: `1px solid ${T.hairline}`, padding: 12 }}>
                <LeadQuotesInline
                  apiToken={apiToken}
                  sid={r.sid.trim()}
                  name={r.name}
                  phone={r.phone}
                />
              </div>
            )}
            {analyzeSid === r.sid.trim() && (
              <div style={{ borderTop: `1px solid ${T.hairline}`, padding: 12 }}>
                <LeadAnalysisInline apiToken={apiToken} sid={r.sid.trim()} name={r.name} />
              </div>
            )}
          </div>
          );
        })}
      </div>
      </div>{/* /inbox-listcol */}
      {threadSid && threadRow && (
        <ThreadView
          apiToken={apiToken}
          row={threadRow}
          busy={busy}
          quickTemplates={quickTemplates}
          onClose={() => setThreadSid(null)}
          onToggle={() => toggle(threadRow.sid, threadRow.botPaused)}
          onSendTemplate={(tpl) =>
            sendTemplate(threadRow.sid, threadRow.name || threadRow.phone || threadRow.sid, tpl)
          }
        />
      )}
      </div>{/* /inbox-split */}

    </div>
  );
}

// Hebrew labels for factory-quote statuses (used by LeadQuotesInline).
const STATUS_HE: Record<string, string> = {
  draft: "טיוטה",
  pending: "ממתין",
  received: "התקבל",
  finalized: "סופי",
};

interface InlineQuote {
  id: string;
  quotationNo: string | null;
  createdAt: string;
  factoryStatus: string;
  finalPricing: { totalSellingPrice?: number; totalOrderPriceIls?: number } | null;
  pdfUrl: string | null;
}

/**
 * Inline factory-quotes panel shown under a conversation row when "הצעות מחיר"
 * is chosen from the row's ⋯ menu. Lists the lead's quotes (open PDF / send on finalized) and lets
 * the user multi-select finalized ones to combine into one PDF — all without
 * leaving the שיחות tab.
 */
interface ThreadMsg {
  id: number;
  direction: string;
  text: string | null;
  sender: string | null;
  receivedAt: string;
}

/**
 * In-widget conversation pane (Front pattern). Loads the message thread, lets
 * Eli reply free-form (via /api/widget/calculator/send-text), and surfaces ALL
 * the row's functions in the header: pause/resume, quotes, analyze, templates,
 * open-in-GHL.
 */
function ThreadView({
  apiToken,
  row,
  busy,
  quickTemplates,
  onClose,
  onToggle,
  onSendTemplate,
}: {
  apiToken: string;
  row: InboxRow;
  busy: string | null;
  quickTemplates: QuickTemplate[];
  onClose: () => void;
  onToggle: () => void;
  onSendTemplate: (tpl: QuickTemplate) => void;
}) {
  const sid = row.sid.trim();
  const [msgs, setMsgs] = useState<ThreadMsg[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [panel, setPanel] = useState<"chat" | "quotes" | "analyze">("chat");
  const [showTpl, setShowTpl] = useState(false);
  const [ctx, setCtx] = useState<{ quoteTotal: string | null; stage: string | null } | null>(null);

  async function load() {
    try {
      const res = await fetch(
        `/api/widget/messages?widget_token=${encodeURIComponent(apiToken)}&sid=${encodeURIComponent(sid)}`
      );
      const j = await res.json();
      if (j.ok) setMsgs(j.messages as ThreadMsg[]);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let alive = true;
    setPanel("chat");
    setMsgs(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/widget/messages?widget_token=${encodeURIComponent(apiToken)}&sid=${encodeURIComponent(sid)}`
        );
        const j = await res.json();
        if (alive && j.ok) setMsgs(j.messages as ThreadMsg[]);
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sid, apiToken]);

  useEffect(() => {
    let alive = true;
    setCtx(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/widget/leads/${encodeURIComponent(sid)}/factory-context?widget_token=${encodeURIComponent(apiToken)}`
        );
        const j = await res.json();
        if (alive && j?.ok && j.lead) {
          setCtx({ quoteTotal: j.lead.quoteTotal ?? null, stage: j.lead.stage ?? null });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [sid, apiToken]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/widget/calculator/send-text?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid, text }),
        }
      );
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "send failed");
      setDraft("");
      await load();
    } catch (e) {
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  }

  const actBtn: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 10px",
    borderRadius: 8,
    fontSize: 12,
    fontFamily: "inherit",
    cursor: "pointer",
    background: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.11)",
    color: "#f5f6f7",
    whiteSpace: "nowrap",
  };
  const sideBtn: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 7,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 12.5,
    fontFamily: "inherit",
    cursor: "pointer",
    background: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.11)",
    color: "#f5f6f7",
    textAlign: "right",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
  const sideActive: CSSProperties = {
    ...sideBtn,
    background: "rgba(205,169,120,0.14)",
    border: "1px solid rgba(205,169,120,0.30)",
    color: "#e7cba6",
  };

  // Hebrew stage pill for the header — reuses the same client-safe map as the
  // list rows; prefers the freshly-loaded context stage, falls back to the row.
  const headerStage = stageMeta(ctx?.stage ?? row.stage);

  // Secondary actions behind the header ⋯ — relocated, same handlers/links.
  const headerActions: RowActionItem[] = [
    { label: "הצעות מחיר", tone: "champagne", onClick: () => setPanel(panel === "quotes" ? "chat" : "quotes") },
    { label: "נתח ליד", tone: "neutral", onClick: () => setPanel(panel === "analyze" ? "chat" : "analyze") },
    {
      label: "פתח מחשבון",
      onClick: () =>
        window.open(
          `/widget/calculator?widget_token=${encodeURIComponent(apiToken)}&sid=${encodeURIComponent(sid)}`,
          "_blank",
          "noopener,noreferrer"
        ),
    },
    ...quickTemplates.map((tpl) => ({
      label: stripLeadingEmoji(tpl.name) || "תבנית",
      onClick: () => onSendTemplate(tpl),
    })),
    ...(row.ghlContactUrl
      ? [{ label: "פתח ב-GHL", onClick: () => window.open(row.ghlContactUrl!, "_blank", "noopener,noreferrer") }]
      : []),
  ];

  return (
    <div style={{ display: "flex", gap: 0, height: "100%", minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <button
          onClick={onClose}
          title="חזרה לרשימה"
          aria-label="חזרה לרשימה"
          style={{ ...actBtn, padding: "6px 9px" }}
        >
          <ArrowRight size={15} />
        </button>
        <Avatar name={row.name || undefined} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: T.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.name || row.phone || sid}
          </div>
          <div style={{ fontSize: 11, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
            {row.phone || ""}
          </div>
        </div>
        {headerStage && <StatusPill label={headerStage.label} tone={headerStage.tone} />}
        {/* pause/resume — primary action, kept visible in the header */}
        <button
          onClick={onToggle}
          disabled={busy === row.sid}
          title={row.botPaused ? "הפעל בוט" : "השהה בוט"}
          aria-label={row.botPaused ? "הפעל בוט" : "השהה בוט"}
          style={{
            ...actBtn,
            padding: "6px 9px",
            ...(row.botPaused
              ? { background: "rgba(203,176,121,0.12)", border: "1px solid rgba(203,176,121,0.30)", color: T.warn }
              : {}),
          }}
        >
          {row.botPaused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        {/* the rest behind a single ⋯ */}
        <RowActions items={headerActions} />
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 9,
        }}
      >
        {panel === "quotes" ? (
          <LeadQuotesInline apiToken={apiToken} sid={sid} name={row.name} phone={row.phone} />
        ) : panel === "analyze" ? (
          <LeadAnalysisInline apiToken={apiToken} sid={sid} name={row.name} />
        ) : loading ? (
          <div style={{ color: "#8f939b", fontSize: 12, textAlign: "center", padding: 24 }}>טוען שיחה…</div>
        ) : !msgs || msgs.length === 0 ? (
          <div style={{ color: "#8f939b", fontSize: 12, textAlign: "center", padding: 24 }}>אין הודעות עדיין</div>
        ) : (
          msgs.filter((m) => m.text && m.text.trim()).map((m) => {
            const incoming = m.direction === "in" || m.sender === "lead";
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: incoming ? "flex-start" : "flex-end",
                  maxWidth: "80%",
                  background: incoming ? "rgba(255,255,255,0.06)" : "rgba(205,169,120,0.16)",
                  color: incoming ? "#e4e5e8" : "#fdf3e6",
                  border: incoming ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(205,169,120,0.34)",
                  borderRadius: incoming ? "10px 10px 10px 3px" : "10px 10px 3px 10px",
                  padding: "9px 13px",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.text}
              </div>
            );
          })
        )}
      </div>

      {panel === "chat" && (
        <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="כתוב תשובה… (⌘/Ctrl+Enter לשליחה)"
            rows={2}
            style={{
              flex: 1,
              resize: "none",
              background: "rgba(255,255,255,0.05)",
              color: "#f5f6f7",
              border: "1px solid rgba(255,255,255,0.13)",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            title="שלח"
            aria-label="שלח"
            style={{
              flexShrink: 0,
              alignSelf: "stretch",
              minWidth: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 16px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.22)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(235,237,240,0.88))",
              color: "#15171c",
              cursor: sending || !draft.trim() ? "default" : "pointer",
              fontFamily: "inherit",
              opacity: sending || !draft.trim() ? 0.5 : 1,
              backdropFilter: "blur(30px) saturate(1.7)",
              WebkitBackdropFilter: "blur(30px) saturate(1.7)",
            }}
          >
            {sending ? "…" : <Send size={16} />}
          </button>
        </div>
      )}
      </div>{/* /thread column */}

      {/* CONTEXT panel (left) — lead at a glance + actions */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflowY: "auto",
          borderInlineStart: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div>
          <div style={{ fontSize: 10.5, color: T.muted, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>
            הצעה
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.5px",
              fontVariantNumeric: "tabular-nums",
              fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
              color: T.champStrong,
            }}
          >
            {ctx?.quoteTotal ? `₪${ctx.quoteTotal}` : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: T.muted, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 5 }}>
            שלב
          </div>
          {headerStage ? (
            <StatusPill label={headerStage.label} tone={headerStage.tone} />
          ) : (
            <span style={{ color: T.faint }}>—</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto", borderTop: `1px solid ${T.hairline}`, paddingTop: 12 }}>
          <button onClick={() => setPanel(panel === "quotes" ? "chat" : "quotes")} style={panel === "quotes" ? sideActive : sideBtn}>
            <Wallet size={14} /> הצעות מחיר
          </button>
          <button onClick={() => setPanel(panel === "analyze" ? "chat" : "analyze")} style={panel === "analyze" ? sideActive : sideBtn}>
            <BarChart3 size={14} /> נתח ליד
          </button>
          <a
            href={`/widget/calculator?widget_token=${encodeURIComponent(apiToken)}&sid=${encodeURIComponent(sid)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={sideBtn}
          >
            <Calculator size={14} /> פתח מחשבון
          </a>
          <button onClick={onToggle} disabled={busy === row.sid} style={sideBtn}>
            {row.botPaused ? <Play size={14} /> : <Pause size={14} />}
            {row.botPaused ? "הפעל בוט" : "השהה בוט"}
          </button>
          {quickTemplates.length > 0 && (
            <button onClick={() => setShowTpl((s) => !s)} style={sideBtn}>
              <Mail size={14} /> תבניות
            </button>
          )}
          {showTpl && quickTemplates.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingInlineStart: 4 }}>
              {quickTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => {
                    setShowTpl(false);
                    onSendTemplate(tpl);
                  }}
                  style={{ ...sideBtn, fontSize: 11.5 }}
                >
                  {stripLeadingEmoji(tpl.name) || "תבנית"}
                </button>
              ))}
            </div>
          )}
          {row.ghlContactUrl && (
            <a href={row.ghlContactUrl} target="_blank" rel="noopener noreferrer" style={sideBtn}>
              <ExternalLink size={14} /> פתח ב-GHL
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function LeadQuotesInline({
  apiToken,
  sid,
  name,
  phone,
}: {
  apiToken: string;
  sid: string;
  name: string | null;
  phone: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState<InlineQuote[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/widget/factory/list?widget_token=${encodeURIComponent(apiToken)}&lead=${encodeURIComponent(sid)}`
        );
        const j = await res.json();
        if (!alive) return;
        if (j?.ok) setQuotes(j.requests as InlineQuote[]);
        else setErr(j?.error ?? "load failed");
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "load failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [apiToken, sid]);

  const cleanPhone = (phone ?? "").replace(/[^\d]/g, "");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const money = (q: InlineQuote) => {
    const v = q.finalPricing?.totalSellingPrice ?? q.finalPricing?.totalOrderPriceIls;
    return typeof v === "number" ? `₪${Math.round(v).toLocaleString("he-IL")}` : "";
  };

  const linkStyle: CSSProperties = {
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 6,
    textDecoration: "none",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#f5f6f7",
    background: "rgba(255,255,255,0.11)",
    whiteSpace: "nowrap",
    cursor: "pointer",
  };
  const waStyle: CSSProperties = {
    ...linkStyle,
    background: "#15803d",
    borderColor: "#15803d",
    color: "#fff",
  };

  if (loading) return <div style={{ fontSize: 12, color: "#8f939b" }}>טוען הצעות…</div>;
  if (err) return <div style={{ fontSize: 12, color: "#f87171" }}>שגיאה: {err}</div>;
  if (!quotes || quotes.length === 0)
    return <div style={{ fontSize: 12, color: "#8f939b" }}>אין הצעות מחיר ללקוח הזה.</div>;

  const ids = [...selected].join(",");
  const combinedWa =
    selected.size >= 2 && cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
          [
            name ? `היי ${name},` : "היי,",
            `מצורפת הצעת מחיר משולבת ל-${selected.size} מוצרים.`,
            `הצעה מלאה: ${origin}/api/factory/combine/pdf?ids=${ids}`,
            "ההצעה בתוקף ל-14 יום. נשמח לקבל אישור 🙂",
          ].join("\n")
        )}`
      : null;
  const sorted = [...quotes].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "#8f939b" }}>
        הצעות מחיר ({quotes.length}) · סמן 2+ סופיות לאיחוד ל-PDF אחד
      </div>
      {selected.size >= 2 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "2px 0",
          }}
        >
          <span style={{ fontSize: 11, color: "#cda978" }}>{selected.size} נבחרו</span>
          <button onClick={() => setSelected(new Set())} style={linkStyle}>
            נקה
          </button>
          <a href={`/api/factory/combine/pdf?ids=${ids}`} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            פתח PDF
          </a>
          {combinedWa && (
            <a href={combinedWa} target="_blank" rel="noopener noreferrer" style={waStyle}>
              שלח ב-WhatsApp
            </a>
          )}
        </div>
      )}
      {sorted.map((q) => {
        const isFinal = q.factoryStatus === "finalized" && !!q.finalPricing;
        const waUrl =
          isFinal && cleanPhone
            ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                [
                  name ? `היי ${name},` : "היי,",
                  `מצורפת הצעת מחיר #${q.quotationNo ?? q.id.slice(-6)}.`,
                  `הצעה מלאה: ${origin}/api/factory/${q.id}/pdf`,
                  "ההצעה בתוקף ל-14 יום. נשמח לקבל אישור 🙂",
                ].join("\n")
              )}`
            : null;
        return (
          <div
            key={q.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.11)",
              background: "#15171c",
            }}
          >
            {isFinal && (
              <input
                type="checkbox"
                checked={selected.has(q.id)}
                onChange={() => toggle(q.id)}
                style={{ accentColor: "#cda978" }}
              />
            )}
            <span style={{ fontSize: 11, color: "#8f939b", fontFamily: "monospace" }}>
              {q.quotationNo ?? q.id.slice(-6)}
            </span>
            <span style={{ fontSize: 11, color: "#8f939b" }}>
              {new Date(q.createdAt).toLocaleDateString("he-IL")}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 99,
                border: "1px solid rgba(255,255,255,0.11)",
                color: isFinal ? "#34d399" : "#8f939b",
              }}
            >
              {STATUS_HE[q.factoryStatus] ?? q.factoryStatus}
            </span>
            {isFinal && (
              <span style={{ fontSize: 12, color: "#34d399", fontWeight: 600 }}>{money(q)}</span>
            )}
            <div style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
              {isFinal && (
                <a href={`/api/factory/${q.id}/pdf`} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                  פתח PDF
                </a>
              )}
              {waUrl && (
                <a href={waUrl} target="_blank" rel="noopener noreferrer" style={waStyle}>
                  שלח
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
