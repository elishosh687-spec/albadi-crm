"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendManualReply,
  suggestRepliesAction,
  snoozeLead,
  setBotPaused,
  setLeadStage,
  updateLeadNotes,
} from "@/app/actions/v2";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import {
  V2_PIPELINE_STAGES,
  type V2PipelineStage,
} from "@/lib/manychat/stages";

export interface LeadDetailMessage {
  id: number | string;
  direction: "in" | "out";
  text: string;
  at: string | null;
}

interface Props {
  sid: string;
  name: string | null;
  phone: string | null;
  pipelineStage: string | null;
  pipelineFlag: string | null;
  botPaused: boolean;
  botSummary: string | null;
  notes: string | null;
  quoteTotal: string | null;
  messages: LeadDetailMessage[];
}

function formatStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadDetailView(props: Props) {
  const router = useRouter();
  const [composeText, setComposeText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [notes, setNotes] = useState(props.notes ?? "");
  const [stage, setStage] = useState(props.pipelineStage ?? "");
  const [paused, setPaused] = useState(props.botPaused);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [suggesting, startSuggest] = useTransition();

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 2500);
  }

  function onSend() {
    const t = composeText.trim();
    if (!t) {
      flash("err", "אין טקסט לשלוח");
      return;
    }
    start(async () => {
      const r = await sendManualReply(props.sid, t);
      if (r.ok) {
        flash("ok", "נשלח");
        setComposeText("");
        setSuggestions([]);
        router.refresh();
      } else {
        flash("err", r.error ?? "שליחה נכשלה");
      }
    });
  }

  function onSuggest() {
    setSuggestions([]);
    startSuggest(async () => {
      const r = await suggestRepliesAction(props.sid, hint || undefined);
      if (r.ok) {
        setSuggestions(r.replies);
      } else {
        flash("err", r.error ?? "כשל בהצעות");
      }
    });
  }

  function onSnooze(hours: number) {
    start(async () => {
      const r = await snoozeLead(props.sid, hours);
      if (r.ok) {
        flash("ok", r.message ?? "נדחה");
        router.refresh();
      } else {
        flash("err", r.error ?? "כשל");
      }
    });
  }

  function onTogglePause() {
    const next = !paused;
    start(async () => {
      const r = await setBotPaused(props.sid, next);
      if (r.ok) {
        setPaused(next);
        flash("ok", next ? "הבוט מושהה" : "הבוט פעיל");
        router.refresh();
      } else {
        flash("err", r.error ?? "כשל");
      }
    });
  }

  function onMarkDropped() {
    if (!confirm("לסמן את הליד כ-DROPPED? פעולה זו תוציא אותו מה-pipeline.")) return;
    start(async () => {
      const r = await setLeadStage({
        manychatSubId: props.sid,
        stage: "DROPPED" as V2PipelineStage,
        flags: [],
        reason: "Manual drop from lead detail",
      });
      if (r.ok) {
        flash("ok", "סומן DROPPED");
        setStage("DROPPED");
        router.refresh();
      } else {
        flash("err", r.error ?? "כשל");
      }
    });
  }

  function onChangeStage() {
    if (!stage || stage === props.pipelineStage) {
      flash("err", "אין שינוי");
      return;
    }
    start(async () => {
      const r = await setLeadStage({
        manychatSubId: props.sid,
        stage: stage as V2PipelineStage,
        flags: [],
        reason: `Manual stage change from lead detail (${props.pipelineStage ?? "none"} → ${stage})`,
      });
      if (r.ok) {
        flash("ok", `stage → ${stage}`);
        router.refresh();
      } else {
        flash("err", r.error ?? "כשל");
      }
    });
  }

  function onSaveNotes() {
    start(async () => {
      const r = await updateLeadNotes(props.sid, notes);
      if (r.ok) flash("ok", "הערות נשמרו");
      else flash("err", r.error ?? "כשל");
    });
  }

  function insertSuggestion(s: string) {
    setComposeText(s);
    setSuggestions([]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space.md }}>
      {msg && (
        <div
          style={{
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: 6,
            background: msg.kind === "ok" ? "#e6f4ea" : "#fdecec",
            color: msg.kind === "ok" ? colors.success : colors.danger,
            fontFamily: fontStack.body,
            fontSize: size.sm,
          }}
        >
          {msg.text}
        </div>
      )}

      {/* Bot summary banner */}
      {props.botSummary && (
        <Card title="סיכום הבוט">
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.ink,
              whiteSpace: "pre-wrap",
            }}
          >
            {props.botSummary}
          </div>
          {props.quoteTotal && (
            <div
              style={{
                marginTop: space.sm,
                fontFamily: fontStack.body,
                fontSize: size.sm,
                color: colors.inkMuted,
              }}
            >
              💰 מחיר משוער/סופי: <strong>{props.quoteTotal}</strong>
            </div>
          )}
        </Card>
      )}

      {/* Conversation thread */}
      <Card title={`שיחה — ${props.messages.length} הודעות אחרונות`}>
        <div
          dir="rtl"
          style={{
            maxHeight: 400,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: space.xs,
            padding: space.sm,
            background: colors.surfaceMuted,
            borderRadius: 6,
          }}
        >
          {props.messages.length === 0 && (
            <div
              style={{
                fontFamily: fontStack.body,
                fontSize: size.sm,
                color: colors.inkMuted,
                textAlign: "center",
                padding: space.md,
              }}
            >
              אין הודעות עדיין
            </div>
          )}
          {props.messages.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.direction === "in" ? "flex-start" : "flex-end",
                maxWidth: "75%",
                padding: `${space.xs}px ${space.sm}px`,
                borderRadius: 8,
                background: m.direction === "in" ? "white" : "#dcf8c6",
                fontFamily: fontStack.body,
                fontSize: size.sm,
                color: colors.ink,
                whiteSpace: "pre-wrap",
                border: `1px solid ${colors.rule}`,
              }}
            >
              <div>{m.text}</div>
              <div
                style={{
                  fontSize: size.xs,
                  color: colors.inkSubtle,
                  marginTop: 2,
                  textAlign: "left",
                  direction: "ltr",
                }}
              >
                {formatStamp(m.at)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Compose + suggest */}
      <Card title="כתוב תגובה ידנית">
        <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
          <textarea
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            placeholder="הקלד הודעה ידנית, או לחץ 'הצע תגובה' לקבל וריאציות מ-LLM"
            rows={4}
            dir="rtl"
            disabled={pending}
            style={{
              width: "100%",
              fontFamily: fontStack.body,
              fontSize: size.md,
              padding: `${space.sm}px ${space.md}px`,
              border: `1px solid ${colors.rule}`,
              borderRadius: 6,
              resize: "vertical",
              boxSizing: "border-box",
              minHeight: 90,
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
            <Button
              size="md"
              variant="primary"
              onClick={onSend}
              pending={pending}
              pendingText="שולח…"
            >
              שלח ב-WhatsApp
            </Button>
            <input
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder='הכוונה (לדוגמה: "תציע הנחה 10%")'
              disabled={suggesting}
              dir="rtl"
              style={{
                flex: 1,
                minWidth: 200,
                fontFamily: fontStack.body,
                fontSize: size.sm,
                padding: `${space.xs}px ${space.sm}px`,
                border: `1px solid ${colors.rule}`,
                borderRadius: 4,
              }}
            />
            <Button
              size="md"
              variant="ghost"
              onClick={onSuggest}
              pending={suggesting}
              pendingText="חושב…"
            >
              הצע תגובה (LLM)
            </Button>
          </div>

          {suggestions.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: space.xs,
                paddingTop: space.sm,
                borderTop: `1px dashed ${colors.rule}`,
              }}
            >
              <div
                style={{
                  fontFamily: fontStack.body,
                  fontSize: size.xs,
                  color: colors.inkMuted,
                  fontWeight: weight.medium,
                }}
              >
                {suggestions.length} הצעות — לחץ כדי להכניס לתיבה (אפשר לערוך לפני שליחה):
              </div>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => insertSuggestion(s)}
                  dir="rtl"
                  style={{
                    textAlign: "right",
                    fontFamily: fontStack.body,
                    fontSize: size.sm,
                    color: colors.ink,
                    background: "white",
                    border: `1px solid ${colors.rule}`,
                    borderRadius: 6,
                    padding: `${space.sm}px ${space.md}px`,
                    cursor: "pointer",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Quick actions */}
      <Card title="פעולות מהירות">
        <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" onClick={() => onSnooze(4)} disabled={pending}>
            דחה 4 שעות
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSnooze(24)} disabled={pending}>
            דחה 24 שעות
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSnooze(72)} disabled={pending}>
            דחה 3 ימים
          </Button>
          <Button
            size="sm"
            variant={paused ? "primary" : "ghost"}
            onClick={onTogglePause}
            disabled={pending}
          >
            {paused ? "המשך בוט" : "השהה בוט"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onMarkDropped}
            disabled={pending || stage === "DROPPED"}
          >
            סמן DROPPED
          </Button>
          {props.phone && (
            <a
              href={`tel:${props.phone}`}
              style={{
                fontFamily: fontStack.body,
                fontSize: size.sm,
                color: colors.accent,
                textDecoration: "none",
                alignSelf: "center",
                marginInlineStart: space.sm,
              }}
            >
              📞 חייג {props.phone}
            </a>
          )}
        </div>
      </Card>

      {/* Stage + notes */}
      <Card title="Stage + הערות">
        <div style={{ display: "flex", flexDirection: "column", gap: space.md }}>
          <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
            <label
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.inkMuted,
                fontWeight: weight.medium,
              }}
            >
              שלב נוכחי:
            </label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              disabled={pending}
              style={{
                fontFamily: fontStack.body,
                fontSize: size.sm,
                padding: `${space.xs}px ${space.sm}px`,
                border: `1px solid ${colors.rule}`,
                borderRadius: 4,
                background: "white",
              }}
            >
              <option value="">— בחר —</option>
              {V2_PIPELINE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={onChangeStage}
              disabled={pending || !stage || stage === props.pipelineStage}
            >
              שמור שלב
            </Button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
            <label
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.inkMuted,
                fontWeight: weight.medium,
              }}
            >
              הערות (custom field <code>notes</code>)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              dir="rtl"
              disabled={pending}
              style={{
                width: "100%",
                fontFamily: fontStack.body,
                fontSize: size.sm,
                padding: `${space.sm}px ${space.md}px`,
                border: `1px solid ${colors.rule}`,
                borderRadius: 6,
                resize: "vertical",
                boxSizing: "border-box",
                minHeight: 120,
              }}
            />
            <div>
              <Button size="sm" variant="ghost" onClick={onSaveNotes} disabled={pending}>
                שמור הערות
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
