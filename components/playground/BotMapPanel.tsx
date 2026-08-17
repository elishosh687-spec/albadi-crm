"use client";

/**
 * "מפת הבוט" — what the bot actually does, read live.
 *
 * Eli's standing complaint: the bot has been through many rounds of fixes and
 * there was no single place saying what it does at any given moment ("אני
 * טובע"). A written document answers that once and then rots, so this reads
 * the real settings row and the real job cursors on every open: the copy shown
 * here is the copy a customer receives, and "last ran" is measured.
 *
 * It sits next to the settings tab on purpose — every editable line jumps
 * straight to the knob that controls it, so reading the map and changing the
 * bot are the same motion.
 */
import { useEffect, useState } from "react";
import {
  BOT_SETTING_FIELDS,
  DEFAULT_BOT_SETTINGS,
  type BotSettings,
} from "@/lib/bot-settings/schema";
import { parseCadence, describeCadence } from "@/lib/autoresponder/followup-cadence";
import { PAUSE_REASON_LABELS } from "@/lib/autoresponder/bot-pause";

const C = {
  card: "rgba(255,255,255,0.025)",
  border: "rgba(255,255,255,0.08)",
  text: "#e8e4de",
  dim: "#9a938a",
  faint: "#6b645c",
  accent: "#c9a227",
  locked: "#c98157",
};

interface Pulse {
  cursors: Record<string, string>;
  pausedByReason: { reason: string; n: number }[];
  listening: number;
}

