"use client";

/**
 * CockpitView — the salesperson "action cockpit": the DEFAULT view of the
 * שיחות widget tab. Presentation-only. Renders a server-assembled
 * `CockpitLead[]` (urgency-sorted, overdue first) as:
 *   - a header (count + "המערכת ניתחה כל ליד" subtitle)
 *   - one expanded HERO card for the most urgent lead (script + actions)
 *   - slim rows below, ONE champagne button per lead
 *
 * No business logic here. Buttons OPEN surfaces (chat thread / tel:) or do
 * reversible writes via existing actions, surfaced through the parent's
 * `onOpenChat` / `onSnooze` callbacks. WON/LOST leads are excluded upstream.
 */

import { type CSSProperties } from "react";
import { Send, Phone, Clock } from "lucide-react";
import { Avatar, T } from "@/components/widget-ui";

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
}

interface Props {
  leads: CockpitLead[];
  onOpenChat: (sid: string) => void;
  onSnooze: (sid: string) => void;
}

const PANEL_BG = "rgba(255,255,255,0.04)";
const PANEL_BD = "rgba(255,255,255,0.08)";
const HR = "rgba(255,255,255,0.06)";

const btnBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  height: 38,
  padding: "0 16px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const btnChamp: CSSProperties = {
  ...btnBase,
  background: T.champ,
  color: "#231708",
  border: "none",
};

const btnGhost: CSSProperties = {
  ...btnBase,
  background: "transparent",
  color: T.muted,
  border: `1px solid ${PANEL_BD}`,
  fontWeight: 400,
};

export default function CockpitView({ leads, onOpenChat, onSnooze }: Props) {
  const hero = leads[0] ?? null;
  const rest = leads.slice(1);

  return (
    <div
      className="gg-theme"
      dir="rtl"
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "22px 22px 24px",
        background: T.bg,
        borderRadius: 14,
        border: `0.5px solid ${PANEL_BD}`,
        color: T.text,
        fontFamily: "Inter, Heebo, system-ui, sans-serif",
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.02em" }}>
          צריכים אותך עכשיו
        </span>
        <span
          style={{ fontSize: 13, color: T.muted, fontVariantNumeric: "tabular-nums" }}
        >
          {leads.length} לידים
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 18 }}>
        המערכת ניתחה כל ליד — לפי דחיפות וערך. לחץ על הפעולה, וזהו.
      </div>

      {leads.length === 0 ? (
        <div
          style={{
            background: PANEL_BG,
            border: `1px solid ${PANEL_BD}`,
            borderRadius: 12,
            padding: "26px 18px",
            textAlign: "center",
            color: T.muted,
            fontSize: 13.5,
          }}
        >
          הכל מטופל — אין לידים שדורשים אותך עכשיו.
        </div>
      ) : null}

      {/* HERO — most urgent */}
      {hero && (
        <div
          style={{
            background: PANEL_BG,
            border: `1px solid ${PANEL_BD}`,
            borderRadius: 12,
            padding: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 13,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: hero.overdue ? T.alert : T.champ,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: hero.overdue ? T.alert : T.champ,
              }}
            >
              הכי דחוף{hero.urgencyLabel ? ` · ${hero.urgencyLabel}` : ""}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              marginBottom: 14,
            }}
          >
            <Avatar name={hero.name || undefined} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>
                {hero.name || hero.phone || hero.sid}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: T.muted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {hero.want || "—"}
                {hero.value ? (
                  <>
                    {" · "}
                    <span style={{ color: T.champ, fontVariantNumeric: "tabular-nums" }}>
                      {hero.value}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* script box */}
          <div
            style={{
              background: "rgba(255,255,255,0.025)",
              border: `1px solid ${HR}`,
              borderRadius: 9,
              padding: "12px 13px",
              marginBottom: 14,
            }}
          >
            {hero.lastInbound && (
              <>
                <div style={{ fontSize: 11, color: T.faint, marginBottom: 5 }}>
                  {hero.name ? `${heroFirstName(hero.name)} שאלה לאחרונה` : "נשאלה לאחרונה"}
                </div>
                <div style={{ fontSize: 13, marginBottom: 11 }}>
                  &quot;{hero.lastInbound}&quot;
                </div>
              </>
            )}
            <div style={{ fontSize: 11, color: T.faint, marginBottom: 5 }}>
              מה כדאי לענות
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              {hero.script || "טפל לפי ההקשר שעלה בשיחה."}
            </div>
          </div>

          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button style={btnChamp} onClick={() => onOpenChat(hero.sid)}>
              <Send size={15} strokeWidth={2} />
              {hero.actionLabel}
            </button>
            <button style={btnGhost} onClick={() => onOpenChat(hero.sid)}>
              פתח שיחה מלאה
            </button>
            {hero.phone && (
              <a href={`tel:${hero.phone}`} style={{ textDecoration: "none" }}>
                <button style={btnGhost}>
                  <Phone size={15} strokeWidth={2} />
                  התקשר
                </button>
              </a>
            )}
          </div>
        </div>
      )}

      {/* slim rows */}
      {rest.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {rest.map((lead) => (
            <SlimRow
              key={lead.sid}
              lead={lead}
              onOpenChat={onOpenChat}
              onSnooze={onSnooze}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function heroFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function SlimRow({
  lead,
  onOpenChat,
  onSnooze,
}: {
  lead: CockpitLead;
  onOpenChat: (sid: string) => void;
  onSnooze: (sid: string) => void;
}) {
  // FACTORY_WAIT leads get the muted "תזכיר לי מחר" (reversible snooze write);
  // everyone else gets the champagne open-thread action. This is a UI
  // affordance default — NOT a pipeline transition.
  const isSnoozeRow = lead.stage === "FACTORY_WAIT";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "15px 4px",
        borderTop: `0.5px solid ${HR}`,
      }}
    >
      <Avatar name={lead.name || undefined} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>
          {lead.name || lead.phone || lead.sid}
        </div>
        <div
          style={{
            fontSize: 12,
            color: T.muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {lead.want || "—"}
          {lead.value ? (
            <span style={{ fontVariantNumeric: "tabular-nums" }}> · {lead.value}</span>
          ) : null}
        </div>
      </div>
      {lead.stageLabel && (
        <span
          style={{
            fontSize: 11.5,
            color: lead.stage === "CONSIDERATION" ? T.champ : T.faint,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {lead.stageLabel}
        </span>
      )}
      {isSnoozeRow ? (
        <button
          style={{ ...btnGhost, flexShrink: 0 }}
          onClick={() => onSnooze(lead.sid)}
        >
          <Clock size={14} strokeWidth={2} />
          תזכיר לי מחר
        </button>
      ) : (
        <button
          style={{ ...btnChamp, flexShrink: 0 }}
          onClick={() => onOpenChat(lead.sid)}
        >
          {lead.actionLabel}
        </button>
      )}
    </div>
  );
}
