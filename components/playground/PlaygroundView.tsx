"use client";

/**
 * Bot playground — chat with the real bot, tools to test it, settings to tune it.
 *
 * Layout follows standard dev-tool conventions (rebuilt 14.8 after Eli's
 * feedback that the button-soup was unreadable):
 *   - Three TABS switch context: שיחה (the test chat) / הגדרות / מצב מערכת.
 *   - The chat tab is a two-column split: conversation on one side, a
 *     labelled tool rail on the other (test actions grouped under headings,
 *     one-line captions instead of hover-only tooltips).
 *   - The setter's analysis renders in the tool rail next to the chat it
 *     analysed — not as a panel that shoves the conversation off-screen.
 *
 * Client-safe: data arrives via /api/widget/playground only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import BotSettingsPanel from "./BotSettingsPanel";
import BotMapPanel from "./BotMapPanel";

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
  faint: "#6b645c",
  accent: "#c9a227",
  inBubble: "#26302a",
  outBubble: "#22201d",
  alert: "#3a2a1a",
};

type Tab = "chat" | "map" | "settings" | "system";

export default function PlaygroundView({ apiToken }: { apiToken: string }) {
  // ?tab=settings lets the bot map link straight at a knob instead of telling
  // the reader where to go looking for it.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "chat";
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "settings" || t === "system" || t === "map" ? t : "chat";
  });
  const [transcript, setTranscript] = useState<PlaygroundMessage[]>([]);
  const [lead, setLead] = useState<LeadState | null>(null);
  const [systemInfo, setSystemInfo] = useState<SettingsGroup[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [setter, setSetter] = useState<Record<string, unknown> | null>(null);
  const [showQState, setShowQState] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const url = `/api/widget/playground?widget_token=${encodeURIComponent(apiToken)}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "load failed");
      setTranscript(json.transcript ?? []);
      setLead(json.lead ?? null);
      setSystemInfo(json.settings ?? []);
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

  async function post(body: Record<string, unknown>, busyKey: string) {
    if (busy) return null;
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.transcript) setTranscript(json.transcript);
      if (json.lead !== undefined) setLead(json.lead);
      if (json.error) setError(json.error);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function send(text: string) {
    const body = text.trim();
    if (!body) return;
    setInput("");
    const json = await post({ action: "send", text: body }, "send");
    // Some turns do something the transcript can't show — a real conversation
    // would pause the bot and alert Eli, but the playground lead is not a
    // customer, so the handler says so instead of silently doing nothing.
    if (json?.note) setNotice(json.note as string);
  }

  const stageLabel = lead?.pipelineStage
    ? (STAGE_LABELS[lead.pipelineStage] ?? lead.pipelineStage)
    : "קליטה (שאלון)";
  const step = lead?.qState?.step as number | undefined;
  const subFlow = lead?.qState?.subFlow as string | undefined;

  return (
    <div
      dir="rtl"
      // `.mfit` opts this screen into the mobile layer in globals.css (chiefly
      // the 16px input rule that stops iOS zooming the page on focus).
      className="mfit"
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
      }}
    >
      {/* ===== header: title + tabs ===== */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: C.bg,
          borderBottom: `1px solid ${C.border}`,
          padding: "12px clamp(10px, 3vw, 20px) 0",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            flexWrap: "wrap",
            maxWidth: 1100,
            margin: "0 auto",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>מגרש בדיקות לבוט</h1>
          <span style={{ fontSize: 12.5, color: C.dim }}>
            הבוט האמיתי, בלי לקוחות — שום הודעה לא יוצאת ל-WhatsApp
          </span>
        </div>
        <nav style={{ display: "flex", gap: 2, maxWidth: 1100, margin: "8px auto 0" }}>
          {(
            [
              ["chat", "💬 שיחה"],
              ["map", "🗺 מפת הבוט"],
              ["settings", "⚙️ הגדרות הבוט"],
              ["system", "🖥 מצב מערכת"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${tab === id ? C.accent : "transparent"}`,
                color: tab === id ? C.text : C.dim,
                padding: "8px 14px",
                fontSize: 13.5,
                fontWeight: tab === id ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(10px, 3vw, 16px)" }}>
        {notice && (
          <div
            style={{
              background: "rgba(201,162,39,0.10)",
              border: "1px solid rgba(201,162,39,0.35)",
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 12,
              fontSize: 13,
              color: "#e0c46a",
              display: "flex",
              gap: 8,
            }}
          >
            <span style={{ flex: 1 }}>{notice}</span>
            <button onClick={() => setNotice(null)} style={linkBtn}>
              ✕
            </button>
          </div>
        )}

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

        {tab === "map" && (
          <BotMapPanel apiToken={apiToken} onEdit={() => setTab("settings")} />
        )}

        {tab === "settings" && <BotSettingsPanel apiToken={apiToken} />}

        {tab === "system" && <SystemTab groups={systemInfo} />}

        {tab === "chat" && (
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* ===== chat column ===== */}
            <section style={{ flex: "1 1 480px", minWidth: 300 }}>
              {/* status strip */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <Chip label="שלב" value={stageLabel} />
                {typeof step === "number" && <Chip label="שאלה" value={String(step)} />}
                {subFlow && <Chip label="מצב" value={subFlow} />}
                {lead?.pipelineFlag && <Chip label="דגל" value={lead.pipelineFlag} tone="warn" />}
                {lead?.botPaused && <Chip label="הבוט" value="מושהה" tone="warn" />}
                <div style={{ flex: 1 }} />
                <button onClick={() => setShowQState((v) => !v)} style={linkBtn}>
                  {showQState ? "הסתר qState" : "qState"}
                </button>
              </div>

              {showQState && (
                <pre
                  style={{
                    background: C.panel,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: 10,
                    margin: "0 0 8px",
                    fontSize: 11.5,
                    color: C.dim,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 180,
                    overflowY: "auto",
                  }}
                >
                  {JSON.stringify(lead?.qState ?? {}, null, 2)}
                </pre>
              )}

              {/* thread */}
              <div
                style={{
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: 14,
                  height: "52vh",
                  minHeight: 300,
                  overflowY: "auto",
                }}
              >
                {transcript.length === 0 && (
                  <div
                    style={{
                      color: C.dim,
                      fontSize: 13,
                      textAlign: "center",
                      marginTop: 48,
                      lineHeight: 1.8,
                    }}
                  >
                    <div style={{ fontSize: 26, marginBottom: 6 }}>💬</div>
                    אתה הלקוח. כתוב הודעה ראשונה —<br />
                    למשל <b>&quot;היי, אני צריך שקיות&quot;</b> — והבוט האמיתי יענה.
                  </div>
                )}
                {transcript.map((m) => (
                  <Bubble key={m.id} msg={m} onPick={send} disabled={!!busy} />
                ))}
                {busy === "send" && (
                  <div style={{ color: C.dim, fontSize: 12, padding: "6px 2px" }}>הבוט חושב…</div>
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
                  disabled={!!busy}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: C.panel,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    color: C.text,
                    fontSize: 16,
                  }}
                />
                <button type="submit" disabled={!!busy || !input.trim()} style={btnPrimary}>
                  שלח
                </button>
              </form>
            </section>

            {/* ===== tool rail ===== */}
            <aside
              style={{
                flex: "1 1 280px",
                maxWidth: 360,
                minWidth: 250,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <ToolCard
                icon="🧠"
                title="מוח המכירות (סטר)"
                caption="מנתח את השיחה הנוכחית ומראה מה הוא היה עונה — בלי לשלוח."
              >
                <button
                  onClick={async () => {
                    const json = await post({ action: "setter_preview" }, "setter");
                    if (json?.setter) setSetter(json.setter);
                  }}
                  disabled={!!busy}
                  style={{ ...btnSecondary, width: "100%" }}
                >
                  {busy === "setter" ? "מנתח…" : "מה הסטר היה עונה?"}
                </button>
                {setter && <SetterResult run={setter} onClose={() => setSetter(null)} />}
              </ToolCard>

              <ToolCard
                icon="⏩"
                title="מכונת זמן"
                caption="מזיז את השיחה אחורה בזמן — לבדוק פולו-אפים בלי לחכות ימים."
              >
                <div style={{ display: "flex", gap: 6 }}>
                  {(
                    [
                      [3, "3 שעות"],
                      [24, "יום"],
                      [72, "3 ימים"],
                    ] as [number, string][]
                  ).map(([h, label]) => (
                    <button
                      key={h}
                      onClick={async () => {
                        await post({ action: "time_travel", hours: h }, "time");
                        setNotice(
                          `⏪ השיחה הוזזה ${label} אחורה (תראה את השעות על ההודעות). עכשיו לחץ "מה הסטר היה עונה?" כדי לראות את הפולו-אפ.`
                        );
                      }}
                      disabled={!!busy}
                      style={{ ...btnSecondary, flex: 1, padding: "8px 4px" }}
                    >
                      +{label}
                    </button>
                  ))}
                </div>
              </ToolCard>

              <ToolCard
                icon="📞"
                title="בקשת זמן לשיחה"
                caption="מדמה את הודעת תיאום השיחה האמיתית, כולל רשימת ההכנה של הלקוח."
              >
                <button
                  onClick={() => void post({ action: "ask_callback" }, "callback")}
                  disabled={!!busy}
                  style={{ ...btnSecondary, width: "100%" }}
                >
                  {busy === "callback" ? "שולח…" : "בקש זמן לשיחה"}
                </button>
              </ToolCard>

              <ToolCard icon="↺" title="איפוס" caption="מוחק את השיחה ואת כל מצב הבוט — התחלה נקייה.">
                <button
                  onClick={async () => {
                    setSetter(null);
                    await post({ action: "reset" }, "reset");
                  }}
                  disabled={!!busy}
                  style={{ ...btnDanger, width: "100%" }}
                >
                  {busy === "reset" ? "מאפס…" : "התחל מחדש"}
                </button>
              </ToolCard>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

/* ================= sub-components ================= */

function ToolCard({
  icon,
  title,
  caption,
  children,
}: {
  icon: string;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>
        {icon} {title}
      </div>
      <p style={{ margin: "0 0 9px", fontSize: 11.5, color: C.dim, lineHeight: 1.55 }}>{caption}</p>
      {children}
    </div>
  );
}

function SetterResult({ run, onClose }: { run: Record<string, unknown>; onClose: () => void }) {
  const cls = (run.classification ?? {}) as Record<string, string | null>;
  const strat = (run.strategy ?? {}) as {
    goal?: string;
    skills?: string[];
    informationToRequest?: string[];
  };
  const msg = (run.message ?? null) as {
    text?: string;
    validation?: { ok: boolean; violations: string[]; wordCount: number };
  } | null;

  const HE: Record<string, string> = {
    book_call: "לקבוע שיחה",
    answer_and_advance: "לענות ולקדם",
    explore_objection: "לחקור התנגדות",
    revive: "להחיות ליד שקט",
    hold_back: "לא לדחוף",
    interested: "מתעניין",
    considering: "שוקל",
    objecting: "מתנגד",
    asking_question: "שואל",
    ready_to_proceed: "מוכן להתקדם",
    postponing: "דוחה",
    gone_quiet: "נעלם",
    not_interested: "לא מעוניין",
    unclear: "לא ברור",
  };

  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
      <table style={{ fontSize: 12, color: C.dim, borderSpacing: 0, marginBottom: 8 }}>
        <tbody>
          <Row k="כוונת הלקוח" v={HE[String(cls.intent)] ?? String(cls.intent ?? "—")} />
          {cls.objectionType && <Row k="התנגדות" v={String(cls.objectionType)} />}
          <Row k="החלטת הסטר" v={HE[strat.goal ?? ""] ?? String(strat.goal ?? "—")} strong />
          {!!strat.informationToRequest?.length && (
            <Row k="חסר ללקוח" v={strat.informationToRequest.join(", ")} />
          )}
        </tbody>
      </table>
      {msg?.text ? (
        <div
          style={{
            background: C.outBubble,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "9px 11px",
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg.text}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: C.dim }}>הסטר בחר לא לשלוח כלום בתור הזה.</div>
      )}
      {msg?.validation && (
        <div
          style={{
            fontSize: 11,
            marginTop: 5,
            color: msg.validation.ok ? "#7fb894" : "#e88",
          }}
        >
          {msg.validation.ok
            ? `✓ עבר ולידציה · ${msg.validation.wordCount} מילים`
            : `⛔ ההודעה נפסלה ולא הייתה נשלחת — ${msg.validation.violations.join("; ")}`}
        </div>
      )}
      <button onClick={onClose} style={{ ...linkBtn, marginTop: 6 }}>
        נקה
      </button>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <tr>
      <td style={{ paddingLeft: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
      <td style={{ color: strong ? C.accent : C.text, fontWeight: strong ? 600 : 400 }}>{v}</td>
    </tr>
  );
}

function SystemTab({ groups }: { groups: SettingsGroup[] }) {
  return (
    <div style={{ maxWidth: 760 }}>
      <p style={{ margin: "4px 0 14px", fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
        לקריאה בלבד — ערכים שנקבעים בפריסה (משתני סביבה וקבועים בקוד), לא בהגדרות. מוצג כדי
        שתדע מול מה אתה בודק.
      </p>
      {groups.map((g) => (
        <div
          key={g.title}
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 14,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 13, color: C.accent, fontWeight: 600, marginBottom: 6 }}>
            {g.title}
          </div>
          {g.items.map((it) => (
            <div
              key={it.label}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "baseline",
                flexWrap: "wrap",
                padding: "5px 0",
                borderBottom: `1px solid ${C.border}`,
                fontSize: 13,
              }}
            >
              <span style={{ minWidth: 190, color: C.dim }}>{it.label}</span>
              <span style={{ flex: 1 }}>{it.value}</span>
              <span style={{ fontSize: 11, color: C.faint }}>
                {SOURCE_LABELS[it.source]}
                {it.hint ? ` · ${it.hint}` : ""}
              </span>
            </div>
          ))}
        </div>
      ))}
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
  const ts = new Date(msg.receivedAt);
  const ageMs = Date.now() - ts.getTime();
  // Time label makes the time machine visible — without it, aging the
  // conversation looks like a button that does nothing.
  const timeLabel =
    ageMs > 20 * 3600_000
      ? ts.toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })
      : ts.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isIn ? "flex-start" : "flex-end",
        marginBottom: 10,
      }}
    >
      <div style={{ maxWidth: "85%" }}>
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
        <div
          style={{
            fontSize: 10,
            color: "#6b645c",
            marginTop: 2,
            textAlign: isIn ? "start" : "end",
          }}
        >
          {timeLabel}
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

function Chip({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <span
      style={{
        background: tone === "warn" ? "rgba(214,164,76,0.12)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${tone === "warn" ? "rgba(214,164,76,0.35)" : C.border}`,
        borderRadius: 999,
        padding: "3px 10px",
        fontSize: 12,
        color: tone === "warn" ? "#e0c46a" : C.text,
      }}
    >
      <span style={{ color: C.dim }}>{label}: </span>
      {value}
    </span>
  );
}

/* ================= shared styles ================= */

const btnBase: React.CSSProperties = {
  borderRadius: 9,
  padding: "8px 13px",
  fontSize: 13,
  cursor: "pointer",
  border: "1px solid transparent",
};
const btnSecondary: React.CSSProperties = {
  ...btnBase,
  background: "rgba(255,255,255,0.05)",
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
  padding: "10px 22px",
};
const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: C.faint,
  fontSize: 11.5,
  cursor: "pointer",
  textDecoration: "underline",
  padding: 0,
};
