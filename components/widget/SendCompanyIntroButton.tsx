"use client";

import { useState } from "react";

/**
 * One-click "send company intro" button for the GHL-embedded widgets.
 * Sends the same template the bot sends after the quote (company video +
 * the 3 sister-site buttons + Instagram) via /api/widget/send-company-intro.
 */
export default function SendCompanyIntroButton({
  sid,
  apiToken,
  leadName,
}: {
  sid: string;
  apiToken: string;
  leadName?: string | null;
}) {
  const [busy, setBusy] = useState(false);

  async function send() {
    const who = leadName || "הליד";
    if (!window.confirm(`לשלוח הצגת חברה (וידאו + אתרים) ל-${who}?`)) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <button
      onClick={send}
      disabled={busy}
      title="שלח הצגת חברה (וידאו + אתרים)"
      style={{
        background: "#14321f",
        color: "#e4e4e7",
        border: "1px solid #2f6f4f",
        borderRadius: 6,
        padding: "8px 14px",
        fontSize: 14,
        fontWeight: 600,
        cursor: busy ? "wait" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {busy ? "…שולח" : "🎬 שלח הצגת חברה"}
    </button>
  );
}
