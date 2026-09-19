"use client";

/**
 * CockpitShell — the client wrapper for the שיחות tab. Shows the conversation
 * list (ConversationList) by DEFAULT; tapping a row opens ConversationThread
 * for that sid; "כל השיחות" returns to the list.
 * (The old "צריכים אותך עכשיו" cockpit was replaced 18/09 — ui-ux-pro-max.)
 */

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import ConversationList, { type ConversationLead } from "./ConversationList";
import ConversationThread, { type InboxRow, type QuickTemplate } from "./ConversationThread";
import { LuxShell } from "@/components/widget-ui/lux";

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
  // cockpit. `openSid` !== null means "show this conversation".
  const [openSid, setOpenSid] = useState<string | null>(
    selectedSid?.trim() || null
  );

  if (openSid !== null) {
    // A deep-linked sid may be outside the loaded rows — open it anyway.
    const row =
      inboxRows.find((r) => r.sid.trim() === openSid) ??
      ({ sid: openSid, name: null, phone: null, stage: null, botPaused: false, lastText: null, lastSender: "lead", lastAt: null, inboundLast24h: 0, ghlContactUrl: null } satisfies InboxRow);
    return (
      <LuxShell className="ux ux-floor">
        <button type="button" className="ux-btn" style={{ marginBottom: 10 }} onClick={() => setOpenSid(null)}>
          <ArrowRight size={16} strokeWidth={2} aria-hidden />
          כל השיחות
        </button>
        <ConversationThread key={openSid} apiToken={apiToken} row={row} quickTemplates={quickTemplates} />
      </LuxShell>
    );
  }

  return <ConversationList leads={cockpitLeads} renderedAt={renderedAt} onOpen={(sid) => setOpenSid(sid)} />;
}
