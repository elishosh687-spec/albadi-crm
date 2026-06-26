"use client";

import { type CSSProperties, useEffect, useMemo, useState, useTransition } from "react";
import LeadAnalysisInline from "./LeadAnalysisInline";

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

function senderLabel(s: "lead" | "bot" | "eli"): string {
  if (s === "lead") return "👤";
  if (s === "eli") return "🧑‍💼";
  return "🤖";
}

// Strip a leading pictographic char + whitespace so the visible label under
// the tile icon doesn't repeat the icon (e.g. "📐 הסבר מידות שקית" →
// "הסבר מידות שקית").
function stripLeadingEmoji(name: string): string {
  return name.trim().replace(/^\p{Extended_Pictographic}\s*/u, "").trim();
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
  // sid of the row whose mobile template overlay is open. null = closed.
  const [mobileMenuSid, setMobileMenuSid] = useState<string | null>(null);
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
    <div className="gg-theme" dir="rtl" style={{ maxWidth: 720, margin: "0 auto", padding: "0 4px", borderRadius: 12 }}>
      {/* Responsive CSS — at ≤640px (mobile), collapse the inline template
          tiles into a ☰ hamburger that opens an overlay; on tablet/desktop
          show them inline. Inline styles can't do media queries, so this
          tiny <style> tag carries the breakpoint behavior. */}
      <style>{`
        /* Front pattern: clean rows, actions behind a single ⋯ at every width */
        .inbox-actions-inline { display: none; }
        .inbox-actions-mobile { display: flex; }
        .inbox-row-actions-btn { transition: background 0.12s ease, color 0.12s ease; }
        .inbox-row-actions-btn:hover { background: rgba(255,255,255,0.09); color: #f5f6f7; }
        /* list | thread | context — ONE seamless glass surface (Front 3-pane).
           RTL: list on the RIGHT (first column), thread+context fill the LEFT.
           No gaps between panes — the outer surface IS the card; panes are
           transparent and separated by hairline dividers only. */
        .inbox-split {
          display: grid;
          grid-template-columns: 290px 1fr;
          gap: 0;
          height: calc(100dvh - 96px);
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
        @media (max-width: 760px) { .inbox-split { grid-template-columns: 1fr; height: calc(100dvh - 96px); } .inbox-listcol { display: none; } }
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
        <input
          type="text"
          placeholder="חפש שם / טלפון / טקסט"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.05)",
            color: "#f5f6f7",
            border: "1px solid rgba(255,255,255,0.11)",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 15,
          }}
        />
        <button
          onClick={refresh}
          style={{
            background: "rgba(255,255,255,0.11)",
            color: "#f5f6f7",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          🔄
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: threadSid ? 0 : 6 }}>
        {visible.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#8f939b" }}>
            אין שיחות
          </div>
        )}
        {visible.map((r) => {
          const isSel = selectedSid === r.sid.trim();
          // Rail mode (a thread is open): flat Front-style rows — no per-row
          // card, just a hairline divider + selected accent. Full-list mode:
          // floating glass cards.
          const rowStyle: CSSProperties = threadSid
            ? {
                background: isSel
                  ? "rgba(205,169,120,0.12)"
                  : r.botPaused
                  ? "rgba(220,150,90,0.08)"
                  : "transparent",
                borderInlineStart: `2px solid ${isSel ? "#cda978" : "transparent"}`,
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                display: "flex",
                flexDirection: "column",
              }
            : {
                background: r.botPaused ? "rgba(220,150,90,0.10)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${isSel ? "#cda978" : "rgba(255,255,255,0.11)"}`,
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                backdropFilter: "blur(24px) saturate(1.6)",
                WebkitBackdropFilter: "blur(24px) saturate(1.6)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
              };
          return (
          <div key={r.sid} style={rowStyle}>
            <div
              style={{
                padding: 12,
                display: "flex",
                gap: 10,
                // Buttons live at the bottom-left of the row (alignSelf below),
                // so the row height is driven by the info area on the right.
                alignItems: "stretch",
              }}
            >
            <a
              href={r.ghlContactUrl ?? "#"}
              onClick={(e) => { e.preventDefault(); setThreadSid(r.sid.trim()); }}
              title="פתח שיחה"
              style={{
                flex: 1,
                minWidth: 0,
                cursor: r.ghlContactUrl ? "pointer" : "default",
                color: "inherit",
                textDecoration: "none",
                display: "block",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "baseline",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: "#f5f6f7",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name || r.phone || r.sid}
                </div>
                <div style={{ fontSize: 12, color: "#8f939b", flexShrink: 0 }}>
                  {timeAgo(r.lastAt)}
                </div>
              </div>

              <div
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  color: r.lastSender === "lead" ? "#a5f3fc" : "#8f939b",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  direction: "rtl",
                }}
              >
                <span style={{ marginLeft: 6 }}>{senderLabel(r.lastSender)}</span>
                {r.lastText?.slice(0, 100) || <span style={{ color: "#6b7079" }}>—</span>}
              </div>

              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  gap: 6,
                  fontSize: 11,
                  color: "#8f939b",
                  flexWrap: "wrap",
                }}
              >
                {r.stage && (
                  <span
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {r.stage}
                  </span>
                )}
                {r.inboundLast24h > 0 && (
                  <span
                    style={{
                      background: "#1e3a8a",
                      color: "#bfdbfe",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {r.inboundLast24h} חדשות 24ש
                  </span>
                )}
                {r.botPaused && (
                  <span
                    style={{
                      background: "#7c2d12",
                      color: "#fed7aa",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    בוט מושהה
                  </span>
                )}
                {r.phone && (
                  <span style={{ color: "#6b7079" }}>{r.phone}</span>
                )}
              </div>
            </a>

            {/* Action area — bottom-left of the row.
                Desktop (≥641px): all tiles inline (pause + every template).
                Mobile (≤640px): only pause + a ☰ hamburger that opens an
                overlay containing the same tiles in a 2-column grid.
                The hamburger keeps the row compact on narrow screens so
                the lead name + last message stay legible. */}

            {/* Inline tiles — desktop only */}
            <div
              className="inbox-actions-inline"
              style={{
                flexWrap: "wrap",
                gap: 8,
                flexShrink: 0,
                alignSelf: "flex-end",
                justifyContent: "flex-start",
                maxWidth: "100%",
              }}
            >
              <ActionTile
                onClick={() => toggle(r.sid, r.botPaused)}
                disabled={busy === r.sid}
                title={r.botPaused ? "הבוט מושהה — לחץ כדי להפעיל" : "הבוט פעיל — לחץ כדי להשהות"}
                icon={busy === r.sid ? "…" : r.botPaused ? "▶" : "⏸"}
                label={r.botPaused ? "הפעל" : "השהה"}
                tone={r.botPaused ? "warn" : "neutral"}
              />
              {quickTemplates.map((tpl) => {
                const labelText = stripLeadingEmoji(tpl.name);
                return (
                  <ActionTile
                    key={tpl.id}
                    onClick={() =>
                      sendTemplate(r.sid, r.name || r.phone || r.sid, tpl)
                    }
                    disabled={busy === r.sid}
                    title={`שלח: ${tpl.name}`}
                    icon={tpl.icon}
                    label={labelText || "תבנית"}
                    tone="accent"
                  />
                );
              })}
              <ActionTile
                onClick={() =>
                  setExpandedSid((cur) => (cur === r.sid.trim() ? null : r.sid.trim()))
                }
                disabled={false}
                title="הצעות מחיר של הלקוח"
                icon="💰"
                label="הצעות"
                tone={expandedSid === r.sid.trim() ? "warn" : "accent"}
              />
              <ActionTile
                onClick={() =>
                  setAnalyzeSid((cur) => (cur === r.sid.trim() ? null : r.sid.trim()))
                }
                disabled={false}
                title="ניתוח מכירה — למה הליד תקוע + תסריט תשובה"
                icon="🔍"
                label="נתח"
                tone={analyzeSid === r.sid.trim() ? "warn" : "accent"}
              />
            </div>

            {/* Single ⋯ actions button (Front pattern). Opens a sheet with
                pause/resume, quote (הצעות), analyze (נתח) and templates. */}
            <div
              className="inbox-actions-mobile"
              style={{ flexShrink: 0, alignSelf: "center" }}
            >
              <button
                className="inbox-row-actions-btn"
                onClick={() => setMobileMenuSid(r.sid)}
                title="פעולות"
                aria-label="פעולות"
                style={{
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  color: "#8f939b",
                  border: "1px solid rgba(255,255,255,0.11)",
                  borderRadius: 8,
                  fontSize: 20,
                  lineHeight: 1,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  touchAction: "manipulation",
                }}
              >
                ⋯
              </button>
            </div>
            </div>
            {expandedSid === r.sid.trim() && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.11)", padding: 12 }}>
                <LeadQuotesInline
                  apiToken={apiToken}
                  sid={r.sid.trim()}
                  name={r.name}
                  phone={r.phone}
                />
              </div>
            )}
            {analyzeSid === r.sid.trim() && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.11)", padding: 12 }}>
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

      {/* Mobile template picker overlay — fires when a row's ☰ tile is
          tapped. Sits at the bottom of the viewport as a sheet so it's
          thumb-reachable. Outside-tap closes it. */}
      {mobileMenuSid && (() => {
        const r = rows.find((x) => x.sid === mobileMenuSid);
        if (!r) return null;
        const leadName = r.name || r.phone || r.sid;
        return (
          <div
            onClick={() => setMobileMenuSid(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              zIndex: 100,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 480,
                background: "#0c0d10",
                border: "1px solid rgba(255,255,255,0.11)",
                borderRadius: "16px 16px 8px 8px",
                padding: 16,
                boxShadow: "0 -10px 30px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#8f939b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  פעולות
                </div>
                <div style={{ fontSize: 14, color: "#f5f6f7", fontWeight: 600, marginTop: 2 }}>
                  {leadName}
                </div>
              </div>
              {(() => {
                const sheetBtn: CSSProperties = {
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "10px 8px",
                  borderRadius: 9,
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  background: "rgba(255,255,255,0.045)",
                  border: "1px solid rgba(255,255,255,0.11)",
                  color: "#f5f6f7",
                  touchAction: "manipulation",
                };
                return (
                  <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                    <button
                      style={sheetBtn}
                      onClick={() => { setMobileMenuSid(null); toggle(r.sid, r.botPaused); }}
                    >
                      <span>{r.botPaused ? "▶" : "⏸"}</span>
                      {r.botPaused ? "הפעל בוט" : "השהה בוט"}
                    </button>
                    <button
                      style={{ ...sheetBtn, background: "rgba(205,169,120,0.13)", border: "1px solid rgba(205,169,120,0.30)", color: "#e7cba6" }}
                      onClick={() => { setMobileMenuSid(null); setExpandedSid(r.sid.trim()); }}
                    >
                      <span>💰</span> הצעות
                    </button>
                    <button
                      style={{ ...sheetBtn, background: "rgba(205,169,120,0.13)", border: "1px solid rgba(205,169,120,0.30)", color: "#e7cba6" }}
                      onClick={() => { setMobileMenuSid(null); setAnalyzeSid(r.sid.trim()); }}
                    >
                      <span>🔍</span> נתח
                    </button>
                  </div>
                );
              })()}
              {quickTemplates.length > 0 && (
                <div style={{ fontSize: 11, color: "#8f939b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                  תבניות לשליחה
                </div>
              )}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                  gap: 10,
                }}
              >
                {quickTemplates.map((tpl) => {
                  const labelText = stripLeadingEmoji(tpl.name);
                  return (
                    <ActionTile
                      key={tpl.id}
                      onClick={() => {
                        setMobileMenuSid(null);
                        sendTemplate(r.sid, leadName, tpl);
                      }}
                      disabled={busy === r.sid}
                      title={`שלח: ${tpl.name}`}
                      icon={tpl.icon}
                      label={labelText || "תבנית"}
                      tone="accent"
                    />
                  );
                })}
              </div>
              <button
                onClick={() => setMobileMenuSid(null)}
                style={{
                  marginTop: 14,
                  width: "100%",
                  padding: "10px 16px",
                  background: "transparent",
                  color: "#8f939b",
                  border: "1px solid rgba(255,255,255,0.11)",
                  borderRadius: 8,
                  fontSize: 14,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Vertical action tile — icon on top, short Hebrew label below. Tooltip
// (`title`) gives the full description on hover/long-press.
//
// Sizing follows ui-ux-pro-max guidelines: touch target ≥44×44 (we use
// 56×60 to accommodate the label), 8px gap between tiles (set by the
// parent container), and dynamic text scaling-safe (label wraps to 2
// lines and clamps if longer).
//
// Three tones:
//   • neutral — default slate (e.g. pause when bot active)
//   • warn    — muted red (pause button when bot IS paused — state cue)
//   • accent  — subtle blue (template buttons — distinguishes them
//               from system actions like pause)
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
 * Inline factory-quotes panel shown under a conversation row when its 💰 tile
 * is tapped. Lists the lead's quotes (open PDF / send on finalized) and lets
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
  const champBtn: CSSProperties = {
    ...actBtn,
    background: "rgba(205,169,120,0.14)",
    border: "1px solid rgba(205,169,120,0.30)",
    color: "#e7cba6",
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
        <button onClick={onClose} title="חזרה לרשימה" style={{ ...actBtn, padding: "5px 10px" }}>
          →
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#f5f6f7",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.name || row.phone || sid}
          </div>
          <div style={{ fontSize: 11, color: "#8f939b" }}>
            {row.phone || ""}
            {row.stage ? ` · ${row.stage}` : ""}
          </div>
        </div>
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
          msgs.map((m) => {
            const incoming = m.direction === "in" || m.sender === "lead";
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: incoming ? "flex-start" : "flex-end",
                  maxWidth: "80%",
                  background: incoming ? "rgba(255,255,255,0.06)" : "rgba(205,169,120,0.16)",
                  color: incoming ? "#e4e5e8" : "#fdf3e6",
                  border: incoming ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(205,169,120,0.28)",
                  borderRadius: incoming ? "12px 12px 12px 4px" : "12px 12px 4px 12px",
                  padding: "9px 13px",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.text || "—"}
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
            style={{ ...champBtn, padding: "0 16px", opacity: sending || !draft.trim() ? 0.5 : 1 }}
          >
            {sending ? "…" : "שלח"}
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
          <div style={{ fontSize: 10.5, color: "#8f939b", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 5 }}>
            שלב
          </div>
          <span
            style={{
              fontSize: 11.5,
              color: "#e7cba6",
              background: "rgba(205,169,120,0.13)",
              border: "1px solid rgba(205,169,120,0.28)",
              padding: "3px 9px",
              borderRadius: 6,
              display: "inline-block",
            }}
          >
            {ctx?.stage || row.stage || "—"}
          </span>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: "#8f939b", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>
            הצעה
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.5px",
              fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
              color: "#fdf3e6",
            }}
          >
            {ctx?.quoteTotal ? `₪${ctx.quoteTotal}` : "—"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
          <button onClick={() => setPanel(panel === "quotes" ? "chat" : "quotes")} style={panel === "quotes" ? sideActive : sideBtn}>
            💰 הצעות מחיר
          </button>
          <button onClick={() => setPanel(panel === "analyze" ? "chat" : "analyze")} style={panel === "analyze" ? sideActive : sideBtn}>
            🔍 נתח ליד
          </button>
          <a
            href={`/widget/calculator?widget_token=${encodeURIComponent(apiToken)}&sid=${encodeURIComponent(sid)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={sideBtn}
          >
            🧮 פתח מחשבון
          </a>
          <button onClick={onToggle} disabled={busy === row.sid} style={sideBtn}>
            {row.botPaused ? "▶ הפעל בוט" : "⏸ השהה בוט"}
          </button>
          {quickTemplates.length > 0 && (
            <button onClick={() => setShowTpl((s) => !s)} style={sideBtn}>
              ✉️ תבניות
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
                  {tpl.icon} {stripLeadingEmoji(tpl.name) || "תבנית"}
                </button>
              ))}
            </div>
          )}
          {row.ghlContactUrl && (
            <a href={row.ghlContactUrl} target="_blank" rel="noopener noreferrer" style={sideBtn}>
              ↗ פתח ב-GHL
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

function ActionTile({
  onClick,
  disabled,
  title,
  icon,
  label,
  tone,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  icon: string;
  label: string;
  tone: "neutral" | "warn" | "accent";
}) {
  const palette = {
    neutral: { bg: "rgba(255,255,255,0.045)", border: "rgba(255,255,255,0.11)", hover: "rgba(255,255,255,0.09)", text: "#f5f6f7" },
    warn: { bg: "rgba(220,130,95,0.12)", border: "rgba(220,130,95,0.28)", hover: "rgba(220,130,95,0.18)", text: "#f0cdbe" },
    accent: { bg: "rgba(205,169,120,0.13)", border: "rgba(205,169,120,0.30)", hover: "rgba(205,169,120,0.19)", text: "#e7cba6" },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        // 56 wide × 60 tall fits 18px icon + 11px two-line label cleanly.
        // Width gives Hebrew labels room to breathe without truncation.
        width: 56,
        minWidth: 56,
        height: 60,
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        backdropFilter: "blur(16px) saturate(1.5)",
        WebkitBackdropFilter: "blur(16px) saturate(1.5)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
        cursor: disabled ? "wait" : "pointer",
        touchAction: "manipulation",
        padding: "6px 4px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        fontFamily: "inherit",
        opacity: disabled ? 0.55 : 1,
        transition: "background 0.12s ease, transform 0.06s ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = palette.hover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = palette.bg;
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.96)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, height: 18 }}>{icon}</span>
      <span
        style={{
          fontSize: 10.5,
          lineHeight: 1.15,
          fontWeight: 500,
          textAlign: "center",
          width: "100%",
          maxHeight: 24,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical" as const,
          WebkitLineClamp: 2,
          overflow: "hidden",
          wordBreak: "break-word",
          opacity: 0.92,
        }}
      >
        {label}
      </span>
    </button>
  );
}

