"use client";

/**
 * One conversation (ui-ux-pro-max redesign, 18/09 — replaces InboxView's
 * graphite 3-pane thread, whose own back arrow led to a second, older list).
 *
 * Header: who + stage + quote, and the bot's state in words with the action
 * next to it. One row of labelled tools (quotes / analyse / calculator /
 * templates / GHL). Messages grouped by day, each outgoing bubble says who
 * wrote it (בוט / אתה) and when. Composer is 16px (iOS zooms under that).
 * Same endpoints as before; nothing new is written.
 */
import { useEffect, useRef, useState } from "react";
import { BarChart3, Calculator, ExternalLink, Loader2, Lock, Mail, MessagesSquare, Pause, Play, Send, Wallet } from "lucide-react";
import LeadAnalysisInline from "./LeadAnalysisInline";
import { messagePreview, senderPrefix } from "@/lib/inbox/list-format";
import { stageLabel } from "@/lib/analytics/labels";

export interface InboxRow {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  botPaused: boolean;
  botPauseSticky?: boolean;
  lastText: string | null;
  lastSender: "lead" | "bot" | "eli";
  lastAt: string | null;
  inboundLast24h: number;
  ghlContactUrl: string | null;
}

export interface QuickTemplate {
  id: number;
  name: string;
  /** First char/emoji of the name */
  icon: string;
}

interface ThreadMsg {
  id: number;
  direction: string;
  text: string | null;
  sender: string | null;
  receivedAt: string;
}

type Panel = "chat" | "quotes" | "analyze" | "templates";

/** "📐 הסבר מידות" → "הסבר מידות" — the label shouldn't repeat an emoji icon. */
const stripLeadingEmoji = (name: string) => name.trim().replace(/^\p{Extended_Pictographic}\s*/u, "").trim();

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

