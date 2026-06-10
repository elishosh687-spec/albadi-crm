"use client";

import { useState, useMemo, useTransition } from "react";

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
              alignItems: "flex-start",
            }}
          >
            {/* Action buttons — compact column with icon + always-visible
                label so it's clear what each button does without hovering.
                Unified neutral palette; pause button tints red only when
                actually paused (state cue). Wraps into multi-row grid if
                there are many templates. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 56px)",
                gap: 6,
                alignContent: "flex-start",
              }}
            >
              <ActionTile
                onClick={() => toggle(r.sid, r.botPaused)}
                disabled={busy === r.sid}
                tooltip={r.botPaused ? "הבוט מושהה — לחץ כדי להפעיל" : "הבוט פעיל — לחץ כדי להשהות"}
                label={r.botPaused ? "הפעל" : "השהה"}
                icon={busy === r.sid ? "…" : r.botPaused ? "▶" : "⏸"}
                tone={r.botPaused ? "warn" : "neutral"}
              />

              <ActionTile
                onClick={() => sendIntro(r.sid, r.name || r.phone || r.sid)}
                disabled={busy === r.sid}
                tooltip="הצגת חברה — וידאו תדמית + לינקים לאתרים"
                label="הצגה"
                icon="🎬"
                tone="neutral"
              />

              {quickTemplates.map((tpl) => {
                // Strip the leading icon char from the visible label so the
                // emoji doesn't repeat (e.g. "📐 הסבר מידות שקית" → "הסבר
                // מידות שקית"). Limited to ~10 chars to keep the tile
                // compact; full name still on hover.
                const labelText = tpl.name
                  .trim()
                  .replace(/^\p{Extended_Pictographic}\s*/u, "")
                  .trim()
                  .slice(0, 12);
                return (
                  <ActionTile
                    key={tpl.id}
                    onClick={() =>
                      sendTemplate(r.sid, r.name || r.phone || r.sid, tpl)
                    }
                    disabled={busy === r.sid}
                    tooltip={`שלח: ${tpl.name}`}
                    label={labelText || "תבנית"}
                    icon={tpl.icon}
                    tone="accent"
                  />
                );
              })}
            </div>

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
          </div>
        ))}
      </div>
    </div>
  );
}

// Reusable per-row action button. Icon on top + tiny label below; tooltip on
// hover (desktop) / long-press (mobile) via the native `title` attribute.
// Three tones: neutral (slate), warn (paused/destructive), accent (templates).
function ActionTile({
  onClick,
  disabled,
  tooltip,
  label,
  icon,
  tone,
}: {
  onClick: () => void;
  disabled: boolean;
  tooltip: string;
  label: string;
  icon: string;
  tone: "neutral" | "warn" | "accent";
}) {
  const palette = {
    neutral: { bg: "#1a2030", border: "#2d3548", text: "#e4e4e7" },
    warn: { bg: "#3a1d1a", border: "#7c2d12", text: "#fecaca" },
    accent: { bg: "#1a2a3a", border: "#2f4a6e", text: "#dbeafe" },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      style={{
        width: 56,
        height: 56,
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        cursor: disabled ? "wait" : "pointer",
        touchAction: "manipulation",
        padding: "4px 2px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        fontFamily: "inherit",
        opacity: disabled ? 0.6 : 1,
        transition: "background 0.12s ease, transform 0.06s ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = palette.border;
        }
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
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      <span
        style={{
          fontSize: 9.5,
          lineHeight: 1.1,
          opacity: 0.85,
          textAlign: "center",
          maxWidth: 52,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </button>
  );
}