export default function BotMapPanel({
  apiToken,
  onEdit,
}: {
  apiToken: string;
  /** Jump to the settings tab — the map's whole value is that it's actionable. */
  onEdit: () => void;
}) {
  const [S, setS] = useState<BotSettings>(DEFAULT_BOT_SETTINGS);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const q = `widget_token=${encodeURIComponent(apiToken)}`;
        const [sRes, pRes] = await Promise.all([
          fetch(`/api/widget/bot-settings?${q}`),
          fetch(`/api/widget/bot-map?${q}`),
        ]);
        const sJson = await sRes.json();
        const pJson = await pRes.json();
        if (sJson.ok) setS(sJson.settings);
        if (pJson.ok) setPulse(pJson);
        if (!sJson.ok && !pJson.ok) setErr(sJson.error ?? pJson.error ?? "טעינה נכשלה");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [apiToken]);

  if (loading) return <div style={{ color: C.dim, fontSize: 13, padding: 12 }}>טוען…</div>;

  const label = (key: keyof BotSettings) =>
    BOT_SETTING_FIELDS.find((f) => f.key === key)?.label ?? String(key);
  const cadence = (key: keyof BotSettings, fb: number[]) =>
    describeCadence(parseCadence(S[key] as string, fb).hours);

  const pausedTotal = pulse?.pausedByReason.reduce((a, r) => a + r.n, 0) ?? 0;

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={lede}>
        מה הבוט עושה ברגע זה, לפי ההגדרות שלך. כל מה שמסומן{" "}
        <Tag kind="edit">ניתן לעריכה</Tag> נפתח בלחיצה.
      </p>
      {err && <div style={{ ...card, color: "#e0a0a0", marginBottom: 10 }}>{err}</div>}

      {/* ---------- pulse ---------- */}
      <H>דופק</H>
      <div style={grid}>
        <Stat n={pulse?.listening ?? 0} label="לידים שהבוט מקשיב להם" />
        <Stat n={pausedTotal} label="לידים מושתקים" muted />
        <Stat n={S.followupsEnabled ? "פעיל" : "כבוי"} label="תזכורות" muted={!S.followupsEnabled} />
        <Stat n={S.setterLiveEnabled ? "פעיל" : "כבוי"} label="מוח מכירות" muted={!S.setterLiveEnabled} />
      </div>

      <div style={{ ...card, marginTop: 8 }}>
        <Row k="תזכורות רצו לאחרונה" v={ago(pulse?.cursors["followups.lock"])} />
        <Row k="שיחות טלפון נקלטו" v={ago(pulse?.cursors["call_recordings.last_polled_at"])} />
        <Row k="סוכן קולי סונכרן" v={ago(pulse?.cursors["elevenlabs.last_polled_unix"])} last />
      </div>

      {pulse && pulse.pausedByReason.length > 0 && (
        <div style={{ ...card, marginTop: 8 }}>
          <div style={cardHead}>למה הבוט שותק, ואצל כמה</div>
          {pulse.pausedByReason.map((r, i) => (
            <Row
              key={r.reason}
              k={PAUSE_REASON_LABELS[r.reason as keyof typeof PAUSE_REASON_LABELS] ?? r.reason}
              v={String(r.n)}
              last={i === pulse.pausedByReason.length - 1}
            />
          ))}
          <p style={foot}>
            השתקה שנקבעה כי אדם נכנס לשיחה פגה מעצמה אחרי {S.autoResumeHours} שעות.
            בקשת הסרה, בקשה לדבר עם אדם, עסקה סגורה וכיבוי ידני — נשארים שקטים תמיד.
          </p>
        </div>
      )}

      {/* ---------- conversation ---------- */}
      <H sub="הטקסטים כאן הם בדיוק מה שהלקוח מקבל היום.">השיחה, שלב אחר שלב</H>

      <Phase n="1" title="הליד נכנס">
        <Quote text={S.openingMessage} name={label("openingMessage")} onEdit={onEdit} />
        {S.humanHandoffHintEnabled ? (
          <Quote text={S.humanHandoffHint} name={label("humanHandoffHint")} onEdit={onEdit} />
        ) : (
          <Meta text="ההצעה לעבור לבן אדם כבויה — הלקוח לא יידע שאפשר" />
        )}
      </Phase>

      <Phase n="2" title="השאלון">
        <Locked text="5 שאלות: שיטת משלוח · כמות · גודל · צבעי לוגו · אישור" />
        <Quote text={S.reask1} name={label("reask1")} onEdit={onEdit} />
        <Quote text={S.reask2} name={label("reask2")} onEdit={onEdit} />
        <Quote text={S.bailReply} name={label("bailReply")} onEdit={onEdit} />
        <Meta text={`מוותר אחרי ${S.reaskAttempts} פסילות · מינימום ${S.minQuantity.toLocaleString()} יח׳ · שאלות כסקר: ${S.pollsEnabled ? "כן" : "לא"}`} />
      </Phase>

      <Phase n="3" title="ההצעה">
        <Meta
          text={
            S.customSizeMode === "off"
              ? "מידה מחוץ לקטלוג → עוברת אליך, בלי מחיר אוטומטי"
              : S.customSizeMode === "range"
                ? `מידה מחוץ לקטלוג → טווח מחירים ±${S.customSizeRangePct}%`
                : "מידה מחוץ לקטלוג → מחיר מדויק מהאומדן"
          }
        />
        <Meta text={`חלופת משלוח: ${S.showAlternativeShipping ? "מוצגת" : "מוסתרת"} · קישור לשיחה: ${S.showBookingLink ? "מצורף" : "לא"}`} />
        {S.sendCompanyCard && <Quote text={S.companyCardText} name={label("companyCardText")} onEdit={onEdit} />}
        {S.sendDecisionPrompt && <Quote text={S.decisionPrompt} name={label("decisionPrompt")} onEdit={onEdit} />}
        <Quote text={S.factoryHoldMessage} name={label("factoryHoldMessage")} onEdit={onEdit} />
      </Phase>

      <Phase n="4" title="אחרי ההצעה">
        {S.setterLiveEnabled ? (
          <>
            <Meta text="12 תשובות (יקר לי · לא מעוניין · זמני אספקה · תנאי תשלום · קטלוג · שאלות) — מוח המכירות עונה בזמן אמת" />
            {S.setterPhrasesStateReplies ? (
              <Meta text='14 רגעי החלטה ("מתאים לי" · קבלת לוגו · שינוי מפרט · אישור סופי) — הקוד מבצע את המעבר, מוח המכירות מנסח' />
            ) : (
              <Locked text='14 רגעי החלטה — "מתאים לי", קבלת לוגו, שינוי מפרט, אישור סופי' />
            )}
          </>
        ) : (
          <Locked text="מוח המכירות כבוי בשיחה — כל 26 התשובות נאמרות כלשונן" />
        )}
        <Locked text="שאלת שינוי המפרט (הרשימה עצמה) · זמני אספקה 25/90 · תנאי תשלום 50/50" />
      </Phase>

      <Phase n="5" title="תזכורות">
        {S.followupsEnabled ? (
          <>
            <Cadence title="אחרי שנשלחה הצעה" text={cadence("followupCadenceIntake", [2, 12, 23])} onEdit={onEdit} />
            <Cadence title="נטש באמצע השאלון" text={cadence("followupCadenceMidQuestionnaire", [1, 1, 1])} onEdit={onEdit} />
            <Cadence title="מחכים ללוגו" text={cadence("followupCadenceAwaitingLogo", [2, 12, 23])} onEdit={onEdit} />
            <Cadence title="אחרי המחיר הסופי" text={cadence("followupCadenceConsideration", [2, 12, 23])} onEdit={onEdit} />
            <Cadence title="חידוש קשר (חוזר ללא הגבלה)" text={cadence("followupCadenceReengage", [72])} onEdit={onEdit} />
            <Meta text={`עד ${S.followupMaxAttempts} תזכורות ואז הליד עובר אליך · שקט 21:00–09:00 · לא בשישי־שבת וחג`} />
          </>
        ) : (
          <Meta text="התזכורות כבויות — אף לקוח לא מקבל תזכורת" />
        )}
        {S.setterWritesFollowups ? (
          <Meta
            text={
              "הנוסח נכתב מחדש לכל לקוח ע״י מוח המכירות · אם הניסוח נכשל נשלח הטקסט הקבוע" +
              (S.followupSupervisorEnabled ? " · שכבת מפקח דלוקה מעליו" : "")
            }
          />
        ) : (
          <Locked text="נוסח 13 התזכורות הקבועות" />
        )}
      </Phase>

      {/* ---------- calls ---------- */}
      <H sub="כל שיחה שנענתה מתומללת, מנותחת, ונכתבת כהערה בכרטיס הלקוח.">שיחות טלפון</H>
      <div style={card}>
        <Row k="מה נכנס להערה" v="סיכום · צרכי לקוח · התנגדויות עם ציטוטים · מחיר · צעדים הבאים · התמלול המלא" />
        <Row k="אם סוכם מועד חזרה" v="נפתחת משימה אוטומטית" />
        <Row k="שיחה שלא נענתה" v="נרשמת בלי תמלול, מעדכנת את תאריך השיחה האחרונה" />
        <Row k="הגנה מהמצאות" v="כל ציטוט נבדק מול התמלול; מה שלא נמצא נמחק" />
        <Row k="עלות" v="כ-4 אגורות לשיחה שנענתה · ללא מענה חינם" last />
      </div>
      <p style={foot}>
        ⚠️ ניתוח השיחות רץ על המודל הזול ביותר. ההגדרה "מודל ניתוח" משפיעה על ניתוח
        הלידים בלבד, לא על סיכומי השיחות.
      </p>

      {/* ---------- models ---------- */}
      <H sub="ארבע עבודות שונות, ארבעה מודלים. כולן נבחרות מההגדרות.">מי עושה מה</H>
      <div style={card}>
        <ModelRow
          job="עונה ללקוחות"
          what="מנסח כל תשובה ותזכורת — זה שמדבר בפועל"
          model={S.setterModel}
          onEdit={onEdit}
        />
        <ModelRow
          job="מתמלל שיחות טלפון"
          what="ממיר הקלטה לטקסט"
          model={S.transcribeModel}
          onEdit={onEdit}
        />
        <ModelRow
          job="מנתח את התמלול"
          what="סיכום השיחה, התנגדויות, מה סוכם, מועד חזרה"
          model={S.analysisModel}
          onEdit={onEdit}
        />
        <ModelRow
          job="כותב מה הצעד הבא"
          what="למה הליד תקוע, מה החסם, מה לעשות"
          model={S.analysisModel}
          onEdit={onEdit}
        />
        <ModelRow
          job="מבין מה הלקוח אמר"
          what="סיווג כוונות וחילוץ מידות וכמויות מהשאלון"
          model={S.intentModel}
          onEdit={onEdit}
          last
        />
      </div>
      <p style={foot}>
        המודל היקר לא תמיד עדיף: הבנת כוונות היא משימה פשוטה שרצה על כל הודעה,
        וניסוח מכירתי הוא לא. אם סיכומי השיחות מרגישים שטחיים — זה "מנתח את
        התמלול".
      </p>

      {/* ---------- locked ---------- */}
      <H sub="דורש מתכנת. לפי סדר הכדאיות לשחרר.">מה עדיין לא ניתן לשינוי</H>
      <div style={{ ...card, marginBottom: 30 }}>
        <Row k="התשובות שאחרי ההצעה" v="כולל זמן אספקה ותנאי תשלום" />
        <Row k="שעות שקט וימי מנוחה" v="21:00–09:00, ללא שישי־שבת וחג" />
        <Row k="נוסח 5 שאלות השאלון" v="אפשר רק להחליף סקר בטקסט חופשי" />
        <Row k="הכמויות והמידות שמוצגות" v={`המינימום ${S.minQuantity.toLocaleString()} אבל הכפתורים קבועים`} last />
      </div>
    </div>
  );
}