export default function ConversationThread({
  apiToken,
  row: initialRow,
  quickTemplates,
}: {
  apiToken: string;
  row: InboxRow;
  quickTemplates: QuickTemplate[];
}) {
  const sid = initialRow.sid.trim();
  const [row, setRow] = useState(initialRow);
  const [msgs, setMsgs] = useState<ThreadMsg[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>("chat");
  const [quoteTotal, setQuoteTotal] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const q = (path: string) => `${path}${path.includes("?") ? "&" : "?"}widget_token=${encodeURIComponent(apiToken)}`;

  async function load() {
    try {
      const res = await fetch(q(`/api/widget/messages?sid=${encodeURIComponent(sid)}`));
      const j = await res.json();
      if (j.ok) setMsgs(j.messages as ThreadMsg[]);
      else setLoadErr(true);
    } catch {
      setLoadErr(true);
    }
  }

  useEffect(() => {
    void load();
    fetch(q(`/api/widget/leads/${encodeURIComponent(sid)}/factory-context`))
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && j.lead) {
          setQuoteTotal(j.lead.quoteTotal ?? null);
          if (j.lead.stage) setRow((r) => ({ ...r, stage: j.lead.stage }));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  // Newest message in view after every load / send.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && panel === "chat") el.scrollTop = el.scrollHeight;
  }, [msgs, panel]);

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(q(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  }

  async function toggleBot() {
    const next = !row.botPaused;
    setBusy(true);
    setRow((r) => ({ ...r, botPaused: next }));
    try {
      await post("/api/widget/toggle-pause", { sid, paused: next });
    } catch (e) {
      setRow((r) => ({ ...r, botPaused: !next }));
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** Exempt this lead from the automatic wake-up, permanently. */
  async function keepPaused() {
    if (!window.confirm('הבוט לא יחזור לדבר בשיחה הזו לעולם, גם אחרי הזמן שהוגדר בהגדרות.\nלהחזיר אותו בהמשך — "הפעל בוט".\n\nלסמן?')) return;
    setBusy(true);
    setRow((r) => ({ ...r, botPauseSticky: true }));
    try {
      await post("/api/widget/toggle-pause", { sid, paused: true, sticky: true });
    } catch (e) {
      setRow((r) => ({ ...r, botPauseSticky: false }));
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendTemplate(tpl: QuickTemplate) {
    const who = row.name || row.phone || sid;
    if (!window.confirm(`לשלוח "${stripLeadingEmoji(tpl.name)}" ל-${who}?`)) return;
    setBusy(true);
    try {
      await post("/api/widget/send-template", { sid, templateId: tpl.id });
      setPanel("chat");
      await load();
    } catch (e) {
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await post("/api/widget/calculator/send-text", { sid, text });
      setDraft("");
      await load();
    } catch (e) {
      alert(`לא נשלח: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  }

  const name = row.name || row.phone || sid;
  const shown = (msgs ?? []).filter((m) => m.text && m.text.trim());
  const tool = (id: Panel) => ({ "aria-pressed": panel === id, onClick: () => setPanel(panel === id ? "chat" : id) });

  return (
    <section className="ux-thread" aria-label={`שיחה עם ${name}`}>
      <header className="th-head">
        <div className="who">
          <h1>{name}</h1>
          <div className="meta">
            {row.phone && <span className="tnum" dir="ltr">{row.phone}</span>}
            {row.stage && <span className="ux-pill" data-tone="idle">{stageLabel(row.stage)}</span>}
            {quoteTotal && <span className="ux-pill" data-tone="go">הצעה ₪{quoteTotal}</span>}
          </div>
        </div>
        <div className="bot" role="group" aria-label="מצב הבוט">
          <span className="state">
            <span className="ux-dot" data-tone={row.botPaused ? "warn" : undefined} aria-hidden />
            {row.botPaused ? (row.botPauseSticky ? "הבוט מושהה לתמיד" : "הבוט מושהה") : "הבוט פעיל"}
          </span>
          <button type="button" className="ux-btn sm" onClick={toggleBot} disabled={busy}>
            {row.botPaused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
            {row.botPaused ? "הפעל בוט" : "השהה בוט"}
          </button>
          {row.botPaused && !row.botPauseSticky && (
            <button type="button" className="ux-btn sm warn" onClick={keepPaused} disabled={busy} title="הבוט לא יתעורר לבד בשיחה הזו">
              <Lock className="size-4" aria-hidden /> אל תיגע בליד הזה
            </button>
          )}
        </div>
      </header>

      <nav className="th-tools ux-chips" aria-label="כלים">
        <button type="button" className="ux-chip" {...tool("chat")}>
          <MessagesSquare className="size-4" aria-hidden /> שיחה
        </button>
        <button type="button" className="ux-chip" {...tool("quotes")}>
          <Wallet className="size-4" aria-hidden /> הצעות מחיר
        </button>
        <button type="button" className="ux-chip" {...tool("analyze")}>
          <BarChart3 className="size-4" aria-hidden /> נתח ליד
        </button>
        {quickTemplates.length > 0 && (
          <button type="button" className="ux-chip" {...tool("templates")}>
            <Mail className="size-4" aria-hidden /> תבניות
          </button>
        )}
        <a className="ux-chip" href={q(`/widget/calculator?sid=${encodeURIComponent(sid)}`)} target="_blank" rel="noopener noreferrer">
          <Calculator className="size-4" aria-hidden /> מחשבון
        </a>
        {row.ghlContactUrl && (
          <a className="ux-chip" href={row.ghlContactUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden /> GHL
          </a>
        )}
      </nav>

      <div className="th-body" ref={bodyRef}>
        {panel === "quotes" ? (
          <LeadQuotesInline apiToken={apiToken} sid={sid} name={row.name} phone={row.phone} />
        ) : panel === "analyze" ? (
          <LeadAnalysisInline apiToken={apiToken} sid={sid} name={row.name} />
        ) : panel === "templates" ? (
          <div className="grid gap-2">
            <p style={{ margin: 0, fontSize: 14, color: "var(--lux-muted)" }}>לחיצה שולחת את התבנית ל-{name} (תופיע שאלת אישור).</p>
            {quickTemplates.map((tpl) => (
              <button key={tpl.id} type="button" className="ux-btn" style={{ justifyContent: "flex-start" }} onClick={() => sendTemplate(tpl)} disabled={busy}>
                <Send className="size-4" aria-hidden /> {stripLeadingEmoji(tpl.name) || "תבנית"}
              </button>
            ))}
          </div>
        ) : msgs === null && !loadErr ? (
          <div className="grid gap-3" aria-label="טוען שיחה">
            <div className="ux-skel" style={{ height: 44, width: "60%" }} />
            <div className="ux-skel" style={{ height: 44, width: "45%", justifySelf: "end" }} />
            <div className="ux-skel" style={{ height: 64, width: "70%" }} />
          </div>
        ) : loadErr ? (
          <p className="ux-note" style={{ color: "#f0c0c0" }}>לא הצלחתי לטעון את השיחה — נסה לרענן.</p>
        ) : shown.length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--lux-muted)", padding: 24 }}>אין הודעות עדיין.</p>
        ) : (
          <ol className="th-msgs">
            {shown.map((m, i) => {
              const incoming = m.direction === "in" || m.sender === "lead";
              const day = dayKey(m.receivedAt);
              const newDay = i === 0 || dayKey(shown[i - 1].receivedAt) !== day;
              const who = incoming ? null : senderPrefix(m.sender === "bot" ? "bot" : "eli");
              return (
                <li key={m.id} className="contents">
                  {newDay && <div className="th-day">{day}</div>}
                  <div className="th-msg" data-in={incoming || undefined} data-bot={m.sender === "bot" || undefined}>
                    <div className="txt">{messagePreview(m.text)}</div>
                    <div className="when tnum">
                      {who && <b>{who} · </b>}
                      {hhmm(m.receivedAt)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {panel === "chat" && (
        <form
          className="th-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="ux-sr" htmlFor="th-draft">
            תשובה ל-{name}
          </label>
          <textarea
            id="th-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="כתוב תשובה… נשלח בוואטסאפ ללקוח"
            rows={2}
          />
          <button type="submit" className="ux-btn primary" disabled={sending || !draft.trim()}>
            {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {sending ? "שולח…" : "שלח"}
          </button>
        </form>
      )}
    </section>
  );
}

// Hebrew labels for factory-quote statuses (LeadQuotesInline).
const STATUS_HE: Record<string, { text: string; tone: string }> = {
  draft: { text: "טיוטה", tone: "idle" },
  pending: { text: "ממתין למפעל", tone: "warn" },
  received: { text: "המפעל ענה", tone: "go" },
  finalized: { text: "סופי", tone: "good" },
};

interface InlineQuote {
  id: string;
  quotationNo: string | null;
  createdAt: string;
  factoryStatus: string;
  finalPricing: { totalSellingPrice?: number; totalOrderPriceIls?: number } | null;
  pdfUrl: string | null;
}

/**
 * The lead's factory quotes inside the conversation: open the PDF, send one on
 * WhatsApp (wa.me link — opens WhatsApp with the text ready, nothing is sent
 * from here), or tick 2+ final ones to combine them into one PDF.
 */
function LeadQuotesInline({ apiToken, sid, name, phone }: { apiToken: string; sid: string; name: string | null; phone: string | null }) {
  const [quotes, setQuotes] = useState<InlineQuote[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetch(`/api/widget/factory/list?widget_token=${encodeURIComponent(apiToken)}&lead=${encodeURIComponent(sid)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.ok) setQuotes(j.requests as InlineQuote[]);
        else setErr(j?.error ?? "load failed");
      })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "load failed"));
    return () => {
      alive = false;
    };
  }, [apiToken, sid]);

  if (err) return <p className="ux-note" style={{ color: "#f0c0c0" }}>לא הצלחתי לטעון הצעות: {err}</p>;
  if (!quotes) return <div className="ux-skel" style={{ height: 120 }} aria-label="טוען הצעות" />;
  if (quotes.length === 0) return <p style={{ color: "var(--lux-muted)" }}>אין הצעות מחיר ללקוח הזה.</p>;

  const cleanPhone = (phone ?? "").replace(/[^\d]/g, "");
  const origin = window.location.origin;
  const money = (qq: InlineQuote) => {
    const v = qq.finalPricing?.totalSellingPrice ?? qq.finalPricing?.totalOrderPriceIls;
    return typeof v === "number" ? `₪${Math.round(v).toLocaleString("he-IL")}` : "";
  };
  const wa = (lines: string[]) => `https://wa.me/${cleanPhone}?text=${encodeURIComponent([name ? `היי ${name},` : "היי,", ...lines, "ההצעה בתוקף ל-14 יום. נשמח לקבל אישור 🙂"].join("\n"))}`;
  const ids = [...selected].join(",");
  const sorted = [...quotes].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

  return (
    <div className="grid gap-3">
      <p style={{ margin: 0, fontSize: 14, color: "var(--lux-muted)" }}>
        {quotes.length} הצעות · סמן 2 סופיות או יותר כדי לאחד ל-PDF אחד
      </p>
      {selected.size >= 2 && (
        <div className="ux-acts" aria-live="polite">
          <span className="tnum" style={{ fontSize: 14 }}>{selected.size} נבחרו</span>
          <a className="ux-btn sm" href={`/api/factory/combine/pdf?ids=${ids}`} target="_blank" rel="noopener noreferrer">PDF משולב</a>
          {cleanPhone && (
            <a className="ux-btn sm go" href={wa([`מצורפת הצעת מחיר משולבת ל-${selected.size} מוצרים.`, `הצעה מלאה: ${origin}/api/factory/combine/pdf?ids=${ids}`])} target="_blank" rel="noopener noreferrer">
              פתח בוואטסאפ
            </a>
          )}
          <button type="button" className="ux-btn sm" onClick={() => setSelected(new Set())}>נקה</button>
        </div>
      )}
      <ul className="ux-list">
        {sorted.map((qq) => {
          const isFinal = qq.factoryStatus === "finalized" && !!qq.finalPricing;
          const st = STATUS_HE[qq.factoryStatus];
          return (
            <li key={qq.id} className="th-quote">
              {isFinal ? (
                <label className="qh-check">
                  <input
                    type="checkbox"
                    checked={selected.has(qq.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(qq.id)) next.delete(qq.id);
                        else next.add(qq.id);
                        return next;
                      })
                    }
                  />
                  <span className="ux-sr">בחר את הצעה {qq.quotationNo ?? qq.id.slice(-6)}</span>
                </label>
              ) : (
                <span style={{ width: 44 }} />
              )}
              <span className="main">
                <span className="tnum" style={{ fontFamily: "ui-monospace, monospace", color: "var(--lux-muted)" }}>{qq.quotationNo ?? qq.id.slice(-6)}</span>
                <span className="tnum" style={{ color: "var(--lux-muted)" }}>{new Date(qq.createdAt).toLocaleDateString("he-IL")}</span>
                <span className="ux-pill" data-tone={st?.tone ?? "idle"}>{st?.text ?? qq.factoryStatus}</span>
                {isFinal && <span className="tnum" style={{ color: "var(--lux-success, #a8c0a0)" }}>{money(qq)}</span>}
              </span>
              {isFinal && (
                <span className="ux-acts">
                  <a className="ux-btn sm" href={`/api/factory/${qq.id}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a>
                  {cleanPhone && (
                    <a className="ux-btn sm go" href={wa([`מצורפת הצעת מחיר #${qq.quotationNo ?? qq.id.slice(-6)}.`, `הצעה מלאה: ${origin}/api/factory/${qq.id}/pdf`])} target="_blank" rel="noopener noreferrer">
                      פתח בוואטסאפ
                    </a>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
