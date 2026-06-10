"use client";

import { useMemo, useState, useTransition } from "react";

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

export default function InboxView({
  apiToken,
  initialRows,
  selectedSid,
  quickTemplates = [],
}: Props) {
  const [rows, setRows] = useState<InboxRow[]>(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [, startTransition] = useTransition();

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
    <div dir="rtl" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          position: "sticky",
          top: 0,
          background: "#0d0f14",
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
            background: "#1a1d24",
            color: "#e4e4e7",
            border: "1px solid #2a2d34",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 15,
          }}
        />
        <button
          onClick={refresh}
          style={{
            background: "#2a2d34",
            color: "#e4e4e7",
            border: "1px solid #3a3d44",
            borderRadius: 6,
            padding: "10px 14px",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          🔄
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#71717a" }}>
            אין שיחות
          </div>
        )}
        {visible.map((r) => (
          <div
            key={r.sid}
            style={{
              background: r.botPaused ? "#2a1d24" : "#1a1d24",
              border: `1px solid ${selectedSid === r.sid.trim() ? "#3b82f6" : "#2a2d34"}`,
              borderRadius: 8,
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
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { if (!r.ghlContactUrl) e.preventDefault(); }}
              style={{
                flex: 1,
                minWidth: 0,
                cursor: r.ghlContactUrl ? "pointer" : "default",
                color: "inherit",
                textDecoration: "none",
                display: "block",
              }}
              title={r.ghlContactUrl ? "פתח ב-GHL (טאב חדש)" : "אין GHL contact מקושר"}
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
                    color: "#e4e4e7",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name || r.phone || r.sid}
                </div>
                <div style={{ fontSize: 12, color: "#71717a", flexShrink: 0 }}>
                  {timeAgo(r.lastAt)}
                </div>
              </div>

              <div
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  color: r.lastSender === "lead" ? "#a5f3fc" : "#a1a1aa",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  direction: "rtl",
                }}
              >
                <span style={{ marginLeft: 6 }}>{senderLabel(r.lastSender)}</span>
                {r.lastText?.slice(0, 100) || <span style={{ color: "#52525b" }}>—</span>}
              </div>

              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  gap: 6,
                  fontSize: 11,
                  color: "#71717a",
                  flexWrap: "wrap",
                }}
              >
                {r.stage && (
                  <span
                    style={{
                      background: "#1f2937",
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
                  <span style={{ color: "#52525b" }}>{r.phone}</span>
                )}
              </div>
            </a>

            {/* Action buttons — bottom-left of the row. Each button is a
                vertical tile (icon on top, short label below) so on mobile
                the user reads instantly without relying on hover. Touch
                targets ≥48×56 with 8px gap (ui-ux-pro-max guidelines:
                44px minimum + 8px spacing). Wraps to second line if the
                row accumulates many templates. */}
            <div
              style={{
                display: "flex",
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
                // Strip leading emoji from the visible label so the icon
                // isn't repeated under itself.
                const labelText = tpl.name
                  .trim()
                  .replace(/^\p{Extended_Pictographic}\s*/u, "")
                  .trim();
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
            </div>
          </div>
        ))}
      </div>
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
    neutral: { bg: "#1a2030", border: "#2d3548", hover: "#252e44", text: "#e4e4e7" },
    warn: { bg: "#3a1d1a", border: "#7c2d12", hover: "#5a2a20", text: "#fecaca" },
    accent: { bg: "#1a2638", border: "#2f4a6e", hover: "#23344e", text: "#dbeafe" },
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

