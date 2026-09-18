"use client";

/**
 * CockpitShell — the client wrapper for the שיחות tab. Shows the conversation
 * list (ConversationList) by DEFAULT; tapping a row opens the EXISTING
 * InboxView thread for that sid; "כל השיחות" returns to the list.
 * (The old "צריכים אותך עכשיו" cockpit was replaced 18/09 — ui-ux-pro-max.)
 */

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import ConversationList, { type ConversationLead } from "./ConversationList";
import InboxView, { type InboxRow, type QuickTemplate } from "./InboxView";

interface Props {
  apiToken: string;
  cockpitLeads: ConversationLead[];
  inboxRows: InboxRow[];
  quickTemplates: QuickTemplate[];
  /** server clock at render (hydration-safe "לפני X"). */
  renderedAt: number;
  /** when the URL carried ?sid=, open straight into that thread. */
  selectedSid?: string;
}

export default function CockpitShell({
  apiToken,
  cockpitLeads,
  inboxRows,
  quickTemplates,
  selectedSid,
  renderedAt,
}: Props) {
  // If the URL deep-links a sid, start in the thread; otherwise start in the
  // cockpit. `openSid` !== null means "show InboxView with this thread open".
  const [openSid, setOpenSid] = useState<string | null>(
    selectedSid?.trim() || null
  );

  if (openSid !== null) {
    return (
      <div className="lux-theme" dir="rtl">
        <div className="ux" style={{ padding: "8px 8px 0" }}>
          <button type="button" className="ux-btn" onClick={() => setOpenSid(null)}>
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
            כל השיחות
          </button>
        </div>
        <InboxView
          apiToken={apiToken}
          initialRows={inboxRows}
          quickTemplates={quickTemplates}
          openSid={openSid}
        />
      </div>
    );
  }

  return <ConversationList leads={cockpitLeads} renderedAt={renderedAt} onOpen={(sid) => setOpenSid(sid)} />;
}
