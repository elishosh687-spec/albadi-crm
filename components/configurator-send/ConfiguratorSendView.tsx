"use client";

import { useState, useMemo, useTransition } from "react";

export interface ConfiguratorSendRow {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  /** Whether this lead already received a configurator link (any time). */
  alreadySent: boolean;
}

interface Props {
  apiToken: string;
  initialRows: ConfiguratorSendRow[];
}

type SendState = "idle" | "sending" | "sent" | "error";

export default function ConfiguratorSendView({ apiToken, initialRows }: Props) {
  const [filter, setFilter] = useState("");
  const [state, setState] = useState<Record<string, SendState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return initialRows;
    return initialRows.filter((r) =>
      [r.name, r.phone, r.sid].some((x) => x?.toLowerCase().includes(f))
    );
  }, [initialRows, filter]);

  async function send(row: ConfiguratorSendRow) {
    const sid = row.sid;
    setState((s) => ({ ...s, [sid]: "sending" }));
    setErrors((e) => ({ ...e, [sid]: "" }));
    try {
      const res = await fetch(
        `/api/widget/send-configurator?widget_token=${encodeURIComponent(apiToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid }),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "send failed");
      setState((s) => ({ ...s, [sid]: "sent" }));
    } catch (e) {
      setState((s) => ({ ...s, [sid]: "error" }));
      setErrors((er) => ({
        ...er,
        [sid]: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  function refresh() {
    startTransition(() => location.reload());
  }

  function btnLabel(st: SendState, already: boolean): string {
    if (st === "sending") return "שולח…";
    if (st === "sent") return "✓ נשלח";
    if (st === "error") return "↻ נסה שוב";
    return already ? "שלח שוב 🎨" : "שלח מעצב 3D 🎨";
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
          placeholder="חפש שם / טלפון"
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
            אין לקוחות
          </div>
        )}
        {visible.map((r) => {
          const st = state[r.sid] ?? "idle";
          const sent = st === "sent";
          return (
            <div
              key={r.sid}
              style={{
                background: sent ? "#13241a" : "#1a1d24",
                border: `1px solid ${sent ? "#15803d" : "#2a2d34"}`,
                borderRadius: 8,
                padding: 12,
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
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
                <div
                  style={{
                    marginTop: 4,
                    display: "flex",
                    gap: 6,
                    fontSize: 11,
                    color: "#71717a",
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  {r.stage && (
                    <span style={{ background: "#1f2937", padding: "2px 6px", borderRadius: 4 }}>
                      {r.stage}
                    </span>
                  )}
                  {r.phone && <span style={{ color: "#52525b" }}>{r.phone}</span>}
                  {r.alreadySent && st === "idle" && (
                    <span style={{ background: "#1e3a8a", color: "#bfdbfe", padding: "2px 6px", borderRadius: 4 }}>
                      כבר נשלח
                    </span>
                  )}
                  {st === "error" && errors[r.sid] && (
                    <span style={{ color: "#f87171" }}>{errors[r.sid]}</span>
                  )}
                </div>
              </div>

              <button
                onClick={() => send(r)}
                disabled={st === "sending"}
                style={{
                  minWidth: 130,
                  height: 44,
                  fontSize: 14,
                  fontWeight: 600,
                  background: sent ? "#15803d" : st === "error" ? "#7c2d12" : "#7c3aed",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  cursor: st === "sending" ? "wait" : "pointer",
                  touchAction: "manipulation",
                  flexShrink: 0,
                }}
              >
                {btnLabel(st, r.alreadySent)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
