"use client";

/**
 * CockpitView — the salesperson "action cockpit": the DEFAULT view of the
 * שיחות widget tab, in the warm "Silent Luxury" skin. Presentation-only.
 * Renders a server-assembled `CockpitLead[]` (urgency-sorted, overdue first) as:
 *   - an editorial header ("צריכים אותך עכשיו." + overdue/active stat tiles)
 *   - one expanded HERO card for the most urgent lead (last question + script
 *     + actions + template shortcuts)
 *   - slim rows below, each with an icon cluster + ONE primary action
 *
 * No business logic here. Every control OPENS a surface (chat thread / tel:) or
 * does a reversible write via the parent's `onOpenChat` / `onSnooze` callbacks.
 * WON/LOST leads are excluded upstream.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  Send,
  Phone,
  Clock,
  MessageSquare,
  Sparkles,
  ChevronDown,
  Play,
  Pause,
} from "lucide-react";
import { Avatar } from "@/components/widget-ui";
import { LuxStat } from "@/components/widget-ui/lux";

export interface CockpitLead {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  /** Hebrew stage label (calm), for the slim-row trailing tag. */
  stageLabel: string | null;
  /** "what they want" — bot_summary, or trimmed last inbound text. */
  want: string | null;
  /** value — raw quote_total text; already ₪-prefixed when it's a bare number. */
  value: string | null;
  /** the customer's most recent inbound line (hero "היא שאלה לאחרונה"). */
  lastInbound: string | null;
  /** urgency label formatted from nextEligibleAt ("באיחור יומיים" / "היום"...). */
  urgencyLabel: string | null;
  /** true when nextEligibleAt is in the past → red dot + alert tint. */
  overdue: boolean;
  /** the recommended script line (play.lines[0]). */
  script: string | null;
  /** the primary action button label, chosen by stage (UI affordance). */
  actionLabel: string;
  /** whether the bot is currently paused for this lead. */
  botPaused: boolean;
  /** ISO of the last message (either side); drives the recency sort. */
  lastAt: string | null;
  /** true when the CUSTOMER sent the last message (awaiting your reply). */
  lastSenderIsLead: boolean;
}

interface Props {
  leads: CockpitLead[];
  /** total active leads (for the "פעילים" tile); falls back to leads.length. */
  activeCount?: number;
  /** widget token — needed to toggle the per-lead bot pause. */
  apiToken: string;
  onOpenChat: (sid: string) => void;
  onSnooze: (sid: string) => void;
}

const INK = "#e6e1e0";
const MUTED = "#8a7f74";
const COOL = "#bec6e0";
const CHAMP = "#d6c4ac";
const ALERT = "#e8b4b4";
const GREEN = "#a9d3b0";
const RING = "rgba(69,70,77,0.2)";

/** Prominent per-lead bot on/off toggle. Green = bot active, muted-red = paused.
 *  Reversible write to /api/widget/toggle-pause; optimistic in the parent. */
function BotToggle({
  paused,
  busy,
  onToggle,
  compact,
}: {
  paused: boolean;
  busy?: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onToggle();
      }}
      title={paused ? "הבוט מושהה — לחץ להפעלה" : "הבוט פעיל — לחץ להשהיה"}
      aria-label={paused ? "הפעל בוט" : "השהה בוט"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: compact ? 30 : 34,
        padding: compact ? "0 11px" : "0 14px",
        border: 0,
        borderRadius: 9999,
        cursor: busy ? "wait" : "pointer",
        fontSize: compact ? 11.5 : 12.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        flexShrink: 0,
        opacity: busy ? 0.55 : 1,
        color: paused ? ALERT : GREEN,
        background: paused ? "rgba(232,180,180,0.10)" : "rgba(169,211,176,0.10)",
        boxShadow: `inset 0 0 0 1px ${paused ? "rgba(232,180,180,0.42)" : "rgba(169,211,176,0.42)"}`,
      }}
    >
      {paused ? <Play size={compact ? 13 : 14} strokeWidth={2} /> : <Pause size={compact ? 13 : 14} strokeWidth={2} />}
      {paused ? "בוט מושהה" : "בוט פעיל"}
    </button>
  );
}

