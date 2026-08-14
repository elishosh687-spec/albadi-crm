"use client";

/**
 * Bot playground — chat with the real bot, see its state, see its settings.
 *
 * Client-safe by construction: everything arrives over /api/widget/playground.
 * No server-only imports (see the client-bundle rule in CLAUDE.md).
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface PlaygroundMessage {
  id: number;
  direction: "in" | "out";
  text: string | null;
  sender: string | null;
  receivedAt: string;
  options?: string[];
  kind?: string;
}

interface LeadState {
  pipelineStage: string | null;
  pipelineFlag: string | null;
  botPaused: boolean;
  qState: Record<string, unknown> | null;
}

interface SettingItem {
  label: string;
  value: string;
  source: "env" | "code" | "config";
  hint?: string;
}
interface SettingsGroup {
  title: string;
  items: SettingItem[];
}

const STAGE_LABELS: Record<string, string> = {
  INTAKE: "קליטה",
  DISCAVERY: "אפיון",
  FACTORY_WAIT: "מחכה למפעל",
  CONSIDERATION: "שוקל / משא ומתן",
  WON: "נסגר",
  LOST: "אבוד",
};

const SOURCE_LABELS: Record<SettingItem["source"], string> = {
  env: "משתנה סביבה",
  code: "קבוע בקוד",
  config: "הגדרות",
};

const C = {
  bg: "#141312",
  panel: "#1b1917",
  border: "rgba(255,255,255,0.08)",
  text: "#e8e4de",
  dim: "#9a938a",
  accent: "#c9a227",
  inBubble: "#26302a",
  outBubble: "#22201d",
  alert: "#3a2a1a",
};

export default function PlaygroundView({ apiToken }: { apiToken: string }) {
  const [transcript, setTranscript] = useState<PlaygroundMessage[]>([]);
  const [lead, setLead] = useState<LeadState | null>(null);
  const [settings, setSettings] = useState<SettingsGroup[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRoute, setLastRoute] = useState<string | null>(null);
  const [showState, setShowState] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const url = `/api/widget/playground?widget_token=${encodeURIComponent(apiToken)}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "load failed");
      setTranscript(json.transcript ?? []);
      setLead(json.lead ?? null);
      setSettings(json.settings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length]);

  async function send(text: string) {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", text: body }),
      });
      const json = await res.json();
      setTranscript(json.transcript ?? []);
      setLead(json.lead ?? null);
      setLastRoute(json.routedTo ?? null);
      if (json.error) setError(json.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const json = await res.json();
      setTranscript(json.transcript ?? []);
      setLead(json.lead ?? null);
      setLastRoute(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const stageLabel = lead?.pipelineStage
    ? (STAGE_LABELS[lead.pipelineStage] ?? lead.pipelineStage)
    : "קליטה (שאלון)";
  const step = lead?.qState?.step as number | undefined;
  const subFlow = lead?.qState?.subFlow as string | undefined;

  return (
    <div
      dir="rtl"
      style={{
        // Fixed inset rather than minHeight: the widget lives in a GHL iframe,
        // and a taller-than-viewport page let the (light) document background
        // show through below the container.
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        background: C.bg,
        color: C.text,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        padding: 16,
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <header style={{ marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            מגרש בדיקות לבוט
          </h1>
          <p style={{ margin: "6px 0 0", color: C.dim, fontSize: 13, lineHeight: 1.6 }}>
            כאן אתה הלקוח. הבוט האמיתי עונה — אותו קוד, אותו תמחור, אותם מודלים.
            <strong style={{ color: C.accent }}> שום הודעה לא יוצאת ל-WhatsApp</strong>,
            ולא נוצר כלום ב-GHL.
          </p>
        </header>

        {/* status bar */}
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <Chip label="שלב" value={stageLabel} />
          {typeof step === "number" && <Chip label="שאלה" value={String(step)} />}
          {subFlow && <Chip label="מצב" value={subFlow} />}
          {lead?.pipelineFlag && <Chip label="דגל" value={lead.pipelineFlag} tone="warn" />}
          {lead?.botPaused && <Chip label="הבוט" value="מושהה" tone="warn" />}
          {lastRoute && lastRoute !== "none" && (
            <Chip
              label="טופל ע״י"
              value={lastRoute === "questionnaire" ? "שאלון" : "החלטות"}
            />
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowState((v) => !v)} style={btnGhost}>
            {showState ? "הסתר מצב" : "מצב הבוט"}
          </button>
          <button onClick={() => setShowSettings((v) => !v)} style={btnGhost}>
            {showSettings ? "הסתר הגדרות" : "הגדרות"}
          </button>
          <button onClick={reset} disabled={busy} style={btnDanger}>
            התחל מחדש
          </button>
        </div>

        {error && (
          <div
            style={{
              background: "#3a1d1d",
              border: "1px solid #7f1d1d",
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            שגיאה: {error}
          </div>
        )}

        {showState && (
          <Panel title="מצב פנימי (qState)">
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                overflowX: "auto",
                color: C.dim,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(lead?.qState ?? {}, null, 2)}
            </pre>
          </Panel>
        )}

        {showSettings && (
          <Panel title="ההגדרות שהבוט רץ איתן כרגע">
            <p style={{ margin: "0 0 10px", color: C.dim, fontSize: 12, lineHeight: 1.6 }}>
              לקריאה בלבד — היום רוב ההתנהגות קבועה בקוד או במשתני סביבה. כל
              שורה שתהפוך לניתנת לעריכה תעבור לכאן כשדה אמיתי.
            </p>
            {settings.map((g) => (
              <div key={g.title} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: C.accent,
                    marginBottom: 6,
                    fontWeight: 600,
                  }}
                >
                  {g.title}
                </div>
                {g.items.map((it) => (
                  <div
                    key={it.label}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "baseline",
                      padding: "5px 0",
                      borderBottom: `1px solid ${C.border}`,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ minWidth: 190, color: C.dim }}>{it.label}</span>
                    <span style={{ flex: 1 }}>{it.value}</span>
                    <span style={{ fontSize: 11, color: "#6b645c" }}>
                      {SOURCE_LABELS[it.source]}
                      {it.hint ? ` · ${it.hint}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </Panel>
        )}

        {/* thread */}
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 14,
            minHeight: 320,
            maxHeight: "56vh",
            overflowY: "auto",
          }}
        >
          {transcript.length === 0 && (
            <p style={{ color: C.dim, fontSize: 13, textAlign: "center", marginTop: 40 }}>
              כתוב הודעה ראשונה כדי להתחיל — למשל &quot;היי, אני צריך שקיות&quot;.
            </p>
          )}
          {transcript.map((m) => (
            <Bubble key={m.id} msg={m} onPick={send} disabled={busy} />
          ))}
          {busy && (
            <div style={{ color: C.dim, fontSize: 12, padding: "6px 2px" }}>
              הבוט חושב…
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          style={{ display: "flex", gap: 8, marginTop: 10 }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="מה הלקוח כותב…"
            disabled={busy}
            style={{
              flex: 1,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "10px 12px",
              color: C.text,
              fontSize: 14,
            }}
          />
          <button type="submit" disabled={busy || !input.trim()} style={btnPrimary}>
            שלח
          </button>
        </form>
      </div>
    </div>
  );
}

function Bubble({
  msg,
  onPick,
  disabled,
}: {
  msg: PlaygroundMessage;
  onPick: (t: string) => void;
  disabled: boolean;
}) {
  const isIn = msg.direction === "in";
  const isAlert = msg.kind === "eli_dm";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isIn ? "flex-start" : "flex-end",
        marginBottom: 10,
      }}
    >
      <div style={{ maxWidth: "82%" }}>
        {isAlert && (
          <div style={{ fontSize: 11, color: "#d6a44c", marginBottom: 3 }}>
            🔔 התראה פנימית לאלי (הלקוח לא רואה)
          </div>
        )}
        <div
          style={{
            background: isAlert ? C.alert : isIn ? C.inBubble : C.outBubble,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "9px 12px",
            fontSize: 14,
            lineHeight: 1.65,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {msg.text}
        </div>
        {msg.options && msg.options.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {msg.options.map((o) => (
              <button
                key={o}
                onClick={() => onPick(o)}
                disabled={disabled}
                style={{
                  background: "rgba(201,162,39,0.10)",
                  border: "1px solid rgba(201,162,39,0.35)",
                  color: "#e0c46a",
                  borderRadius: 999,
                  padding: "5px 11px",
                  fontSize: 12.5,
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <span
      style={{
        background: tone === "warn" ? "rgba(214,164,76,0.12)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${tone === "warn" ? "rgba(214,164,76,0.35)" : C.border}`,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        color: tone === "warn" ? "#e0c46a" : C.text,
      }}
    >
      <span style={{ color: C.dim }}>{label}: </span>
      {value}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const btnBase: React.CSSProperties = {
  borderRadius: 9,
  padding: "7px 13px",
  fontSize: 13,
  cursor: "pointer",
  border: "1px solid transparent",
};
const btnGhost: React.CSSProperties = {
  ...btnBase,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${C.border}`,
  color: C.text,
};
const btnDanger: React.CSSProperties = {
  ...btnBase,
  background: "rgba(220,80,80,0.10)",
  border: "1px solid rgba(220,80,80,0.35)",
  color: "#e88",
};
const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: "rgba(201,162,39,0.16)",
  border: "1px solid rgba(201,162,39,0.45)",
  color: "#e0c46a",
  padding: "10px 20px",
};
