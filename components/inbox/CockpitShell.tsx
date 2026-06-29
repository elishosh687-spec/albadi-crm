"use client";

/**
 * CockpitShell — the client wrapper for the שיחות tab. Shows the
 * salesperson action cockpit (CockpitView) by DEFAULT. Selecting a lead /
 * "open chat" switches to the EXISTING InboxView thread for that sid; a
 * "כל השיחות" back link returns to the cockpit (and the full list lives
 * inside InboxView itself).
 *
 * Presentation + reversible writes only. Snooze routes through the existing
 * `setManualFollowupAction` server action (tomorrow 09:00 IL ISO) — no new
 * cadence/business logic.
 */

import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import CockpitView, { type CockpitLead } from "./CockpitView";
import InboxView, { type InboxRow, type QuickTemplate } from "./InboxView";
import { setManualFollowupAction } from "@/app/actions/v2";
import { T } from "@/components/widget-ui";

interface Props {
  apiToken: string;
  cockpitLeads: CockpitLead[];
  inboxRows: InboxRow[];
  quickTemplates: QuickTemplate[];
  /** when the URL carried ?sid=, open straight into that thread. */
  selectedSid?: string;
}

/** Tomorrow at 09:00 Israel-ish — a reversible "remind me tomorrow" date. */
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

export default function CockpitShell({
  apiToken,
  cockpitLeads,
  inboxRows,
  quickTemplates,
  selectedSid,
}: Props) {
  // If the URL deep-links a sid, start in the thread; otherwise start in the
  // cockpit. `openSid` !== null means "show InboxView with this thread open".
  const [openSid, setOpenSid] = useState<string | null>(
    selectedSid?.trim() || null
  );
  const [snoozedSids, setSnoozedSids] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function handleSnooze(sid: string) {
    // Optimistically drop the row from the cockpit; reversible existing action.
    setSnoozedSids((prev) => new Set(prev).add(sid));
    startTransition(() => {
      void setManualFollowupAction(sid, tomorrowIso());
    });
  }

  if (openSid !== null) {
    return (
      <div className="lux-theme" dir="rtl">
        <button
          onClick={() => setOpenSid(null)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            margin: "0 auto 8px",
            padding: "6px 12px",
            background: "transparent",
            border: `1px solid ${T.glassBorder}`,
            borderRadius: 8,
            color: T.muted,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          <ArrowRight size={14} strokeWidth={2} />
          כל השיחות
        </button>
        <InboxView
          apiToken={apiToken}
          initialRows={inboxRows}
          quickTemplates={quickTemplates}
          openSid={openSid}
        />
      </div>
    );
  }

  const visible = cockpitLeads.filter((l) => !snoozedSids.has(l.sid));

  return (
    <CockpitView
      leads={visible}
      activeCount={inboxRows.length}
      onOpenChat={(sid) => setOpenSid(sid)}
      onSnooze={handleSnooze}
    />
  );
}