/** small square icon button used in the hero chips + slim rows */
const iconSquare: CSSProperties = {
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  background: "#211f1e",
  boxShadow: `inset 0 0 0 1px ${RING}`,
  color: MUTED,
  cursor: "pointer",
  flexShrink: 0,
};

const insightSquare: CSSProperties = {
  ...iconSquare,
  background: "rgba(190,198,224,0.08)",
  boxShadow: "inset 0 0 0 1px rgba(190,198,224,0.22)",
  color: COOL,
};

const ghostPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 42,
  padding: "0 16px",
  border: 0,
  borderRadius: 9999,
  cursor: "pointer",
  fontSize: 13,
  color: INK,
  background: "transparent",
  boxShadow: `inset 0 0 0 1px ${RING}`,
};

export default function CockpitView({
  leads,
  activeCount,
  apiToken,
  onOpenChat,
  onSnooze,
}: Props) {
  const hero = leads[0] ?? null;
  const rest = leads.slice(1);
  const overdueCount = leads.filter((l) => l.overdue).length;

  // Per-lead bot pause — optimistic map seeded from the server; reversible write.
  const [pausedMap, setPausedMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(leads.map((l) => [l.sid, l.botPaused]))
  );
  const [busySid, setBusySid] = useState<string | null>(null);
  const isPaused = (l: CockpitLead) => pausedMap[l.sid] ?? l.botPaused;
  async function toggleBot(sid: string) {
    const current = pausedMap[sid] ?? leads.find((l) => l.sid === sid)?.botPaused ?? false;
    const next = !current;
    setPausedMap((m) => ({ ...m, [sid]: next }));
    setBusySid(sid);
    try {
      const res = await fetch(
        `/api/widget/toggle-pause?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid, paused: next }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setPausedMap((m) => ({ ...m, [sid]: current })); // revert on failure
    } finally {
      setBusySid(null);
    }
  }

  return (
    <div
      className="lux-theme hubscroll"
      dir="rtl"
      style={{
        maxWidth: 1040,
        margin: "0 auto",
        padding: "26px 28px 36px",
        color: INK,
      }}
    >
      <style>{`
        @keyframes acPulse{0%,100%{opacity:1}50%{opacity:.4}}
        .cockpit-row{cursor:pointer;transition:background .12s ease;border-radius:8px}
        .cockpit-row:hover{background:rgba(255,255,255,0.022)}
      `}</style>

      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div className="lux-title">
            צריכים אותך <span className="lux-accent">עכשיו.</span>
          </div>
          <span
            style={{ fontSize: 14, color: MUTED, fontVariantNumeric: "tabular-nums" }}
          >
            {leads.length} לידים
          </span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <LuxStat value={overdueCount} label="באיחור" tone="alert" />
          <LuxStat value={activeCount ?? leads.length} label="פעילים" />
        </div>
      </div>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
        לפי ההודעה האחרונה — מי שכתב אחרון למעלה, ומי שממתין לתשובה ראשון.
      </div>

      {leads.length === 0 ? (
        <div
          className="lux-inset"
          style={{
            padding: "28px 18px",
            textAlign: "center",
            color: MUTED,
            fontSize: 14,
          }}
        >
          הכל מטופל — אין לידים שדורשים אותך עכשיו.
        </div>
      ) : null}

      {/* HERO — most urgent */}
      {hero && (
        <div
          style={{
            background: "#1d1b1a",
            borderRadius: 10,
            padding: "22px 24px",
            marginBottom: 16,
            boxShadow: `inset 0 0 0 1px ${
              hero.overdue ? "rgba(232,180,180,0.2)" : RING
            }`,
          }}
        >
          {/* eyebrow — recency label on the right, bot toggle up front on the left */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 15,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: hero.lastSenderIsLead ? ALERT : CHAMP,
                  animation: hero.lastSenderIsLead ? "acPulse 2s ease-in-out infinite" : "none",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-editorial-sans), Manrope, system-ui",
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: hero.lastSenderIsLead ? ALERT : CHAMP,
                }}
              >
                {hero.lastSenderIsLead ? "ממתין לתשובה" : "שיחה אחרונה"}
                {hero.urgencyLabel ? ` · ${hero.urgencyLabel}` : ""}
              </span>
            </div>
            <BotToggle
              paused={isPaused(hero)}
              busy={busySid === hero.sid}
              onToggle={() => toggleBot(hero.sid)}
            />
          </div>

          {/* lead identity */}
          <div
            onClick={() => onOpenChat(hero.sid)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 16,
              cursor: "pointer",
            }}
          >
            <Avatar name={hero.name || undefined} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 19 }}>
                {hero.name || hero.phone || hero.sid}
              </div>
              <div style={{ fontSize: 13, color: "#c6c6cd" }}>
                {hero.want || "—"}
                {hero.value ? (
                  <span style={{ color: CHAMP, fontVariantNumeric: "tabular-nums" }}>
                    {" · "}
                    {hero.value}
                  </span>
                ) : null}
              </div>
            </div>
            {hero.stage ? (
              <span
                style={{
                  fontFamily: "var(--font-editorial-sans), Manrope, system-ui",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  color: MUTED,
                  background: "#211f1e",
                  padding: "5px 11px",
                  borderRadius: 9999,
                  flexShrink: 0,
                }}
              >
                {hero.stage}
              </span>
            ) : null}
          </div>

          {/* script box */}
          <div
            style={{
              background: "#161514",
              borderRadius: 9,
              padding: "15px 16px",
              marginBottom: 16,
              boxShadow: `inset 0 0 0 1px ${RING}`,
            }}
          >
            {hero.lastInbound && (
              <>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 5 }}>
                  {hero.name ? `${heroFirstName(hero.name)} שאלה לאחרונה` : "נשאלה לאחרונה"}
                </div>
                <div style={{ fontSize: 14, marginBottom: 13 }}>
                  &quot;{hero.lastInbound}&quot;
                </div>
              </>
            )}
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 5 }}>
              מה כדאי לענות
            </div>
            <div
              className="lux-serif"
              style={{
                fontStyle: "italic",
                fontSize: 14,
                lineHeight: 1.55,
                color: CHAMP,
              }}
            >
              {hero.script ? `— ${hero.script}` : "— טפל לפי ההקשר שעלה בשיחה."}
            </div>
          </div>

          {/* actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <button
              className="lux-cta-champagne"
              style={{ minHeight: 42 }}
              onClick={() => onOpenChat(hero.sid)}
            >
              <Send size={15} strokeWidth={2} />
              {hero.actionLabel}
            </button>
            <button style={ghostPill} onClick={() => onOpenChat(hero.sid)}>
              <MessageSquare size={15} strokeWidth={1.9} color={MUTED} />
              פתח שיחה מלאה
            </button>
            {hero.phone && (
              <a href={`tel:${hero.phone}`} style={{ textDecoration: "none" }}>
                <button style={ghostPill}>
                  <Phone size={15} strokeWidth={1.9} color={MUTED} />
                  התקשר
                </button>
              </a>
            )}
            <span style={{ width: 1, height: 24, background: "rgba(69,70,77,0.35)", margin: "0 4px" }} />
            <span style={{ fontSize: 11, color: MUTED }}>שלח תבנית:</span>
            <TemplateChip emoji="📐" label="מידות" onClick={() => onOpenChat(hero.sid)} />
            <TemplateChip emoji="💰" label="מחיר" onClick={() => onOpenChat(hero.sid)} />
            <TemplateChip emoji="📚" label="קטלוג" onClick={() => onOpenChat(hero.sid)} />
            <span
              onClick={() => onOpenChat(hero.sid)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 12px",
                borderRadius: 9999,
                background: "rgba(190,198,224,0.08)",
                boxShadow: "inset 0 0 0 1px rgba(190,198,224,0.22)",
                fontSize: 12,
                color: COOL,
                cursor: "pointer",
              }}
            >
              <Sparkles size={14} strokeWidth={2} />
              ניתוח ליד
            </span>
          </div>
        </div>
      )}

      {/* slim rows — click anywhere to expand inline with full action panel */}
      {rest.length > 0 && (
        <SlimRowList
          rows={rest}
          isPaused={isPaused}
          busySid={busySid}
          onToggleBot={toggleBot}
          onOpenChat={onOpenChat}
          onSnooze={onSnooze}
        />
      )}
    </div>
  );
}

function SlimRowList({
  rows,
  isPaused,
  busySid,
  onToggleBot,
  onOpenChat,
  onSnooze,
}: {
  rows: CockpitLead[];
  isPaused: (l: CockpitLead) => boolean;
  busySid: string | null;
  onToggleBot: (sid: string) => void;
  onOpenChat: (sid: string) => void;
  onSnooze: (sid: string) => void;
}) {
  const [expandedSid, setExpandedSid] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((lead) => (
        <SlimRow
          key={lead.sid}
          lead={lead}
          paused={isPaused(lead)}
          busy={busySid === lead.sid}
          onToggleBot={() => onToggleBot(lead.sid)}
          expanded={expandedSid === lead.sid}
          onToggle={() =>
            setExpandedSid((cur) => (cur === lead.sid ? null : lead.sid))
          }
          onOpenChat={onOpenChat}
          onSnooze={onSnooze}
        />
      ))}
    </div>
  );
}

function heroFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function TemplateChip({
  emoji,
  label,
  onClick,
}: {
  emoji: string;
  label: ReactNode;
  onClick: () => void;
}) {
  return (
    <span
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 34,
        padding: "0 12px",
        borderRadius: 9999,
        background: "#211f1e",
        boxShadow: `inset 0 0 0 1px ${RING}`,
        fontSize: 12,
        color: "#c6c6cd",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 13 }}>{emoji}</span>
      {label}
    </span>
  );
}

function SlimRow({
  lead,
  paused,
  busy,
  onToggleBot,
  expanded,
  onToggle,
  onOpenChat,
  onSnooze,
}: {
  lead: CockpitLead;
  paused: boolean;
  busy: boolean;
  onToggleBot: () => void;
  expanded: boolean;
  onToggle: () => void;
  onOpenChat: (sid: string) => void;
  onSnooze: (sid: string) => void;
}) {
  // FACTORY_WAIT leads get the muted "תזכיר לי מחר" (reversible snooze write);
  // everyone else opens to the standard send-offer/full-chat action set.
  const isSnoozeRow = lead.stage === "FACTORY_WAIT";
  const isNegotiation = lead.stage === "CONSIDERATION";

  return (
    <div
      style={{
        borderTop: "1px solid rgba(69,70,77,0.18)",
        background: expanded ? "rgba(255,255,255,0.022)" : "transparent",
        transition: "background .12s ease",
      }}
    >
      {/* row strip */}
      <div
        className="cockpit-row"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "15px 6px",
        }}
      >
        <Avatar name={lead.name || undefined} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 15 }}>
            {lead.name || lead.phone || lead.sid}
          </div>
          <div
            style={{
              fontSize: 12,
              color: MUTED,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lead.want || "—"}
            {lead.value ? (
              <span style={{ color: CHAMP, fontVariantNumeric: "tabular-nums" }}>
                {" · "}
                {lead.value}
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <BotToggle paused={paused} busy={busy} onToggle={onToggleBot} compact />
          {lead.stageLabel && (
            <span
              style={{
                fontSize: 11.5,
                color: isNegotiation ? CHAMP : MUTED,
                marginInlineEnd: 4,
                whiteSpace: "nowrap",
              }}
            >
              {lead.stageLabel}
            </span>
          )}
          {/* chevron — visual cue that the row expands */}
          <span
            style={{
              ...iconSquare,
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform .15s ease",
            }}
            aria-hidden
          >
            <ChevronDown size={16} strokeWidth={2} />
          </span>
        </div>
      </div>

      {/* expanded action panel — same affordances the HERO has */}
      {expanded && (
        <ExpandedActions
          lead={lead}
          isSnoozeRow={isSnoozeRow}
          onOpenChat={onOpenChat}
          onSnooze={onSnooze}
        />
      )}
    </div>
  );
}

function ExpandedActions({
  lead,
  isSnoozeRow,
  onOpenChat,
  onSnooze,
}: {
  lead: CockpitLead;
  isSnoozeRow: boolean;
  onOpenChat: (sid: string) => void;
  onSnooze: (sid: string) => void;
}) {
  return (
    <div
      style={{
        background: "#161514",
        borderRadius: 9,
        padding: "13px 14px",
        margin: "0 6px 14px",
        boxShadow: `inset 0 0 0 1px ${RING}`,
      }}
    >
      {/* script line — the same play surface as the HERO */}
      {lead.script && (
        <>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 5 }}>
            מה כדאי לענות
          </div>
          <div
            className="lux-serif"
            style={{
              fontStyle: "italic",
              fontSize: 13.5,
              lineHeight: 1.55,
              color: CHAMP,
              marginBottom: 14,
            }}
          >
            — {lead.script}
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {isSnoozeRow ? (
          <button
            className="lux-cta-champagne"
            style={{ minHeight: 38, padding: "0 16px", fontSize: 13 }}
            onClick={() => onSnooze(lead.sid)}
          >
            <Clock size={14} strokeWidth={2} />
            תזכיר לי מחר
          </button>
        ) : (
          <button
            className="lux-cta-champagne"
            style={{ minHeight: 38, padding: "0 16px", fontSize: 13 }}
            onClick={() => onOpenChat(lead.sid)}
          >
            <Send size={14} strokeWidth={2} />
            {lead.actionLabel}
          </button>
        )}
        <button
          style={{ ...ghostPill, height: 38, fontSize: 12.5 }}
          onClick={() => onOpenChat(lead.sid)}
        >
          <MessageSquare size={14} strokeWidth={1.9} color={MUTED} />
          פתח שיחה מלאה
        </button>
        {lead.phone && (
          <a href={`tel:${lead.phone}`} style={{ textDecoration: "none" }}>
            <button style={{ ...ghostPill, height: 38, fontSize: 12.5 }}>
              <Phone size={14} strokeWidth={1.9} color={MUTED} />
              התקשר
            </button>
          </a>
        )}
        <span style={{ width: 1, height: 22, background: "rgba(69,70,77,0.35)", margin: "0 4px" }} />
        <span style={{ fontSize: 11, color: MUTED }}>שלח תבנית:</span>
        <TemplateChip emoji="📐" label="מידות" onClick={() => onOpenChat(lead.sid)} />
        <TemplateChip emoji="💰" label="מחיר" onClick={() => onOpenChat(lead.sid)} />
        <TemplateChip emoji="📚" label="קטלוג" onClick={() => onOpenChat(lead.sid)} />
        <span
          onClick={() => onOpenChat(lead.sid)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 12px",
            borderRadius: 9999,
            background: "rgba(190,198,224,0.08)",
            boxShadow: "inset 0 0 0 1px rgba(190,198,224,0.22)",
            fontSize: 12,
            color: COOL,
            cursor: "pointer",
          }}
        >
          <Sparkles size={13} strokeWidth={2} />
          ניתוח ליד
        </span>
      </div>
    </div>
  );
}
