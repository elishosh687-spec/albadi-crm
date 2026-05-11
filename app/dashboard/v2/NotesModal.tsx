"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { approveSuggestion, updateLeadNotes } from "@/app/actions/v2";
import {
  V2_PIPELINE_STAGES,
  type V2PipelineStage,
} from "@/lib/manychat/stages";

export interface NotesModalTarget {
  manychatSubId: string;
  leadName: string | null;
  initialNotes: string | null;
  suggestionId: number | null;
  suggestedStage: string | null;
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NotesModal({
  target,
  onClose,
}: {
  target: NotesModalTarget | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [overrideStage, setOverrideStage] = useState<string>("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state on target change.
  useEffect(() => {
    if (target) {
      const v = target.initialNotes ?? "";
      setValue(v);
      setSaved(v);
      setOverrideStage("");
      setMsg(null);
    }
  }, [target]);

  // Cleanup pending msg-clear timer on unmount.
  useEffect(() => {
    return () => {
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, []);

  // Esc closes the modal.
  useEffect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;

  const dirty = value !== saved;

  function flashMsg(text: string, isOk: boolean) {
    setMsg(text);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setMsg(null), 2500);
    if (!isOk) console.warn("Notes modal error:", text);
  }

  function onSave() {
    if (!target) return;
    start(async () => {
      const r = await updateLeadNotes(target.manychatSubId, value);
      if (r.ok) {
        setSaved(value);
        flashMsg("נשמר", true);
        router.refresh();
      } else {
        flashMsg(r.error ?? "כשל", false);
      }
    });
  }

  function onInsertStamp() {
    const stamp = `[${nowStamp()}] `;
    const next = value.length === 0 ? stamp : `${stamp}\n${value}`;
    setValue(next);
    // Focus textarea + put cursor right after stamp so Eli can type immediately.
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = stamp.length;
        ta.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  function onApplyOverride() {
    if (!target || !target.suggestionId || !overrideStage) return;
    start(async () => {
      const r = await approveSuggestion({
        suggestionId: target.suggestionId!,
        stage: overrideStage as V2PipelineStage,
        overrideReason: `Manual override from ${target.suggestedStage} to ${overrideStage}`,
      });
      if (r.ok) {
        flashMsg(`הסטייג שונה ל-${overrideStage}`, true);
        router.refresh();
        onClose();
      } else {
        flashMsg(r.error ?? "כשל", false);
      }
    });
  }

  function onBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      onMouseDown={onBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,24,21,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: space.lg,
      }}
    >
      <div
        style={{
          background: colors.surface,
          borderRadius: 8,
          padding: space.xl,
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: space.md,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3
            style={{
              margin: 0,
              fontFamily: fontStack.display,
              fontSize: size.lg,
              fontWeight: weight.medium,
              color: colors.ink,
            }}
          >
            {target.leadName ?? target.manychatSubId}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            style={{
              background: "transparent",
              border: "none",
              fontSize: size.lg,
              color: colors.inkMuted,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Notes section */}
        <section style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <label
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.inkMuted,
                fontWeight: weight.medium,
              }}
            >
              הערות (custom field <code>notes</code> ב-ManyChat)
            </label>
            <button
              type="button"
              onClick={onInsertStamp}
              disabled={pending}
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.accent,
                background: "transparent",
                border: "none",
                cursor: pending ? "not-allowed" : "pointer",
                padding: 0,
              }}
            >
              ＋ הוסף תאריך עכשיו
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`כתוב הערות כאן… (לחץ "הוסף תאריך" לפתוח שורה חדשה עם [${nowStamp()}])`}
            rows={8}
            dir="rtl"
            autoFocus
            style={{
              width: "100%",
              fontFamily: fontStack.body,
              fontSize: size.md,
              color: colors.ink,
              background: colors.surface,
              border: `1px solid ${dirty ? colors.accent : colors.rule}`,
              borderRadius: 6,
              padding: `${space.sm}px ${space.md}px`,
              resize: "vertical",
              lineHeight: 1.5,
              boxSizing: "border-box",
              minHeight: 180,
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
            <Button
              size="sm"
              variant="primary"
              onClick={onSave}
              disabled={!dirty || pending}
              pending={pending}
              pendingText="שומר…"
            >
              שמור הערות
            </Button>
          </div>
        </section>

        {/* Stage override section — only when there's an active pending suggestion */}
        {target.suggestionId && target.suggestedStage && (
          <section
            style={{
              borderTop: `1px solid ${colors.ruleSoft}`,
              paddingTop: space.md,
              display: "flex",
              flexDirection: "column",
              gap: space.sm,
            }}
          >
            <label
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.inkMuted,
                fontWeight: weight.medium,
              }}
            >
              העברת stage (Claude הציע: <strong>{target.suggestedStage}</strong>)
            </label>
            <div style={{ display: "flex", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={overrideStage}
                onChange={(e) => setOverrideStage(e.target.value)}
                disabled={pending}
                style={{
                  fontFamily: fontStack.body,
                  fontSize: size.sm,
                  padding: `${space.sm}px ${space.md}px`,
                  border: `1px solid ${colors.rule}`,
                  borderRadius: 6,
                  background: colors.surface,
                  color: colors.ink,
                }}
              >
                <option value="">— בחר stage חלופי —</option>
                {V2_PIPELINE_STAGES.filter((s) => s !== target.suggestedStage).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                onClick={onApplyOverride}
                disabled={!overrideStage || pending}
              >
                החל ושמור
              </Button>
            </div>
            <div
              style={{
                fontFamily: fontStack.body,
                fontSize: size.xs,
                color: colors.inkMuted,
              }}
            >
              החלה תרשם כ-<code>overridden</code>, תידחף ל-ManyChat (<code>pipeline_stage</code>) ותתועד ב-<code>eli_decisions</code>.
            </div>
          </section>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: space.sm, marginTop: space.sm }}>
          <Button size="md" variant="ghost" onClick={onClose} disabled={pending}>
            סגור
          </Button>
          {msg && (
            <span
              style={{
                fontFamily: fontStack.body,
                fontSize: size.sm,
                color: msg.startsWith("נשמר") || msg.startsWith("הסטייג") ? colors.success : colors.danger,
                marginInlineStart: space.sm,
              }}
            >
              {msg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
