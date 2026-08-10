"use client";

/**
 * "התראה על שליחת הצעה" — who gets a WhatsApp ping every time a quote goes out
 * to a customer. Was hardwired to Itay; Eli turned it off 2026-08-10 and wanted
 * to be able to switch it back on, or point it at a different salesperson,
 * without a redeploy.
 *
 * Saves on its own endpoint/button so a half-edited pricing form can't block it.
 */
import { useEffect, useState } from "react";
import { Loader2, Check, BellRing } from "lucide-react";

export function QuoteNotifySection({ apiToken }: { apiToken: string }) {
  const [enabled, setEnabled] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const url = (p: string) => `${p}?widget_token=${encodeURIComponent(apiToken)}`;

  useEffect(() => {
    fetch(url("/api/widget/settings/quote-notify"))
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error ?? "load failed");
        setEnabled(Boolean(j.current?.enabled));
        setPhone(j.current?.phone ?? "");
        setName(j.current?.name ?? "");
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken]);

  async function save() {
    setState("saving");
    setErr(null);
    try {
      const r = await fetch(url("/api/widget/settings/quote-notify"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, phone, name }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error ?? "save failed");
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  const label: React.CSSProperties = { fontSize: 12.5, color: "#8a7f74" };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "7px 9px",
    borderRadius: 6,
    border: "1px solid rgba(230,225,224,0.12)",
    background: "rgba(230,225,224,0.03)",
    color: "#e6e1e0",
    fontSize: 13,
  };

  return (
    <div
      style={{
        border: "1px solid rgba(230,225,224,0.08)",
        borderRadius: 10,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <BellRing size={15} strokeWidth={1.75} />
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>
          התראה על שליחת הצעה ללקוח
        </h3>
      </div>
      <p style={{ ...label, margin: "0 0 10px" }}>
        מי מקבל הודעת ווטסאפ בכל פעם שנשלחת הצעת מחיר ללקוח. כבוי = אף אחד לא מקבל.
      </p>

      {!loaded ? (
        <div style={{ color: "#8a7f74", fontSize: 13 }}>טוען…</div>
      ) : (
        <>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              marginBottom: 10,
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>שלח התראה בכל שליחת הצעה</span>
          </label>

          {enabled ? (
            <div style={{ display: "grid", gap: 8, maxWidth: 340 }}>
              <div>
                <div style={label}>טלפון המקבל (למשל 972559230001)</div>
                <input
                  style={input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="972…"
                  dir="ltr"
                />
              </div>
              <div>
                <div style={label}>שם (לתצוגה בלבד)</div>
                <input
                  style={input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="איתי"
                />
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={save}
            disabled={state === "saving"}
            style={{
              marginTop: 12,
              padding: "7px 14px",
              borderRadius: 6,
              border: "1px solid rgba(230,225,224,0.12)",
              background: "rgba(230,225,224,0.06)",
              color: "#e6e1e0",
              fontSize: 13,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {state === "saving" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : state === "saved" ? (
              <Check size={14} />
            ) : null}
            {state === "saved" ? "נשמר" : "שמור"}
          </button>
          {err ? (
            <div style={{ marginTop: 8, color: "#e08a8a", fontSize: 12 }}>{err}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
