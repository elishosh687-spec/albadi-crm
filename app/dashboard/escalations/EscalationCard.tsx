"use client";

import { useState } from "react";

interface Escalation {
  id: number;
  leadName: string | null;
  manychatSubId: string;
  reason: string;
  triggerText: string | null;
  createdAt: string;
}

const REASON_HE: Record<string, string> = {
  low_confidence: "Claude לא בטוחה",
  human_request: "ביקש שיחה אישית",
  pricing: "נושא מחיר/הנחה",
  complaint: "תלונה",
  unknown: "לא מוכר / שבור",
};

export function EscalationCard({ escalation }: { escalation: Escalation }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [draft, setDraft] = useState("");

  async function resolve(action: string, note?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/actions/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: escalation.id, action, note: note ?? action }),
      });
      if (!res.ok) throw new Error("failed");
      setDone(true);
    } catch (e) {
      alert("שגיאה בעדכון");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        id={`e-${escalation.id}`}
        style={{
          padding: 16,
          border: "1px solid #d1e7dd",
          background: "#f0f9f4",
          borderRadius: 8,
          marginBottom: 12,
          color: "#2d7a3a",
        }}
      >
        ✓ {escalation.leadName ?? escalation.manychatSubId} — נסגר
      </div>
    );
  }

  return (
    <div
      id={`e-${escalation.id}`}
      style={{
        padding: 16,
        border: "1px solid #e5e5e5",
        background: "#fff",
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <strong style={{ fontSize: 16 }}>{escalation.leadName ?? escalation.manychatSubId}</strong>
          <span style={{ marginInlineStart: 8, color: "#888", fontSize: 13 }}>
            — {REASON_HE[escalation.reason] ?? escalation.reason}
          </span>
        </div>
        <span style={{ color: "#888", fontSize: 12 }}>
          {new Date(escalation.createdAt).toLocaleString("he-IL")}
        </span>
      </div>

      {escalation.triggerText && (
        <div
          style={{
            background: "#f7f7f8",
            padding: 8,
            borderRadius: 4,
            fontSize: 13,
            color: "#444",
            marginBottom: 12,
          }}
        >
          {escalation.triggerText}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>
          טיוטת תגובה (לערוך לפני אישור):
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="כתוב כאן את התגובה שתישלח ללקוח..."
          rows={3}
          style={{
            width: "100%",
            padding: 8,
            borderRadius: 4,
            border: "1px solid #ddd",
            fontFamily: "inherit",
            fontSize: 14,
            resize: "vertical",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => resolve("sent", `נשלח: ${draft.slice(0, 100)}`)}
          disabled={busy || !draft.trim()}
          style={btnPrimary(busy || !draft.trim())}
        >
          ✓ אשר ושלח
        </button>
        <button
          onClick={() => resolve("dismissed")}
          disabled={busy}
          style={btnSecondary(busy)}
        >
          ✗ דחה
        </button>
        <button
          onClick={() => resolve("manual", "אטפל ידנית")}
          disabled={busy}
          style={btnSecondary(busy)}
        >
          ✏️ אטפל ידנית
        </button>
      </div>
    </div>
  );
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? "#ccc" : "#1a1a1a",
    color: "#fff",
    padding: "8px 16px",
    borderRadius: 6,
    fontSize: 13,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    background: "#fff",
    color: "#1a1a1a",
    padding: "8px 16px",
    borderRadius: 6,
    fontSize: 13,
    border: "1px solid #ddd",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
