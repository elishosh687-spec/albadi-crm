"use client";

import { useState, useMemo } from "react";

export interface LeadOption {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
}

interface Props {
  apiToken: string;
  options: LeadOption[];
}

export function OrderLeadPicker({ apiToken, options }: Props) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options.slice(0, 50);
    return options
      .filter((l) =>
        (l.name ?? "").toLowerCase().includes(needle) ||
        (l.phone ?? "").includes(needle) ||
        l.sid.toLowerCase().includes(needle)
      )
      .slice(0, 50);
  }, [q, options]);

  function selectLead(sid: string) {
    const url = `/widget/order-summary?sid=${encodeURIComponent(sid)}&widget_token=${encodeURIComponent(apiToken)}`;
    window.location.href = url;
  }

  return (
    <div style={{ padding: 16, direction: "rtl", color: "#e4e4e7" }}>
      <input
        type="search"
        placeholder="🔍 חפש ליד (שם / טלפון)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 15,
          background: "#1a1d24",
          color: "#e4e4e7",
          border: "1px solid #2a2d34",
          borderRadius: 8,
          marginBottom: 12,
          outline: "none",
        }}
      />

      <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 8 }}>
        {filtered.length} מתוך {options.length}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {filtered.map((l) => (
          <button
            key={l.sid}
            onClick={() => selectLead(l.sid.trim())}
            style={{
              textAlign: "right",
              background: "#1a1d24",
              border: "1px solid #2a2d34",
              borderRadius: 6,
              padding: "10px 12px",
              cursor: "pointer",
              color: "#e4e4e7",
              fontFamily: "inherit",
              fontSize: 14,
              transition: "background 100ms",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2d34")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#1a1d24")}
          >
            <div style={{ fontWeight: 600 }}>{l.name ?? l.sid.slice(0, 25)}</div>
            <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 2 }}>
              {l.phone ?? "—"} {l.stage ? `· ${l.stage}` : ""}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ color: "#71717a", padding: 12, textAlign: "center" }}>
            לא נמצא ליד מתאים
          </div>
        )}
      </div>
    </div>
  );
}
