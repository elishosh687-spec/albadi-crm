"use client";

import { useCallback, useEffect, useState } from "react";
import { Section, LuxCTA, LuxStat } from "@/components/widget-ui/lux";
import InfoTip from "./InfoTip";

interface GapRow {
  rowIndex: number;
  name: string;
  phone: string;
  sent: string | null;
  status: string | null;
  sid: string | null;
}
interface Resp {
  ok: boolean;
  checked?: number;
  inSystem?: number;
  notInSystem?: GapRow[];
  spreadsheetId?: string | null;
  error?: string;
}

// A sheet row that says "sent" but is missing from the DB is the alarming case
// (the form thinks it handled the lead, but there's no lead / no conversation).
function statusTone(status: string | null, sent: string | null): "alert" | "muted" {
  const s = (sent ?? "").trim().toUpperCase();
  return s === "SENT" ? "alert" : "muted";
}

function statusLabel(status: string | null, sent: string | null): string {
  const s = (sent ?? "").trim().toUpperCase();
  const ls = (status ?? "").trim();
  if (s === "SENT" || ls === "sent") return "מסומן נשלח — אך חסר במערכת ⚠️";
  if (ls.startsWith("BAD_PHONE")) return "טלפון לא תקין";
  if (ls === "lead_created_send_failed") return "נוצר אך השליחה נכשלה";
  if (ls.startsWith("http_") || ls.startsWith("exception_")) return `שגיאה: ${ls}`;
  if (!ls) return "לא עובד עדיין (ממתין)";
  return ls;
}

export default function FormGapsSection({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/widget/form-gaps?widget_token=${encodeURIComponent(token)}`
      );
      const j: Resp = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      setData(j);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gaps = data?.notInSystem ?? [];
  const rowLink = (rowIndex: number) =>
    data?.spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit#gid=0&range=A${rowIndex}`
      : null;

  return (
    <Section
      eyebrow="— Form gaps"
      title={
        <InfoTip
          info={
            <>
              מצליב כל שורה בטופס הלידים של פייסבוק מול טבלת הלידים ב-CRM (לפי
              טלפון). מראה מי <b>מילא טופס אבל לא נכנס למערכת</b> — כולל שורות
              שמסומנות "נשלח" אבל אין להן ליד בפועל. אלה לקוחות שנפלו לגמרי בין
              הכיסאות — מילאו פרטים ואף אחד לא מדבר איתם.
            </>
          }
        >
          <span>
            פערי <span className="lux-accent">טופס</span>.
          </span>
        </InfoTip>
      }
      style={{ marginTop: 22 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 12.5, color: "var(--lux-muted)", maxWidth: 420 }}>
          מי מילא את טופס הפייסבוק ולא נמצא ב-CRM. בדיקה אמיתית מול הטלפון —
          לא רק לפי הסימון בגיליון.
        </div>
        <LuxCTA variant="champagne" onClick={load} disabled={loading}>
          {loading ? "בודק…" : "רענן"}
        </LuxCTA>
      </div>

      {data && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <LuxStat
            value={gaps.length}
            label="לא נכנסו למערכת"
            tone={gaps.length ? "alert" : "success"}
          />
          <LuxStat value={data.inSystem ?? 0} label="במערכת ✓" />
          <LuxStat value={data.checked ?? 0} label="נבדקו בטופס" />
        </div>
      )}

      {error && (
        <div style={{ color: "#e0736f", fontSize: 12.5, marginBottom: 10 }}>
          שגיאה: {error}
        </div>
      )}

      {data && gaps.length === 0 && !error && (
        <div style={{ fontSize: 13, color: "var(--lux-muted)" }}>
          🎉 כל הלידים מהטופס נמצאים במערכת.
        </div>
      )}

      {open && gaps.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {gaps.map((g) => {
            const link = rowLink(g.rowIndex);
            const alert = statusTone(g.status, g.sent) === "alert";
            return (
              <div
                key={g.rowIndex}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--lux-border, rgba(255,255,255,0.08))",
                  background: alert
                    ? "rgba(224,115,111,0.06)"
                    : "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{g.name}</div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--lux-muted)",
                      fontVariantNumeric: "tabular-nums",
                      direction: "ltr",
                      textAlign: "right",
                    }}
                  >
                    {g.phone}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11.5,
                      color: alert ? "#e0736f" : "var(--lux-muted)",
                    }}
                  >
                    {statusLabel(g.status, g.sent)}
                  </span>
                  {link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: 11.5,
                        color: "var(--lux-accent, #c9a86a)",
                        textDecoration: "none",
                        border: "1px solid var(--lux-border, rgba(255,255,255,0.12))",
                        borderRadius: 8,
                        padding: "4px 8px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      שורה בטופס ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