/* ------------------------------- pieces ------------------------------- */

function ago(iso: string | undefined): string {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `לפני ${hrs} שעות`;
  return `לפני ${Math.round(hrs / 24)} ימים`;
}

function H({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ marginTop: 22, marginBottom: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{children}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Phase({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
      <div style={phaseNum}>{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>{children}</div>
      </div>
    </div>
  );
}

function Quote({ text, name, onEdit }: { text: string; name: string; onEdit: () => void }) {
  return (
    <button onClick={onEdit} style={{ ...card, ...btnReset, textAlign: "start" }} className="lux-tap">
      <div style={{ fontSize: 12.5, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{text}</div>
      <div style={{ marginTop: 6 }}>
        <Tag kind="edit">{name} ←</Tag>
      </div>
    </button>
  );
}

function Cadence({ title, text, onEdit }: { title: string; text: string; onEdit: () => void }) {
  return (
    <button
      onClick={onEdit}
      className="lux-tap lux-wrap-sm"
      style={{ ...card, ...btnReset, display: "flex", gap: 8, justifyContent: "space-between", alignItems: "baseline", textAlign: "start" }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 11.5, color: C.accent }}>{text}</span>
    </button>
  );
}

function ModelRow({
  job,
  what,
  model,
  onEdit,
  last,
}: {
  job: string;
  what: string;
  model: string;
  onEdit: () => void;
  last?: boolean;
}) {
  return (
    <button
      onClick={onEdit}
      className="lux-tap lux-wrap-sm"
      style={{
        ...btnReset,
        display: "flex",
        gap: 10,
        alignItems: "baseline",
        justifyContent: "space-between",
        textAlign: "start",
        padding: "7px 0",
        background: "transparent",
        border: "none",
        borderBottom: last ? "none" : `1px solid rgba(255,255,255,0.05)`,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, display: "block" }}>{job}</span>
        <span style={{ fontSize: 11, color: C.faint }}>{what}</span>
      </span>
      <span
        style={{
          fontSize: 11,
          color: C.accent,
          whiteSpace: "nowrap",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      >
        {model}
      </span>
    </button>
  );
}

function Locked({ text }: { text: string }) {
  return (
    <div style={{ ...card, display: "flex", gap: 8, alignItems: "baseline" }} className="lux-wrap-sm">
      <span style={{ fontSize: 12.5, flex: 1 }}>{text}</span>
      <Tag kind="lock">קבוע בקוד</Tag>
    </div>
  );
}

function Meta({ text }: { text: string }) {
  return <div style={{ fontSize: 11.5, color: C.faint, padding: "0 2px", lineHeight: 1.6 }}>{text}</div>;
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div
      className="lux-wrap-sm"
      style={{
        display: "flex",
        gap: 10,
        justifyContent: "space-between",
        padding: "5px 0",
        borderBottom: last ? "none" : `1px solid rgba(255,255,255,0.05)`,
      }}
    >
      <span style={{ fontSize: 12, color: C.dim, flex: "0 0 auto" }}>{k}</span>
      <span style={{ fontSize: 12, textAlign: "start", flex: 1 }}>{v}</span>
    </div>
  );
}

function Stat({ n, label, muted }: { n: number | string; label: string; muted?: boolean }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 21, fontWeight: 600, color: muted ? C.faint : C.accent, fontVariantNumeric: "tabular-nums" }}>
        {typeof n === "number" ? n.toLocaleString() : n}
      </div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 2, lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}

function Tag({ kind, children }: { kind: "edit" | "lock"; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        padding: "2px 6px",
        borderRadius: 3,
        whiteSpace: "nowrap",
        background: kind === "edit" ? "rgba(201,162,39,0.13)" : "rgba(168,81,42,0.13)",
        color: kind === "edit" ? C.accent : C.locked,
      }}
    >
      {children}
    </span>
  );
}

const lede: React.CSSProperties = { fontSize: 12.5, color: C.dim, margin: "0 0 14px", lineHeight: 1.7 };
const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "10px 12px",
};
const btnReset: React.CSSProperties = {
  width: "100%",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  display: "block",
};
const cardHead: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, marginBottom: 4 };
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: 8,
};
const phaseNum: React.CSSProperties = {
  flex: "0 0 24px",
  height: 24,
  borderRadius: "50%",
  background: "rgba(201,162,39,0.13)",
  color: C.accent,
  fontSize: 12,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const foot: React.CSSProperties = { fontSize: 11, color: C.faint, lineHeight: 1.7, marginTop: 8 };
