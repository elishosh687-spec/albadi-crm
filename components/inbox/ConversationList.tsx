"use client";

/**
 * שיחות — the conversation list (ui-ux-pro-max redesign, 18/09; replaces the
 * "צריכים אותך עכשיו" cockpit, whose rows showed only "—").
 *
 * Like WhatsApp: name, who wrote the last line and what, how long ago.
 * Customers waiting for OUR reply come first (longest wait on top); everyone
 * else by recency. Tapping a row opens the full conversation (the screen that
 * already works — InboxView), via CockpitShell. "בוט מושהה" shows only when
 * it is; stages in Eli's words. Read-only: no writes from this screen.
 */
import { useEffect, useMemo, useState } from "react";
import { PauseCircle, Search } from "lucide-react";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";
import { displayName, initials, messagePreview, senderPrefix, timeAgo, waitingLabel, WAITING_MAX_DAYS } from "@/lib/inbox/list-format";

export interface ConversationLead {
  sid: string;
  name: string | null;
  phone: string | null;
  /** Hebrew stage label (Eli's words), null before a quote. */
  stageLabel: string | null;
  lastText: string | null;
  lastSender: "lead" | "bot" | "eli" | null;
  /** ISO of the last message (either side). */
  lastAt: string | null;
  lastSenderIsLead: boolean;
  botPaused: boolean;
  /** Follow-up date passed (loadFollowupQueue). */
  overdue: boolean;
  /** Quote total, already ₪-formatted. */
  value: string | null;
}

const PAGE = 40;

export default function ConversationList({ leads, onOpen, renderedAt }: { leads: ConversationLead[]; onOpen: (sid: string) => void; /** server clock at render — the first client render uses it too, so hydration matches */ renderedAt: number }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  // `now` ticks each minute so "לפני 5 דק׳" stays true without a reload.
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return leads;
    const digits = s.replace(/\D/g, "");
    return leads.filter(
      (l) =>
        (l.name ?? "").toLowerCase().includes(s) ||
        (digits.length >= 3 && (l.phone ?? "").replace(/\D/g, "").includes(digits)) ||
        (l.lastText ?? "").toLowerCase().includes(s),
    );
  }, [leads, q]);

  const t = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
  const waiting = filtered
    .filter((l) => waitingLabel(l.lastAt, l.lastSenderIsLead, now))
    .sort((a, b) => t(a.lastAt) - t(b.lastAt));
  const waitingSids = new Set(waiting.map((l) => l.sid));
  const rest = filtered.filter((l) => !waitingSids.has(l.sid)).sort((a, b) => t(b.lastAt) - t(a.lastAt));
  const overdueCount = leads.filter((l) => l.overdue).length;
  const allWaiting = leads.filter((l) => waitingLabel(l.lastAt, l.lastSenderIsLead, now)).length;

  return (
    <LuxShell className="ux">
      <LuxTitle
        overline="— Conversations"
        subtitle="מי שמחכה לתשובה שלך למעלה, ואז כל השאר לפי ההודעה האחרונה. לחיצה פותחת את השיחה המלאה."
        aside={
          <div className="ux-chips" role="status">
            <span className="ux-chip" style={{ cursor: "default" }}>
              <span className="ux-dot" data-tone={allWaiting ? "warn" : undefined} aria-hidden />
              {allWaiting === 1 ? "לקוח אחד מחכה לך" : `${allWaiting} מחכים לך`}
            </span>
            {overdueCount > 0 && (
              <span className="ux-chip" style={{ cursor: "default" }}>
                <span className="ux-dot" data-tone="bad" aria-hidden />
                {overdueCount} מעקבים באיחור
              </span>
            )}
          </div>
        }
      >
        <LuxAccent>שיחות.</LuxAccent>
      </LuxTitle>

      <label className="ux-search">
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="ux-sr">חיפוש שיחה</span>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShown(PAGE);
          }}
          placeholder="חיפוש לפי שם, טלפון או הודעה"
          enterKeyHint="search"
        />
      </label>

      {filtered.length === 0 ? (
        <div className="ux-panel" style={{ textAlign: "center", color: "var(--lux-muted)" }}>
          {q ? `לא נמצאה שיחה עם ״${q}״.` : "אין שיחות פעילות."}
        </div>
      ) : (
        <>
          {waiting.length > 0 && (
            <section aria-labelledby="conv-waiting" style={{ marginBottom: 22 }}>
              <div className="ux-sechead">
                <h2 id="conv-waiting">מחכים לתשובה שלך · {waiting.length}</h2>
                <span className="hint">{WAITING_MAX_DAYS} הימים האחרונים · הכי ותיק למעלה</span>
              </div>
              <ul className="ux-list ux-convs">
                {waiting.map((l) => <Row key={l.sid} l={l} now={now} onOpen={onOpen} />)}
              </ul>
            </section>
          )}

          <section aria-labelledby="conv-rest">
            <div className="ux-sechead">
              <h2 id="conv-rest">{waiting.length ? "שאר השיחות" : "כל השיחות"} · {rest.length}</h2>
              <span className="hint">לפי ההודעה האחרונה</span>
            </div>
            <ul className="ux-list ux-convs">
              {rest.slice(0, shown).map((l) => <Row key={l.sid} l={l} now={now} onOpen={onOpen} />)}
            </ul>
            {rest.length > shown && (
              <button type="button" className="ux-btn" style={{ marginTop: 12, width: "100%" }} onClick={() => setShown((n) => n + PAGE)}>
                הצג עוד {Math.min(PAGE, rest.length - shown)} מתוך {rest.length - shown}
              </button>
            )}
          </section>
        </>
      )}
    </LuxShell>
  );
}

function Row({ l, now, onOpen }: { l: ConversationLead; now: number; onOpen: (sid: string) => void }) {
  const name = displayName(l.name, l.phone);
  const wait = waitingLabel(l.lastAt, l.lastSenderIsLead, now);
  const who = senderPrefix(l.lastSender);
  const text = messagePreview(l.lastText);
  return (
    <li>
      <button type="button" className="ux-conv" onClick={() => onOpen(l.sid)}>
        <span className="av" aria-hidden>{initials(name)}</span>
        <span className="main">
          <span className="top">
            <span className="nm">{name}</span>
            {l.stageLabel && <span className="stage">{l.stageLabel}</span>}
            {l.value && <span className="stage tnum">{l.value}</span>}
          </span>
          <span className="msg">
            {text ? (
              <>
                {who && <b>{who}: </b>}
                {text}
              </>
            ) : (
              <span style={{ color: "var(--lux-faint)" }}>עוד אין הודעות</span>
            )}
          </span>
          {(wait || l.botPaused || l.overdue) && (
            <span className="flags">
              {wait && <span className="ux-pill" data-tone="warn">{wait}</span>}
              {l.overdue && <span className="ux-pill" data-tone="stop">מעקב באיחור</span>}
              {l.botPaused && (
                <span className="ux-pill" data-tone="idle">
                  <PauseCircle className="size-3.5" aria-hidden /> בוט מושהה
                </span>
              )}
            </span>
          )}
        </span>
        <span className="when tnum">{timeAgo(l.lastAt, now)}</span>
      </button>
    </li>
  );
}
